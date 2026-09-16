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
 * ⚠ IT IMPORTS lib/data NOW (2026-09-16), for paymentRecordOf and
 * paymentHoldActive. It was import-free so the cron and the client panel could
 * both read it; lib/data has no imports of its own, so that still holds. Nothing
 * in lib/requirements imports this file.
 */
import { paymentHoldActive, paymentRecordOf, type PaymentFields } from "./data";

export const PRODUCTION_COMPLETE_TYPES: readonly string[] = ["order", "sample"];

/** Why an otherwise-ready row will NOT be advanced. */
export type ProductionAdvanceSkip = "purchase_archived" | "payment_hold" | "project_unavailable";

/**
 * Whether the PURCHASE stops a row that otherwise qualifies.
 *
 * ⚠ ADDED 2026-09-16 (handoff item 16). The cron read neither of these:
 *
 *   payment_hold        A refund blocks forward movement (OPERATIONS §10), and
 *                       PATCH has enforced that since 08-20 -- but the cron is a
 *                       forward move too, and it pushes the stage to Shopify.
 *                       A refunded order waiting In production needs a person,
 *                       which is correct: a refund is an ending and somebody
 *                       should decide. The work queue already surfaces it.
 *   purchase_archived   `orders.archived` is false on every project-linked row
 *                       by design, so the cron's own filter never saw an
 *                       archived purchase. Only a refunded purchase can be
 *                       archived with a group still In production, so the hold
 *                       usually catches it first; this is not left to that.
 *   project_unavailable A project-linked row whose project was not supplied.
 *                       Not advancing is the safe reading of "unknown".
 */
export function productionAutoAdvanceSkip(
  order: PaymentFields & { project_id?: string | null },
  project: (PaymentFields & { archived?: boolean | null }) | null,
): ProductionAdvanceSkip | null {
  if (order.project_id && !project) return "project_unavailable";
  if (project?.archived) return "purchase_archived";
  const record = paymentRecordOf(order, project);
  if (record && paymentHoldActive(record)) return "payment_hold";
  return null;
}

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
export function productionAutoAdvance(
  order: PaymentFields & {
    type?: string | null;
    stage?: string | null;
    archived?: boolean | null;
    project_id?: string | null;
    production_est_finish_date?: string | null;
  },
  /**
   * The row's project, or null for a standalone row. REQUIRED, so a caller
   * cannot promise an advance without having asked the purchase.
   */
  project: (PaymentFields & { archived?: boolean | null }) | null,
): { on: string; to: string } | null {
  if (order.stage !== "In production") return null;
  if (order.archived) return null;
  if (!order.type || !PRODUCTION_COMPLETE_TYPES.includes(order.type)) return null;
  if (!order.production_est_finish_date) return null;
  if (productionAutoAdvanceSkip(order, project)) return null;
  return { on: order.production_est_finish_date, to: PRODUCTION_COMPLETE_TARGET };
}
