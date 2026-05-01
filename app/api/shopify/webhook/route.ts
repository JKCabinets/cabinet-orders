import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { decodeSku } from "@/lib/skuDecoder";

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

function verifyShopifyHmac(body: string, hmacHeader: string): boolean {
  if (!SHOPIFY_SECRET) return false; // reject if secret not configured
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader)); }
  catch { return false; }
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

  // Build full ship-to address from shipping address
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

  // Read _sku from line item properties (written by sku-avis-bridge.js)
  // Fall back to the Shopify variant SKU if not present
  const skuItems = lineItems.map(i => {
    const props = (i.properties as Array<{ name: string; value: string }>) ?? [];
    const skuProp = props.find(p => p.name === "_sku");
    const sku = skuProp?.value || String(i.sku ?? i.variant_id ?? "");
    return {
      sku,
      quantity: Number(i.quantity ?? 1),
      description: String(i.name ?? ""),
    };
  }).filter(i => i.sku);

  const skus = skuItems.map(i => i.sku).filter(Boolean).join(", ");

  // Decode door style + color from the first SKU
  const firstDecodedSku = skuItems.find(i => i.sku) ? decodeSku(skuItems.find(i => i.sku)!.sku) : null;
  const decodedDoorStyle = firstDecodedSku?.doorStyle ?? "";
  const decodedColor     = firstDecodedSku?.color     ?? "";

  const orderNumber = String(payload.order_number ?? payload.name ?? "");
  const note = String(payload.note ?? "");
  // Keep notes clean — just the customer note, not address (that's in ship_to now)
  const notes = note || "";

  // Delivery method from shipping lines
  const shippingLines = (payload.shipping_lines as Array<Record<string, unknown>>) ?? [];
  const deliveryMethod = shippingLines.length > 0
    ? String(shippingLines[0].title ?? "")
    : "";

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

  return { customerName, customerEmail, customerPhone, shipTo, deliveryMethod, detail, skus, skuItems, notes, today, orderNumber, decodedDoorStyle, decodedColor };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";

  if (!verifyShopifyHmac(rawBody, hmacHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const shopifyId = String(payload.id ?? "");

  // ─── New order ────────────────────────────────────────────────────────────
  if (topic === "orders/create") {
    // Check if already exists
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();
    if (existing) return NextResponse.json({ received: true, skipped: "duplicate" });

    const { customerName, customerEmail, customerPhone, shipTo, deliveryMethod, detail, skus, skuItems, notes, today, orderNumber, decodedDoorStyle, decodedColor } = buildOrder(payload);
    const orderId = orderNumber ? `SHO-${orderNumber}` : `SHO-${shopifyId.slice(-6)}`;

    // Look up vendor from shopify_products using first SKU
    let vendorName = "";
    const firstSku = skuItems.find(i => i.sku)?.sku ?? "";
    if (firstSku) {
      const { data: product } = await supabase
        .from("shopify_products")
        .select("vendor")
        .eq("sku", firstSku)
        .single();
      if (product?.vendor) vendorName = product.vendor;
    }

    const { error } = await supabase.from("orders").insert({
      id: orderId,
      type: "order",
      name: customerName,
      source: "Shopify",
      detail,
      stage: "New",
      member: "GB",
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
      vendor: vendorName,
      ship_to: shipTo,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      delivery_method: deliveryMethod,
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
    // Ignore if the order is being cancelled — the cancelled webhook will handle it
    if (payload.cancelled_at) return NextResponse.json({ received: true, skipped: "cancelled" });

    const { data: existing } = await supabase
      .from("orders").select("id, stage").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      const { detail, skus, skuItems, notes, shipTo, customerPhone, customerEmail, deliveryMethod } = buildOrder(payload);

      // Update line items and notes but don't override stage if user moved it
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
      };

      // Only auto-advance stage if Shopify fulfilled
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
