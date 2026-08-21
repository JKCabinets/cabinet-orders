// ─── Types ────────────────────────────────────────────────────────────────────

export type Source = "Shopify" | "Manual";
export type Member = string;
export type Role = "admin" | "member";

export interface TeamMember {
  id: string;
  username: string;
  name: string;
  initials: string;
  role: Role;
  avatarColor: AvatarColor;
  active: boolean;

  // Profile fields (v15). All optional — users fill them in via the
  // profile editor over time. Existing rows from before v15 have NULL
  // for everything except ooo_status, which defaults to FALSE.
  photoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  roleTitle?: string | null;       // e.g. "Lead Designer"
  bio?: string | null;
  workingHours?: string | null;    // free text, e.g. "9-5 PT, Mon-Fri"
  timezone?: string | null;        // IANA, e.g. "America/Phoenix"
  slackHandle?: string | null;
  oooStatus?: boolean;             // defaults to false
  oooMessage?: string | null;
  oooUntil?: string | null;        // ISO date string (YYYY-MM-DD)
}

export type AvatarColor = "blue" | "teal" | "amber" | "coral" | "purple" | "rose";

// Use inline styles instead of Tailwind classes — prevents purging
export const AVATAR_COLOR_STYLES: Record<AvatarColor, React.CSSProperties> = {
  blue:   { backgroundColor: "#1e3a5f", color: "#93c5fd", borderColor: "#2563eb" },
  teal:   { backgroundColor: "#134e4a", color: "#5eead4", borderColor: "#0d9488" },
  amber:  { backgroundColor: "#451a03", color: "#fcd34d", borderColor: "#d97706" },
  coral:  { backgroundColor: "#431407", color: "#fdba74", borderColor: "#ea580c" },
  purple: { backgroundColor: "#2e1065", color: "#c4b5fd", borderColor: "#7c3aed" },
  rose:   { backgroundColor: "#4c0519", color: "#fda4af", borderColor: "#e11d48" },
};

export const AVATAR_COLOR_SWATCH_STYLES: Record<AvatarColor, React.CSSProperties> = {
  blue:   { backgroundColor: "#3b82f6" },
  teal:   { backgroundColor: "#14b8a6" },
  amber:  { backgroundColor: "#f59e0b" },
  coral:  { backgroundColor: "#f97316" },
  purple: { backgroundColor: "#8b5cf6" },
  rose:   { backgroundColor: "#f43f5e" },
};

// Keep for backwards compat
export const AVATAR_COLOR_CLASSES: Record<AvatarColor, string> = {
  blue:   "bg-blue-900 text-blue-300 border-blue-700",
  teal:   "bg-teal-900 text-teal-300 border-teal-700",
  amber:  "bg-amber-900 text-amber-300 border-amber-700",
  coral:  "bg-orange-900 text-orange-300 border-orange-700",
  purple: "bg-purple-900 text-purple-300 border-purple-700",
  rose:   "bg-rose-900 text-rose-300 border-rose-700",
};

export const AVATAR_COLOR_SWATCHES: Record<AvatarColor, string> = {
  blue:   "bg-blue-500",
  teal:   "bg-teal-500",
  amber:  "bg-amber-500",
  coral:  "bg-orange-500",
  purple: "bg-purple-500",
  rose:   "bg-rose-500",
};

export const AVATAR_COLOR_OPTIONS: AvatarColor[] = [
  "blue", "teal", "amber", "coral", "purple", "rose",
];

export type OrderStage =
  | "New"
  | "Entered"
  | "In production"
  | "At cross dock"
  | "Delivered";

export type WarrantyStage =
  | "New claim"
  | "In review"
  | "Parts ordered"
  | "Shipped"
  | "Resolved";

/**
 * Hardware groups: pulls, hinges and the like, shipped by us on a timeline
 * of their own. No acknowledgment gate, no production dates, no cross dock,
 * no signed receipt -- none of those have a hardware equivalent, and forcing
 * them would make overriding gates routine.
 *
 * WARNING: every one of these three names already exists in another flow.
 * "Ordered" is a CustomStage, "Shipped" is a WarrantyStage, "Delivered" is
 * an OrderStage. stageIndex() without a `type` argument will mis-resolve all
 * three. Always pass the row type.
 */
