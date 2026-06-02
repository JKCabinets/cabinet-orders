import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { cleanInput } from "@/lib/auth";
import { decodeHtmlEntities } from "@/lib/htmlEntities";
import { decodeSku, buildSkuFromAvisNames } from "@/lib/skuDecoder";

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

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

  const skuItems = lineItems.map(i => {
    const props = (i.properties as Array<{ name: string; value: string }>) ?? [];

    const getProp = (...names: string[]) =>
      props.find(p => names.includes(p.name))?.value ?? "";

    const skuProp = props.find(p => p.name === "_sku");
    const baseVariantSku = String(i.sku ?? i.variant_id ?? "");

    const avisDoorStyle   = getProp("_Door Style", "Door Style");
    const avisColorSelect = getProp("_Color Selection", "Color Selection");

    let sku = skuProp?.value || "";
    if (!sku && baseVariantSku && avisDoorStyle && avisColorSelect) {
      sku = buildSkuFromAvisNames(baseVariantSku, avisDoorStyle, avisColorSelect) ?? baseVariantSku;
    }
    if (!sku) sku = baseVariantSku;

    // Normalize every string field via shopifyInput (decode any HTML entities
    // Shopify may have included, then trim). This is the boundary where
    // external data becomes raw internal data.
    return {
      sku: shopifyInput(sku),
      quantity: Number(i.quantity ?? 1),
      description: shopifyInput(String(i.name ?? "")),
      door_style: shopifyInput(avisDoorStyle),
      color: shopifyInput(avisColorSelect),
    };
  }).filter(i => i.sku);

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const shopifyId = String(payload.id ?? "");
  if (!/^\d+$/.test(shopifyId)) {
    return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  }

  // Whitelist topics — ignore anything else silently to avoid leaking which
  // topics we handle.
  const ALLOWED_TOPICS = new Set(["orders/create", "orders/updated", "orders/cancelled", "orders/deleted"]);
  if (!ALLOWED_TOPICS.has(topic)) {
    return NextResponse.json({ received: true, skipped: "unhandled_topic" });
  }

  // ─── New order ────────────────────────────────────────────────────────────
  if (topic === "orders/create") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();
    if (existing) return NextResponse.json({ received: true, skipped: "duplicate" });

    const { customerName, customerEmail, customerPhone, shipTo, deliveryMethod, detail, skus, skuItems, notes, today, orderNumber, decodedDoorStyle, decodedColor } = buildOrder(payload);
    const orderId = orderNumber ? `SHO-${orderNumber}` : `SHO-${shopifyId.slice(-6)}`;

    let vendorName = "";
    const firstSkuFull = skuItems.find(i => i.sku)?.sku ?? "";
    // Derive the base variant SKU regardless of composite shape:
    //   Waypoint  base-DOOR-COLOR (3-part) -> base
    //   HCI / J&K base-COLOR      (2-part) -> base
    const firstSku = decodeSku(firstSkuFull)?.baseSku || firstSkuFull;
    if (firstSku) {
      const { data: products } = await supabase
        .from("shopify_products")
        .select("vendor")
        .eq("sku", firstSku)
        .limit(1);
      if (products && products[0]?.vendor) vendorName = products[0].vendor;
    }

    const { error } = await supabase.from("orders").insert({
      id: orderId,
      type: "order",
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("order_activity").insert({
      order_id: orderId,
      text: `Order received from Shopify${orderNumber ? ` (#${orderNumber})` : ""}`,
      time: today,
    });
  }

  // ─── Order updated ────────────────────────────────────────────────────────
  if (topic === "orders/updated") {
    if (payload.cancelled_at) return NextResponse.json({ received: true, skipped: "cancelled" });

    const { data: existing } = await supabase
      .from("orders").select("id, stage").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      const { detail, skus, skuItems, notes, shipTo, customerPhone, customerEmail, deliveryMethod } = buildOrder(payload);

      const fulfillmentStatus = String(payload.fulfillment_status ?? "");
      const updates: Record<string, unknown> = {
        detail,
        sku: skus || "—",
        notes,
        sku_items: skuItems,
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
  if (topic === "orders/deleted") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();

    if (existing) {
      await supabase.from("order_activity").delete().eq("order_id", existing.id);
      await supabase.from("orders").delete().eq("id", existing.id);
    }
  }

  return NextResponse.json({ received: true });
}
