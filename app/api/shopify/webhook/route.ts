import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { cleanInput } from "@/lib/auth";
import { decodeHtmlEntities } from "@/lib/htmlEntities";
import { decodeSku, buildSkuFromAvisNamesDetailed, ensureSkuMaps, skuMapsUnavailable, modificationMap } from "@/lib/skuDecoder";
import { parseModifications } from "@/lib/modifications";
import type { ReviewReason } from "@/lib/data";
// isSampleVendor and lookupVendorsForSkus are no longer imported here.
// Classification moved into lib/categories (one implementation, shared with
// grouping), and the per-line vendor now comes from the payload rather than
// the SKU resolver -- which cannot see a SKU-less sample line at all.
import {
  categoryForVendor, isUnknownVendor, GROUP_ORDER, GROUP_SUFFIX,
  FIRST_STAGE_BY_CATEGORY, fulfilmentIsAuthoritative, fulfilmentTargetStage,
  type OrderCategory,
} from "@/lib/categories";

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
/**
 * Compare one signature against one secret. Constant-time.
 *
 * Unchanged from the original single-secret version: decode base64 to raw
 * bytes, check the length BEFORE comparing (timingSafeEqual throws on a
 * length mismatch, and an attacker controlling the header could otherwise
 * short-circuit the comparison through the thrown error), then compare.
 */
