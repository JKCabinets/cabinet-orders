/**
 * One sentence per stage, saying what being in it means (2026-10-22, item 8).
 *
 * ⚠ GARRETT'S WORDING, approved 2026-10-22 -- change it with him, not here
 * alone. Staff-only: the stage panel of the order modal. Nothing here reaches a
 * customer (lib/customerFacing is the customer's wording, and must never say a
 * cabinet leaves a "factory" -- the website team's rule, 2026-10-21).
 *
 * Says the STATE, not the next step: the Next Action band directly below says
 * what is needed next, and saying it twice would be noise.
 */
import type { OrderType } from "@/lib/data";
import { isWaypointVendor } from "@/lib/vendorFamily";

const SENTENCES: Record<OrderType, Record<string, string>> = {
  order: {
    "New": "A new order, waiting to be entered with the manufacturer.",
    "Entered": "Order has been placed with the manufacturer. Entering production dates is next.",
    "In production": "Being built. Order will automatically move to the cross dock on the last production date.",
    "At cross dock": "At the cross dock and ready for final delivery scheduling.",
    "Delivered": "Delivered to the customer.",
  },
  custom: {
    "New": "A new custom job waiting to be reviewed.",
    "In review": "Gather customer selections and communicate with customer.",
    "Ordered": "Ordered from the manufacturer, awaiting production dates.",
    "In production": "Order is in production, being built.",
    "At cross dock": "At the cross dock and ready for final delivery scheduling.",
    "Delivered": "Delivered to the customer.",
  },
  warranty: {
    "New claim": "A new claim, waiting to be reviewed.",
    "In review": "The claim is being assessed.",
    "Parts ordered": "Replacement parts are on order.",
    "Shipped": "Replacement parts are on their way to the customer.",
    "Resolved": "The claim is resolved.",
  },
  hardware: {
    "New": "A new hardware order, waiting to be ordered.",
    "Ordered": "Ordered from the supplier; shipping is next.",
    "Shipped": "On its way to the customer.",
    "Delivered": "Delivered to the customer.",
  },
  sample: {
    "New": "A new sample order, waiting to be shipped.",
    "Shipped": "On its way to the customer.",
    "Delivered": "Delivered to the customer.",
  },
};

/**
 * ⚠ WOODMARK'S ORDER STATUS -- cabinet orders at the cross dock, and ONLY the
 * Waypoint family (Waypoint / Select), whose manufacturer runs that portal
 * (Garrett, 2026-10-22). Custom jobs and other vendors get the sentence alone.
 */
const WOODMARK_STATUS = { label: "Check order status", href: "https://go.woodmark.com/onlineordering/" } as const;

export interface StageSentence { text: string; link?: { label: string; href: string } }

export function stageSentence(order: { type: OrderType; stage: string; vendor?: string | null }): StageSentence | null {
  const text = SENTENCES[order.type]?.[order.stage];
  if (!text) return null;
  const link = order.type === "order" && order.stage === "At cross dock" && isWaypointVendor(order.vendor)
    ? WOODMARK_STATUS : undefined;
  return link ? { text, link } : { text };
}