export type HardwareStage =
  | "Ordered"
  | "Shipped"
  | "Delivered";

/**
 * Row discriminator on the `orders` table.
 *
 * Warranty claims, sample orders, and custom (quote-form) orders all live in
 * the same table as standard orders, separated by this column. The list API
 * filters on it: /api/orders?type=order|warranty|sample|custom.
 */
export type OrderType = "order" | "warranty" | "sample" | "custom" | "hardware";

/**
 * Custom (quote-form) orders get their own flow: a quote is reviewed and
 * priced before anything is ordered, so New / In review / Ordered precede
 * the production stages.
 *
 * NOTE: stage strings are NOT globally unique any more. "New",
 * "In production", "At cross dock" and "Delivered" are shared with
 * OrderStage, and "In review" is also a WarrantyStage. Always resolve a
 * stage against the row's `type` via STAGE_ORDER_BY_TYPE in
 * lib/stageLogic.ts -- never by searching the arrays blind.
 */
export type CustomStage =
  | "New"
  | "In review"
  | "Ordered"
  | "In production"
  | "At cross dock"
  | "Delivered";

/**
 * Sample orders reuse OrderStage verbatim. A sample is an ordinary Shopify
 * order that skips the manufacturer, so it carries the same stage names and
 * shares ORDER_STAGE_ORDER. In practice it moves New -> Entered ->
 * Delivered; the intermediate stages simply never get set, and skipping
 * forward is not a backwards move.
 */
export type SampleStage = OrderStage;

export type Stage = OrderStage | WarrantyStage | CustomStage | HardwareStage;

export interface ActivityEntry {
  text: string;
  time: string;
}

export type ReviewReason =
  | "unmapped_value"      // a door/color name has no sku_code yet
  | "decoder_unavailable" // the sku_mappings table could not be loaded
  | "sku_mismatch"        // a client-forged _sku was rejected
  | "missing_sku"         // the Shopify line carried no SKU at all
  | "missing_mod_value";  // a modification is missing its depth value

/** A modification sub-SKU attached to a parent cabinet line (Step 2). */
export interface SkuModification {
  sku: string;   // e.g. "RD-4", "ID-13", "RTKL"
  label: string; // human label, e.g. 'Reduce Depth to 4"'
}

export interface SkuItem {
  sku: string;
  /** Shopify variant id, captured at ingest. Authoritative key for vendor resolution. */
  variant_id?: string;
  quantity: number;
  description?: string;
  /**
   * Backorder tracking. Set by the team after the vendor confirms a delay.
   * `backordered: true` means this specific SKU is delayed beyond the order's
   * normal production timeline. `expected_ready_date` is the vendor's
   * commitment for when the SKU will be available. `backorder_notes` is
   * staff-only context (e.g. "vendor said wait list is 3 weeks").
   */
  backordered?: boolean;
  expected_ready_date?: string | null; // YYYY-MM-DD
  backorder_notes?: string;
  /**
   * Decoded display fields, persisted at ingest for ALL vendors (Waypoint
   * from Avis names, HCI/J&K from their composite SKU) so the UI never
   * decodes in the browser. Written by the webhook and the one-time backfill.
   */
  door_style?: string;
  color?: string;
  /**
   * Raw Shopify line item properties the decoder did not consume, kept so
   * nothing is silently dropped at ingest.
   *
   * door_style and color above are the DECODED values and take priority in
   * the UI; this is what remains. For a sample order -- which has no cabinet
   * SKU to decode -- it is the only place the customer's choices appear.
   *
   * Hidden properties (leading underscore, _apo) are filtered at ingest.
   */
  properties?: Array<{ name: string; value: string }>;
  /**
   * Per-line review flag. The LINE is authoritative (which line + why);
   * orders.needs_review is a derived rollup. Clears on fix / re-decode; the
   * order_activity note is the permanent record.
   */
  needs_review?: boolean;
  review_reason?: ReviewReason;
  /** Attaching modification sub-SKUs (Waypoint). Travel with the parent line. */
  modifications?: SkuModification[];
}

