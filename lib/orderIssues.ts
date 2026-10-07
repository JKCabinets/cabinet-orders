import { describeLineIssue, skuKey, type ReconcileResult } from "@/lib/reconcile";

/**
 * What is wrong with an order, in words -- ONE COPY, for the vendor PDF
 * (app/api/orders/[id]/export) and the order modal's Full Order tab (2026-10-07).
 *
 * ⚠ ONE COPY ON PURPOSE. The PDF and the screen must flag the same things the
 * same way: an order the screen calls clean must not print with an amber row,
 * nor the reverse. Pure -- no database, no browser -- so both can import it.
 *
 * Two kinds of issue:
 *   - the CUSTOMER'S DETAILS and the PO (Garrett, 2026-10-07): what a vendor
 *     cannot ship to, reach or file without;
 *   - the ACKNOWLEDGMENT: the vendor's .xlsx, reconciled against the order
 *     (lib/reconcile). Each line that differs is told on its own line.
 */

export interface CustomerFields {
  name?: string | null;
  ship_to?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
}

/** "" where the value is fine; otherwise what is wrong with it. */
export interface CustomerIssues { name: string; shipTo: string; phone: string; email: string }

/**
 * Simple on purpose: a missing value, or one that cannot be right.
 * ⚠ THE ZIP IS LOOKED FOR AT THE END, optionally before "USA". A five-digit
 * house number ("22792 E Via De Olivos") is not a ZIP, and a test anywhere in
 * the line passed every address with one.
 */
export function customerIssues(o: CustomerFields): CustomerIssues {
  const name = String(o.name ?? "").trim();
  const shipTo = String(o.ship_to ?? "").trim();
  const phone = String(o.customer_phone ?? "").trim();
  const email = String(o.customer_email ?? "").trim();
  return {
    // poReference falls back to the bare order number when there is no name.
    name: !name ? "No customer name, so the PO has no last name" : "",
    shipTo: !shipTo ? "No ship-to address"
      : !/\b\d{5}(?:-\d{4})?\s*(?:,?\s*(?:USA?|United States))?\s*$/i.test(shipTo) ? "Ship-to address has no ZIP code" : "",
    phone: !phone ? "No customer phone"
      : phone.replace(/\D/g, "").length < 10 ? "Customer phone looks incomplete" : "",
    email: !email ? "No customer email"
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Customer email looks wrong" : "",
  };
}

/** An acknowledgment as lib/acknowledgments summarises it (and /vendors returns it). */
export type AckLike = { verdict: "green" | "red"; result: ReconcileResult; stale?: boolean } | null;

export interface AckIssues {
  /** skuKey(an order line's SKU) -> what differs about that line. */
  byKey: Record<string, string[]>;
  /** Lines the vendor acknowledged that are not on the order. */
  extras: { sku: string; text: string }[];
  /** The customer's name or address as the acknowledgment has them, where they differ. */
  fields: { name?: string; address?: string };
  /** Lines and fields that differ. */
  count: number;
  /** A red acknowledgment older than the order's last change. */
  stale: boolean;
}

/**
 * Every red acknowledgment's differences, per line. A green one has none; a
 * vendor with no acknowledgment yet has none to show.
 */
export function ackIssues(acks: Record<string, AckLike>): AckIssues {
  const out: AckIssues = { byKey: {}, extras: [], fields: {}, count: 0, stale: false };
  for (const ack of Object.values(acks)) {
    if (!ack || ack.verdict !== "red" || !ack.result) continue;
    if (ack.stale) out.stale = true;
    for (const l of ack.result.lines ?? []) {
      if (l.status === "match") continue;
      out.count += 1;
      if (l.status === "extra_in_ack") {
        out.extras.push({ sku: l.composite_sku, text: describeLineIssue(l) });
        continue;
      }
      const k = skuKey(l.composite_sku);
      (out.byKey[k] ??= []).push(describeLineIssue(l));
    }
    for (const f of ack.result.fields ?? []) {
      if (f.matched) continue;
      out.count += 1;
      out.fields[f.field] = `The acknowledgment has "${f.ack_value || "nothing"}"`;
    }
  }
  return out;
}

/** The acknowledgment notes for one order line, if any. */
export function ackNotesFor(issues: AckIssues, sku: string | null | undefined): string[] {
  return issues.byKey[skuKey(sku ?? "")] ?? [];
}

/**
 * Who keyed the order, as a NAME. ⚠ `claimed_by` holds a team_members.id, not
 * a name -- until 2026-10-07 the PDF printed the id. `entered_by` is already a
 * name or username. The caller supplies the id -> name lookup.
 */
export function keyedByName(
  o: { entered_by?: string | null; claimed_by?: string | null; member?: string | null },
  nameOfId: (id: string) => string | null | undefined,
): string {
  if (o.entered_by) return o.entered_by;
  if (o.claimed_by) return nameOfId(o.claimed_by) ?? "—";
  return "";
}
