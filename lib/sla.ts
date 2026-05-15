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
