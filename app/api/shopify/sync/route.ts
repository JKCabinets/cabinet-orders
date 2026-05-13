import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, parseBoundedInt } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

// Cap the number of Shopify pages we will follow in a single sync, both to
// avoid runaway runs and to ensure a malicious / corrupted Link header can't
// chain us into an unbounded loop.
const MAX_PAGES = 200;

// Cap the total rows returned by the GET endpoint and the slice the caller can
// request. The previous code did unbounded `range()` pagination driven entirely
// by data size.
const MAX_GET_PAGE_SIZE = 1000;
const MAX_GET_TOTAL_ROWS = 50_000;

/**
 * Escape `%` and `_` for a Postgres ILIKE pattern so user-supplied search
 * text can't expand into a wildcard match across the entire table.
 */
function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!adminToken && (!clientId || !clientSecret)) {
    return NextResponse.json({ error: "Missing Shopify credentials" }, { status: 500 });
  }

  try {
    const token = await getShopifyToken();

    let allProducts: Record<string, unknown>[] = [];
    let url: string = `https://${domain}/admin/api/2024-01/products.json?limit=250&fields=id,title,vendor,variants`;
    let pagesFetched = 0;

    while (url) {
      if (pagesFetched++ >= MAX_PAGES) {
        return NextResponse.json(
          { error: `Pagination cap reached (${MAX_PAGES} pages)` },
          { status: 502 }
        );
      }

      // Defense in depth — even though we set the URL above, ensure we never
      // follow a Link header to a non-myshopify host (could otherwise be used
      // to bounce our admin API token to attacker-controlled hosts if the
      // Shopify response was tampered with in transit).
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || !isValidShopifyDomain(parsed.hostname)) {
          return NextResponse.json(
            { error: "Refusing to follow non-Shopify URL during sync" },
            { status: 502 }
          );
        }
      } catch {
        return NextResponse.json({ error: "Invalid pagination URL" }, { status: 502 });
      }

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
  const search = (searchParams.get("search") ?? "").slice(0, 200);
  const vendor = (searchParams.get("vendor") ?? "").slice(0, 200);

  // Allow callers to cap their result set (default unchanged at full set,
  // bounded by MAX_GET_TOTAL_ROWS).
  const maxRows = parseBoundedInt(searchParams.get("max"), {
    min: 1,
    max: MAX_GET_TOTAL_ROWS,
    fallback: MAX_GET_TOTAL_ROWS,
  });

  let allData: Record<string, unknown>[] = [];
  const pageSize = MAX_GET_PAGE_SIZE;
  let from = 0;
  let hasMore = true;

  while (hasMore && allData.length < maxRows) {
    let query = supabase
      .from("shopify_products")
      .select("*")
      .order("vendor")
      .order("title")
      .range(from, from + pageSize - 1);

    if (search) {
      const pat = `%${escapeIlike(search)}%`;
      query = query.or(`sku.ilike.${pat},title.ilike.${pat}`);
    }
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

  if (allData.length > maxRows) allData = allData.slice(0, maxRows);

  return NextResponse.json({ data: allData });
}
