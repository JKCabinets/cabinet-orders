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
 * Samples: New -> Shipped -> Delivered.
 *
 * ⚠ THEY NO LONGER SHARE ORDER_STAGE_ORDER. "Entered" was renamed "Shipped" on
 * 2026-08-25 -- the word a customer sees -- and "Shipped" is not in the cabinet
 * array. Sharing it would make stageIndex() return -1 for every sample, which
 * silently disables backward-move detection and makes isStageAllowedForType
 * reject the stage. Their own array, and FLOW_BY_TYPE keeps reporting "order"
 * so they still clear dates on a reversal.
 */
export const SAMPLE_STAGE_ORDER = [
  "New", "Shipped", "Delivered",
] as const;

/**
 * Hardware is DROP-SHIP via the manufacturer's UPS account: New -> Ordered ->
 * Delivered.
 *
 * ⚠ "New" was added on 2026-08-25 -- the flow began at Ordered, so an ingested
 * group read as already placed with the vendor.
 *
 * ⚠ "Shipped" is REACHED BY ENTERING A TRACKING NUMBER, not by a button. It
 * was briefly removed on the belief that it meant "JK shipped it"; on a
 * drop-ship flow it means the MANUFACTURER DISPATCHED, which is exactly what a
 * tracking number evidences.
 *
 * ⚠ Every name still collides: "New" and "Delivered" are ORDER stages,
 * "Ordered" is a CUSTOM one. stageIndex() falls back to searching
 * order -> warranty -> custom when no type is passed, so an untyped lookup
 * resolves to the WRONG flow. Every call site must pass the row type.
 */
export const HARDWARE_STAGE_ORDER = [
  "New", "Ordered", "Shipped", "Delivered",
] as const;

