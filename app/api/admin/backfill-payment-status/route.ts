import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

/**
 * POST /api/admin/backfill-payment-status
 *
 * One-time backfill: walks every Shopify order in our DB that's missing
 * a payment_status, fetches the current financial_status from Shopify,
 * and writes it back.
 *
 * Safe to run repeatedly:
 *   - Targets only rows where payment_status IS NULL, so completed work
 *     isn't redone.
 *   - Each request processes a bounded batch (default 50). The response
 *     reports remaining count so the caller (or admin UI) can re-hit
 *     the endpoint until done.
 *   - Failures in individual fetches don't poison the whole batch —
 *     each is recorded in the response's errors[] and the rest proceeds.
 *
 * Auth: admin session required (no service-account token path — this
 * is a manual admin tool, not a cron).
 *
 * Returns:
 *   { ok, batch_size, updated, errors, remaining }
 */

// Bulk-fetch chunk size. Shopify's REST API caps `ids=` queries at 250
// orders per response. 50 keeps each Vercel function call well within
// the 60s limit even if Shopify is slow.
const DEFAULT_BATCH = 50;
const MAX_BATCH = 100;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedBatch = Number(body.batch_size ?? DEFAULT_BATCH);
  const batchSize = Math.min(Math.max(1, requestedBatch), MAX_BATCH);

  // ── Find orders that still need backfilling ─────────────────────────
  // We target: Shopify-sourced orders, NOT archived (no point), with
  // a non-null shopify_id and a NULL payment_status.
  const { data: rows, error: queryError } = await supabase
    .from("orders")
    .select("id, shopify_id")
    .eq("source", "Shopify")
    .not("shopify_id", "is", null)
    .is("payment_status", null)
    .limit(batchSize);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  const orders = (rows ?? []) as Array<{ id: string; shopify_id: string }>;

  // Also report total remaining so the caller knows how many batches
  // are left. This is a separate count query so the limit doesn't
  // bound it.
  const { count: remainingTotal } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("source", "Shopify")
    .not("shopify_id", "is", null)
    .is("payment_status", null);

  if (orders.length === 0) {
    return NextResponse.json({
      ok: true,
      batch_size: 0,
      updated: 0,
      errors: [],
      remaining: 0,
      message: "Nothing to backfill — every Shopify order already has a payment_status.",
    });
  }

  // ── Fetch from Shopify in one bulk call ─────────────────────────────
  let token: string;
  try {
    token = await getShopifyToken();
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to get Shopify token", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const ids = orders.map(o => o.shopify_id).join(",");
  // `status=any` includes cancelled / archived orders; we want them
  // because our DB may already have them as `archived = true`.
  // Field-restrict to just what we need to keep the response tiny.
  const url =
    `https://${domain}/admin/api/2024-01/orders.json` +
    `?ids=${encodeURIComponent(ids)}&status=any&limit=${orders.length}&fields=id,financial_status`;

  let shopifyOrders: Array<{ id: number | string; financial_status: string | null }> = [];
  try {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify API error: ${res.status}`, body: text.slice(0, 500) },
        { status: 502 },
      );
    }
    const data = await res.json();
    shopifyOrders = data.orders ?? [];
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to reach Shopify", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Index by id (Shopify returns it as a number; we store as string)
  const byShopifyId = new Map<string, string | null>();
  for (const so of shopifyOrders) {
    byShopifyId.set(String(so.id), so.financial_status);
  }

  // ── Update each matching row ────────────────────────────────────────
  let updated = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const row of orders) {
    const financialStatus = byShopifyId.get(row.shopify_id);
    if (financialStatus === undefined) {
      // Shopify didn't return this order — likely deleted on their end.
      // Mark it as such by writing an empty-but-not-null sentinel so
      // we don't loop on it forever. Using "unknown" is safer than
      // leaving it null.
      const { error: updateError } = await supabase
        .from("orders")
        .update({ payment_status: "unknown" })
        .eq("id", row.id);
      if (updateError) {
        errors.push({ id: row.id, error: `not in Shopify response, mark failed: ${updateError.message}` });
      } else {
        updated++;
      }
      continue;
    }

    const value = financialStatus ?? "unknown";
    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: value })
      .eq("id", row.id);
    if (updateError) {
      errors.push({ id: row.id, error: updateError.message });
    } else {
      updated++;
    }
  }

  const remainingAfter = Math.max(0, (remainingTotal ?? orders.length) - updated);

  return NextResponse.json({
    ok: true,
    batch_size: orders.length,
    updated,
    errors,
    remaining: remainingAfter,
    message:
      remainingAfter > 0
        ? `Processed ${updated} of ${orders.length}. ${remainingAfter} orders still need backfilling — run again.`
        : `Done. Backfilled ${updated} orders.`,
  });
}
