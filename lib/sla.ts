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

export const SLA_TARGETS: Record<OrderStage, number> = {
  "New":            3,
  "Entered":        2,
  "In production":  14,
  "At cross dock":  5,
  "Delivered":      Infinity, // no SLA on Delivered
};

/**
 * How many days has the order been in its current stage?
 *
 * Prefers `stage_entered_at` (schema v9) for accurate per-stage age.
 * Falls back to `order.date` (the original creation date) for legacy
 * rows where the column is missing — in that case the value is total
 * order age, not stage age. Returns null only if both signals are
 * unavailable.
 */
export function daysInStage(order: Order, now: number = Date.now()): number | null {
  if (order.stage_entered_at) {
    const t = new Date(order.stage_entered_at).getTime();
    if (isFinite(t)) return Math.floor((now - t) / (1000 * 60 * 60 * 24));
  }
  const t = parseOrderDate(order.date);
  if (t === null) return null;
  return Math.floor((now - t) / (1000 * 60 * 60 * 24));
}

/** Is this order past its SLA target for its current stage? */
export function isOverdue(order: Order, now: number = Date.now()): boolean {
  const target = SLA_TARGETS[order.stage as OrderStage];
  if (!isFinite(target)) return false;
  const days = daysInStage(order, now);
  if (days === null) return false;
  return days > target;
}

/* ═══════════════════════════════════════════════════════════════════════
   RULE-BASED SLA (step 1 of 2)
   ═══════════════════════════════════════════════════════════════════════

   Everything above this line is the OLD day-per-stage model, still in use by
   SLAClient and the teams-digest cron. Step 2 migrates them here and deletes
   it. Do not add new callers to SLA_TARGETS / isOverdue.
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
   */
  measureFrom?: "stage" | "created";
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
const CUSTOM_RULES: Partial<Record<string, SlaRule>> = {
  "New":       { softHours: SOFT_HOURS, hardHours: HARD_HOURS, measureFrom: "created" },
  "In review": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "Ordered":   { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "In production": STANDARD_RULES["In production"],
  "At cross dock": STANDARD_RULES["At cross dock"],
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
  // Same reasoning as New: measured from when the claim was filed.
  "New claim": { softHours: SOFT_HOURS, hardHours: HARD_HOURS, measureFrom: "created" },
  "In review": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  // "Parts ordered" and "Shipped": no rule. Waiting on a vendor or a
  // carrier, with no date field that would say when to stop worrying.
  // "Resolved": terminal.
};

/**
 * The rules, per row type. One table, so tuning a type is a local edit and
 * adding a type is one entry.
 */
export const SLA_RULES: Record<OrderType, Partial<Record<string, SlaRule>>> = {
  order: STANDARD_RULES,
  sample: STANDARD_RULES,
  warranty: WARRANTY_RULES,
  custom: CUSTOM_RULES,
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
 * The age a rule actually measures. See SlaRule.measureFrom.
 */
export function slaAgeHours(
  order: Order,
  rule: SlaRule,
  now: number = Date.now(),
): number | null {
  return rule.measureFrom === "created"
    ? hoursSinceCreated(order, now)
    : hoursInStage(order, now);
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