export type BackorderStatus = "none" | "pending" | "ready";

/**
 * Compute the order-level backorder status from its SKU items.
 *   - "none"    → no SKUs are marked backordered
 *   - "pending" → at least one backordered SKU's expected date is in the future
 *                 (or has no date set)
 *   - "ready"   → every backordered SKU has an expected_ready_date and they
 *                 have all passed; the order is ready to advance.
 *
 * `todayIso` is optional for testing; defaults to the local YYYY-MM-DD.
 */
export function getBackorderStatus(
  skuItems: SkuItem[] | undefined,
  todayIso?: string
): { status: BackorderStatus; count: number } {
  const items = skuItems ?? [];
  const backordered = items.filter(i => i.backordered);
  if (backordered.length === 0) return { status: "none", count: 0 };

  const today = todayIso ?? new Date().toISOString().split("T")[0];

  // Pending if any backordered SKU has no date OR a future date
  const allReady = backordered.every(i =>
    i.expected_ready_date && i.expected_ready_date <= today
  );

  return { status: allReady ? "ready" : "pending", count: backordered.length };
}

export interface Order {
  id: string;
  type: OrderType;
  name: string;
  source: Source;
  detail: string;
  stage: Stage;
  member: Member;
  date: string;
  sku: string;
  notes: string;
  /**
   * Internal-only notes. Visible to staff in the order modal and shown in a
   * clearly-marked section of the export PDF; never sent to customers via
   * shopify writeback. Use this for "customer is grumpy", "vendor is slow",
   * pricing comments, etc.
   */
  internal_notes?: string;
  activity: ActivityEntry[];
  archived?: boolean;
  // Order details
  door_style?: string;
  color?: string;
  sku_items?: SkuItem[];
  // Derived rollup: any sku_item flagged needs_review (Step 3). Drives the
  // row/board "Needs review" badge and the list filter.
  needs_review?: boolean;
  // Production timeline
  production_start_date?: string | null;
  production_est_finish_date?: string | null;
  // Delivery
  delivery_date?: string | null;
  scheduled_delivery_date?: string | null;
  delivery_window?: string;
  delivery_notes?: string;
  // Claim system
  claimed_by?: string | null;
  // Who moved the order to Entered (set server-side, permanent record)
  entered_by?: string | null;
  // Customer & shipping fields
  vendor?: string;
  ship_to?: string;
  customer_phone?: string;
  customer_email?: string;
  delivery_method?: string;
  // Shopify payment status — financial_status from the Shopify order.
  // One of: paid, partially_paid, pending, refunded, partially_refunded,
  // voided, authorized. NULL for manually-created orders that have no
  // Shopify counterpart. This comment predates the `type` discriminator and
  // does NOT refer to type === "custom" -- a custom order may or may not
  // have a payment status depending on how it was raised.
  payment_status?: string | null;
  /**
   * Which payment_status value was acknowledged, letting this order move
   * forward despite a refund. Compared against the CURRENT payment_status,
   * so acknowledging partially_refunded does not pre-clear a later full
   * refund. Null means nothing has been acknowledged.
   */
  payment_hold_cleared_for?: string | null;
  payment_hold_cleared_at?: string | null;
  /**
   * The purchase this group belongs to. NULL only for warranty rows,
   * which are ABOUT a purchase rather than part of one.
   *
   * ⚠ This is the customer-facing ORDER NUMBER. `id` is the internal
   * group handle (SHO-1048-CAB). Never show `id` to a customer -- use
   * displayOrderNumber().
   */
  project_id?: string | null;
  /**
   * Warranty only: the GROUP this claim is about. A distinct relationship
   * from project_id -- one means "belongs to", this means "is about".
   * Points at the group rather than the project because the 48-hour
   * window in Terms 12.3 runs from a delivery, and deliveries are per
   * group.
   */
  about_order_id?: string | null;
  /**
   * Warranty only: self-reported and unverified, whatever was typed into
   * the claim form. The customer OF RECORD resolves through
   * about_order_id once a claim is linked. A mismatch between the two is
   * worth seeing rather than reconciling away.
   */
  claimant_name?: string | null;
  claimant_email?: string | null;
  /** Hardware groups: pulled off the Shopify fulfilment, not typed in. */
  carrier?: string | null;
  tracking_number?: string | null;
  // ISO timestamp of when the order entered its current stage. Updated
  // automatically (DB trigger + app code) whenever `stage` changes. Used
  // by the SLA page to compute real per-stage age rather than total
  // order age. May be null on legacy rows that pre-date schema v9.
  stage_entered_at?: string | null;
  /**
   * Row insert timestamp. Distinct from `date`, which is a DISPLAY string
   * ("Jul 22") with no time component and no year.
   *
   * Used by the SLA rules whose measureFrom is "created" -- currently the
   * New stages, which must not have their clock reset by an order being
   * bounced backwards into New.
   */
  created_at?: string | null;
  /**
   * When a warranty claim was REPORTED by the customer, as distinct from
   * when this row was created.
   *
   * Set on promotion from claim_submissions.received_at. A claim submitted
   * Thursday evening and promoted Monday morning was reported Thursday --
   * and per Terms 12.3 the reporting windows are conditions precedent to
   * the claim, so this is the timestamp that matters both legally and for
   * the SLA clock.
   *
   * Null on every other flow, and null on every row until the intake work
   * lands. The rules fall back to created_at when it is absent.
   */
  reported_at?: string | null;
}

