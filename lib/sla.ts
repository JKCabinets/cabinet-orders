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
  "New":     { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
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
  "New":       { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "In review": { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "Ordered":   { softHours: SOFT_HOURS, hardHours: HARD_HOURS },
  "In production": STANDARD_RULES["In production"],
  "At cross dock": STANDARD_RULES["At cross dock"],
};

/**
 * The rules, per row type. One table, so tuning a type is a local edit and
 * adding a type is one entry.
 *
 * Warranty deliberately has no rules: it has no SLA today either (the old
 * SLA_TARGETS is typed to OrderStage, so warranty stages never matched).
 */
export const SLA_RULES: Record<OrderType, Partial<Record<string, SlaRule>>> = {
  order: STANDARD_RULES,
  sample: STANDARD_RULES,
  warranty: {},
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
 * Evaluate an order against its rule.
 *
 * Returns "ok" when there is no rule for the stage, when the rule's clock is
 * not running (the awaited data is present), or when age cannot be measured.
 */
export function slaTier(order: Order, now: number = Date.now()): SlaTier {
  const rule = slaRuleFor(order);
  if (!rule) return "ok";
  if (rule.clockRuns && !rule.clockRuns(order)) return "ok";
  const hours = hoursInStage(order, now);
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
