import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, parseBoundedInt } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { runCatalogueSync } from "@/lib/shopifyCatalogue";

// (2026-11-04, item 5 part 2) The Sync's page cap, its REST read and its rows
// moved to lib/shopifyCatalogue -- GraphQL by cursor, so no Link header to guard.

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

  // ⚠ THE SYNC IS lib/shopifyCatalogue's runCatalogueSync (2026-11-04, item 5
  // part 2) -- the same code the daily cron runs, over GraphQL, every variant of
  // every product. Its answer is the one this page has always read.
  const result = await runCatalogueSync();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
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
      // Variants Shopify no longer has are kept for past orders' lookups, not listed (item 59).
      .is("removed_at", null)
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