/**
 * Shape a raw `orders` row into the canonical Order.
 *
 * THE ONLY implementation. It lives here, beside the Order interface it
 * builds, because BOTH paths into the store need it: the REST load in
 * store.tsx and the realtime events in useRealtimeOrders.
 *
 * useRealtimeOrders used to carry its own copy, which stopped being updated --
 * it cast `type` to "order" | "warranty" long after there were four types, and
 * never learned created_at or reported_at. Every row arriving over realtime
 * was shaped by that stale version until the next full fetch corrected it.
 *
 * If you add a column to Order, add it HERE and nowhere else.
 */
export function shapeOrder(raw: Record<string, unknown>): Order {
  return {
    id: raw.id as string,
    type: (raw.type as OrderType) ?? "order",
    name: raw.name as string,
    source: (raw.source as Source) ?? "Manual",
    detail: (raw.detail as string) ?? "",
    stage: (raw.stage as Stage) ?? "New",
    member: (raw.member as Member) ?? "AX",
    date: (raw.date as string) ?? "",
    // /api/orders selects `*`, so this has always been on the wire -- it
    // just was not mapped through. The SLA rules for New need it.
    created_at: (raw.created_at as string | null) ?? null,
    // Set on promotion from claim_submissions.received_at. Null on every
    // other flow, and on every row until the intake work lands -- the SLA
    // rules fall back to created_at when it is absent.
    reported_at: (raw.reported_at as string | null) ?? null,
    sku: (raw.sku as string) ?? "",
    notes: (raw.notes as string) ?? "",
    internal_notes: (raw.internal_notes as string) ?? "",
    archived: (raw.archived as boolean) ?? false,
    activity: (raw.activity as { text: string; time: string }[]) ?? [],
    door_style: (raw.door_style as string) ?? "",
    color: (raw.color as string) ?? "",
    sku_items: (raw.sku_items as { sku: string; quantity: number; description?: string }[]) ?? [],
    needs_review: (raw.needs_review as boolean) ?? false,
    claimed_by: (raw.claimed_by as string | null) ?? null,
    entered_by: (raw.entered_by as string | null) ?? null,
    vendor: (raw.vendor as string) ?? "",
    ship_to: (raw.ship_to as string) ?? "",
    customer_phone: (raw.customer_phone as string) ?? "",
    customer_email: (raw.customer_email as string) ?? "",
    delivery_method: (raw.delivery_method as string) ?? "",
    payment_status: (raw.payment_status as string | null) ?? null,
    payment_hold_cleared_for: (raw.payment_hold_cleared_for as string | null) ?? null,
    payment_hold_cleared_at: (raw.payment_hold_cleared_at as string | null) ?? null,
    // Added with the Project Orders migration. shapeOrder is the ONE row
    // shaper -- both the REST load in store.tsx and the realtime events in
    // useRealtimeOrders go through it -- so a column added here reaches
    // every consumer, and a column added anywhere else reaches none.
    // useRealtimeOrders carried its own copy until 2026-08-20 and shaped
    // every realtime row with a stale version until the next full fetch.
    project_id: (raw.project_id as string | null) ?? null,
    about_order_id: (raw.about_order_id as string | null) ?? null,
    claimant_name: (raw.claimant_name as string | null) ?? null,
    claimant_email: (raw.claimant_email as string | null) ?? null,
    carrier: (raw.carrier as string | null) ?? null,
    tracking_number: (raw.tracking_number as string | null) ?? null,
    stage_entered_at: (raw.stage_entered_at as string | null) ?? null,
    production_start_date: (raw.production_start_date as string | null) ?? null,
    production_est_finish_date: (raw.production_est_finish_date as string | null) ?? null,
    scheduled_delivery_date: (raw.scheduled_delivery_date as string | null) ?? null,
    // The other three delivery fields Order declares. Unmapped until
    // 2026-08-20, so they were undefined on every row on every load path.
    //
    // delivery_date matters most: the At-cross-dock SLA rule tests
    // `!o.delivery_date && !o.scheduled_delivery_date`, and with the first
    // permanently undefined an order that HAS a delivery date would keep
    // its clock running and flag overdue.
    delivery_date: (raw.delivery_date as string | null) ?? null,
    delivery_window: (raw.delivery_window as string) ?? "",
    delivery_notes: (raw.delivery_notes as string) ?? "",
  };
}


