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

export const CUSTOM_STAGE_ORDER = [
  "New", "In review", "Ordered", "In production", "At cross dock", "Delivered",
] as const;

/**
 * Hardware ships on its own timeline, so it gets its own ordering rather
 * than a subset of another flow the way samples reuse ORDER_STAGE_ORDER.
 *
 * ⚠ All three names collide: "Ordered" is also a CUSTOM stage, "Shipped" a
 * WARRANTY one, "Delivered" an ORDER one. stageIndex() falls back to a
 * search across order -> warranty -> custom when no type is passed, so an
 * untyped lookup of any hardware stage resolves to the WRONG flow. Every
 * call site must pass the row type.
 */
export const HARDWARE_STAGE_ORDER = [
  "Ordered", "Shipped", "Delivered",
] as const;

export const ALLOWED_STAGES: ReadonlySet<string> = new Set<string>([
  ...ORDER_STAGE_ORDER,
  ...WARRANTY_STAGE_ORDER,
  ...CUSTOM_STAGE_ORDER,
  // Adds no new members -- every hardware stage name already appears in
  // another flow. Listed anyway so the union stays honest about its
  // sources, and so removing a flow cannot silently drop a name.
  ...HARDWARE_STAGE_ORDER,
]);

export type StageFlow = "order" | "warranty" | "custom" | "hardware" | "unknown";

/**
 * Which stage ordering applies to a row, keyed by its `type` column.
 *
 * `sample` maps to ORDER_STAGE_ORDER deliberately -- see SampleStage in
 * lib/data.ts. Sharing the array is what lets samples reuse backward-move
 * detection, date clearing, and the Shopify stage tags unchanged.
 */
export const STAGE_ORDER_BY_TYPE: Record<string, readonly string[]> = {
  order: ORDER_STAGE_ORDER,
  sample: ORDER_STAGE_ORDER,
  warranty: WARRANTY_STAGE_ORDER,
  custom: CUSTOM_STAGE_ORDER,
  hardware: HARDWARE_STAGE_ORDER,
};

/**
 * Samples report flow "order" because they share the order array; that is
 * what makes fieldsToClearOnBackwardMove apply to them correctly.
 */
const FLOW_BY_TYPE: Record<string, StageFlow> = {
  order: "order",
  sample: "order",
  warranty: "warranty",
  custom: "custom",
  // Reports its own flow, NOT "order". That is what keeps
  // fieldsToClearOnBackwardMove away from it -- hardware has no production
  // or delivery dates to clear, and the ORDER_STAGE_ORDER indices the
  // clearing rules are written against do not apply.
  hardware: "hardware",
};

/**
 * Resolve a stage name to its position within its flow.
 *
 * PASS `type` WHENEVER YOU HAVE IT. Stage names are no longer globally
 * unique: "New", "Delivered", "In production" and "At cross dock" appear in
 * both the order and custom flows, and "In review" is in both warranty and
 * custom. Without `type` this falls back to the legacy search order --
 * order, then warranty, then custom -- which is exactly the old behaviour
 * for every stage string that existed before custom orders, but WILL
 * mis-resolve a custom row.
 *
 * An unrecognised type falls through to the legacy path rather than
 * throwing, so a corrupted `type` column degrades instead of 500ing.
 */
/**
 * Is `stage` part of `type`'s OWN flow?
 *
 * ALLOWED_STAGES is the union of every flow, so it happily accepts
 * "Parts ordered" on a custom order -- which strands the row where
 * stageIndex returns -1 and no stage tab matches it. That is not
 * hypothetical: it happened to QUO-1787174567522 on 2026-08-19.
 *
 * An UNKNOWN type falls back to the union rather than rejecting, so a row
 * with a corrupted `type` column stays editable instead of becoming stuck.
 */
export function isStageAllowedForType(stage: string, type?: string | null): boolean {
  const flow = type ? STAGE_ORDER_BY_TYPE[type] : undefined;
  if (!flow) return ALLOWED_STAGES.has(stage);
  return flow.includes(stage);
}

export function stageIndex(stage: string, type?: string): { idx: number; flow: StageFlow } {
  if (type) {
    const arr = STAGE_ORDER_BY_TYPE[type];
    if (arr) {
      const idx = arr.indexOf(stage);
      return idx >= 0
        ? { idx, flow: FLOW_BY_TYPE[type] ?? "unknown" }
        : { idx: -1, flow: "unknown" };
    }
  }
  const orderIdx = (ORDER_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (orderIdx >= 0) return { idx: orderIdx, flow: "order" };
  const warrantyIdx = (WARRANTY_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (warrantyIdx >= 0) return { idx: warrantyIdx, flow: "warranty" };
  const customIdx = (CUSTOM_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (customIdx >= 0) return { idx: customIdx, flow: "custom" };
  return { idx: -1, flow: "unknown" };
}

/**
 * Decide whether moving from `currentStage` to `targetStage` is a backwards
 * transition (lower index within the same flow). Cross-flow moves (order ↔
 * warranty) are treated as NOT backwards — the caller should reject those
 * separately if they're disallowed.
 */
export function isBackwardsMove(
  currentStage: string,
  targetStage: string,
  type?: string,
): boolean {
  const current = stageIndex(currentStage, type);
  const target = stageIndex(targetStage, type);
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
  type?: string,
): Record<string, string | null> | null {
  if (!isBackwardsMove(currentStage, targetStage, type)) return null;
  const target = stageIndex(targetStage, type);
  // Warranty has no date-driven transitions. Custom orders DO have
  // production and delivery stages, but their indices differ from
  // ORDER_STAGE_ORDER (which the rules below are written against), so
  // clearing is deliberately skipped for now rather than computed wrongly.
  // TODO: revisit when the custom order modal + date fields are specified.
  // Samples report flow "order" and so DO get the standard clearing.
  if (target.flow !== "order") return null;

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
