/**
 * Wording a CUSTOMER sees. Internal stage names never leave the OMS.
 *
 * The storefront contract in `jk-order-status-page.liquid` is explicit that
 * labels come from the server: "Change the wording in one place and every
 * customer sees it, with no theme deploy." This is that one place.
 *
 * ⚠ NOTHING HERE MAY REVEAL WHAT HAS OR HAS NOT BEEN ENTERED IN THE OMS.
 * "Awaiting an estimated completion date" is a missing-data SLA condition --
 * it means nobody at JK has filled the date in. On the work queue that is the
 * point. On the page a customer opened for reassurance it announces our own
 * unfinished admin. Every absent-data branch below reads as ordinary progress.
 */
import { ORDER_STAGES, type OrderStage, type OrderType } from "@/lib/data";

export const CABINET_STAGE_LABEL: Record<OrderStage, string> = {
  "New":           "Order received",
  "Entered":       "Order has been processed",
  "In production": "In production",
  /**
   * ⚠ NOT "Arrived in Arizona". Select Cabinetry builds in Kingman, Arizona,
   * and our own Docs article says so -- telling a customer their order has
   * reached the state it was made in says nothing, and the two contradict.
   *
   * ⚠ NOT "Ready for delivery" or "Ready to schedule delivery" either. The row
   * STAYS at this stage after a delivery has been booked, right up until it is
   * delivered, so anything implying scheduling is still to come is false for
   * the orders furthest along.
   */
  "At cross dock": "Arrived at our delivery partner",
  "Delivered":     "Delivered",
};

export type StageState = "done" | "current" | "todo";

export interface CustomerStage {
  label: string;
  state: StageState;
  /** Sub-line under this step. Omitted entirely when there is nothing to say. */
  note?: string;
}

/**
 * What the note needs to know. Display-ready, because formatting a date is the
 * route's job and deciding what to SAY is this file's.
 */
export interface CabinetFacts {
  /** Display-ready estimated production finish, or null when unset. */
  estimatedFinish: string | null;
  /** Has a delivery date actually been agreed with the customer? */
  deliveryScheduled: boolean;
}

/**
 * The line under a stage.
 *
 * ⚠ ONLY THE CURRENT STAGE GETS ONE. A note under a completed step would still
 * be written in the future tense -- "we will let you know when it is on its
 * way" under a Delivered order reads as a system that has lost track.
 */
function noteFor(stage: OrderStage, f: CabinetFacts): string | undefined {
  switch (stage) {
    case "New":
      return "Our team is working on your order. Check back soon for updates.";
    case "Entered":
      return "We have placed it with the manufacturer.";
    case "In production":
      /**
       * ⚠ THE ESTIMATE APPEARS HERE AND NOWHERE ELSE. Production is the
       * longest wait and the most asked-about, so withholding it is the
       * unhelpful choice. But it goes in PROSE, hedged, never in
       * `scheduled_date` -- the page renders that field as "Delivery booked
       * for …", which turns a working date into a commitment.
       *
       * "Estimated ... around" carries the hedge on its own. Adding that dates
       * can move would make movement sound expected, when it is roughly one
       * job in ten.
       */
      return f.estimatedFinish
        ? `Estimated to be finished around ${f.estimatedFinish}. `
          + `We will let you know when it is on its way.`
        : "Your cabinets are being built. We will let you know when they are "
          + "finished and on their way.";
    case "At cross dock":
      // ⚠ "our delivery partner", never "we". JK does not run the truck.
      return f.deliveryScheduled
        ? "Your delivery is booked. Our delivery partner will confirm the "
          + "details with you."
        : "Our delivery partner will contact you soon to arrange a date and time.";
    case "Delivered":
      /**
       * ⚠ DOES NOT CLAIM A SIGNED RECEIPT. The At cross dock → Delivered gate
       * is overridable with a logged reason, so a delivered group may have no
       * proof-of-delivery attachment at all. Terms 12.3 makes the reporting
       * window a condition precedent, so a false claim about holding a
       * signature would surface in a dispute over exactly those orders.
       */
      return "Delivered, and confirmed by our team.";
  }
}

/**
 * The five cabinet steps, one marked current, that one carrying a note.
 *
 * An unrecognised stage marks nothing current rather than guessing a position:
 * every step reads "todo" and none carries a note, which is visibly incomplete
 * instead of confidently wrong.
 */
export function cabinetStages(
  currentStage: string,
  facts: CabinetFacts,
): CustomerStage[] {
  const at = (ORDER_STAGES as readonly string[]).indexOf(currentStage);
  return ORDER_STAGES.map((stage, i) => {
    const state: StageState =
      at < 0 ? "todo" : i < at ? "done" : i === at ? "current" : "todo";
    const note = state === "current" ? noteFor(stage, facts) : undefined;
    return note
      ? { label: CABINET_STAGE_LABEL[stage], state, note }
      : { label: CABINET_STAGE_LABEL[stage], state };
  });
}

/**
 * What to call a non-cabinet group in the tracking list.
 *
 * ⚠ ONLY TYPES A CUSTOMER CAN BE SHOWN A TRACKING NUMBER FOR. Cabinets go by
 * freight to a cross dock and never carry one, so they are absent by design.
 * Custom and warranty have no project and never reach the public lookup.
 */
export const TRACKING_GROUP_LABEL: Partial<Record<OrderType, string>> = {
  sample:   "Samples",
  hardware: "Hardware",
};

/**
 * Shown for a purchase with no cabinets in it -- a samples-only checkout.
 *
 * ⚠ THE ONLY REMAINING USE OF `delivery_note`. It used to render for cabinet
 * orders too, saying "we will call to arrange delivery once it reaches
 * Arizona" -- which sat directly under the "Arrived in Arizona" label and
 * contradicted it, and said "we" about a job the delivery partner does.
 * Per-stage notes replaced it.
 */
export const NOTE_NO_CABINETS =
  "This order is on its way. Tracking is below where we have it, and it is "
  + "also in your account and on your confirmation email.";
