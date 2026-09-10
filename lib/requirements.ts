import type { Order, OrderStage, OrderType } from "@/lib/data";

/**
 * What a row still needs, per (type, stage). THE source.
 *
 * ⚠ THIS QUESTION WAS ANSWERED IN FOUR PLACES BEFORE THIS FILE.
 *
 *   lib/sla.ts            `clockRuns` / `waitingFor` -- is the awaited data
 *                         absent, and what is it called
 *   lib/stageLogic.ts     `fieldsToClearOnBackwardMove` -- what the stage a row
 *                         returns to will DEMAND AGAIN
 *   app/api/orders/[id]   the PATCH gates -- what actually refuses a transition
 *   lib/categories.ts     `trackingTargetStage` -- which data makes which stage
 *
 * Four shapes of one fact. OMS-STATE already describes the second in
 * requirement language -- "a backward move clears whatever the stage it
 * returns to will demand again" -- so the clearing table and this table are
 * the same table written twice.
 *
 * Garrett's call, 2026-09-08: this becomes the source and the others derive
 * from it. `lib/sla.ts` is the first, and derives today.
 *
 * ⚠ A SOURCE TABLE WITH NO CONSUMER IS `AttentionEnrichment` AGAIN -- built,
 * documented, never fired. So this ships WITH its first consumer rather than
 * as a foundation to be adopted later.
 *
 * ── What is deliberately NOT here yet ──────────────────────────────────────
 *
 * Nothing in this file changes behaviour. The row-readable entries below
 * reproduce sla.ts's four `clockRuns` predicates EXACTLY, and the two
 * gate-backed entries carry `clocks: false` so they cannot start a clock that
 * does not exist today. Migrating the other three consumers is separate work,
 * and each is a behaviour change that should be argued on its own.
 */

/**
 * Where the answer comes from.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE REASON `enrich` EXISTS. A row-readable
 * requirement is a column: any caller holding an Order can answer it. An
 * enrichment-backed one needs a join -- `order_acknowledgments` and
 * `order_attachments` are not on the row -- so a caller must fetch it, and a
 * per-row query across a work queue is why those reasons have never appeared
 * on a screen.
 */
export type RequirementSource = "row" | "enrich";

/**
 * The joined facts a requirement may need. Optional everywhere: a caller that
 * has not fetched them gets `undefined`, and an enrichment-backed requirement
 * reports UNKNOWN rather than unmet.
 *
 * ⚠ UNKNOWN IS NOT UNMET. A queue that says "acknowledgment missing" because
 * nobody looked is worse than one that says nothing: it sends somebody to do
 * work that may already be done, and it does it on every row at once.
 */
export interface RequirementEnrichment {
  /** A green, non-stale acknowledgment covering every vendor on the order. */
  ackGreen?: boolean;
  /** Any attachment at all, of any kind. */
  hasAttachment?: boolean;
  /** An attachment with kind = 'proof_of_delivery'. */
  hasProofOfDelivery?: boolean;
}

export type RequirementState = "met" | "unmet" | "unknown";

export interface Requirement {
  /** Stable across renames. Attention reasons and UI keys use this. */
  id: string;
  /** What is needed, as a person would say it. Lowercase, no full stop. */
  label: string;
  /** What to do about it. Shown next to the label where there is room. */
  remedy: string;
  source: RequirementSource;
  /**
   * ⚠ DOES AN UNMET REQUIREMENT KEEP THE SLA CLOCK RUNNING? Not every one
   * should. sla.ts's whole design is that a stage waiting on a THIRD PARTY has
   * no rule -- an order can legitimately sit in production for six weeks -- so
   * only requirements that represent OUR unfinished work belong on a clock.
   *
   * Defaults to false, so adding an entry cannot start a clock by accident.
   */
  clocks?: boolean;
  /**
   * ⚠ DOES THE SERVER REFUSE THE TRANSITION WITHOUT THIS? Distinct from
   * `clocks`: a delivery date at At cross dock keeps a clock running and the
   * PATCH route lets the move through without it; a signed receipt runs no
   * clock and the route refuses without it. The modal's next-action panel
   * disables its move button on THESE and only these -- disabling on every
   * unmet requirement was a client gate stricter than its server, which is
   * the failure this table exists to end.
   *
   * Added 2026-09-09. Descriptive today: the gates in app/api/orders/[id]
   * are still written by hand and this records which entries they check.
   * Deriving them from here is the migration OMS-STATE §4 lists as pending.
   * Defaults to false, so adding an entry cannot claim a gate by accident.
   */
  gates?: boolean;
  /** Answer for this row. `enrich` is undefined when nobody fetched it. */
  state: (o: Order, e?: RequirementEnrichment) => RequirementState;
}

/** Helper for a plain column check. */
const rowReq = (
  id: string, label: string, remedy: string,
  met: (o: Order) => boolean,
  clocks: boolean,
  gates = false,
): Requirement => ({
  id, label, remedy, source: "row", clocks, gates,
  state: (o) => (met(o) ? "met" : "unmet"),
});