/**
 * Shopify financial_status values that stop an order moving forward.
 *
 * ONE definition, used by the server block and the modal banner alike. Two
 * copies of "is this order on hold" would drift the way four definitions of
 * "overdue" did.
 */
export const PAYMENT_HOLD_STATUSES = ["refunded", "partially_refunded", "voided"] as const;

export function isPaymentHoldStatus(status: string | null | undefined): boolean {
  return PAYMENT_HOLD_STATUSES.includes(
    String(status ?? "").trim().toLowerCase() as typeof PAYMENT_HOLD_STATUSES[number],
  );
}

/**
 * Is this order currently held?
 *
 * True when the payment is in a hold state AND that exact state has not been
 * acknowledged. Acknowledging partially_refunded therefore leaves a later
 * refunded still blocking.
 */
export function paymentHoldActive(order: {
  payment_status?: string | null;
  payment_hold_cleared_for?: string | null;
}): boolean {
  const status = String(order.payment_status ?? "").trim().toLowerCase();
  if (!isPaymentHoldStatus(status)) return false;
  return String(order.payment_hold_cleared_for ?? "").trim().toLowerCase() !== status;
}

/**
 * Customer-facing-ish wording for a hold state.
 *
 * "voided" is NOT a refund -- it is an authorisation that never captured.
 * Calling it a refund sends someone hunting for money that never moved.
 */
export function paymentHoldLabel(status: string | null | undefined): string {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "refunded": return "This order has been refunded";
    case "partially_refunded": return "This order has been partially refunded";
    case "voided": return "This order's payment was voided before capture";
    default: return "This order's payment needs attention";
  }
}

export const ORDER_STAGES: OrderStage[] = [
  "New", "Entered", "In production", "At cross dock", "Delivered",
];

export const WARRANTY_STAGES: WarrantyStage[] = [
  "New claim", "In review", "Parts ordered", "Shipped", "Resolved",
];

export const CUSTOM_STAGES: CustomStage[] = [
  "New", "In review", "Ordered", "In production", "At cross dock", "Delivered",
];

/**
 * The stages a sample order is actually offered in the UI. The underlying
 * ordering is ORDER_STAGE_ORDER (see SampleStage), so a sample jumping
 * Entered -> Delivered is an ordinary forward move.
 */
