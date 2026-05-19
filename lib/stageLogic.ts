/**
 * Pure stage-logic helpers — isomorphic, safe to import from client and
 * server. No Node-only dependencies (no `crypto`).
 *
 * The server-only secret comparison + admin-PIN env reading lives in the
 * sibling `stageGuards.ts` module so this file stays bundle-safe for the
 * client store.
 *
 * Stage orderings mirror ORDER_STAGES / WARRANTY_STAGES from lib/data.ts.
 */

export const ORDER_STAGE_ORDER = [
  "New", "Entered", "In production", "At cross dock", "Delivered",
] as const;

export const WARRANTY_STAGE_ORDER = [
  "New claim", "In review", "Parts ordered", "Shipped", "Resolved",
] as const;

export const ALLOWED_STAGES: ReadonlySet<string> = new Set<string>([
  ...ORDER_STAGE_ORDER,
  ...WARRANTY_STAGE_ORDER,
]);

export type StageFlow = "order" | "warranty" | "unknown";

export function stageIndex(stage: string): { idx: number; flow: StageFlow } {
  const orderIdx = (ORDER_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (orderIdx >= 0) return { idx: orderIdx, flow: "order" };
  const warrantyIdx = (WARRANTY_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (warrantyIdx >= 0) return { idx: warrantyIdx, flow: "warranty" };
  return { idx: -1, flow: "unknown" };
}

/**
 * Decide whether moving from `currentStage` to `targetStage` is a backwards
 * transition (lower index within the same flow). Cross-flow moves (order ↔
 * warranty) are treated as NOT backwards — the caller should reject those
 * separately if they're disallowed.
 */
export function isBackwardsMove(currentStage: string, targetStage: string): boolean {
  const current = stageIndex(currentStage);
  const target = stageIndex(targetStage);
  if (current.flow === "unknown" || target.flow === "unknown") return false;
  if (current.flow !== target.flow) return false;
  return target.idx < current.idx;
}

/**
 * When an order moves backwards through the pipeline, certain date fields
 * become stale: they describe progress that has now been undone. We clear
 * them so the calendar, SLA page, and dashboard don't keep showing the
 * order on schedule for events that won't happen.
 *
 * Mapping by **target stage** (what to clear when landing back here):
 *   → New             : entered_by, all production dates, all delivery fields
 *   → Entered         : all production dates, all delivery fields
 *   → In production   : all delivery fields + production_est_finish_date.
 *                       production_start_date stays — it's what's keeping
 *                       the order IN production.
 *   → At cross dock   : delivery date only (window/notes stay — they're the
 *                       scheduling intent, which is what we're trying to fix)
 *
 * Forward moves don't trigger any clearing.
 * Warranty stages have no date-driven transitions, so no fields to clear.
 *
 * Returns a partial update object suitable for spreading into the DB UPDATE,
 * or null if nothing should change.
 */
export function fieldsToClearOnBackwardMove(
  currentStage: string,
  targetStage: string,
): Record<string, string | null> | null {
  if (!isBackwardsMove(currentStage, targetStage)) return null;
  const target = stageIndex(targetStage);
  if (target.flow !== "order") return null; // warranty has no date transitions

  // Mixed value type:
  //   - `null` for date columns and nullable text (entered_by). These are
  //     `date` or nullable `text` in the DB.
  //   - `""` for delivery_window and delivery_notes, which are NOT NULL
  //     text columns (default '') from supabase-schema-v2. Setting them
  //     to null violates the constraint and returns a 500 from the API;
  //     empty string is the schema-sanctioned "no value" sentinel.
  const clear: Record<string, string | null> = {};

  // Target is "At cross dock" or earlier → clear delivery date
  if (target.idx <= ORDER_STAGE_ORDER.indexOf("At cross dock")) {
    clear.delivery_date = null;
    clear.scheduled_delivery_date = null;
  }
  // When target is "At cross dock", keep window/notes (the user is fixing
  // a scheduled delivery — access notes are still relevant). When target
  // is earlier, drop them too — but to "" not null (NOT NULL columns).
  if (target.idx < ORDER_STAGE_ORDER.indexOf("At cross dock")) {
    clear.delivery_window = "";
    clear.delivery_notes = "";
  }

  // Target is earlier than "In production" → clear production dates
  if (target.idx < ORDER_STAGE_ORDER.indexOf("In production")) {
    clear.production_start_date = null;
    clear.production_est_finish_date = null;
  }
  // Target is exactly "In production" → clear only the finish estimate;
  // keep the start date so the order makes sense as "currently in production".
  else if (target.idx === ORDER_STAGE_ORDER.indexOf("In production")) {
    clear.production_est_finish_date = null;
  }

  // Target is "New" → also clear entered_by (the order has un-entered)
  if (targetStage === "New") {
    clear.entered_by = null;
  }

  return Object.keys(clear).length > 0 ? clear : null;
}

/**
 * Human-readable list of the fields that would be cleared. Used for the
 * activity-log message so the team can see what got wiped.
 */
export function describeFieldsCleared(cleared: Record<string, string | null> | null): string {
  if (!cleared) return "";
  const labels: Record<string, string> = {
    entered_by: "entered-by",
    production_start_date: "production start",
    production_est_finish_date: "production finish",
    delivery_date: "delivery date",
    scheduled_delivery_date: "delivery date",
    delivery_window: "delivery window",
    delivery_notes: "delivery notes",
  };
  // Dedupe (delivery_date + scheduled_delivery_date both map to "delivery date")
  const set = new Set<string>();
  for (const k of Object.keys(cleared)) {
    if (labels[k]) set.add(labels[k]);
  }
  if (set.size === 0) return "";
  const arr = Array.from(set);
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}
