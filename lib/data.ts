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
 * Row discriminator on the `orders` table.
 *
 * Warranty claims, sample orders, and custom (quote-form) orders all live in
 * the same table as standard orders, separated by this column. The list API
 * filters on it: /api/orders?type=order|warranty|sample|custom.
 */
export type OrderType = "order" | "warranty" | "sample" | "custom";

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

export type Stage = OrderStage | WarrantyStage | CustomStage;

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
export const ORDER_TYPES: OrderType[] = ["order", "warranty", "sample", "custom"];

/**
 * Id prefix per row type. Shared by the API insert and the store's
 * offline fallback so the two cannot drift.
 */
export const ID_PREFIX_BY_TYPE: Record<OrderType, string> = {
  order: "ORD",
  warranty: "WRN",
  sample: "SMP",
  custom: "CST",
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
