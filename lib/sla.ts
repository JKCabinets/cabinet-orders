/**
 * Service-level targets per stage, in days. An order is "overdue" when
 * it has been in the stage longer than the target.
 *
 * Single source of truth: import this here both in the UI and in cron
 * jobs so we never drift between client-side and server-side notions
 * of "overdue".
 */
import type { OrderStage, Order } from "@/lib/data";
import { parseOrderDate } from "@/lib/dateUtils";

export const SLA_TARGETS: Record<OrderStage, number> = {
  "New":            3,
  "Entered":        2,
  "In production":  14,
  "At cross dock":  5,
  "Delivered":      Infinity, // no SLA on Delivered
};

/**
 * How many days has the order been in its current stage? Returns null
 * if the date can't be parsed (the field is free-form text rather than
 * a Date column, hence the guard).
 *
 * Note: this measures days since `order.date`, which is the order's
 * creation date — not the date it entered its *current* stage. That's
 * fine for "New" (where date ≈ stage-entered) but for later stages it
 * effectively gives total age, not stage age. A future improvement
 * would be to add a `stage_entered_at` column and reference it here.
 */
export function daysInStage(order: Order, now: number = Date.now()): number | null {
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
