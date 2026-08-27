/**
 * reconcile.ts — Order-acknowledgment reconciliation engine (Waypoint).
 *
 * Compares a parsed vendor acknowledgment against the original order on three
 * gates (ALL must pass for a GREEN verdict):
 *   1. Line items  — every composite SKU + quantity matches, both directions
 *   2. Address     — normalized exact match (phone stripped)
 *   3. Name        — normalized exact match
 *
 * Exact-match policy (per business decision): minor differences such as
 * "Garret" vs "Garrett" DO flag — they are real data-entry discrepancies a
 * human should see before the order ships to the manufacturer. Normalization
 * here only removes formatting noise (case, extra whitespace, embedded phone),
 * NOT meaningful character differences.
 *
 * Pricing is parsed for display but is NOT a gate.
 *
 * The engine is pure: inputs in, structured verdict out. No I/O, no DB. That
 * makes it unit-testable and reusable by the upload endpoint and the UI.
 */

export interface AckLineItem {
  composite_sku: string;
  qty: number;
  list_price?: number | null;
  /** Modification sub-SKU codes read off the ack's attribute rows (RD-13, RTKB). */
  modifications?: string[];
}

export interface ParsedAck {
  waypoint_order: string;
  po: string;            // join key -> our order id
  ship_name: string;
  ship_address: string;  // may contain phone; we strip it
  items: AckLineItem[];
}

export interface OrderLineItem {
  sku: string;
  quantity: number;
  /** Modification sub-SKU codes stored on the order line (RD-13, RTKB). */
  modifications?: string[];
}

export interface OrderForReconcile {
  id: string;
  name: string;          // customer/order name
  ship_to: string;
  sku_items: OrderLineItem[];
}

export type LineStatus = "match" | "qty_mismatch" | "mod_mismatch" | "missing_from_ack" | "extra_in_ack";

/**
 * describeLineIssue — human-readable summary of one reconciled line.
 *
 * Single source of truth for how a LineStatus is described to a person. It
 * previously lived as `lineIssue` in TWO components (AcknowledgmentPanel and
 * OrderEntryActions), which drifted: the mod-mismatch separator and the
 * missing-from-ack phrasing differed. Those differences were deliberate
 * per-surface wording, so they are preserved here behind `terse` rather than
 * flattened:
 *   - AcknowledgmentPanel (full review panel) -> verbose form (default).
 *   - OrderEntryActions   (Manual Push dialog) -> terse form.
 *
 * Living next to LineStatus means a new status can't be added without this
 * describer being right here to update.
 */
export interface LineIssueInput {
  status: string;
  order_qty: number | null;
  ack_qty: number | null;
  order_mods?: string[];
  ack_mods?: string[];
}

export function describeLineIssue(l: LineIssueInput, opts?: { terse?: boolean }): string {
  const terse = opts?.terse ?? false;

  if (l.status === "qty_mismatch") {
    return `ordered ${l.order_qty}, acknowledged ${l.ack_qty}`;
  }

  if (l.status === "mod_mismatch") {
    const o = (l.order_mods ?? []).join(", ") || "none";
    const a = (l.ack_mods ?? []).join(", ") || "none";
    return terse
      ? `modifications differ — order: ${o} vs ack: ${a}`
      : `modifications differ — order: ${o} · acknowledgment: ${a}`;
  }

  if (l.status === "missing_from_ack") {
    return terse
      ? "missing from the acknowledgment"
      : "on the order, missing from the acknowledgment";
  }

  if (l.status === "extra_in_ack") {
    return "on the acknowledgment, not on the order";
  }

  return l.status;
}

export interface LineResult {
  composite_sku: string;
  status: LineStatus;
  order_qty: number | null;
  ack_qty: number | null;
  /** Modifications on each side — populated so the UI can name the difference. */
  order_mods?: string[];
  ack_mods?: string[];
}

export interface FieldResult {
  field: "name" | "address";
  matched: boolean;
  order_value: string;
  ack_value: string;
}

export interface ReconcileResult {
  verdict: "green" | "red";
  matched_order_id: string | null;   // null if PO didn't resolve to this order
  po_matched: boolean;
  lines: LineResult[];
  fields: FieldResult[];
  // convenience flags for the UI
  lines_ok: boolean;
  address_ok: boolean;
  name_ok: boolean;
}

/**
 * Normalize a name/string for comparison: collapse whitespace, trim, uppercase.
 *
 * ⚠ EXPORTED for lib/ackFingerprint. The fingerprint that decides whether a
 * green ack is still about this order has to normalise exactly as the engine
 * does -- a second implementation would stale acks over differences reconcileAck
 * treats as noise, blocking orders for no reason a person could see.
 */
