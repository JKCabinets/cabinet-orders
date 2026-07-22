import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { decodeSku, ensureSkuMaps, skuMapsUnavailable } from "@/lib/skuDecoder";
import type { SkuItem } from "@/lib/data";

/**
 * POST /api/admin/backfill-decode   (Step 3.5 — one-time backfill)
 *
 * Fills blank `door_style` / `color` on existing orders' sku_items by decoding
 * each line's stored SKU with the server-side mapping cache — the values the
 * webhook now persists at ingest. This is what turns "Unknown" group headers on
 * historical orders back into real style/color after the decoder went
 * server-only (2b/2c + 2d).
 *
 * Body: { dry_run?: boolean, after?: string, batch_size?: number }
 *   - dry_run: true  → report what WOULD change; write nothing.
 *   - dry_run: false → write filled sku_items back.
 *   - after: keyset cursor (an order id). Omit for the first page; pass the
 *     response's `next_cursor` to continue. `done: true` when the last page is
 *     reached (scanned < batch_size).
 *
 * Safe + idempotent:
 *   - FILLS BLANKS ONLY: `item.door_style || decodeSku(item.sku)?.doorStyle`.
 *     An already-set value is preserved; a second run finds nothing to fill.
 *   - Scope is door_style/color only. It does NOT set needs_review — flagging
 *     historical orders is Step 4's separate "Re-decode" action.
 *   - Degrades safely: if the mapping table can't load, returns 503 and writes
 *     nothing rather than blanking everything.
 *
 * Auth: admin session required (manual admin tool).
 *
 * Returns: { ok, dry_run, scanned, orders_changed, fields_filled,
 *            next_cursor, done, errors, message }
 */

const DEFAULT_BATCH = 200;
const MAX_BATCH = 500;

/** Pure fill: returns the (possibly) updated items + how many fields were filled. */
export function fillItems(items: SkuItem[]): { items: SkuItem[]; fieldsFilled: number; changed: boolean } {
  let fieldsFilled = 0;
  const out = items.map(item => {
    const decoded = item.sku ? decodeSku(item.sku) : null;
    const doorVal = item.door_style || decoded?.doorStyle || "";
    const colorVal = item.color || decoded?.color || "";
    const doorFilled = !!doorVal && doorVal !== (item.door_style ?? "");
    const colorFilled = !!colorVal && colorVal !== (item.color ?? "");
    if (!doorFilled && !colorFilled) return item;
    fieldsFilled += (doorFilled ? 1 : 0) + (colorFilled ? 1 : 0);
    // Write ONLY the field that was actually filled — don't stamp a blank
    // door_style onto color-only (HCI/J&K) lines.
    const next: SkuItem = { ...item };
    if (doorFilled) next.door_style = doorVal;
    if (colorFilled) next.color = colorVal;
    return next;
  });
  return { items: out, fieldsFilled, changed: fieldsFilled > 0 };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dry_run === true;
  const after = typeof body.after === "string" ? body.after : "";
  const requested = Number(body.batch_size ?? DEFAULT_BATCH);
  const batchSize = Math.min(Math.max(1, requested), MAX_BATCH);

  // Warm the cache; refuse (don't write) if it can't load — a backfill run with
  // no maps would fill nothing useful and just churn.
  try { await ensureSkuMaps(); } catch { /* handled by the guard below */ }
  if (skuMapsUnavailable()) {
    return NextResponse.json(
      { error: "SKU mappings unavailable — try again shortly." },
      { status: 503 },
    );
  }

  // Keyset page over orders that have sku_items, ordered by id. Any total order
  // works for one-pass-per-row coverage; `> after` guarantees forward progress.
  let query = supabase
    .from("orders")
    .select("id, sku_items")
    .not("sku_items", "is", null)
    .order("id", { ascending: true })
    .limit(batchSize);
  if (after) query = query.gt("id", after);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const orders = (rows ?? []) as Array<{ id: string; sku_items: SkuItem[] | null }>;

  let ordersChanged = 0;
  let fieldsFilled = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const o of orders) {
    const items = o.sku_items ?? [];
    if (items.length === 0) continue;
    const { items: filled, fieldsFilled: n, changed } = fillItems(items);
    if (!changed) continue;

    if (dryRun) {
      ordersChanged++;
      fieldsFilled += n;
      continue;
    }

    const { error: uErr } = await supabase
      .from("orders")
      .update({ sku_items: filled })
      .eq("id", o.id);
    if (uErr) {
      errors.push({ id: o.id, error: uErr.message });
    } else {
      ordersChanged++;
      fieldsFilled += n;
    }
  }

  const scanned = orders.length;
  const nextCursor = scanned > 0 ? orders[orders.length - 1].id : after;
  const done = scanned < batchSize;

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    scanned,
    orders_changed: ordersChanged,
    fields_filled: fieldsFilled,
    next_cursor: nextCursor,
    done,
    errors,
    message: done
      ? `${dryRun ? "Dry run" : "Backfill"} complete: ${ordersChanged} orders / ${fieldsFilled} fields on this final page.`
      : `Processed ${scanned}. More remain — call again with after="${nextCursor}".`,
  });
}