function hmacMatches(body: string, hmacHeader: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
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
 * Which secret verified a delivery, or null if none did.
 *
 * TWO SECRETS, DURING A MIGRATION ONLY. Shopify signs app-created webhook
 * subscriptions with the app's CLIENT secret and admin-created ones with the
 * store's webhook secret. Moving from one to the other in a single step would
 * break the working set the moment it deployed. Accepting both means no
 * window where ingestion is down.
 *
 * FAILS CLOSED. The fallback counts only when it is a non-empty string after
 * trimming, and with NEITHER secret configured every delivery is rejected.
 * There is no path where an unconfigured secret means "accept". That is not
 * theoretical: .kamal/secrets fails open, and a variable can be silently
 * absent from the container if it is not declared in config/deploy.yml.
 *
 * The return value is logged so a fallback still in use after the migration
 * is visible rather than forgotten.
 */
function verifyShopifyHmac(body: string, hmacHeader: string): "primary" | "fallback" | null {
  if (!hmacHeader) return null;

  const primary = (SHOPIFY_SECRET ?? "").trim();
  const fallback = (process.env.SHOPIFY_WEBHOOK_SECRET_FALLBACK ?? "").trim();

  // Neither configured: reject everything. Never "no secret means allow".
  if (!primary && !fallback) return null;

  if (primary && hmacMatches(body, hmacHeader, primary)) return "primary";
  if (fallback && hmacMatches(body, hmacHeader, fallback)) return "fallback";
  return null;
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
      // The Shopify vendor for THIS line, retained at ingest.
      //
      // Without it the input that decided a line's group is kept nowhere: a
      // mis-grouped line could only be diagnosed by re-fetching the order
      // from Shopify, and the Full Order table would have to resolve every
      // row through shopify_products on each render.
      vendor: shopifyInput(i.vendor),
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

/**
 * Numeric, or null when absent. null means UNKNOWN; 0 means actually zero.
 * Free shipping is genuinely zero, so the two must stay distinguishable --
 * that distinction is load-bearing for the metrics work.
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The four money figures for a project, from a Shopify order payload.
 *
 * A checkout has ONE total, not one per group -- storing it per group would
 * either double-count revenue on any sum or arbitrarily assign it to the
 * cabinets, so it lives on `projects` alone.
 *
 * SHIPPING IS NOT TOP-LEVEL. subtotal_price, total_tax and total_price are,
 * but shipping is only in total_shipping_price_set.shop_money.amount. Reading
 * payload.total_shipping returns undefined, which writes null, which reads as
 * "unknown" rather than "free shipping".
 */
function projectMoney(payload: Record<string, unknown>) {
  const shipSet = payload.total_shipping_price_set as Record<string, unknown> | undefined;
  const shopMoney = shipSet?.shop_money as Record<string, unknown> | undefined;
  return {
    subtotal_price: numOrNull(payload.subtotal_price),
    total_tax: numOrNull(payload.total_tax),
    total_shipping: numOrNull(shopMoney?.amount),
    total_price: numOrNull(payload.total_price),
  };
}

type BuiltItem = ReturnType<typeof buildOrder>["skuItems"][number];

/**
 * Split decoded lines into their category buckets, carrying each line's
 * payload vendor alongside.
 *
 * `items` is lineItems.map(...) from buildOrder, so index i here IS index i of
 * payloadLines. That alignment is the whole mechanism: it lets a payload
 * vendor classify a line the SKU resolver cannot see.
 */
function groupLinesByCategory(
  items: BuiltItem[],
  payloadLines: Array<Record<string, unknown>>,
): Map<OrderCategory, { items: BuiltItem[]; vendors: string[] }> {
  const out = new Map<OrderCategory, { items: BuiltItem[]; vendors: string[] }>();
  items.forEach((item, i) => {
    const vendor = String(payloadLines[i]?.vendor ?? "").trim();
    const cat = categoryForVendor(vendor);
    const bucket = out.get(cat) ?? { items: [], vendors: [] };
    bucket.items.push(item);
    bucket.vendors.push(vendor);
    out.set(cat, bucket);
  });
  return out;
}

/**
 * Per-GROUP rollups.
 *
 * buildOrder computes detail / skus / door_style / color / needs_review across
 * the whole order, which is the wrong scope once one checkout becomes several
 * groups: a cabinet group would otherwise be labelled with a hardware line's
 * description. Same derivations, narrowed to one group's items.
 */
function groupFields(items: BuiltItem[]) {
  const names = items.map(i => String(i.description ?? "")).filter(Boolean);
  return {
    skus: items.map(i => i.sku).filter(Boolean).join(", "),
    detail: names.length > 1
      ? `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2} more` : ""}`
      : names[0] ?? "Shopify order",
    doorStyle: items.find(i => i.door_style)?.door_style ?? "",
    color: items.find(i => i.color)?.color ?? "",
    needsReview: items.some(i => i.needs_review),
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

  // Returns WHICH secret matched, so a migration in progress is visible in
  // the logs rather than inferred. Never logs the secret itself.
  const verifiedBy = verifyShopifyHmac(rawBody, hmacHeader);
  if (!verifiedBy) {
    // A rejected HMAC and a webhook that never arrived look identical
    // without this line.
    logWebhook("hmac_rejected", { topic, body_bytes: rawBody.length });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (verifiedBy === "fallback") {
    // Expected DURING the migration. If this is still appearing once the
    // admin-created subscriptions are gone, the fallback has not been
    // removed and step 4 is outstanding.
    logWebhook("verified_by_fallback", { topic });
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
    // Duplicate check moved from orders.shopify_id to projects.shopify_id.
    // Under grouping a project's groups all share one Shopify order, so
    // `.eq("shopify_id", ...).single()` on `orders` ERRORS on multiple rows
    // rather than picking one -- the first cabinets-plus-hardware checkout
    // would have broken ingest, cancellation and deletion at once.
    const { data: existingProject } = await supabase
      .from("projects").select("id").eq("shopify_id", shopifyId).maybeSingle();
    if (existingProject) {
      logWebhook("duplicate", { shopify_id: shopifyId, existing_id: existingProject.id });
      return NextResponse.json({ received: true, skipped: "duplicate" });
    }

    // Warm the mapping cache before decoding. Degrade, never crash: a failed
    // load leaves skuMapsUnavailable() true and every line is flagged
    // decoder_unavailable, so the order still ingests.
    try { await ensureSkuMaps(); } catch { /* degrade to decoder_unavailable */ }
    const { customerName, customerEmail, customerPhone, shipTo, deliveryMethod, skuItems, skuAnomalies, reviewNotes, notes, today, orderNumber } = buildOrder(payload);
    const projectId = orderNumber ? `SHO-${orderNumber}` : `SHO-${shopifyId.slice(-6)}`;
    // One timestamp for the project and every group, so the New SLA clock --
    // which measures from the order date -- is identical across them.
    const nowIso = new Date().toISOString();

    // ── Group the lines by category ───────────────────────────────────────
    //
    // Read the vendor from the PAYLOAD, never through the SKU resolver. That
    // resolver is keyed entirely on the SKU and JK's sample products carry an
    // empty one, so routing classification through it returned an empty list
    // and silently classified every sample as a standard order on 2026-08-19.
    //
    // skuItems is lineItems.map(...), so index i of one IS index i of the
    // other. That alignment is what lets a payload vendor decide which group
    // owns a line the resolver cannot see.
    const payloadLines = (payload.line_items as Array<Record<string, unknown>>) ?? [];
    const grouped = groupLinesByCategory(skuItems, payloadLines);
    const categories = GROUP_ORDER.filter(c => grouped.has(c));
    // An order with no line items still gets a cabinet group. A project with
    // no groups is invisible work -- nothing lists it, nothing can claim it.
    if (categories.length === 0) categories.push("order");

    const unknownVendors = Array.from(new Set(
      payloadLines.map(l => String(l.vendor ?? "").trim()).filter(isUnknownVendor)));
    if (unknownVendors.length > 0) {
      // Unknown vendors fall through to the cabinet group ON PURPOSE: the line
      // lands in a queue a human actually works rather than one nobody owns.
      // This log line is what stops that being a silent reclassification, and
      // it is not optional.
      logWebhook("unknown_vendor", {
        order_id: projectId, vendors: unknownVendors.map(v => v || "(blank)"),
      });
    }

    // ── The project ───────────────────────────────────────────────────────
    const { error: projectError } = await supabase.from("projects").insert({
      id: projectId,
      shopify_id: shopifyId,
      name: customerName,
      source: "Shopify",
      ship_to: shipTo,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      payment_status: payload.financial_status ?? null,
      ...projectMoney(payload),
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (projectError) {
      // 23505 is the unique index on projects.shopify_id: two concurrent
      // deliveries of the same order both passed the check above and one lost.
      // Treat the loser as a duplicate rather than a failure -- previously
      // this race left one delivery hitting the primary key and returning 500.
      if ((projectError as { code?: string }).code === "23505") {
        logWebhook("duplicate", { shopify_id: shopifyId, existing_id: projectId });
        return NextResponse.json({ received: true, skipped: "duplicate" });
      }
      logWebhook("insert_failed", {
        order_id: projectId, shopify_id: shopifyId,
        scope: "project", reason: projectError.message,
      });
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }

    // ── One group per category present ────────────────────────────────────
    const groupRows = categories.map((cat, idx) => {
      const bucket = grouped.get(cat) ?? { items: [], vendors: [] };
      const f = groupFields(bucket.items);
      return {
        id: `${projectId}${GROUP_SUFFIX[cat]}`,
        project_id: projectId,
        type: cat,
        name: customerName,
        source: "Shopify",
        detail: f.detail,
        stage: FIRST_STAGE_BY_CATEGORY[cat],
        // No team member at ingest -- the group is unclaimed until someone
        // clicks Claim, and each group is claimed separately.
        member: "",
        date: today,
        sku: f.skus || "\u2014",
        notes,
        archived: false,
        // Exactly ONE group carries the denormalised shopify_id, so
        // `orders.shopify_id` still identifies one row per Shopify order --
        // the invariant the hourly webhook-health reconciliation reads. It
        // stops being needed when that check is repointed at projects.
        shopify_id: idx === 0 ? shopifyId : null,
        sku_items: bucket.items,
        needs_review: f.needsReview,
        door_style: f.doorStyle,
        color: f.color,
        delivery_window: "",
        delivery_notes: "",
        vendor: shopifyInput(bucket.vendors.find(Boolean) ?? ""),
        ship_to: shipTo,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        delivery_method: deliveryMethod,
        payment_status: payload.financial_status ?? null,
        created_at: nowIso,
        stage_entered_at: nowIso,
      };
    });

    const { error } = await supabase.from("orders").insert(groupRows);

    if (error) {
      // The type CHECK constraint rejected samples and custom orders for
      // three weeks without a single log line. Never again.
      logWebhook("insert_failed", {
        order_id: projectId, shopify_id: shopifyId,
        groups: categories, reason: error.message,
      });
      // Leave no orphan: a project with no groups is invisible work, and
      // nothing would ever retry it.
      await supabase.from("projects").delete().eq("id", projectId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logWebhook("ingested", {
      order_id: projectId, shopify_id: shopifyId,
      groups: categories, lines: skuItems.length,
      vendors: Array.from(new Set(payloadLines.map(l => String(l.vendor ?? "").trim()))),
    });

    for (const cat of categories) {
      await supabase.from("order_activity").insert({
        order_id: `${projectId}${GROUP_SUFFIX[cat]}`,
        // Name the grouping in the trail. A silent classification is the kind
        // of thing nobody can reconstruct later.
        text: `Order received from Shopify${orderNumber ? ` (#${orderNumber})` : ""}`
          + (categories.length > 1
              ? ` \u00b7 ${cat} group (${categories.length} groups in this order)`
              : "")
          + (cat === "sample" ? " \u00b7 JK stock" : ""),
        time: today,
      });
    }

    // SKU anomalies and review notes are cabinet concerns -- sample and
    // hardware lines carry nothing decodable -- so they land on the cabinet
    // group, falling back to the first group for an order that has none.
    const noteTarget = `${projectId}${GROUP_SUFFIX[categories.includes("order") ? "order" : categories[0]]}`;

    // Surface any rejected _sku in the trail. The stored SKU is already the
    // rebuilt, authoritative one -- this makes the discrepancy visible rather
    // than silently corrected.
    for (const a of skuAnomalies) {
      await supabase.from("order_activity").insert({
        order_id: noteTarget,
        text: skuMismatchNote(a),
        time: today,
      });
    }
    for (const text of reviewNotes) {
      await supabase.from("order_activity").insert({
        order_id: noteTarget,
        text,
        time: today,
      });
    }
  }

  // ─── Order updated ────────────────────────────────────────────────────────
  if (topic === "orders/updated") {
    if (payload.cancelled_at) return NextResponse.json({ received: true, skipped: "cancelled" });

    const { data: project } = await supabase
      .from("projects").select("id").eq("shopify_id", shopifyId).maybeSingle();

    if (project) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      try { await ensureSkuMaps(); } catch { /* degrade to decoder_unavailable */ }
      const { skuItems, skuAnomalies, reviewNotes, notes, shipTo, customerPhone, customerEmail, deliveryMethod } = buildOrder(payload);
      const payloadLines = (payload.line_items as Array<Record<string, unknown>>) ?? [];
      const grouped = groupLinesByCategory(skuItems, payloadLines);

      // Project-level: money and payment status. Refreshing these is what
      // stops a later refund leaving a stale total inflating the month
      // forever, and what lets the payment hold see the current status.
      await supabase.from("projects").update({
        ship_to: shipTo,
        customer_phone: customerPhone,
        customer_email: customerEmail,
        payment_status: payload.financial_status ?? null,
        ...projectMoney(payload),
        updated_at: new Date().toISOString(),
      }).eq("id", project.id);

      const { data: groups } = await supabase
        .from("orders").select("id, type, stage").eq("project_id", project.id);
      const groupRows = groups ?? [];

      const fulfillmentStatus = String(payload.fulfillment_status ?? "");
      const fulfillments = (payload.fulfillments as Array<Record<string, unknown>>) ?? [];
      const firstFulfilment = fulfillments[0];

      // GROUPS ARE NEVER CREATED OR DESTROYED HERE. A group may already be
      // claimed, carry attachments and hold activity; deleting it because a
      // line moved is destructive and unrecoverable. If the lines now imply a
      // category with no group, say so and leave it for a human -- the
      // tempting implementation is the symmetric one.
      const present = new Set(groupRows.map(g => String(g.type)));
      const implied = GROUP_ORDER.filter(c => grouped.has(c) && !present.has(c));
      if (implied.length > 0) {
        logWebhook("group_missing", { order_id: project.id, implied });
      }

      for (const g of groupRows) {
        const cat = String(g.type) as OrderCategory;
        const bucket = grouped.get(cat) ?? { items: [], vendors: [] };
        const f = groupFields(bucket.items);
        const updates: Record<string, unknown> = {
          detail: f.detail,
          sku: f.skus || "\u2014",
          notes,
          sku_items: bucket.items,
          needs_review: f.needsReview,
          ship_to: shipTo,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          delivery_method: deliveryMethod,
          payment_status: payload.financial_status ?? null,
        };

        // A fulfilment is authoritative only for what WE ship. Samples and
        // hardware are tracked in Shopify with a real carrier and number, so
        // the event is the real thing and the tracking comes free. Cabinets
        // are drop-ship: the manufacturer's partner delivers and Shopify never
        // sees that shipment, so a fulfilment there is bookkeeping and calling
        // it "Delivered" is untrue. It is also why the signed-receipt gate
        // exists -- we are not the ones delivering.
        if (fulfillmentStatus === "fulfilled" && fulfilmentIsAuthoritative(cat)) {
          const num = firstFulfilment
            ? shopifyInput(firstFulfilment.tracking_number)
            : "";
          if (firstFulfilment) {
            updates.carrier = shopifyInput(firstFulfilment.tracking_company);
            updates.tracking_number = num;
          }
          // ⚠ THE TRACKING NUMBER MOVES THE STAGE, not the fulfilment event.
          //
          // This used to set the stage from fulfilmentTargetStage AND write the
          // tracking as two independent decisions -- so a fulfilment with no
          // number still advanced the group, claiming a dispatch it had no
          // evidence of. Worse, it was a second implementation of the rule the
          // modal uses, which is the shape that has bitten this codebase four
          // times in a week.
          //
          // No number, no move: a fulfilment without tracking tells us nothing
          // a customer could act on.
          const target = num ? fulfilmentTargetStage(cat) : null;
          if (target && g.stage !== target) updates.stage = target;
        }

        await supabase.from("orders").update(updates).eq("id", g.id);
      }

      if (fulfillmentStatus === "fulfilled"
          && groupRows.some(g => !fulfilmentIsAuthoritative(String(g.type) as OrderCategory))) {
        // NOT nothing: a fulfilment on a drop-ship vendor means the
        // MANUFACTURER DISPATCHED. That is the real trigger behind the
        // notification the order confirmation already promises ("we will
        // notify you when your order has finished production and is on its
        // way"), which is currently planned off the production-complete cron
        // inferring dispatch from a date. Logged rather than discarded, so the
        // signal exists by the time that work lands.
        logWebhook("fulfilment_not_applied", {
          order_id: project.id, reason: "drop_ship_vendor",
          carrier: firstFulfilment ? String(firstFulfilment.tracking_company ?? "") : "",
        });
      }

      // Notes go on the cabinet group, or the first group without one. One
      // note per EVENT, not per group: orders/updated fires repeatedly and
      // multiplying that by the group count would bury the trail.
      const noteTarget = groupRows.find(g => g.type === "order")?.id ?? groupRows[0]?.id;
      if (noteTarget) {
        await supabase.from("order_activity").insert({
          order_id: noteTarget,
          text: "Order updated in Shopify",
          time: today,
        });

        // orders/updated fires repeatedly (payment, fulfillment, edits), and a
        // forged _sku persists across them -- so dedupe against notes already
        // on the trail instead of appending the same warning every time.
        if (skuAnomalies.length > 0) {
          const { data: priorNotes } = await supabase
            .from("order_activity")
            .select("text")
            .eq("order_id", noteTarget)
            .like("text", "SKU mismatch on %");
          const seen = new Set((priorNotes ?? []).map((n: { text: string }) => n.text));
          for (const a of skuAnomalies) {
            const text = skuMismatchNote(a);
            if (seen.has(text)) continue;
            await supabase.from("order_activity").insert({
              order_id: noteTarget,
              text,
              time: today,
            });
          }
        }

        // Needs-review notes -- same dedupe discipline as the mismatch notes
        // above, so repeat orders/updated events don't re-append the same flag.
        if (reviewNotes.length > 0) {
          const { data: priorReview } = await supabase
            .from("order_activity")
            .select("text")
            .eq("order_id", noteTarget)
            .like("text", "Needs review on %");
          const seenReview = new Set((priorReview ?? []).map((n: { text: string }) => n.text));
          for (const text of reviewNotes) {
            if (seenReview.has(text)) continue;
            await supabase.from("order_activity").insert({
              order_id: noteTarget,
              text,
              time: today,
            });
          }
        }
      }
    }
  }

  // ─── Order cancelled ──────────────────────────────────────────────────────
  if (topic === "orders/cancelled" || topic === "orders/delete" || topic === "orders/deleted") {
    const { data: project } = await supabase
      .from("projects").select("id").eq("shopify_id", shopifyId).maybeSingle();

    if (project) {
      const { data: groups } = await supabase
        .from("orders").select("id").eq("project_id", project.id);
      const ids = (groups ?? []).map(g => g.id);

      if (ids.length > 0) {
        // EVERY foreign key on these tables is NO ACTION, so children must go
        // first or the delete is REJECTED outright. The previous version
        // cleared only order_activity -- which meant any order carrying a
        // manufacturer acknowledgment, i.e. every order past Entered, would
        // 500 here. Latent only because nothing had been cancelled since
        // acknowledgments started existing.
        //
        // NOTE: deleting order_attachments rows leaves their storage objects
        // behind, since file_path carries no foreign key. Deliberate for now --
        // silently destroying a customer's uploaded files on a Shopify cancel
        // is a decision, not an implementation detail.
        await supabase.from("order_activity").delete().in("order_id", ids);
        await supabase.from("order_acknowledgments").delete().in("order_id", ids);
        await supabase.from("order_attachments").delete().in("order_id", ids);
        await supabase.from("damage_reports").delete().in("order_id", ids);
        await supabase.from("orders").delete().in("id", ids);
      }

      await supabase.from("projects").delete().eq("id", project.id);
      logWebhook("removed", {
        order_id: project.id, shopify_id: shopifyId, topic, groups: ids.length,
      });
    }
  }

  return NextResponse.json({ received: true });
}