export function normName(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Strip an embedded phone number and normalize an address for comparison.
 *
 * Per policy, normalization removes formatting noise only — case, whitespace,
 * separator punctuation (commas/periods), and an embedded phone — while
 * preserving meaningful content. So "AZ, 85142" and "AZ 85142" compare equal
 * (the comma is a separator), but in-token character differences still flag
 * (e.g. a misspelled street, a wrong zip, "Olivos" vs "Olives"). This mirrors
 * the name gate's exact-match intent: noise out, real discrepancies kept.
 */
export function normAddress(s: string): string {
  return (s ?? "")
    // remove phone-like sequences (480-219-9580, (480) 219 9580, 4802199580)
    .replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, " ")
    // separator punctuation -> space
    .replace(/[.,]/g, " ")
    // collapse whitespace, trim, uppercase
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Canonical key for SKU matching — alphanumerics only, uppercased.
 *
 * Vendors spell the same cabinet with different separators: Waypoint's ack
 * writes "B24 BUTT" where our composite is "B24-BUTT". Comparing raw strings
 * put them in different buckets and reported ONE cabinet as TWO discrepancies
 * (missing_from_ack + extra_in_ack). Matching on separator-stripped keys fixes
 * that; the original spelling is preserved separately for display.
 */
export function skuKey(s: string): string {
  return (s ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export function reconcileAck(
  ack: ParsedAck,
  order: OrderForReconcile | null
): ReconcileResult {
  // If we couldn't resolve the ack's PO to an order, return early — UI asks
  // the user which order this belongs to.
  if (!order) {
    return {
      verdict: "red",
      matched_order_id: null,
      po_matched: false,
      lines: [],
      fields: [],
      lines_ok: false,
      address_ok: false,
      name_ok: false,
    };
  }

  // --- Gate 1: line items (match on composite SKU, sum qty per composite) ---
  // Display spelling per key. The ORDER's form wins because it is our
  // canonical composite; the ack's spelling is the fallback for lines that
  // only Waypoint has (extra_in_ack), which would otherwise have no display.
  const displayBySku = new Map<string, string>();
  // Modifications are compared per composite SKU as a multiset. That cannot say
  // WHICH duplicate line differs when a SKU repeats, but it flags any
  // difference — a cabinet built to the wrong depth is the thing to catch.
  const orderModsBySku = new Map<string, string[]>();
  const ackModsBySku = new Map<string, string[]>();
  const orderBySku = new Map<string, number>();
  for (const it of order.sku_items) {
    const k = skuKey(it.sku);
    if (!k) continue;
    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));
    if (!displayBySku.has(k)) displayBySku.set(k, (it.sku ?? "").trim());
    if (it.modifications?.length) {
      orderModsBySku.set(k, [...(orderModsBySku.get(k) ?? []), ...it.modifications]);
    }
  }
  const ackBySku = new Map<string, number>();
  for (const it of ack.items) {
    const k = skuKey(it.composite_sku);
    if (!k) continue;
    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));
    if (!displayBySku.has(k)) displayBySku.set(k, (it.composite_sku ?? "").trim());
    if (it.modifications?.length) {
      ackModsBySku.set(k, [...(ackModsBySku.get(k) ?? []), ...it.modifications]);
    }
  }

  const allSkus = new Set<string>([...orderBySku.keys(), ...ackBySku.keys()]);
  const lines: LineResult[] = [];
  for (const sku of Array.from(allSkus).sort()) {
    const o = orderBySku.has(sku) ? orderBySku.get(sku)! : null;
    const a = ackBySku.has(sku) ? ackBySku.get(sku)! : null;
    const om = orderModsBySku.get(sku) ?? [];
    const am = ackModsBySku.get(sku) ?? [];
    const normMods = (xs: string[]) => xs.map(x => x.trim().toUpperCase()).sort();
    const oN = normMods(om), aN = normMods(am);
    const modsEqual = oN.length === aN.length && oN.every((m, i) => m === aN[i]);

    let status: LineStatus;
    if (o !== null && a !== null) {
      // Quantity first: a wrong count is the bigger problem, and reporting one
      // issue per line keeps the panel readable.
      if (o !== a) status = "qty_mismatch";
      else if (!modsEqual) status = "mod_mismatch";
      else status = "match";
    } else if (o !== null && a === null) status = "missing_from_ack";
    else status = "extra_in_ack";

    lines.push({
      composite_sku: displayBySku.get(sku) ?? sku,
      status,
      order_qty: o,
      ack_qty: a,
      ...(om.length || am.length ? { order_mods: om, ack_mods: am } : {}),
    });
  }
  const lines_ok = lines.every(l => l.status === "match");

  // --- Gate 2: address (normalized, phone stripped) ---
  const address_ok = normAddress(order.ship_to) === normAddress(ack.ship_address);

  // --- Gate 3: name (normalized, exact) ---
  const name_ok = normName(order.name) === normName(ack.ship_name);

  const fields: FieldResult[] = [
    { field: "name", matched: name_ok, order_value: order.name, ack_value: ack.ship_name },
    { field: "address", matched: address_ok, order_value: order.ship_to, ack_value: ack.ship_address },
  ];

  const verdict: "green" | "red" =
    lines_ok && address_ok && name_ok ? "green" : "red";

  return {
    verdict,
    matched_order_id: order.id,
    po_matched: true,
    lines,
    fields,
    lines_ok,
    address_ok,
    name_ok,
  };
}
