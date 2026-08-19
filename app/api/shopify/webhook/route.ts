import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { cleanInput } from "@/lib/auth";
import { decodeHtmlEntities } from "@/lib/htmlEntities";
import { decodeSku, buildSkuFromAvisNamesDetailed, ensureSkuMaps, skuMapsUnavailable, modificationMap } from "@/lib/skuDecoder";
import { parseModifications } from "@/lib/modifications";
import type { ReviewReason } from "@/lib/data";
import { isSampleVendor } from "@/lib/data";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

/**
 * Log a webhook outcome so an order that fails to appear is diagnosable.
 *
 * This route previously logged nothing at all, which meant "Shopify never
 * called us", "called and the insert was rejected" and "called with a bad
 * HMAC" were indistinguishable from the box -- and the Shopify admin
 * webhook page shows stale delivery data.
 *
 *   docker logs <container> | grep shopify-webhook
 *
 * METADATA ONLY. Never customer names, addresses or line detail.
 */
function logWebhook(outcome: string, extra?: Record<string, unknown>) {
  console.warn("[shopify-webhook]", JSON.stringify({ outcome, ...extra }));
}

// Reject payloads larger than 5 MB — Shopify's largest legitimate order payloads
// are well under 1 MB; anything larger is either malformed or an abuse attempt.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Normalize incoming free text from Shopify.
 *
 * Shopify occasionally serves text with HTML entities pre-encoded in
 * JSON payloads (e.g. `&amp;` in a line-item name). The rest of the app
 * stores raw characters and lets React / `escapeHtml()` handle escaping
 * at render time, so we decode here at the ingress boundary to get
 * everything onto the same convention. This is the only place in the
 * codebase that decodes — all reads downstream treat stored text as raw.
 *
 * Then trim via `cleanInput`. Idempotent on already-raw strings; the
 * decode is a no-op when no entities are present.
 */
function shopifyInput(s: unknown): string {
  if (typeof s !== "string") return "";
  return cleanInput(decodeHtmlEntities(s));
}

/**
 * Verify the Shopify HMAC signature.
 *
 * Previous bug: `timingSafeEqual` throws when the two buffers have different
 * lengths. Without an explicit length check, an attacker controlling the
 * header could trigger the catch and short-circuit the comparison via the
 * thrown error (which we already returned false from, but only for that
 * accidental reason). We now compare HMAC bytes (decoded from base64) of
 * known length, which is both correct and constant-time.
 */
