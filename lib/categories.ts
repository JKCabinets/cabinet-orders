import { isSampleVendor } from "@/lib/data";

/**
 * Which product category a line belongs to, and therefore which group of a
 * project it lands in.
 *
 * ONE IMPLEMENTATION. Sample classification, project grouping and (once it
 * exists) the hardware page all read this. The recurring bug class in this
 * codebase is copies that drift — the Shopify tag overwrite, four definitions
 * of "overdue", seven stage-colour maps — so there is exactly one map and it
 * lives here.
 *
 * A category is a subset of OrderType: warranty and custom rows are never
 * produced by grouping a Shopify checkout.
 */
export type OrderCategory = "order" | "hardware" | "sample";

/**
 * ⚠ UNVERIFIED. There is no hardware product in Shopify yet, so these strings
 * are taken from the approved Full Order mockup, not from a real payload.
 *
 * A vendor string that does not match here falls through to `order` (see
 * categoryForVendor) and is logged — it is never silently reclassified. But a
 * hardware product whose vendor differs by so much as a space will ingest as
 * cabinets and inherit the acknowledgment gate, the production dates and the
 * signed-receipt gate, none of which it can satisfy.
 *
 * BEFORE THE HARDWARE WORK IS CALLED DONE: create one test product in Shopify
 * carrying the intended vendor string and ingest a real order through it.
 * "It should work" is how sample classification shipped broken on 2026-08-19.
 */
export const HARDWARE_VENDORS: readonly string[] = [
  "Top Knobs",
  "Blum",
];

const normalise = (v: string | null | undefined): string =>
  String(v ?? "").trim().toLowerCase();

/**
 * The manufacturers whose lines are cabinets. From OPERATIONS section 1:
 * Waypoint (also sold as "Select Cabinetry"), HCI and J&K.
 *
 * Cabinets are the DEFAULT category, so this list changes no routing --
 * categoryForVendor already returns "order" for anything unmatched. It
 * exists so that "unknown" can mean genuinely unknown. Without it,
 * isUnknownVendor fired on every cabinet order, which is how a signal
 * becomes noise and then gets ignored.
 *
 * A NEW cabinet manufacturer will log as unknown until it is added here.
 * That is the intended behaviour: its lines still land in the cabinet
 * group and still get worked, and somebody gets told once.
 */
export const CABINET_VENDORS: readonly string[] = [
  "Waypoint Cabinetry",
  "Waypoint",
  "Select Cabinetry",
  "HCI",
  "J&K",
];

const HARDWARE_SET = new Set(HARDWARE_VENDORS.map(normalise));
const CABINET_SET = new Set(CABINET_VENDORS.map(normalise));

/**
 * Resolve a line's category from its Shopify vendor.
 *
 * READ THE VENDOR FROM THE WEBHOOK PAYLOAD (`line_items[].vendor`), never
 * through the SKU resolver. That resolver is keyed entirely on the SKU and the
 * JK sample products carry empty SKUs, so routing classification through it
 * returns an empty list and silently classifies every sample as a standard
 * order. That is not hypothetical — it is the 2026-08-19 bug.
 *
 * An unknown or missing vendor returns "order" DELIBERATELY: the line lands in
 * the queue a human actually works, rather than in a group nobody owns. The
 * caller must log it. Silent classification is what this whole rule exists to
 * prevent.
 */
export function categoryForVendor(vendor: string | null | undefined): OrderCategory {
  if (isSampleVendor(vendor)) return "sample";
  if (HARDWARE_SET.has(normalise(vendor))) return "hardware";
  return "order";
}

/**
 * True when a vendor string matched NONE of the three known lists, and so
 * fell through to the cabinet group without anyone having decided it should.
 *
 * A blank vendor counts as unknown -- OPERATIONS is explicit that a line
 * with no vendor is never assumed to be JK stock.
 *
 * This is a LOGGING predicate, not a routing one. The line lands in the
 * cabinet queue either way; this only decides whether anyone is told.
 */
export function isUnknownVendor(vendor: string | null | undefined): boolean {
  const v = normalise(vendor);
  if (v === "") return true;
  return !isSampleVendor(vendor) && !HARDWARE_SET.has(v) && !CABINET_SET.has(v);
}

/**
 * Deterministic group order within a project.
 *
 * Cabinets first, and that matters beyond tidiness: during the transition the
 * FIRST group carries the denormalised `shopify_id` so that exactly one
 * `orders` row exists per Shopify order — which is the invariant the
 * webhook-health reconciliation still depends on. Reorder this and that check
 * starts seeing duplicates.
 */
export const GROUP_ORDER: readonly OrderCategory[] = ["order", "hardware", "sample"];

/** Internal group handle suffix. Never shown to a customer. */
export const GROUP_SUFFIX: Record<OrderCategory, string> = {
  order: "-CAB",
  hardware: "-HW",
  sample: "-SMP",
};

/** The stage a freshly ingested group starts in, per category. */
export const FIRST_STAGE_BY_CATEGORY: Record<OrderCategory, string> = {
  order: "New",
  // ⚠ WAS "Ordered". An ingested hardware group arrived reading "we have
  // placed this with the vendor" when nobody had looked at it yet. Every flow
  // now starts with a stage that means "this has arrived and needs somebody".
  hardware: "New",
  sample: "New",
};