export const SAMPLE_STAGES: OrderStage[] = [
  "New", "Entered", "Delivered",
];

export const HARDWARE_STAGES: HardwareStage[] = [
  "Ordered", "Shipped", "Delivered",
];

/**
 * The vendor that marks a line as JK's own stock rather than a
 * manufacturer's. An order is a SAMPLE only when EVERY line is this vendor.
 *
 * Must match `shopify_products.vendor` as Shopify stores it. Compared
 * case-insensitively and trimmed via isSampleVendor, because a vendor name
 * typed into Shopify is not a value anyone validates.
 */
export const SAMPLE_VENDOR = "JK Cabinets 2 You";

export function isSampleVendor(vendor: string | null | undefined): boolean {
  return String(vendor ?? "").trim().toLowerCase() === SAMPLE_VENDOR.toLowerCase();
}

/**
 * Every valid value of the `type` discriminator, in one place, so reads
 * and writes whitelist against the same list.
 */
export const ORDER_TYPES: OrderType[] = ["order", "warranty", "sample", "custom", "hardware"];

/**
 * Id prefix per row type. Shared by the API insert and the store's
 * offline fallback so the two cannot drift.
 */
export const ID_PREFIX_BY_TYPE: Record<OrderType, string> = {
  order: "ORD",
  warranty: "WRN",
  sample: "SMP",
  custom: "CST",
  hardware: "HW",
};

/**
 * Which stage list to offer for a row, keyed by its type.
 *
 * Replaces the binary `tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES`
 * that was duplicated in OrderModal and BulkActionBar. Samples map to
 * SAMPLE_STAGES (the three they actually use) while still being ORDERED by
 * ORDER_STAGE_ORDER in lib/stageLogic -- offering a subset is a UI choice,
 * the ordering is what backward-move detection reads.
 */
/**
 * NOT to be confused with STAGE_ORDER_BY_TYPE in lib/stageLogic.ts.
 *
 *   STAGE_ORDER_BY_TYPE  the FULL ordering, for index maths and
 *                        backward-move detection. Samples map to all five
 *                        ORDER stages, because they share the names.
 *   STAGE_LIST_BY_TYPE   the subset a type is OFFERED in the UI. Samples
 *                        get three: New, Entered, Delivered.
 *
 * A sample skipping "In production" is a forward move in the first and
 * simply absent from the second. Both are correct; keep them in step.
 */
export const STAGE_LIST_BY_TYPE: Record<OrderType, Stage[]> = {
  order: ORDER_STAGES,
  sample: SAMPLE_STAGES,
  warranty: WARRANTY_STAGES,
  custom: CUSTOM_STAGES,
  hardware: HARDWARE_STAGES,
};

/**
 * Dot colour per stage, across every flow.
 *
 * NOTE: near-identical maps are currently duplicated in OrderModal,
 * SLAClient, BulkActionBar, Sidebar (STAGE_DOT) and WarrantyClient
 * (WARRANTY_STAGE_ACCENT). This is the one shared copy; new code uses it,
 * and folding the existing five into it is a worthwhile tidy-up.
 */
export const STAGE_ACCENT: Record<string, string> = {
  // Standard order flow — samples share these names
  "New":           "#c97070",
  "Entered":       "#d4922a",
  "In production": "#c8b84a",
  "At cross dock": "#5a8db8",
  "Delivered":     "#8fbe70",
  // Warranty flow
  "New claim":     "#c97070",
  "In review":     "#d4922a",
  "Parts ordered": "#c8b84a",
  "Shipped":       "#5a8db8",
  "Resolved":      "#8fbe70",
  // Custom flow contributes one stage of its own; the rest reuse the
  // names above ("In review" is shared with warranty, same colour).
  "Ordered":       "#d0a63c",
};

