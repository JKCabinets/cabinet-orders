import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

import { getShopifyToken } from "@/lib/shopify";

function transformOrder(payload: Record<string, unknown>, defaultMember: string) {
  const shopifyId = String(payload.id ?? "");
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

  const createdAt = new Date(String(payload.created_at ?? new Date().toISOString()));
  const date = createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });

  const fulfillmentStatus = String(payload.fulfillment_status ?? "");
  const financialStatus = String(payload.financial_status ?? "");
  let stage = "New";
  if (fulfillmentStatus === "fulfilled") stage = "Delivered";
  else if (fulfillmentStatus === "partial") stage = "At cross dock";
  else if (financialStatus === "paid") stage = "Entered";

  const cancelled = payload.cancelled_at != null;

  return {
    shopify_id: shopifyId,
    type: "order",
    name: customerName,
    source: "Shopify",
    detail,
    stage,
    member: defaultMember,
    date,
    sku: skus || "—",
    notes,
    archived: cancelled,
    sku_items: skuItems,
    door_style: "",
    color: "",
    delivery_window: "",
    delivery_notes: "",
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) return NextResponse.json({ error: "SHOPIFY_STORE_DOMAIN not set" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const defaultMember = String(body.defaultMember ?? "GB");

  try {
    const token = await getShopifyToken();

    const { data: existing } = await supabase
      .from("orders").select("shopify_id").not("shopify_id", "is", null);
    const existingIds = new Set((existing ?? []).map(o => o.shopify_id));

    let allOrders: Record<string, unknown>[] = [];
    let url = `https://${domain}/admin/api/2024-01/orders.json?limit=250&status=any`;

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ error: `Shopify API error: ${res.status}`, body: text }, { status: 502 });
      const data = JSON.parse(text);
      allOrders = [...allOrders, ...(data.orders ?? [])];
      const linkHeader = res.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : "";
    }

    const newOrders = allOrders.filter(o => !existingIds.has(String(o.id)));
    let imported = 0;
    const errors: string[] = [];

    for (const shopifyOrder of newOrders) {
      const transformed = transformOrder(shopifyOrder, defaultMember);
      const orderNum = String(shopifyOrder.order_number ?? "");
      const orderId = orderNum ? `SHO-${orderNum}` : `SHO-${String(shopifyOrder.id).slice(-6)}`;

      const { error } = await supabase.from("orders").insert({ id: orderId, ...transformed });

      if (error) {
        errors.push(`${orderId}: ${error.message}`);
      } else {
        imported++;
        await supabase.from("order_activity").insert({
          order_id: orderId,
          text: `Imported from Shopify${orderNum ? ` (#${orderNum})` : ""}`,
          time: transformed.date,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      total_in_shopify: allOrders.length,
      already_imported: allOrders.length - newOrders.length,
      newly_imported: imported,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