/** Helper for a join-backed check that reports unknown without enrichment. */
const enrichReq = (
  id: string, label: string, remedy: string,
  met: (e: RequirementEnrichment) => boolean | undefined,
  gates = false,
): Requirement => ({
  id, label, remedy, source: "enrich", clocks: false, gates,
  state: (_o, e) => {
    if (!e) return "unknown";
    const answer = met(e);
    return answer === undefined ? "unknown" : answer ? "met" : "unmet";
  },
});

// ── The table ──────────────────────────────────────────────────────────────
//
// ⚠ EVERY STAGE OF EVERY FLOW HAS AN ENTRY, INCLUDING EMPTY ONES. An absent
// key and "nothing is needed here" would be indistinguishable, and the
// module-load check below could not tell a stage that was considered from one
// that was forgotten.

export const REQUIREMENTS: Record<OrderType, Record<string, Requirement[]>> = {
  order: {
    // ⚠ clocks: false. STANDARD_RULES["New"] has no `clockRuns` today -- New
    // measures elapsed time from the order date, full stop. Making this clock
    // would start flagging every unacknowledged order at 24h, which is a
    // behaviour change and not this patch's to make.
    "New": [
      enrichReq(
        "ack_or_attachment",
        "an acknowledgment or an attachment",
        "Upload the manufacturer acknowledgment, or attach any file for this order",
        (e) => (e.ackGreen === undefined && e.hasAttachment === undefined)
          ? undefined
          : Boolean(e.ackGreen) || Boolean(e.hasAttachment),
        true, // the route refuses New -> Entered without one or the other
      ),
    ],
    // ⚠ ADDED 2026-09-08, WITH A SERVER GATE TO MATCH. The manufacturer
    // supplies production dates within a day or two of the order being placed,
    // well before production begins — so an order sitting at Entered without
    // them is waiting on somebody here, not on the factory.
    //
    // clocks: true, which is a VISIBLE CHANGE: Entered had no clocking
    // requirement before, so these rows now read as blocked after 24 hours.
    // That is the point. A row that reaches In production dateless can never
    // leave, because production-complete advances on the finish date.
    "Entered": [
      rowReq(
        "production_start_date", "a production start date",
        "Add the production dates from the manufacturer's acknowledgment",
        (o) => Boolean(o.production_start_date),
        true,
        true, // the route refuses Entered -> In production without it
      ),
    ],
    "In production": [
      rowReq(
        "production_dates", "production dates",
        "Set the production start and estimated finish dates",
        // ⚠ BOTH, matching sla.ts's productionDatesMissing exactly. A missing
        // finish date strands the row -- production-complete advances on
        // `production_est_finish_date <= today` -- and a missing start date
        // means somebody set the stage by hand.
        (o) => Boolean(o.production_start_date) && Boolean(o.production_est_finish_date),
        true,
      ),
    ],
    "At cross dock": [
      rowReq(
        "delivery_date", "a delivery date",
        "Set a delivery date so the order can be confirmed delivered",
        (o) => Boolean(o.delivery_date) || Boolean(o.scheduled_delivery_date),
        true,
      ),
      // ⚠ clocks: false. The receipt gates the MOVE to Delivered; it does not
      // strand the row the way a missing date does, and no clock runs on it
      // today.
      enrichReq(
        "proof_of_delivery", "a signed proof of delivery",
        "Attach the signed delivery receipt",
        (e) => e.hasProofOfDelivery,
        true, // the route refuses At cross dock -> Delivered without it (or a reason)
      ),
    ],
    "Delivered": [],
  },

  hardware: {
    "New": [],
    "Ordered": [
      rowReq(
        "tracking_number", "a tracking number",
        "Enter the tracking number from the manufacturer",
        (o) => Boolean(o.tracking_number),
        true,
        true, // the route refuses Shipped without one
      ),
    ],
    // With a carrier. No field says when to stop worrying.
    "Shipped": [],
    "Delivered": [],
  },

  sample: {
    "New": [
      rowReq(
        "tracking_number", "a tracking number",
        "Enter the tracking number, or let the Shopify fulfilment supply it",
        (o) => Boolean(o.tracking_number),
        true,
        true, // the route refuses Shipped without one
      ),
    ],
    "Shipped": [],
    "Delivered": [],
  },

  // ⚠ CUSTOM HAS NO REQUIREMENTS ANYWHERE, and that is two decisions rather
  // than one omission -- they have different reasons, and the reasons matter
  // more than the empty lists.
  //
  // No CLOCK requirements. Custom jobs are hand-driven end to end: priced by
  // hand, paid in person, scheduled by conversation, and the
  // production-complete cron is filtered to exclude them. A missing date is
  // not a stalled pipeline, it is a date that lives somewhere other than this
  // system. That is a statement about clocks and queues.
  //
  // No GATE requirements either, and in particular NO SIGNED RECEIPT. Custom
  // jobs are not governed by our Terms and policies at all: a custom customer
  // signs a contract and a purchase order with their own terms. Terms 12.3 --
  // the 48-hour reporting window, the conditions precedent, the signed proof
  // of delivery that evidences them -- is a Shopify-checkout agreement and
  // does not reach a custom job. Decided 2026-09-09. Until then the route
  // gated custom on a receipt, which was not merely unnecessary: it was
  // enforcing the wrong document. "Exempt because hand-driven" is a reason
  // somebody reinstates the gate against once the process tightens; "Terms
  // 12.3 does not apply" is not.
  //
  // ⚠ THE ROUTE AND THE ROW BUTTON BOTH ASK THIS TABLE whether a receipt is
  // needed, so this block is the one place that records which flows Terms
  // 12.3 governs. Adding an entry here is adding a gate there.
  //
  // ⚠ CUSTOM HAS NO GATES, PERIOD -- Garrett, 2026-09-09. It is an
  // organisation tool and nothing in it is a condition of anything. That
  // covers the UI as well as the routes: no control may WITHHOLD ITSELF
  // pending a custom job's date, and no copy may say a date unlocks
  // something. Three did, all at At cross dock -- the row's Confirm Delivery
  // button, the "Awaiting delivery date" status and the card's "Once set,
  // you can confirm delivery" -- and all three now ask this table. A demand
  // nothing enforces is worse than a gate: there is no error to search for,
  // only a button that never appears.
  custom: {
    "New": [], "In review": [], "Ordered": [],
    "In production": [], "At cross dock": [], "Delivered": [],
  },

  // The front half is on us and is measured by elapsed time; the back half
  // waits on a vendor or a carrier with no field that would say when to stop.
  warranty: {
    "New claim": [], "In review": [], "Parts ordered": [],
    "Shipped": [], "Resolved": [],
  },
};