/**
 * The next stage this row would advance to, per ITS OWN flow.
 *
 * Replaces hardcoded next-stage maps, which were all written against the
 * standard order flow. A custom order at "New" advances to "In review",
 * not "Entered" -- and "Entered" is not even in its flow, so advancing it
 * there would strand the row at a stage stageIndex() cannot resolve.
 *
 * Returns undefined at the last stage, or if the current stage is not in
 * the type's offered list (e.g. a sample sitting at "In production",
 * which is reachable but not offered).
 */
/**
 * Every group-handle suffix, in one place. Used to recover an order number
 * from a handle when project_id is somehow absent, and to recognise a
 * handle someone has pasted in.
 */
const GROUP_HANDLE_SUFFIXES = ["-CAB", "-HW", "-SMP", "-CST"] as const;

/**
 * The order number to SHOW a human. Never `order.id`.
 *
 * After the Project Orders migration `id` is an internal group handle
 * (SHO-1048-CAB) and the customer-facing number lives on the project
 * (SHO-1048). The customer sees "ORDER #1048", quotes it on the phone, and
 * types it into lookup; the suffix means nothing to them.
 *
 * project_id is authoritative. Stripping the suffix is a FALLBACK for a row
 * that has not been reshaped yet -- it should not normally fire, and if it
 * is firing widely then shapeOrder or the API select is dropping the column.
 *
 * A warranty claim has no project: its own id (WRN-0007) IS its number.
 */
export function displayOrderNumber(order: Pick<Order, "id" | "project_id">): string {
  if (order.project_id) return order.project_id;
  for (const suffix of GROUP_HANDLE_SUFFIXES) {
    if (order.id.endsWith(suffix)) return order.id.slice(0, -suffix.length);
  }
  return order.id;
}

/**
 * Does a search term match this row's order number?
 *
 * Accepts BOTH forms deliberately. A customer says "1048" or "#1048"; a
 * staff member pastes "SHO-1048-CAB" straight out of a log line or a
 * webhook outcome. A search that rejects the handle it just displayed in
 * the logs is a search people stop trusting.
 *
 * Normalisation matches OPERATIONS section 2: strip #, trim, uppercase.
 */
/**
 * Trailing legal suffixes stripped before taking a company's last token.
 * "Sunrise Builders LLC" must not become "LLC-SHO-1048", which identifies
 * nothing and is identical for every company customer.
 */
const LEGAL_SUFFIXES = new Set([
  "llc", "l.l.c.", "inc", "inc.", "incorporated",
  "ltd", "ltd.", "limited", "co", "co.", "corp", "corp.",
  "llp", "lp", "plc",
]);

/**
 * The reference a MANUFACTURER sees: `Battles-SHO-1048`.
 *
 * Last name, hyphen, order number. Garrett's reason: it makes tracking an
 * order through the manufacturer far easier than an opaque id. Internal --
 * never shown to a customer, who knows only "ORDER #1048".
 *
 * Built on the ORDER NUMBER, not the group handle, so every group of a
 * project quotes the same reference. Three edge cases, all deliberate:
 *
 *   "Cher"                  -> Cher-SHO-1048       (one token: use it)
 *   "Sunrise Builders LLC"  -> Builders-SHO-1048   (suffix stripped)
 *   ""                      -> SHO-1048            (no dangling hyphen)
 *
 * ⚠ Reads `name` off the ORDER row. The Project Orders migration COPIED
 * that column to projects rather than moving it, so this works today; when
 * the follow-up migration drops it, this must read through the project.
 */
export function poReference(
  order: { id: string; project_id?: string | null; name?: string | null },
): string {
  const number = displayOrderNumber(order);
  const tokens = String(order.name ?? "").trim().split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter(
    t => !LEGAL_SUFFIXES.has(t.replace(/[.,]+$/, "").toLowerCase()));
  const pick = meaningful.length > 0 ? meaningful : tokens;
  // Strip trailing punctuation from the token we KEEP, not only from the
  // one we test: "Acme Cabinets, Inc." drops "Inc." correctly and would
  // otherwise yield "Cabinets,-SHO-1051", comma and all, in a document
  // sent to a manufacturer.
  const last = (pick[pick.length - 1] ?? "").replace(/[.,]+$/, "");
  // No name is better than a leading hyphen: "-SHO-1048" reads as a typo
  // to whoever receives the PDF.
  return last ? `${last}-${number}` : number;
}

