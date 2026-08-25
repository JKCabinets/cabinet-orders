/**
 * Service-level targets per stage, in days. An order is "overdue" when
 * it has been in the stage longer than the target.
 *
 * Single source of truth: import this here both in the UI and in cron
 * jobs so we never drift between client-side and server-side notions
 * of "overdue".
 */
import type { OrderStage, Order, OrderType } from "@/lib/data";
import { parseOrderDate } from "@/lib/dateUtils";

/* ═══════════════════════════════════════════════════════════════════════
   RULE-BASED SLA — the only model
   ═══════════════════════════════════════════════════════════════════════

   A day-per-stage table (SLA_TARGETS / daysInStage / isOverdue) lived above
   this line until 2026-08-20. It is gone: SLAClient, the dashboard and the
   teams-digest cron have all been migrated.

   It was not merely superseded, it DISAGREED. Its New target was 3 days, so
   an order unentered for 71 hours read as on track while the rules below call
   it hard-overdue at 48. Two definitions of one thing in one file is how the
   tag overwrite, the seven stage-colour maps and the stale realtime shaper all
   happened, so it is deleted rather than deprecated.

   daysInStage also fell back to parsing the `date` DISPLAY string when
   stage_entered_at was absent -- returning total order age under a name that
   promised stage age. hoursInStage below returns null instead, so the same
   mistake is not available.
*/

/** Two-tier severity. `soft` = warn, `hard` = act. */
export type SlaTier = "ok" | "soft" | "hard";

export interface SlaRule {
  /** Hours in stage before the soft (warning) tier. */
  softHours: number;
  /** Hours in stage before the hard tier. */
  hardHours: number;
  /**
   * When present, the clock only runs while this returns true.
   *
   * This is what separates "waiting too long" stages from "missing data"
   * stages. An order may legitimately sit in production for 42 days, so its
   * clock is not about elapsed time at all -- it is about whether the dates
   * that let the pipeline move it have been filled in.
   */
  clockRuns?: (order: Order) => boolean;
  /** Human-readable object of the wait, for UI copy. */
  waitingFor?: string;
  /**
   * Which clock this stage runs on. Defaults to "stage".
   *
   * "stage"    time since stage_entered_at -- "how long stuck HERE"
   * "created"  time since the row was created -- "how long has this
   *            existed without being dealt with"
   *
   * New uses "created" deliberately. An order moved backwards into New has
   * been alive the whole time and is now back at the start, which is worse
   * than a fresh order -- but the stage clock would reset and make it look
   * newer than everything else on the board.
   *
   * "reported" is for promoted warranty claims: the clock runs from when
   * the CUSTOMER reported the issue, not from when a staff member got
   * round to promoting the submission. Without it, triage delay is
   * invisible to the system built to surface delay.
   */
  measureFrom?: "stage" | "created" | "reported";
}

const SOFT_HOURS = 24;
const HARD_HOURS = 48;

/**
 * An order in production with no est-finish date is STRANDED: the
 * production-complete cron advances on `production_est_finish_date <= today`,
 * so with that column null nothing will ever move it. A missing start date
 * means someone set the stage by hand rather than letting the date do it.
 * Either is worth surfacing.
 */
const productionDatesMissing = (o: Order): boolean =>
  !o.production_start_date || !o.production_est_finish_date;

/**
 * Delivered is human-only, via a Confirm Delivery button that appears once a
 * delivery date exists. With no date, nobody can progress the order.
 */
const deliveryDateMissing = (o: Order): boolean =>
  !o.delivery_date && !o.scheduled_delivery_date;

/** Standard Shopify cabinet orders. Samples share this: same stage names. */
const STANDARD_RULES: Partial<Record<string, SlaRule>> = {
  // Measured from the order date, so bouncing an order back to New cannot
  // reset its clock. Every later stage asks "how long stuck here" instead.
  "New":     { softHours: SOFT_HOURS, hardHours: HARD_HOURS, measureFrom: "created" },
  "Entered": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "In production": {
    softHours: SOFT_HOURS,
    hardHours: HARD_HOURS,
    clockRuns: productionDatesMissing,
    waitingFor: "production dates",
  },
  "At cross dock": {
    softHours: SOFT_HOURS,
    hardHours: HARD_HOURS,
    clockRuns: deliveryDateMissing,
    waitingFor: "a delivery date",
  },
  // "Delivered" has no rule, which means no SLA. Same as target Infinity.
};