// ── Reading it ─────────────────────────────────────────────────────────────

/** Every requirement for this row's current stage. Empty is normal. */
export function requirementsFor(order: Pick<Order, "type" | "stage">): Requirement[] {
  return REQUIREMENTS[order.type]?.[order.stage] ?? [];
}

/**
 * The ones that are definitely not met.
 *
 * ⚠ EXCLUDES `unknown`. See RequirementEnrichment: a caller that did not fetch
 * the joins must not be told the work is outstanding.
 */
export function unmetRequirements(
  order: Order, enrich?: RequirementEnrichment,
): Requirement[] {
  return requirementsFor(order).filter((r) => r.state(order, enrich) === "unmet");
}

/**
 * Does an SLA clock run for this row right now?
 *
 * Replaces sla.ts's per-rule `clockRuns`. Only row-readable requirements can
 * reach this -- an enrichment-backed one is `clocks: false` by construction --
 * so it needs no joins and every existing caller keeps working unchanged.
 */
export function clockRunsFor(order: Order): boolean {
  return requirementsFor(order).some(
    (r) => r.clocks === true && r.state(order) === "unmet",
  );
}

/**
 * What the row is waiting for, for a person to read. Undefined when the stage
 * has no clocking requirement, which is what sla.ts's absent `waitingFor`
 * meant.
 */
export function waitingForText(order: Order): string | undefined {
  const clocking = requirementsFor(order).filter((r) => r.clocks === true);
  if (clocking.length === 0) return undefined;
  return clocking.map((r) => r.label).join(" and ");
}

/**
 * ⚠ FAILS AT BOOT IF A FLOW AND THIS TABLE DISAGREE.
 *
 * Adding a stage to a pipeline without deciding what it needs is exactly the
 * kind of gap that stays invisible: the row simply never appears in a count.
 * Renaming one is worse -- the old key lingers and answers for a stage that no
 * longer exists, which is how `Entered` survived in sample rules for a
 * fortnight after the rename.
 *
 * Uses a lazy import so this module keeps no RUNTIME dependency on lib/data.
 * lib/stageLogic.ts does the same, deliberately, to stay free of a cycle --
 * and it is the next consumer of this table.
 */
if (process.env.NODE_ENV !== "production") {
  void (async () => {
    try {
      const { STAGE_LIST_BY_TYPE } = await import("@/lib/data");
      const problems: string[] = [];
      for (const [type, stages] of Object.entries(STAGE_LIST_BY_TYPE)) {
        const table = REQUIREMENTS[type as OrderType];
        if (!table) { problems.push(`no requirements table for type "${type}"`); continue; }
        for (const stage of stages as readonly OrderStage[]) {
          if (!(stage in table)) {
            problems.push(`${type} has no entry for stage "${stage}"`);
          }
        }
        for (const key of Object.keys(table)) {
          if (!(stages as readonly string[]).includes(key)) {
            problems.push(`${type} has an entry for "${key}", which is not in its flow`);
          }
        }
      }
      if (problems.length > 0) {
        console.error(
          "[requirements] table and pipelines disagree:\n  " + problems.join("\n  "),
        );
      }
    } catch {
      // Dev-only check. Never break the app over it.
    }
  })();
}
