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
}

export interface OrderForReconcile {
  id: string;
  name: string;          // customer/order name
  ship_to: string;
  sku_items: OrderLineItem[];
}

export type LineStatus = "match" | "qty_mismatch" | "missing_from_ack" | "extra_in_ack";

export interface LineResult {
  composite_sku: string;
  status: LineStatus;
  order_qty: number | null;
  ack_qty: number | null;
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

/** Normalize a name/string for comparison: collapse whitespace, trim, uppercase. */
function normName(s: string): string {
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
function normAddress(s: string): string {
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

/** Normalize a composite SKU for comparison. */
function normSku(s: string): string {
  return (s ?? "").replace(/\s+/g, "").trim().toUpperCase();
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
  const orderBySku = new Map<string, number>();
  for (const it of order.sku_items) {
    const k = normSku(it.sku);
    if (!k) continue;
    orderBySku.set(k, (orderBySku.get(k) ?? 0) + (Number(it.quantity) || 0));
  }
  const ackBySku = new Map<string, number>();
  for (const it of ack.items) {
    const k = normSku(it.composite_sku);
    if (!k) continue;
    ackBySku.set(k, (ackBySku.get(k) ?? 0) + (Number(it.qty) || 0));
  }

  const allSkus = new Set<string>([...orderBySku.keys(), ...ackBySku.keys()]);
  const lines: LineResult[] = [];
  for (const sku of Array.from(allSkus).sort()) {
    const o = orderBySku.has(sku) ? orderBySku.get(sku)! : null;
    const a = ackBySku.has(sku) ? ackBySku.get(sku)! : null;
    let status: LineStatus;
    if (o !== null && a !== null) status = o === a ? "match" : "qty_mismatch";
    else if (o !== null && a === null) status = "missing_from_ack";
    else status = "extra_in_ack";
    lines.push({ composite_sku: sku, status, order_qty: o, ack_qty: a });
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
