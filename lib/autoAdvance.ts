/**
 * Which rows the production-complete cron moves, and when.
 *
 * ⚠ ONE DEFINITION, IMPORTED BY BOTH THE CRON AND THE UI. The cron's filter and
 * the modal's promise are the same rule, and a UI that says "moves
 * automatically on the 18th" about a row the cron will never look at is worse
 * than saying nothing -- somebody waits for it.
 *
 * ⚠ AN ALLOWLIST, DELIBERATELY -- not "everything except custom". Custom orders
 * are contract work: priced by hand, paid in person, scheduled by conversation.
 * Their stages RECORD what happened rather than drive it, so a cron advancing
 * one at 1am asserts something it cannot know. A denylist would automate the
 * NEXT type added without anyone choosing to, which is exactly how custom
 * orders ended up being advanced in the first place.
 *
 * Samples are listed because they are Shopify orders with Shopify payment, same
 * as standard -- though it is inert today: their flow is New -> Shipped ->
 * Delivered and never reaches In production at all.
 *
 * No imports on purpose: the cron is server-side, the panel is a client
 * component, and lib/requirements deliberately carries no runtime dependency on
 * lib/data. A leaf module can be read from all three.
 */
export const PRODUCTION_COMPLETE_TYPES: readonly string[] = ["order", "sample"];

/** The stage production-complete advances a finished row to. */
export const PRODUCTION_COMPLETE_TARGET = "At cross dock";

/**
 * When this row will advance on its own, or null if it will not.
 *
 * ⚠ NULL WITHOUT AN ESTIMATED FINISH DATE. The cron's query requires the column
 * to be non-null and on or before today, so a row with no finish date sits in
 * In production forever -- which is why the next-action panel keeps asking for
 * both dates rather than just the start one.
 */
export function productionAutoAdvance(order: {
  type?: string | null;
  stage?: string | null;
  archived?: boolean | null;
  production_est_finish_date?: string | null;
}): { on: string; to: string } | null {
  if (order.stage !== "In production") return null;
  if (order.archived) return null;
  if (!order.type || !PRODUCTION_COMPLETE_TYPES.includes(order.type)) return null;
  if (!order.production_est_finish_date) return null;
  return { on: order.production_est_finish_date, to: PRODUCTION_COMPLETE_TARGET };
}