/**
 * Is a Shopify fulfilment authoritative for this category?
 *
 * ⚠ AUTHORITATIVE FOR DATA IS NOT AUTHORITATIVE FOR STAGE. These are two
 * questions and this function answers the first: does the fulfilment carry a
 * carrier and tracking number worth keeping? fulfilmentTargetStage answers the
 * second, and for hardware the answers now differ.
 *
 * Samples ship from JK's own stock, so a fulfilment IS us shipping.
 *
 * ⚠ HARDWARE IS DROP-SHIP, AND EVERYTHING AFTER THAT IS UNVERIFIED. It does
 * NOT ship from JK: the order is placed with the manufacturer, who ships
 * direct, and the MANUFACTURER supplies the tracking number.
 *
 * Whether that number ever reaches SHOPIFY depends on the vendor and whether
 * they are integrated with it. That is undecided, and no hardware product is
 * live, so nothing has tested it. "Via UPS" and "the fulfilment still carries
 * real carrier and tracking" were written here as fact on 2026-08-25; they are
 * assumptions, and they are the reason to re-read this before building on it.
 *
 * Returning true remains correct: IF a fulfilment arrives it is worth reading.
 * That is not a claim that one will. Nothing tells us the parcel arrived
 * either way.
 *
 * Cabinets are DROP-SHIP. The manufacturer or their delivery partner handles
 * the shipment and speaks to the customer directly; Shopify never sees it. Any
 * cabinet fulfilment recorded there is bookkeeping or absent, and treating it
 * as "delivered" is untrue either way. It is also exactly why the
 * delivery-proof gate exists: we are not the ones delivering, so the signed
 * receipt is the only proof we get.
 *
 * ⚠ NOT NOTHING, THOUGH — a cabinet fulfilment means the MANUFACTURER
 * DISPATCHED. That is the real trigger behind the notification the order
 * confirmation already promises ("we will notify you when your order has
 * finished production and is on its way"), which is currently planned off the
 * production-complete cron inferring dispatch from a date. A fulfilment event
 * is better evidence than a date. Not built here; recorded so it is not
 * rediscovered. See the notifications work in the session handoff.
 */
export function fulfilmentIsAuthoritative(category: OrderCategory): boolean {
  return category === "sample" || category === "hardware";
}


/**
 * The stage a TRACKING NUMBER advances a group to.
 *
 * ⚠ TRACKING IS WHAT MAKES A GROUP "SHIPPED". Not a button somebody presses --
 * the number is the evidence, so the stage becomes a fact you can answer a
 * customer with rather than a flag whose truth nobody can check. Same shape as
 * `production_start_date` advancing a cabinet order to In production: the data
 * and the stage move together, so they cannot disagree.
 *
 * It also means one rule serves both entry paths. A person typing the number in
 * the modal and a Shopify fulfilment carrying it take the SAME route -- the
 * webhook used to decide the stage itself, separately, which is the one-rule-
 * two-implementations shape that has bitten this codebase four times in a week.
 *
 * ⚠ CABINETS RETURN NULL, and always will. They move by freight to a cross
 * dock: there is no tracking number to have, no Shipped stage to move to, and a
 * fulfilment on that vendor is bookkeeping. See fulfilmentIsAuthoritative.
 */
export function trackingTargetStage(category: OrderCategory): string | null {
  if (category === "sample" || category === "hardware") return "Shipped";
  return null;
}

/** Does this category carry a tracking number at all? */
export function categoryHasTracking(category: OrderCategory): boolean {
  return trackingTargetStage(category) !== null;
}

/**
 * The stage a fulfilment advances a group to.
 *
 * ⚠ SAMPLES GO TO "Shipped", NOT "Delivered" -- corrected 2026-08-25 with the
 * Entered -> Shipped rename. A fulfilment means WE POSTED IT. Sending it
 * straight to Delivered claimed the customer had it, which Shopify has no way
 * of knowing. Delivered stays a human action, as it is on every other flow.
 *
 * ⚠ HARDWARE GOES TO "Shipped", AND THIS COMMENT SAID THE OPPOSITE until
 * 2026-08-26. It read "HARDWARE MOVES NOWHERE", on the grounds that "Shipped"
 * was a stage that no longer existed and there was nothing between Ordered and
 * Delivered for it to wait in. Hardware's flow gained Shipped the same day --
 * New -> Ordered -> Shipped -> Delivered -- so the deferral below has returned
 * "Shipped" for hardware ever since while the comment above it denied that.
 * The code was right. A comment that contradicts the function under it is worse
 * than no comment: it is read and believed.
 *
 * ⚠ It answers "what WOULD a hardware fulfilment mean", not "one will arrive".
 * See fulfilmentIsAuthoritative -- whether hardware tracking reaches Shopify at
 * all is undecided. The guard that matters is elsewhere and unchanged: no
 * tracking number, no move.
 *
 * Returning a stage outside the row's own flow is what stranded
 * QUO-1787174567522 on 2026-08-19, which is why this defers rather than
 * answering the question a second time.
 *
 * Returns null for categories a fulfilment must not move.
 */
export function fulfilmentTargetStage(category: OrderCategory): string | null {
  // ⚠ DEFERS TO trackingTargetStage. A fulfilment carries a tracking number,
  // and a tracking number is what makes a group Shipped -- so this is the same
  // question asked from a different doorway, not a second rule. It answered
  // separately until 2026-08-25, which meant the webhook could move a group to
  // a stage the modal would never have chosen.
  return trackingTargetStage(category);
}
