import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * AN ARCHIVED ROW IS READ-ONLY (decided 2026-09-16, handoff item 20 step 2).
 *
 * The archive is history: it is browsed and restored, not worked. Until this
 * existed nothing said so on the server -- PATCH, both attachment routes and
 * the acknowledgment route all wrote to an archived row happily, so a stale
 * tab, a script, or a control somebody forgot to hide could still move an
 * archived custom job's stage or delete a receipt off an archived purchase.
 * A modal that merely hides its buttons makes read-only a look; this makes it
 * a fact, and gives the modal one question to ask.
 *
 * ⚠ ARCHIVED EITHER WAY. A standalone row carries `archived` itself. A
 * project-linked group never does -- its PURCHASE is archived and the group is
 * hidden by lookup (orders_archived_standalone_only forbids the other shape) --
 * so every check has to ask the purchase too.
 *
 * ⚠ WHAT IS STILL ALLOWED. Restoring, which is the one way out: on a standalone
 * row that is PATCH `{archived: false}` and nothing else, and on a purchase it
 * is the projects route, which this never touches. The webhook and the crons do
 * not come through these routes at all: Shopify keeps sending updates for an
 * archived purchase and those must keep landing, so the rule is "no human
 * edits", not "no writes".
 */
export interface PurchaseState {
  archived: boolean | null;
  payment_status: string | null;
  payment_hold_cleared_for: string | null;
}

/**
 * The row's purchase, `null` for a standalone row, or a NextResponse to return
 * as-is when the purchase cannot be read.
 *
 * Refusing on an unreadable purchase is deliberate: the alternative is editing
 * a row that may belong to an archived or refunded purchase because a read
 * failed. The payment hold in PATCH /api/orders/[id] reads the same record, so
 * that route loads it once and uses it twice.
 */
export async function purchaseOf(
  order: { project_id?: string | null },
): Promise<PurchaseState | null | NextResponse> {
  if (!order.project_id) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("archived, payment_status, payment_hold_cleared_for")
    .eq("id", order.project_id)
    .single();
  if (error || !data) {
    return NextResponse.json(
      {
        error: "purchase_unavailable",
        message: "Could not read the purchase this order belongs to, so nothing was changed. Try again.",
      },
      { status: 500 },
    );
  }
  return data as PurchaseState;
}

/**
 * Archived through its purchase, on its own, or not at all.
 *
 * ⚠ THE IMPLEMENTATION MOVED TO lib/data ON 2026-09-16 so the ORDER MODAL can
 * ask exactly what these routes ask. lib/data has no imports of its own, which
 * is why the shared half lives there while the Supabase read stays here.
 * Re-exported rather than re-written: one name, one answer.
 */
export { archivedVia } from "@/lib/data";

/**
 * The refusal. 409 rather than 422: the request is not malformed, the row is in
 * a state that does not accept it -- the same shape as claimed_by_other and
 * payment_hold.
 */
export function archivedReadOnly(
  order: { project_id?: string | null },
  via: "purchase" | "row",
): NextResponse {
  return NextResponse.json(
    {
      error: "archived_read_only",
      ...(via === "purchase" ? { project_id: order.project_id } : {}),
      message: via === "purchase"
        ? `This order is part of ${order.project_id}, which is archived. Restore the purchase before changing anything in it.`
        : "This order is archived. Restore it before changing anything.",
    },
    { status: 409 },
  );
}