export function matchesOrderNumber(
  order: Pick<Order, "id" | "project_id">,
  term: string,
): boolean {
  const q = term.replace(/#/g, "").trim().toUpperCase();
  if (!q) return false;
  return order.id.toUpperCase().includes(q)
    || displayOrderNumber(order).toUpperCase().includes(q);
}

export function nextStageFor(order: Pick<Order, "type" | "stage">): Stage | undefined {
  const list = STAGE_LIST_BY_TYPE[order.type] ?? STAGE_LIST_BY_TYPE.order;
  const i = list.indexOf(order.stage);
  if (i < 0) return undefined;
  return list[i + 1];
}

/**
 * Per-type wording for the create-order modal, in one place so a new type
 * cannot ship showing warranty labels on its form.
 */
/**
 * Plural label per row type, for pages that list every type side by side
 * (/sla, the dashboard rollup).
 *
 * Record<OrderType, string> is load-bearing: adding a type to the union
 * without adding a label here is a COMPILE ERROR, which is how the missing
 * hardware category on /sla was caught rather than shipped as an empty
 * column.
 *
 * Declaration order IS display order -- consumers map over Object.keys,
 * and JS guarantees insertion order for non-integer string keys. Reorder
 * these lines to reorder the page; do not sort them alphabetically.
 */
export const TYPE_LIST_LABEL: Record<OrderType, string> = {
  order:    "Standard orders",
  custom:   "Custom orders",
  sample:   "Sample orders",
  hardware: "Hardware",
  warranty: "Warranty claims",
};

export const TYPE_UI: Record<OrderType, {
  createTitle: string;
  createCta: string;
  detailLabel: string;
  detailPlaceholder: string;
}> = {
  order: {
    createTitle: "Add order",
    createCta: "Create order",
    detailLabel: "Description",
    detailPlaceholder: "e.g. Full kitchen · shaker",
  },
  custom: {
    createTitle: "Add Custom Order",
    createCta: "Create order",
    detailLabel: "Description",
    detailPlaceholder: "e.g. Full kitchen · shaker",
  },
  sample: {
    createTitle: "Add sample order",
    createCta: "Create order",
    detailLabel: "Description",
    detailPlaceholder: "e.g. Door sample · Painted Linen",
  },
  warranty: {
    createTitle: "New warranty claim",
    createCta: "Log claim",
    detailLabel: "Issue description",
    detailPlaceholder: "e.g. Door hinge alignment",
  },
  hardware: {
    createTitle: "Add hardware",
    createCta: "Create group",
    detailLabel: "Description",
    detailPlaceholder: "e.g. Bar pulls \u00b7 satin brass",
  },
};

export const STAGE_STATUS: Record<string, "red" | "amber" | "green"> = {
  New: "red", Entered: "amber", "In production": "green",
  "At cross dock": "amber", Delivered: "green",
  "New claim": "red", "In review": "amber", "Parts ordered": "amber",
  "Shipped": "amber", Resolved: "green",
};

export const MEMBER_COLORS: Record<string, string> = {
  AX: "bg-blue-900 text-blue-300 border-blue-700",
  BR: "bg-teal-900 text-teal-300 border-teal-700",
  DN: "bg-amber-900 text-amber-300 border-amber-700",
  CA: "bg-rose-900 text-rose-300 border-rose-700",
};

export const SEED_TEAM: TeamMember[] = [
  { id: "1", username: "ax", name: "Alex",  initials: "AX", role: "admin",  avatarColor: "blue",  active: true },
  { id: "2", username: "br", name: "Brett", initials: "BR", role: "member", avatarColor: "teal",  active: true },
  { id: "3", username: "dn", name: "Dana",  initials: "DN", role: "member", avatarColor: "amber", active: true },
  { id: "4", username: "ca", name: "Casey", initials: "CA", role: "member", avatarColor: "rose",  active: true },
];

export const SEED_ORDERS: Order[] = [];
export const SEED_WARRANTIES: Order[] = [];