export const ALLOWED_STAGES: ReadonlySet<string> = new Set<string>([
  ...ORDER_STAGE_ORDER,
  ...WARRANTY_STAGE_ORDER,
  ...CUSTOM_STAGE_ORDER,
  // Hardware adds no new members -- every one of its names already appears in
  // another flow. Samples add none either, since "Shipped" is a warranty
  // stage. Both listed anyway so the union stays honest about its sources, and
  // so removing a flow cannot silently drop a name still used elsewhere.
  ...HARDWARE_STAGE_ORDER,
  ...SAMPLE_STAGE_ORDER,
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
  // ⚠ Its OWN array since the Entered -> Shipped rename. Pointing this at
  // ORDER_STAGE_ORDER would make stageIndex() return -1 for every sample.
  sample: SAMPLE_STAGE_ORDER,
  warranty: WARRANTY_STAGE_ORDER,
  custom: CUSTOM_STAGE_ORDER,
  hardware: HARDWARE_STAGE_ORDER,
};

/**
 * ⚠ THESE ARRAYS AND lib/data.ts's STAGE_*_STAGES NOW MATCH EXACTLY, for every
 * type. They have to, and this asserts it at module load rather than trusting
 * two files to be edited together.
 *
 * They diverged for one reason: samples pointed here at ORDER_STAGE_ORDER --
 * five stages -- while their UI list was a three-stage subset. That gap was
 * real and dangerous: `isStageAllowedForType` reads THIS map, so the server
 * would have accepted `stage: "In production"` on a sample, landing it
 * somewhere its own rail cannot draw.
 *
 * The Entered -> Shipped rename on 2026-08-25 gave samples their own array and
 * the divergence dissolved. Rather than delete one map -- stageIndex() needs an
 * ORDERING, the rails need a LIST, and they may legitimately differ again --
 * this fails loudly the moment they stop agreeing.
 *
 * If this throws, one of the two was edited and the other was not. That is the
 * bug, not this check.
 */
if (process.env.NODE_ENV !== "production") {
  // Imported lazily so this file stays free of a circular dependency at
  // runtime; lib/data.ts imports nothing from here.
  void (async () => {
    try {
      const data = await import("./data");
      for (const [type, ordering] of Object.entries(STAGE_ORDER_BY_TYPE)) {
        const list = (data.STAGE_LIST_BY_TYPE as Record<string, readonly string[]>)[type];
        if (!list) continue;
        const a = ordering.join(" > ");
        const b = list.join(" > ");
        if (a !== b) {
          console.error(
            `[stageLogic] ${type} ordering and UI list disagree.\n`
            + `  STAGE_ORDER_BY_TYPE: ${a}\n`
            + `  STAGE_LIST_BY_TYPE:  ${b}\n`
            + `  One was edited without the other. stageIndex() and the rails `
            + `will disagree about this flow.`,
          );
        }
      }
    } catch { /* never break a page over a dev-only check */ }
  })();
}

/**
 * Samples report flow "order" so fieldsToClearOnBackwardMove applies to them:
 * their delivery date drives the calendar, and a stale one after a reversal
 * shows a delivery that is not happening.
 *
 * ⚠ They no longer SHARE the order array -- see SAMPLE_STAGE_ORDER -- so this
 * is now a deliberate statement rather than a consequence. The clearing code
 * resolves positions against the row's OWN flow, so a sample with no
 * "In production" stage simply never matches those rules.
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
 *
 * ── WHICH FLOWS CLEAR, AND WHY ─────────────────────────────────────────────
 *
 * This is a DECISION, not a deferral. It carried a TODO saying clearing was
 * "skipped for now rather than computed wrongly" — true about the arithmetic
 * (fixed below), but it left the real question unanswered.
 *
 *   order, sample   CLEAR. These dates drive AUTOMATION: production-complete
 *                   advances on `production_est_finish_date <= today`, and the
 *                   calendar and SLA read the delivery fields. A stale date
 *                   means a cron acts on something that is not happening.
 *
 *   custom          DOES NOT CLEAR. The custom flow is a designer's notebook:
 *                   contract work priced by hand, scheduled by conversation,
 *                   with the designer talking to the customer directly. Those
 *                   dates were TYPED IN after a phone call. Nothing reads
 *                   them — production-complete is filtered to
 *                   ["order","sample"] — so clearing them prevents no wrong
 *                   automation and destroys the only record of that call.
 *                   Backward moves already cost an admin PIN; silently wiping
 *                   four fields on top of that is not tidying, it is loss.
 *
 *   warranty        No production or delivery dates to clear. AND its rows
 *                   carry two fields that must never be touched — see below.
 *
 *   hardware        No such dates either; it runs Ordered → Shipped →
 *                   Delivered with a carrier and a tracking number.
 *
 * Returns a partial update object suitable for spreading into the DB UPDATE,
 * or null if nothing should change.
 */

/**
 * Flows that clear on a reversal.
 *
 * ⚠ HARDWARE ADDED 2026-08-27. It was excluded on the grounds that it has no
 * production or delivery dates to clear, which was true and is no longer the
 * whole question: it carries a TRACKING NUMBER, and HARDWARE_RULES.Ordered
 * gates its SLA clock on that number being absent. A hardware group bounced
 * back from Shipped kept the number and never started the clock whose entire
 * purpose is "placed, and nobody has recorded a dispatch".
 *
 * Adding it costs nothing else: the date rules below resolve positions against
 * the row's OWN flow, and hardware has no "In production" or "At cross dock",
 * so posOf returns -1 and those rules never match.
 *
 * Custom and warranty stay out, for the reasons in the block above.
 */
const FLOWS_THAT_CLEAR: ReadonlySet<StageFlow> = new Set<StageFlow>(["order", "hardware"]);

/**
 * ⚠ NEVER CLEARED, whatever the flow.
 *
 * Today these survive only because warranty returns early — protection by
 * accident. Named here so that narrowing the guard above cannot silently take
 * them with it.
 *
 *   reported_at      When the CUSTOMER reported the issue. The reporting
 *                    windows in Terms §12.3 are conditions precedent to a
 *                    claim, and the warranty SLA measures from this. Losing it
 *                    loses the claim's standing.
 *   about_order_id   Which order a claim is about. Clearing it strands the
 *                    claim — a warranty row with no link cannot be traced to
 *                    what was sold.
 */
const NEVER_CLEARED = ["reported_at", "about_order_id"] as const;

export function fieldsToClearOnBackwardMove(
  currentStage: string,
  targetStage: string,
  type?: string,
): Record<string, string | null> | null {
  if (!isBackwardsMove(currentStage, targetStage, type)) return null;
  const target = stageIndex(targetStage, type);
  if (!FLOWS_THAT_CLEAR.has(target.flow)) return null;

  // Positions are resolved against THIS ROW'S OWN FLOW, not against
  // ORDER_STAGE_ORDER.
  //
  // The rules below used to compare `target.idx` -- an index within the row's
  // flow -- against `ORDER_STAGE_ORDER.indexOf(...)`. Those agree only when
  // the row IS an order flow. "At cross dock" is index 3 in ORDER_STAGE_ORDER
  // and index 4 in CUSTOM_STAGE_ORDER, so a custom row would have been
  // measured against the wrong ruler.
  //
  // Unreachable today, because only the order flow clears. Fixed anyway: a
  // known-wrong calculation sitting behind a guard is inherited by whoever
  // narrows that guard next, which is exactly how isStageAllowedForType became
  // a hole. A stage absent from the flow gives -1 and simply never matches.
  const flowOrder = (type ? STAGE_ORDER_BY_TYPE[type] : undefined) ?? ORDER_STAGE_ORDER;
  const posOf = (stage: string) => (flowOrder as readonly string[]).indexOf(stage);
  const crossDockPos = posOf("At cross dock");
  const productionPos = posOf("In production");

  // Mixed value type:
  //   - `null` for date columns and nullable text (entered_by). These are
  //     `date` or nullable `text` in the DB.
  //   - `""` for delivery_window and delivery_notes, which are NOT NULL
  //     text columns (default '') from supabase-schema-v2. Setting them
  //     to null violates the constraint and returns a 500 from the API;
  //     empty string is the schema-sanctioned "no value" sentinel.
  const clear: Record<string, string | null> = {};

  // Target is "At cross dock" or earlier → clear delivery date
  if (crossDockPos >= 0 && target.idx <= crossDockPos) {
    clear.delivery_date = null;
    clear.scheduled_delivery_date = null;
  }
  // When target is "At cross dock", keep window/notes (the user is fixing
  // a scheduled delivery — access notes are still relevant). When target
  // is earlier, drop them too — but to "" not null (NOT NULL columns).
  if (crossDockPos >= 0 && target.idx < crossDockPos) {
    clear.delivery_window = "";
    clear.delivery_notes = "";
  }

  // Target is earlier than "In production" → clear production dates
  if (productionPos >= 0 && target.idx < productionPos) {
    clear.production_start_date = null;
    clear.production_est_finish_date = null;
  }
  // Target is exactly "In production" → clear only the finish estimate;
  // keep the start date so the order makes sense as "currently in production".
  else if (productionPos >= 0 && target.idx === productionPos) {
    clear.production_est_finish_date = null;
  }

  // ⚠ ONE TRUTH PER ITEM.
  //
  // A tracking number is the EVIDENCE for "Shipped". A row sitting before that
  // stage has not shipped, so holding the number is a contradiction -- and the
  // rest of the system reads it as fact:
  //
  //   · SAMPLE_RULES.New and HARDWARE_RULES.Ordered both gate their clock on
  //     `!o.tracking_number`, so a retained number switches the SLA off for
  //     precisely the row that needs chasing.
  //   · The modal pre-fills TrackingEntry from the row, so Ship re-submits the
  //     same string and the advance reads as "nothing changed".
  //
  // Both were live on SHO-1051-SMP on 2026-08-27. Re-entry starts fresh even
  // when the number is identical: what is being recorded is a new shipment
  // decision, not the same one twice. The old number is not lost -- the
  // activity row that put it there is the history.
  //
  // ⚠ "Shipped" AS A LITERAL, knowingly. trackingTargetStage() in
  // lib/categories.ts is the one implementation of this rule, but that module
  // statically imports lib/data, and THIS file is deliberately free of one to
  // avoid a runtime cycle -- see the lazy import in the dev assertion above.
  // Resolved against the row's OWN flow, so cabinets and custom jobs have no
  // "Shipped" position and never match, and warranty never reaches here.
  const shippedPos = posOf("Shipped");
  if (shippedPos >= 0 && target.idx < shippedPos) {
    clear.tracking_number = null;
    clear.carrier = null;
  }

  // Target is "New" → also clear entered_by (the order has un-entered)
  if (targetStage === "New") {
    clear.entered_by = null;
  }

  // Belt and braces. Nothing above can add these today, but the guard is
  // cheap and the cost of losing them is a claim that cannot be traced.
  for (const field of NEVER_CLEARED) delete clear[field];

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
    // ⚠ BOTH MAP TO ONE LABEL so the Set below dedupes them, exactly as
    // delivery_date and scheduled_delivery_date do. A field cleared without a
    // label here is cleared SILENTLY: the activity row would read "cleared
    // entered-by" while the tracking number had gone too, which is the kind of
    // omission this trail exists to prevent.
    tracking_number: "tracking number",
    carrier: "tracking number",
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