function verifyShopifyHmac(body: string, hmacHeader: string): boolean {
  if (!SHOPIFY_SECRET) return false;
  if (!hmacHeader) return false;

  const expected = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(body, "utf8")
    .digest(); // raw Buffer

  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Does a composite SKU legitimately derive from the variant's own SKU?
 *
 * `properties[_sku]` is written by the storefront bridge (sku-avis-bridge.js)
 * and is therefore CLIENT-SETTABLE — a buyer can forge it via devtools or a
 * hand-rolled /cart/add.js call. The line item's `sku` comes from Shopify's
 * product data and cannot be tampered with, so it is the authority.
 *
 * A legitimate composite is the variant SKU, optionally followed by a
 * separator plus vendor-specific suffixes:
 *   HCI       B09FHD  -> B09FHD-MSL
 *   Waypoint  B24     -> B24-570F-PN
 *   J&K       B24-S1  -> B24-S1        (the bridge's append is idempotent)
 *
 * The separator check is what stops variant B24 from accepting a forged
 * "B240-570F-PN" (a real, different base SKU) as a match.
 */
function compositeMatchesVariant(composite: string, variantSku: string): boolean {
  const c = composite.trim().toUpperCase();
  const v = variantSku.trim().toUpperCase();
  if (!c || !v) return true; // nothing authoritative to compare against
  if (c === v) return true;
  if (!c.startsWith(v)) return false;
  const next = c.charAt(v.length);
  return next !== "" && !/[A-Z0-9]/.test(next);
}

/**
 * Activity-trail wording for a rejected `_sku`. Shared by the create and
 * update paths so the two produce byte-identical text — the update path
 * dedupes against it.
 */
function skuMismatchNote(a: { description: string; claimed: string; actual: string }): string {
  return `SKU mismatch on "${a.description}" \u2014 submitted "${a.claimed}" does not match the variant SKU "${a.actual}". Submitted value ignored; SKU rebuilt from the variant.`;
}

function buildOrder(payload: Record<string, unknown>) {
  const lineItems = (payload.line_items as Array<Record<string, unknown>>) ?? [];
  const customer = (payload.customer as Record<string, unknown>) ?? {};
  const billingAddress = (payload.billing_address as Record<string, unknown>) ?? {};
  const shippingAddress = (payload.shipping_address as Record<string, unknown>) ?? {};

  const firstName = String(customer.first_name ?? billingAddress.first_name ?? "");
  const lastName = String(customer.last_name ?? billingAddress.last_name ?? "");
  const customerName = [firstName, lastName].filter(Boolean).join(" ")
    || String(payload.email ?? "") || "Unknown Customer";

  const customerEmail = String(customer.email ?? payload.email ?? "");
  const customerPhone = String(customer.phone ?? billingAddress.phone ?? shippingAddress.phone ?? "");

  const sa = shippingAddress;
  const shipParts = [
    String(sa.address1 ?? ""),
    String(sa.address2 ?? ""),
    String(sa.city ?? ""),
    String(sa.province_code ?? ""),
    String(sa.zip ?? ""),
  ].filter(Boolean);
  const shipTo = shipParts.length > 0 ? shipParts.join(", ") : "";

  const itemNames = lineItems.map(i => String(i.name ?? "")).filter(Boolean);
  const detail = itemNames.length > 1
    ? `${itemNames.slice(0, 2).join(", ")}${itemNames.length > 2 ? ` +${itemNames.length - 2} more` : ""}`
    : itemNames[0] ?? "Shopify order";

  // Lines whose submitted `_sku` failed validation. Collected here (buildOrder
  // is pure / DB-free) and written to order_activity by the caller.
  const skuAnomalies: Array<{ description: string; claimed: string; actual: string }> = [];
  // Human-readable notes for lines flagged needs_review (unmapped / decoder
  // unavailable / missing sku). Written to order_activity by the caller;
  // deduped on the repeat-firing update path.
  const reviewNotes: string[] = [];

  // Maps are warmed by `await ensureSkuMaps()` in the caller before buildOrder
  // runs. If the table couldn't load, this is stable for the whole pass and
  // every line is flagged decoder_unavailable (never a crash, never dropped).
  const mapsDown = skuMapsUnavailable();

  const skuItems = lineItems.map(i => {
    const props = (i.properties as Array<{ name: string; value: string }>) ?? [];

    // Avis names the door/color option properties "_Door Style 1" / "Color
    // Selection 1" — a hidden-underscore variant plus a trailing selection
    // index — and older/other configs use the bare or visible form. Match the
    // whole family so Waypoint decodes regardless of the exact Avis naming.
    // Match on the TRIMMED name: label_cart comes straight from Avis, so a
    // stray space there ("Door Style 1 ") would otherwise match nothing.
    const getPropLike = (re: RegExp) =>
      props.find(p => re.test((p.name ?? "").trim()))?.value ?? "";

    const skuProp = props.find(p => p.name === "_sku");
    // Blank-aware base: a Shopify sku of "" (empty, not null) must still fall
    // back to variant_id. The old `??` kept the empty string and the line was
    // then dropped by `.filter`; now it falls back, and a line with nothing at
    // all is KEPT + flagged missing_sku rather than silently disappearing.
    const variantIdStr = String(i.variant_id ?? "");
    const rawSku = typeof i.sku === "string" ? i.sku.trim() : "";
    const baseVariantSku = rawSku || variantIdStr;
    // The variant's own SKU from Shopify product data — the tamper-proof
    // authority. Deliberately NOT baseVariantSku (which falls back to the
    // numeric variant_id), so validation compares against a real SKU only.
    const variantSku = rawSku;

    const avisDoorStyle   = getPropLike(/^_?Door\s*Style(\s*\d+)?$/i);
    const avisColorSelect = getPropLike(/^_?Color\s*Selection(\s*\d+)?$/i);

    const desc = String(i.name ?? "");
    let sku = (skuProp?.value ?? "").trim();
    let reviewReason: ReviewReason | null = null;

    // (a) Forged `_sku` (client-settable) — verify it derives from the real
    // variant SKU. Cache-independent, so always checked. On mismatch: record
    // the anomaly (caller writes the activity note), flag the line, and fall
    // through to the rebuild chain so the stored value is authoritative.
    if (sku && variantSku && !compositeMatchesVariant(sku, variantSku)) {
      skuAnomalies.push({ description: desc, claimed: sku, actual: variantSku });
      reviewReason = "sku_mismatch";
      sku = "";
    }

    // (b) Rebuild from Avis names (Waypoint) — only when maps are available.
    // If the names are present but not yet coded, keep the raw base and flag
    // unmapped_value, naming which value is missing so an admin knows what to add.
    if (!mapsDown && !sku && baseVariantSku && avisDoorStyle && avisColorSelect) {
      const built = buildSkuFromAvisNamesDetailed(baseVariantSku, avisDoorStyle, avisColorSelect);
      if (built.sku) {
        sku = built.sku;
      } else {
        sku = baseVariantSku;
        if (!reviewReason) {
          reviewReason = "unmapped_value";
          const which = [
            built.unmappedDoor ? `door "${built.unmappedDoor}"` : "",
            built.unmappedColor ? `color "${built.unmappedColor}"` : "",
          ].filter(Boolean).join(" and ");
          reviewNotes.push(`Needs review on "${desc}" \u2014 ${which || "value"} not yet mapped to a SKU code; kept raw SKU "${shopifyInput(baseVariantSku)}".`);
        }
      }
    }

    // (c) Fall back to the base SKU.
    if (!sku) sku = baseVariantSku;

    // (d) Truly no SKU anywhere: KEEP the line with an identifiable placeholder
    // (so multiple such lines don't collide on the reconcile SKU key) and flag
    // missing_sku. Suppressed when mapsDown — (e) supersedes with one note.
    if (!sku) {
      sku = variantIdStr || `NO-SKU:${desc.slice(0, 40) || "line"}`;
      if (!reviewReason && !mapsDown) {
        reviewReason = "missing_sku";
        reviewNotes.push(`Needs review on "${desc}" \u2014 Shopify line had no SKU; kept placeholder "${shopifyInput(sku)}".`);
      }
    }

    const normSku = shopifyInput(sku);

    // (e) Systemic: the mapping table couldn't load, so this line was
    // interpreted with no maps at all. Highest precedence (agreed): supersede
    // any same-line reason. A superseded sku_mismatch is still preserved in
    // skuAnomalies -> the activity trail, so nothing is lost.
    if (mapsDown) {
      reviewReason = "decoder_unavailable";
      reviewNotes.push(`Needs review on "${desc}" \u2014 SKU mapping table unavailable at ingest; kept raw SKU "${normSku}". Re-decode once mappings load.`);
    }

    // Persisted display fields — decode for ALL vendors so the client never
    // decodes; Avis names are the fallback. Blank for an uninterpretable line.
    const decoded = mapsDown ? null : decodeSku(normSku);
    const door_style = decoded?.doorStyle || shopifyInput(avisDoorStyle) || "";
    const color      = decoded?.color     || shopifyInput(avisColorSelect) || "";

    // Waypoint modifications -> attaching sub-SKUs (RD-4, ID-13, RTKL, ...).
    // Skipped when maps are down (the line is already decoder_unavailable).
    const mods = mapsDown
      ? { subs: [], unmapped: [], missingValue: [] }
      : parseModifications(props, modificationMap());
    // Mod flags are lower priority than a SKU decode issue: only set a
    // reason if the line isn't already flagged.
    if (!reviewReason && mods.unmapped.length > 0) {
      reviewReason = "unmapped_value";
      reviewNotes.push(`Needs review on "${desc}" \u2014 modification "${mods.unmapped[0]}" not yet mapped to a SKU code.`);
    } else if (!reviewReason && mods.missingValue.length > 0) {
      reviewReason = "missing_mod_value";
      reviewNotes.push(`Needs review on "${desc}" \u2014 modification "${mods.missingValue[0]}" is missing its depth value.`);
    }

    // Everything the decoder did not consume. The extractors above pull out
    // the door style and colour they recognise; this keeps the rest, so a
    // property under an unexpected name is visible instead of discarded.
    //
    // Hidden properties are skipped, matching the storefront Liquid: a
    // leading "_" is Shopify's hidden convention and "_apo" belongs to the
    // options app.
    const visibleProps = props
      .filter(p => {
        const n = String(p?.name ?? "").trim();
        const v = String(p?.value ?? "").trim();
        if (!n || !v) return false;
        if (n.startsWith("_")) return false;
        if (n.toLowerCase().includes("_apo")) return false;
        return true;
      })
      .slice(0, 20)
      .map(p => ({
        name: shopifyInput(String(p.name).trim()).slice(0, 100),
        value: shopifyInput(String(p.value).trim()).slice(0, 300),
      }));

    return {
      sku: normSku,
      // Globally-unique Shopify variant id, captured at ingest. Authoritative
      // key for vendor resolution (shopify_products.id) — two vendors can share
      // a base SKU but never a variant_id.
      variant_id: variantIdStr,
      quantity: Number(i.quantity ?? 1),
      description: shopifyInput(desc),
      door_style,
      color,
      ...(mods.subs.length > 0 ? { modifications: mods.subs } : {}),
      ...(visibleProps.length > 0 ? { properties: visibleProps } : {}),
      ...(reviewReason ? { needs_review: true, review_reason: reviewReason } : {}),
    };
  });

  const skus = skuItems.map(i => i.sku).filter(Boolean).join(", ");

  const firstDecodedSku = skuItems.find(i => i.sku) ? decodeSku(skuItems.find(i => i.sku)!.sku) : null;
  const decodedDoorStyle = firstDecodedSku?.doorStyle ?? "";
  const decodedColor     = firstDecodedSku?.color     ?? "";

  const orderNumber = String(payload.order_number ?? payload.name ?? "");
  const note = String(payload.note ?? "");
  const notes = note || "";

  const shippingLines = (payload.shipping_lines as Array<Record<string, unknown>>) ?? [];
  const deliveryMethod = shippingLines.length > 0
    ? String(shippingLines[0].title ?? "")
    : "";

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

  // All free-text strings normalized via shopifyInput before return.
  return {
    customerName: shopifyInput(customerName),
    customerEmail: shopifyInput(customerEmail),
    customerPhone: shopifyInput(customerPhone),
    shipTo: shopifyInput(shipTo),
    deliveryMethod: shopifyInput(deliveryMethod),
    detail: shopifyInput(detail),
    skus,
    skuItems,
    skuAnomalies,
    reviewNotes,
    notes: shopifyInput(notes),
    today,
    orderNumber: shopifyInput(orderNumber),
    decodedDoorStyle: shopifyInput(decodedDoorStyle),
    decodedColor: shopifyInput(decodedColor),
  };
}

export async function POST(req: NextRequest) {
  // Pre-emptively reject oversized payloads (defense in depth — also check
  // Content-Length if present).
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    // A rejected HMAC and a webhook that never arrived look identical
    // without this line.
    logWebhook("hmac_rejected", { topic, body_bytes: rawBody.length });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // ─── Product updated ────────────────────────────────────────────
  // Keep shopify_products current automatically. Without this, the table only
  // refreshes on a manual sync, which is what let a stale/edited vendor drift
  // (the B24 collision). Upserts one row per variant, matching the sync route's
  // row shape exactly (onConflict: "id"), so auto- and manual-synced rows are
  // identical. Handled here, before the order-id guard, since a product payload
  // is not an order.
  if (topic === "products/update") {
    const productId = String(payload.id ?? "");
    if (!/^\d+$/.test(productId)) {
      return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
    }
    const variants = (payload.variants as Array<Record<string, unknown>>) ?? [];
    const vendorName = String(payload.vendor ?? "").trim();
    const title = String(payload.title ?? "");
    const rows = variants.map(variant => ({
      id: String(variant.id),
      title: `${title}${variants.length > 1 ? ` - ${String(variant.title ?? "")}` : ""}`,
      sku: String(variant.sku ?? ""),
      vendor: vendorName,
      variant_id: String(variant.id),
      price: parseFloat(String(variant.price ?? "0")),
      inventory_quantity: Number(variant.inventory_quantity ?? 0),
      synced_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await supabase
        .from("shopify_products")
        .upsert(rows, { onConflict: "id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ received: true, synced: rows.length });
  }

  const shopifyId = String(payload.id ?? "");
  if (!/^\d+$/.test(shopifyId)) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // Whitelist topics — ignore anything else silently to avoid leaking which
  // topics we handle.
  // Shopify delivers order deletion as "orders/delete" (singular). The
  // original set only had "orders/deleted", so a deletion would have been
  // dropped as an unhandled topic. Both are accepted rather than betting on
  // which spelling Shopify uses.
  const ALLOWED_TOPICS = new Set(["orders/create", "orders/updated", "orders/cancelled", "orders/delete", "orders/deleted", "products/update"]);
  if (!ALLOWED_TOPICS.has(topic)) {
    return NextResponse.json({ received: true, skipped: "unhandled_topic" });
  }

  // ─── New order ────────────────────────────────────────────────────────────
  if (topic === "orders/create") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();
    if (existing) {
      logWebhook("duplicate", { shopify_id: shopifyId, existing_id: existing.id });
      return NextResponse.json({ received: true, skipped: "duplicate" });
    }

    // Warm the mapping cache before decoding. Degrade, never crash: a failed
    // load leaves skuMapsUnavailable() true and every line is flagged
    // decoder_unavailable, so the order still ingests.
    try { await ensureSkuMaps(); } catch { /* degrade to decoder_unavailable */ }
    const { customerName, customerEmail, customerPhone, shipTo, deliveryMethod, detail, skus, skuItems, skuAnomalies, reviewNotes, notes, today, orderNumber, decodedDoorStyle, decodedColor } = buildOrder(payload);
    const orderId = orderNumber ? `SHO-${orderNumber}` : `SHO-${shopifyId.slice(-6)}`;

    // Resolve the order-level vendor through the SAME layered resolver used at
    // read time (variant_id -> family -> base SKU), so the stamp is consistent
    // with the per-line vendor shown in the order panel and PDFs.
    //
    // EVERY line is resolved, not just the first. Two things depend on it:
    // the order-level vendor stamp (still the first line's, for display
    // consistency), and sample classification, which is a statement about
    // ALL lines. lookupVendorsForSkus batches its queries, so resolving the
    // whole order is the same number of round-trips as resolving one line.
    let vendorName = "";
    const resolvableItems = skuItems.filter(i => i.sku);
    if (resolvableItems.length > 0) {
      const { vendorBySku } = await lookupVendorsForSkus(resolvableItems);
      vendorName = vendorBySku.get(resolvableItems[0].sku) ?? "";
    }

    // ── Sample classification ────────────────────────────────────────────
    // Read line_items[].vendor from the PAYLOAD, not the SKU resolver.
    //
    // The resolver is keyed entirely on the SKU, and JK's sample products
    // carry an empty sku in shopify_products -- so routing classification
    // through it produced an empty item list and silently classified every
    // sample as a standard order.
    //
    // The payload always carries the vendor per line, and this is the same
    // field the storefront Liquid reads for its "What happens next" block, so
    // the two systems cannot disagree about what a sample order is.
    const payloadLines = (payload.line_items as Array<Record<string, unknown>>) ?? [];
    const lineVendors = payloadLines.map(l => String(l.vendor ?? "").trim());

    // Every line must be JK stock. A mixed order is STANDARD: if samples ever
    // arrive alongside cabinetry, the cabinetry drives the pipeline. A line
    // with no vendor is unknown, and unknown is never assumed to be JK -- so
    // the order keeps the full pipeline and the ack gate.
    const orderType: "order" | "sample" =
      lineVendors.length > 0 && lineVendors.every(v => v !== "" && isSampleVendor(v))
        ? "sample"
        : "order";

    // Fall back to the payload for the order-level vendor stamp when the
    // resolver found nothing -- an unsynced or SKU-less product, exactly the
    // case above, would otherwise leave this blank.
    if (!vendorName && lineVendors.length > 0) {
      vendorName = lineVendors[0];
    }

    const { error } = await supabase.from("orders").insert({
      id: orderId,
      // Classified above from the resolved vendors of every line.
      type: orderType,
      name: customerName,
      source: "Shopify",
      detail,
      stage: "New",
      // No team member assigned at ingest — the order is "unclaimed" until
      // someone clicks Claim. The avatar will populate from claimed_by /
      // entered_by, not from this field.
      member: "",
      date: today,
      sku: skus || "—",
      notes,
      archived: false,
      shopify_id: shopifyId,
      sku_items: skuItems,
      needs_review: skuItems.some(i => i.needs_review),
      door_style: decodedDoorStyle,
      color: decodedColor,
      delivery_window: "",
      delivery_notes: "",
      vendor: shopifyInput(vendorName),
      ship_to: shipTo,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      delivery_method: deliveryMethod,
      // Shopify financial_status — drives the Payment column on order tables.
      // Common values: paid, partially_paid, pending, refunded, voided.
      payment_status: payload.financial_status ?? null,
    });

    if (error) {
      // The type CHECK constraint rejected samples and custom orders for
      // three weeks without a single log line. Never again.
      logWebhook("insert_failed", {
        order_id: orderId, shopify_id: shopifyId,
        order_type: orderType, reason: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logWebhook("ingested", {
      order_id: orderId, shopify_id: shopifyId,
      order_type: orderType, lines: lineVendors.length,
      vendors: Array.from(new Set(lineVendors)),
    });

    await supabase.from("order_activity").insert({
      order_id: orderId,
      // Say when an order was classified as a sample. A silent
      // reclassification is the kind of thing nobody can reconstruct later.
      text: `Order received from Shopify${orderNumber ? ` (#${orderNumber})` : ""}`
        + (orderType === "sample"
            ? " \u00b7 classified as a sample order (all lines JK stock)"
            : ""),
      time: today,
    });

    // Surface any rejected _sku in the trail. The stored SKU is already the
    // rebuilt, authoritative one — this makes the discrepancy visible rather
    // than silently corrected.
    for (const a of skuAnomalies) {
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text: skuMismatchNote(a),
        time: today,
      });
    }
    for (const text of reviewNotes) {
      await supabase.from("order_activity").insert({
        order_id: orderId,
        text,
        time: today,
      });
    }
  }

  // ─── Order updated ────────────────────────────────────────────────────────
  if (topic === "orders/updated") {
    if (payload.cancelled_at) return NextResponse.json({ received: true, skipped: "cancelled" });

    const { data: existing } = await supabase
      .from("orders").select("id, stage").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      try { await ensureSkuMaps(); } catch { /* degrade to decoder_unavailable */ }
      const { detail, skus, skuItems, skuAnomalies, reviewNotes, notes, shipTo, customerPhone, customerEmail, deliveryMethod } = buildOrder(payload);

      const fulfillmentStatus = String(payload.fulfillment_status ?? "");
      const updates: Record<string, unknown> = {
        detail,
        sku: skus || "—",
        notes,
        sku_items: skuItems,
        needs_review: skuItems.some(i => i.needs_review),
        ship_to: shipTo,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        delivery_method: deliveryMethod,
        // Refresh payment status on every update — covers the case where a
        // pending order gets paid later.
        payment_status: payload.financial_status ?? null,
      };

      if (fulfillmentStatus === "fulfilled" && existing.stage !== "Delivered") {
        updates.stage = "Delivered";
      }

      await supabase.from("orders").update(updates).eq("id", existing.id);
      await supabase.from("order_activity").insert({
        order_id: existing.id,
        text: "Order updated in Shopify",
        time: today,
      });

      // orders/updated fires repeatedly (payment, fulfillment, edits), and a
      // forged _sku persists across them — so dedupe against notes already on
      // the trail instead of appending the same warning on every event.
      if (skuAnomalies.length > 0) {
        const { data: priorNotes } = await supabase
          .from("order_activity")
          .select("text")
          .eq("order_id", existing.id)
          .like("text", "SKU mismatch on %");
        const seen = new Set((priorNotes ?? []).map((n: { text: string }) => n.text));
        for (const a of skuAnomalies) {
          const text = skuMismatchNote(a);
          if (seen.has(text)) continue;
          await supabase.from("order_activity").insert({
            order_id: existing.id,
            text,
            time: today,
          });
        }
      }

      // Needs-review notes — same dedupe discipline as the mismatch notes
      // above, so repeat orders/updated events don't re-append the same flag.
      if (reviewNotes.length > 0) {
        const { data: priorReview } = await supabase
          .from("order_activity")
          .select("text")
          .eq("order_id", existing.id)
          .like("text", "Needs review on %");
        const seenReview = new Set((priorReview ?? []).map((n: { text: string }) => n.text));
        for (const text of reviewNotes) {
          if (seenReview.has(text)) continue;
          await supabase.from("order_activity").insert({
            order_id: existing.id,
            text,
            time: today,
          });
        }
      }
    }
  }

  // ─── Order cancelled ──────────────────────────────────────────────────────
  if (topic === "orders/cancelled") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();

    if (existing) {
      await supabase.from("order_activity").delete().eq("order_id", existing.id);
      await supabase.from("orders").delete().eq("id", existing.id);
    }
  }

  // ─── Order deleted ────────────────────────────────────────────────────────
  if (topic === "orders/delete" || topic === "orders/deleted") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();

    if (existing) {
      await supabase.from("order_activity").delete().eq("order_id", existing.id);
      await supabase.from("orders").delete().eq("id", existing.id);
    }
  }

  return NextResponse.json({ received: true });
}
