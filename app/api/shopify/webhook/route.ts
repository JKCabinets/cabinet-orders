import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

function verifyShopifyHmac(body: string, hmacHeader: string): boolean {
  if (!SHOPIFY_SECRET) return false;
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

  const sa = shippingAddress;
  const shipParts = [
    String(sa.address1 ?? ""),
    String(sa.address2 ?? ""),
    String(sa.city ?? ""),
    String(sa.province_code ?? ""),
    String(sa.zip ?? ""),
  ].filter(Boolean);
  const shipTo = shipParts.length > 0 ? shipParts.join(", ") : "";

  const itemNames = lineItems.map((i) => String(i.name ?? "")).filter(Boolean);
  const detail = itemNames.length > 1
    ? `${itemNames.slice(0, 2).join(", ")}${itemNames.length > 2 ? ` +${itemNames.length - 2} more` : ""}`
    : itemNames[0] ?? "Shopify order";

  const skus = lineItems.map((i) => String(i.sku ?? "")).filter(Boolean).join(", ");
  const skuItems = lineItems.map((i) => ({
    sku: String(i.sku ?? i.variant_id ?? ""),
    quantity: Number(i.quantity ?? 1),
    description: String(i.name ?? ""),
  })).filter((i) => i.sku);

  const orderNumber = String(payload.order_number ?? payload.name ?? "");
  const notes = String(payload.note ?? "");

  const shippingLines = (payload.shipping_lines as Array<Record<string, unknown>>) ?? [];
  const deliveryMethod = shippingLines.length > 0 ? String(shippingLines[0].title ?? "") : "";

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  // Vendor: read directly from Shopify line item (no DB lookup needed)
  const vendorName = lineItems.length > 0 ? String(lineItems[0].vendor ?? "") : "";

  // Door style and color: read from SKU picker line item properties
  const firstItem = lineItems[0] ?? {};
  const lineProps = (firstItem.properties as Array<{ name: string; value: string }>) ?? [];
  const doorStyle = lineProps.find((p) => p.name === "Door Style")?.value ?? "";
  const color = lineProps.find((p) => p.name === "Color Selection")?.value ?? "";

  return {
    customerName, customerEmail, customerPhone, shipTo, deliveryMethod,
    detail, skus, skuItems, notes, today, orderNumber,
    vendorName, doorStyle, color,
  };
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

  // New order
  if (topic === "orders/create") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();
    if (existing) return NextResponse.json({ received: true, skipped: "duplicate" });

    const {
      customerName, customerEmail, customerPhone, shipTo, deliveryMethod,
      detail, skus, skuItems, notes, today, orderNumber,
      vendorName, doorStyle, color,
    } = buildOrder(payload);

    const orderId = orderNumber ? `SHO-${orderNumber}` : `SHO-${shopifyId.slice(-6)}`;

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
      door_style: doorStyle,
      color: color,
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

  // Order updated
  if (topic === "orders/updated") {
    if (payload.cancelled_at) return NextResponse.json({ received: true, skipped: "cancelled" });

    const { data: existing } = await supabase
      .from("orders").select("id, stage").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", {
        month: "short", day: "numeric", timeZone: "America/Phoenix",
      });
      const { detail, skus, skuItems, notes, shipTo, customerPhone, customerEmail, deliveryMethod } = buildOrder(payload);

      const fulfillmentStatus = String(payload.fulfillment_status ?? "");
      const updates: Record<string, unknown> = {
        detail, sku: skus || "—", notes, sku_items: skuItems,
        ship_to: shipTo, customer_phone: customerPhone,
        customer_email: customerEmail, delivery_method: deliveryMethod,
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

  // Order cancelled
  if (topic === "orders/cancelled") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();
    if (existing) {
      await supabase.from("order_activity").delete().eq("order_id", existing.id);
      await supabase.from("orders").delete().eq("id", existing.id);
    }
  }

  // Order deleted
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