/** Custom orders: quote-specific early stages, then the shared gated ones. */
/**
 * Custom orders: the front half is ours, the back half is a conversation.
 *
 * New and In review measure OUR responsiveness. A quote request sitting
 * unanswered is ours whether or not the job is hand-driven, so they keep
 * the standard 24h/48h.
 *
 * In production and At cross dock have NO RULE, deliberately. They used to
 * inherit the standard ones, which measure MISSING DATA rather than elapsed
 * time -- an order in production with no dates is stalled, because the
 * production-complete cron needs a finish date to act on.
 *
 * That premise does not hold here. Custom orders are contract work: priced
 * by hand, paid in person, scheduled by conversation, and hand-driven end to
 * end -- the cron is filtered to exclude them. Nothing was ever going to
 * advance the order, so a missing date is not a stalled pipeline, it is a
 * date that lives somewhere other than this system. Flagging it at 24h and
 * forever after is noise in the one place that has to stay trustworthy.
 *
 * Removing them also removes a shared-reference trap: those two entries were
 * the same rule OBJECTS as STANDARD_RULES', not copies, so tuning a standard
 * rule silently retuned custom as well.
 *
 * "Ordered" still carries a rule. Arguably it should not -- it means the job
 * is placed and we are waiting on a manufacturer, which is the same reason
 * warranty's "Parts ordered" has none. Left alone rather than changed
 * unasked; worth a decision.
 *
 * /sla renders every stage in a type's flow, including rule-less ones, with
 * a count and a dash. So these two stages still show their orders -- they
 * simply stop claiming an SLA judgement the system is not making.
 */
