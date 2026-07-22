import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { ensureSkuMaps, skuMapsUnavailable } from "@/lib/skuDecoder";
import { reDecodeItems } from "@/lib/reDecode";
import type { SkuItem } from "@/lib/data";

/**
 * POST /api/admin/orders/[id]/re-decode   (Step 4d)
 *
 * Re-runs decode/build against the CURRENT sku_mappings for ONE order's stored
 * line items — refills door/color, recomputes each line's needs_review, and
 * updates the orders.needs_review rollup. Use after assigning a code (Step 5)
 * or once the mapping table is readable again, to clear flags that now resolve.
 *
 * Admin only. Warms the cache first and refuses (503) if it can't load, so a
 * bad read can't re-flag everything. Writes one order_activity note; leaves the
 * historical flag notes intact.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try { await ensureSkuMaps(); } catch { /* handled by the guard below */ }
  if (skuMapsUnavailable()) {
    return NextResponse.json(
      { error: "SKU mappings unavailable — try again shortly." },
      { status: 503 },
    );
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, sku_items, needs_review")
    .eq("id", id)
    .single();
  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const items = (Array.isArray(order.sku_items) ? order.sku_items : []) as SkuItem[];
  const result = reDecodeItems(items);
  const needsReview = result.flaggedCount > 0;

  if (!result.changed && order.needs_review === needsReview) {
    return NextResponse.json({
      ok: true,
      changed: false,
      resolved: 0,
      still_flagged: result.flaggedCount,
      message: "No change — nothing to re-decode.",
    });
  }

  const { error: uErr } = await supabase
    .from("orders")
    .update({ sku_items: result.items, needs_review: needsReview })
    .eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const who = (auth as { session: { user: { name?: string } } }).session.user.name ?? "an admin";
  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const stillNote = needsReview ? `, ${result.flaggedCount} still flagged` : "";
  const note = result.resolvedCount > 0
    ? `Re-decoded by ${who} — ${result.resolvedCount} line${result.resolvedCount > 1 ? "s" : ""} resolved${stillNote}.`
    : `Re-decoded by ${who} — no lines resolved${stillNote}.`;
  await supabase.from("order_activity").insert({ order_id: id, text: note, time: today });

  return NextResponse.json({
    ok: true,
    changed: true,
    resolved: result.resolvedCount,
    still_flagged: result.flaggedCount,
    message: note,
  });
}
