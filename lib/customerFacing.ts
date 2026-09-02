/**
 * Wording a CUSTOMER sees. Internal stage names never leave the OMS.
 *
 * The storefront contract in `jk-order-status-page.liquid` is explicit that
 * labels come from the server: "Change the wording in one place and every
 * customer sees it, with no theme deploy." This is that one place.
 *
 * ⚠ "At cross dock" MEANS NOTHING TO SOMEBODY WAITING ON A KITCHEN. That is
 * the whole reason this table exists rather than the page rendering
 * `order.stage` directly.
 */
import { ORDER_STAGES, type OrderStage, type OrderType } from "@/lib/data";

/**
 * Cabinet stages, in flow order.
 *
 * ⚠ `Record<OrderStage, string>` IS LOAD-BEARING. Adding a stage to the
 * OrderStage union without adding a label here is a COMPILE ERROR, which is
 * the same mechanism that caught the missing hardware column on /sla. A
 * customer-facing table that silently returns undefined for a new stage would
 * render a blank step.
 */
export const CABINET_STAGE_LABEL: Record<OrderStage, string> = {
  "New":           "Order received",
  "Entered":       "Confirmed with the manufacturer",
  "In production": "In production",
  "At cross dock": "Arrived in Arizona",
  "Delivered":     "Delivered",
};

export type StageState = "done" | "current" | "todo";

export interface CustomerStage {
  label: string;
  state: StageState;
}

/**
 * The five cabinet steps with one marked current.
 *
 * An unrecognised stage marks nothing current rather than guessing a
 * position: every step reads "todo", which is visibly incomplete instead of
 * confidently wrong.
 */
export function cabinetStages(currentStage: string): CustomerStage[] {
  const at = (ORDER_STAGES as readonly string[]).indexOf(currentStage);
  return ORDER_STAGES.map((stage, i) => ({
    label: CABINET_STAGE_LABEL[stage],
    state: at < 0 ? "todo" : i < at ? "done" : i === at ? "current" : "todo",
  }));
}

/**
 * What to call a non-cabinet group in the tracking list.
 *
 * ⚠ ONLY THE TYPES A CUSTOMER CAN BE SHOWN A TRACKING NUMBER FOR. Cabinets go
 * by freight to a cross dock and never carry one -- `trackingTargetStage`
 * returns null for them and always will -- so they are absent here by design,
 * not by omission. Custom and warranty have no project and never reach the
 * public lookup at all.
 */
export const TRACKING_GROUP_LABEL: Partial<Record<OrderType, string>> = {
  sample:   "Samples",
  hardware: "Hardware",
};

/**
 * Shown when there is no agreed delivery date.
 *
 * ⚠ NEVER AN ESTIMATE. `production_est_finish_date` is a working date the
 * production-complete cron acts on, and it moves when somebody edits it. The
 * storefront contract is explicit: a date only when one has been agreed with
 * the customer, and a note explaining its absence otherwise.
 */
export const DELIVERY_NOTE_AWAITING =
  "We will call to arrange delivery once it reaches Arizona.";

/**
 * Shown for a purchase with no cabinets in it -- a samples-only checkout.
 * The step list is empty for these, so this note carries the whole answer.
 */
export const NOTE_NO_CABINETS =
  "This order is on its way. Tracking is below where we have it, and it is "
  + "also in your account and on your confirmation email.";
