import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";

const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";

function verifyShopifyHmac(body: string, hmacHeader: string): boolean {
  if (!SHOPIFY_SECRET) return true;
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

  const itemNames = lineItems.map(i => String(i.name ?? "")).filter(Boolean);
  const detail = itemNames.length > 1
    ? `${itemNames.slice(0, 2).join(", ")}${itemNames.length > 2 ? ` +${itemNames.length - 2} more` : ""}`
    : itemNames[0] ?? "Shopify order";

  const skus = lineItems.map(i => String(i.sku ?? "")).filter(Boolean).join(", ");
  const skuItems = lineItems.map(i => ({
    sku: String(i.sku ?? i.variant_id ?? ""),
    quantity: Number(i.quantity ?? 1),
    description: String(i.name ?? ""),
  })).filter(i => i.sku);

  const orderNumber = String(payload.order_number ?? payload.name ?? "");
  const note = String(payload.note ?? "");
  const notes = [
    note,
    orderNumber ? `Shopify order ${orderNumber}` : "",
    shippingAddress.city ? `Ship to: ${shippingAddress.city}, ${shippingAddress.province_code ?? ""}` : "",
  ].filter(Boolean).join(" · ");

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

  return { customerName, detail, skus, skuItems, notes, today, orderNumber };
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

    const { customerName, detail, skus, skuItems, notes, today, orderNumber } = buildOrder(payload);
    const orderId = `SHO-${shopifyId.slice(-6)}`;

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
      door_style: "",
      color: "",
      delivery_window: "",
      delivery_notes: "",
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
    const { data: existing } = await supabase
      .from("orders").select("id, stage").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      const { detail, skus, skuItems, notes } = buildOrder(payload);

      // Update line items and notes but don't override stage if user moved it
      const fulfillmentStatus = String(payload.fulfillment_status ?? "");
      const updates: Record<string, unknown> = {
        detail,
        sku: skus || "—",
        notes,
        sku_items: skuItems,
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
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      await supabase.from("orders").update({ archived: true }).eq("id", existing.id);
      await supabase.from("order_activity").insert({
        order_id: existing.id,
        text: "Order cancelled in Shopify — moved to archive",
        time: today,
      });
    }
  }

  // ─── Order deleted ────────────────────────────────────────────────────────
  if (topic === "orders/deleted") {
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_id", shopifyId).single();

    if (existing) {
      const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
      await supabase.from("orders").update({ archived: true }).eq("id", existing.id);
      await supabase.from("order_activity").insert({
        order_id: existing.id,
        text: "Order deleted in Shopify — moved to archive",
        time: today,
      });
    }
  }

  return NextResponse.json({ received: true });
}
