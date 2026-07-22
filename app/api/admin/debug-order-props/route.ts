import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

/**
 * GET /api/admin/debug-order-props?id=SHO-1029   (TEMPORARY — delete after use)
 *
 * Returns the RAW Shopify line_item properties for one order, straight from the
 * Shopify Admin API (the source of truth), so we can see exact property
 * name/value pairs (e.g. "_Door Style 1" vs "Door Style 1") before designing the
 * Waypoint door/color fix + the modifications sub-line feature. Admin only,
 * read-only.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id=SHO-xxxx required" }, { status: 400 });

  const { data: order, error } = await supabase
    .from("orders").select("shopify_id").eq("id", id).single();
  if (error || !order?.shopify_id) {
    return NextResponse.json({ error: "order not found or has no shopify_id" }, { status: 404 });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }

  let token: string;
  try {
    token = await getShopifyToken();
  } catch (e) {
    return NextResponse.json({ error: "token", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const url = `https://${domain}/admin/api/2024-01/orders/${order.shopify_id}.json?fields=line_items`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json({ error: `Shopify ${res.status}`, body: body.slice(0, 500) }, { status: 502 });
  }
  const data = await res.json();
  const lines = (data.order?.line_items ?? []).map((li: Record<string, unknown>) => ({
    title: li.title,
    sku: li.sku,
    variant_id: li.variant_id,
    quantity: li.quantity,
    properties: li.properties, // <-- the raw name/value pairs we need
  }));

  return NextResponse.json({ id, shopify_id: order.shopify_id, line_count: lines.length, lines }, {
    headers: { "content-type": "application/json" },
  });
}