const CUSTOM_RULES: Partial<Record<string, SlaRule>> = {
  "New":       { softHours: SOFT_HOURS, hardHours: HARD_HOURS, measureFrom: "created" },
  "In review": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "Ordered":   { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
};

/**
 * Warranty claims: the front half is on us, the back half is not.
 *
 * A claim waiting on a vendor for parts, or in transit, can legitimately
 * run for weeks -- and unlike the production stages there is no date field
 * to gate a clock on, so those stages get no rule rather than a long one.
 *
 * This is the FIRST SLA warranty has ever had: the old SLA_TARGETS is
 * Record<OrderStage, number>, so warranty stages never matched a target.
 * Expect warranty claims to start appearing in SLA counts.
 */
const WARRANTY_RULES: Partial<Record<string, SlaRule>> = {
  // Measured from when the CUSTOMER reported the issue, not when this row
  // was created.
  //
  // For a claim raised in-app those are the same moment: reported_at is
  // null and hoursSinceReported falls back to created_at. For a claim
  // promoted from a website submission they differ by however long triage
  // took -- and per Terms 12.3 the reporting windows are conditions
  // precedent to the claim, so the reported time is the one that counts.
  "New claim": { softHours: SOFT_HOURS, hardHours: HARD_HOURS, measureFrom: "reported" },
  "In review": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  // "Parts ordered" and "Shipped": no rule. Waiting on a vendor or a
  // carrier, with no date field that would say when to stop worrying.
  // "Resolved": terminal.
};

/**
 * The rules, per row type. One table, so tuning a type is a local edit and
 * adding a type is one entry.
 */
/**
 * A hardware group at Ordered with no tracking number is STRANDED in the same
 * sense a cabinet order in production with no finish date is: nothing in the
 * system can move it, and nobody has recorded the thing that would.
 */
const trackingMissing = (o: Order): boolean => !o.tracking_number;

/**
 * Hardware: Ordered carries the standard 24h/48h. Shipped and Delivered do not.
 *
 * Written empty in August on the grounds that there was no baseline for what
 * "slow" looks like on a box of pulls. That was the right call with no
 * throughput; the rule now is that hardware follows the same 24/48 as
 * everything else.
 *
 * ⚠ IT MEASURES MISSING TRACKING, NOT ELAPSED TIME -- deliberately, and this is
 * the difference worth understanding.
 *
 * A plain stage clock would say "this has been at Ordered too long", which is
 * often just true and not actionable: a vendor takes as long as it takes. The
 * clock that fires here says "nobody has recorded the shipment", which is a
 * thing somebody can go and do. That is exactly how In production and At cross
 * dock already work, and why they do not scream about orders legitimately
 * sitting for six weeks.
 *
 * So a hardware group ordered a fortnight ago WITH tracking is quiet; one
 * ordered yesterday WITHOUT it starts a clock.
 *
 * "Shipped" has no rule. It is waiting on a carrier, with no field that would
 * say when to stop worrying -- the same reason warranty's "Shipped" has none.
 * "Delivered" is terminal.
 *
 * ⚠ Expect hardware groups to start appearing in SLA counts once a hardware
 * product exists in Shopify. None does yet, so this is inert today.
 */
const HARDWARE_RULES: Partial<Record<string, SlaRule>> = {
  "Ordered": {
    softHours: SOFT_HOURS,
    hardHours: HARD_HOURS,
    clockRuns: trackingMissing,
    waitingFor: "a tracking number",
  },
};

export const SLA_RULES: Record<OrderType, Partial<Record<string, SlaRule>>> = {
  order: STANDARD_RULES,
  sample: STANDARD_RULES,
  warranty: WARRANTY_RULES,
  custom: CUSTOM_RULES,
  hardware: HARDWARE_RULES,
};

/** The rule for this row's type and current stage, if any. */
export function slaRuleFor(order: Order): SlaRule | undefined {
  const rules = SLA_RULES[order.type] ?? SLA_RULES.order;
  return rules[order.stage];
}

/**
 * Hours the order has been in its current stage.
 *
 * Returns null when `stage_entered_at` is absent. Unlike daysInStage this does
 * NOT fall back to `order.date`: that field is a display string with no time
 * component ("Jul 22"), so an hour count derived from it would assume
 * midnight and over-report age. These rules drive warnings, so measuring
 * nothing beats measuring wrong.
 *
 * Callers must therefore SELECT stage_entered_at.
 */
export function hoursInStage(order: Order, now: number = Date.now()): number | null {
  if (!order.stage_entered_at) return null;
  const t = new Date(order.stage_entered_at).getTime();
  if (!isFinite(t)) return null;
  return (now - t) / (1000 * 60 * 60);
}

/**
 * Hours since the row was created.
 *
 * Prefers created_at. Falls back to parsing the `date` DISPLAY string,
 * which has no time component ("Jul 22"), so it resolves to midnight and
 * over-reports by up to a day -- acceptable only as a last resort for rows
 * that somehow lack created_at.
 */
export function hoursSinceCreated(order: Order, now: number = Date.now()): number | null {
  if (order.created_at) {
    const t = new Date(order.created_at).getTime();
    if (isFinite(t)) return (now - t) / (1000 * 60 * 60);
  }
  const t = parseOrderDate(order.date);
  if (t === null) return null;
  return (now - t) / (1000 * 60 * 60);
}

/**
 * Hours since the customer reported the issue.
 *
 * Falls back to hoursSinceCreated when reported_at is absent -- which is
 * every row today, and every row that did not arrive through the public
 * claims intake. So switching a rule to "reported" is a no-op until
 * promotion starts setting the column.
 */
export function hoursSinceReported(order: Order, now: number = Date.now()): number | null {
  if (order.reported_at) {
    const t = new Date(order.reported_at).getTime();
    if (isFinite(t)) return (now - t) / (1000 * 60 * 60);
  }
  return hoursSinceCreated(order, now);
}

/**
 * The age a rule actually measures. See SlaRule.measureFrom.
 */
export function slaAgeHours(
  order: Order,
  rule: SlaRule,
  now: number = Date.now(),
): number | null {
  switch (rule.measureFrom) {
    case "created":  return hoursSinceCreated(order, now);
    case "reported": return hoursSinceReported(order, now);
    // undefined and "stage" both mean the stage clock.
    default:         return hoursInStage(order, now);
  }
}

/**
 * Evaluate an order against its rule.
 *
 * Returns "ok" when there is no rule for the stage, when the rule's clock is
 * not running (the awaited data is present), or when age cannot be measured.
 */
export function slaTier(order: Order, now: number = Date.now()): SlaTier {
  const rule = slaRuleFor(order);
  if (!rule) return "ok";
  if (rule.clockRuns && !rule.clockRuns(order)) return "ok";
  // Which clock depends on the rule -- New runs on the order date.
  const hours = slaAgeHours(order, rule, now);
  if (hours === null) return "ok";
  if (hours >= rule.hardHours) return "hard";
  if (hours >= rule.softHours) return "soft";
  return "ok";
}

/** Compact age label for UI: "6h", "31h", "3d". */
export function formatStageAge(hours: number | null): string {
  if (hours === null) return "\u2014";
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
