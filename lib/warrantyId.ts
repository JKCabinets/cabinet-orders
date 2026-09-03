import { displayOrderNumber, type Order } from "@/lib/data";

/**
 * Warranty claim ids: WRN-1048-1, WRN-1048-2.
 *
 * ⚠ THIS REPLACES THREE GENERATORS THAT ALL HAD THE SAME BUG.
 *
 *     app/api/orders/route.ts:104   `WRN-${String(Date.now()).slice(-4)}`
 *     app/api/warranties/route.ts:52  the same expression
 *     lib/store.tsx:350               the same expression
 *
 *   The last four digits of epoch milliseconds cycle every TEN SECONDS, so two
 *   claims logged ten seconds apart collide -- and `orders.id` is the primary
 *   key, so the second insert fails with a raw constraint error. Only the first
 *   of those three was ever reachable; the other two are dead code that would
 *   have carried the bug forward whenever somebody revived them.
 *
 * ⚠ AND THE IDS SAID NOTHING. `WRN-4791` gives no hint which order a claim is
 *   about, so every lookup had to go through the row. Tying the id to the
 *   parent means the sequence is meaningful and a duplicate is impossible
 *   rather than merely unlikely -- a second claim on the same order is `-2`
 *   because there is already a `-1`, not because a clock ticked.
 */

/** Only characters that can appear in an id we generate. */
const PARENT_KEY_RE = /^[A-Z0-9-]+$/;

/**
 * The part of the parent order a claim id is built from.
 *
 * A claim is about a GROUP (`SHO-1048-CAB`), because the 48-hour window in
 * Terms 12.3 runs from a delivery and deliveries are per group. But the id
 * reads better keyed on the purchase, and there is no ambiguity: the group is
 * recorded in `about_order_id`, which is the authoritative link.
 *
 *   SHO-1048-CAB (project SHO-1048)  ->  1048
 *   CST-1787174567522                ->  CST-1787174567522
 *
 * A standalone custom job keeps its whole id, because there is nothing to
 * strip and a truncated one would not be unique.
 */
export function warrantyParentKey(parent: Pick<Order, "id" | "project_id">): string {
  const display = displayOrderNumber(parent);
  const key = display.replace(/^SHO-/, "").toUpperCase();
  return PARENT_KEY_RE.test(key) ? key : "";
}

export function warrantyIdFor(parentKey: string, seq: number): string {
  return `WRN-${parentKey}-${seq}`;
}

/**
 * Read the sequence back out of an id.
 *
 * Returns null for the legacy `WRN-4791` shape, which is correct: those have
 * no parent and no sequence, and treating "4791" as a sequence number would
 * make the next claim on some unrelated order collide with it.
 */
export function parseWarrantyId(
  id: string,
): { parentKey: string; seq: number } | null {
  const m = /^WRN-(.+)-(\d+)$/.exec(id);
  if (!m) return null;
  const seq = Number(m[2]);
  if (!Number.isInteger(seq) || seq < 1) return null;
  return { parentKey: m[1], seq };
}

/**
 * The next free sequence, given every existing id for this parent.
 *
 * ⚠ MAX + 1, NOT COUNT + 1. Counting would reuse a number if a claim were
 * ever deleted, and reusing a claim reference is worse than a gap in one.
 */
export function nextWarrantySeq(existingIds: readonly string[]): number {
  let max = 0;
  for (const id of existingIds) {
    const parsed = parseWarrantyId(id);
    if (parsed && parsed.seq > max) max = parsed.seq;
  }
  return max + 1;
}
