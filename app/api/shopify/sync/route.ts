import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

async function getShopifyToken(): Promise<string> {
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (adminToken) return adminToken;

  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token error: ${res.status} ${text}`);
  const data = JSON.parse(text);
  return data.access_token;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!domain || (!adminToken && (!clientId || !clientSecret))) {
    return NextResponse.json({ error: "Missing Shopify credentials" }, { status: 500 });
  }

  try {
    const token = await getShopifyToken();

    let allProducts: Record<string, unknown>[] = [];
    let url: string = `https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,vendor,variants`;

    while (url) {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ error: `Shopify API error: ${res.status}`, body: text }, { status: 502 });
      const data = JSON.parse(text);
      allProducts = [...allProducts, ...(data.products ?? [])];
      const linkHeader = res.headers.get("Link") ?? "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : "";
    }

    const rows: Record<string, unknown>[] = [];
    for (const product of allProducts) {
      const variants = (product.variants as Record<string, unknown>[]) ?? [];
      const vendorName = String(product.vendor ?? "").trim();
      for (const variant of variants) {
        rows.push({
          id: String(variant.id),
          title: `${product.title}${variants.length > 1 ? ` - ${variant.title}` : ""}`,
          sku: String(variant.sku ?? ""),
          vendor: vendorName,
          variant_id: String(variant.id),
          price: parseFloat(String(variant.price ?? "0")),
          inventory_quantity: Number(variant.inventory_quantity ?? 0),
          synced_at: new Date().toISOString(),
        });
      }
    }

    // Upsert in batches of 100 to avoid request size limits
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("shopify_products").upsert(batch, { onConflict: "id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, synced: rows.length, products: allProducts.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const vendor = searchParams.get("vendor") ?? "";

  // Fetch all rows using range pagination
  let allData: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("shopify_products")
      .select("*")
      .order("vendor")
      .order("title")
      .range(from, from + pageSize - 1);

    if (search) query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
    if (vendor) query = query.eq("vendor", vendor);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (data && data.length > 0) {
      allData = [...allData, ...data];
      from += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return NextResponse.json({ data: allData });
}
