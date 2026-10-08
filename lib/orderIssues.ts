import { describeLineIssue, skuKey, normAddress, phoneKey, phoneIn, withoutPhone, type ReconcileResult } from "@/lib/reconcile";

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
export type AckLike = {
  verdict: "green" | "red";
  result: ReconcileResult;
  stale?: boolean;
  /** Names for the door-style and colour codes involved, from the server's mapping tables (2026-10-07). */
  names?: { door: Record<string, string>; color: Record<string, string> };
} | null;

/** What of the order the explanations compare against. */
export interface AckOrderContext {
  ship_to?: string | null;
  customer_phone?: string | null;
  sku_items?: { sku: string; door_style?: string | null; color?: string | null }[] | null;
}

export interface AckIssues {
  /** skuKey(an order line's SKU) -> what differs about that line. */
  byKey: Record<string, string[]>;
  /** Lines the vendor acknowledged that are not on the order AT ALL -- not the same cabinet with a different code. */
  extras: { sku: string; text: string }[];
  /** The customer's name, address or phone as the acknowledgment has them, where they differ. */
  fields: { name?: string; address?: string; phone?: string };
  /** Discrepancies: a paired line counts once. */
  count: number;
  /** A red acknowledgment older than the order's last change. */
  stale: boolean;
  /** When many lines differ the SAME way -- one wrong colour, say -- that, in one sentence. */
  headline?: string;
  /** The banner's words: the headline when there is one, else the count. "" when nothing differs. */
  summary: string;
}

/** A composite SKU, read from the end: colour last, door style before it, the cabinet before that. */
function splitSku(sku: string): { base: string; door: string; color: string } | null {
  const p = String(sku ?? "").split("-");
  if (p.length < 3) return null;
  return { base: p.slice(0, -2).join("-"), door: p[p.length - 2], color: p[p.length - 1] };
}

/**
 * Every red acknowledgment's differences, explained (2026-10-07).
 *
 * ⚠ SAY WHAT IS WRONG, NOT THAT EVERY LINE IS. reconcileAck matches lines on the
 * whole composite SKU, colour code included, so ONE wrong colour made every
 * line "missing from the acknowledgment" and every acknowledged line "extra" --
 * true, and useless: the cabinets were right. A missing order line and an
 * extra acknowledged line for the SAME cabinet (the SKU before its door and
 * colour codes) are one discrepancy, told as what differs: the colour, the door
 * style, the quantity. When many lines differ the same way, the headline says
 * it once. Only what cannot be paired stays "missing" or "extra".
 *
 * ⚠ THE PHONE IS ITS OWN ROW. Acknowledgments from before 2026-10-07 have no
 * phone result -- a wrong phone surfaced as an ADDRESS mismatch -- so for those
 * the address is re-compared without its phone, and the phone on its own.
 */
export function ackIssues(acks: Record<string, AckLike>, order?: AckOrderContext | null): AckIssues {
  const out: AckIssues = { byKey: {}, extras: [], fields: {}, count: 0, stale: false, summary: "" };
  // Names for codes: the order's own lines name theirs; the server names the rest.
  const orderNames = { door: {} as Record<string, string>, color: {} as Record<string, string> };
  for (const it of order?.sku_items ?? []) {
    const s = splitSku(it.sku);
    if (!s) continue;
    if (it.door_style) orderNames.door[s.door.toUpperCase()] = it.door_style;
    if (it.color) orderNames.color[s.color.toUpperCase()] = it.color;
  }
  const signatures: string[] = [];
  let pairedHeadline = "";
  let pairs = 0;

  for (const ack of Object.values(acks)) {
    if (!ack || ack.verdict !== "red" || !ack.result) continue;
    if (ack.stale) out.stale = true;
    const nameOf = (kind: "door" | "color", code: string) =>
      ack.names?.[kind]?.[code] ?? ack.names?.[kind]?.[code.toUpperCase()] ?? orderNames[kind][code.toUpperCase()];
    const label = (kind: "door" | "color", code: string) => {
      const n = nameOf(kind, code);
      return n ? `${n} "${code}"` : `"${code}"`;
    };

    const missing = (ack.result.lines ?? []).filter((l) => l.status === "missing_from_ack");
    const extra = (ack.result.lines ?? []).filter((l) => l.status === "extra_in_ack");
    const usedExtra = new Set<number>();
    for (const l of ack.result.lines ?? []) {
      if (l.status === "match" || l.status === "missing_from_ack" || l.status === "extra_in_ack") continue;
      out.count += 1;
      (out.byKey[skuKey(l.composite_sku)] ??= []).push(describeLineIssue(l));
    }
    for (const m of missing) {
      const ms = splitSku(m.composite_sku);
      const idx = ms ? extra.findIndex((e, k) => !usedExtra.has(k) && splitSku(e.composite_sku) !== null
        && skuKey(splitSku(e.composite_sku)!.base) === skuKey(ms.base)) : -1;
      out.count += 1;
      if (idx < 0 || !ms) {
        (out.byKey[skuKey(m.composite_sku)] ??= []).push(describeLineIssue(m));
        continue;
      }
      usedExtra.add(idx);
      const e = extra[idx]; const es = splitSku(e.composite_sku)!;
      const parts: string[] = []; const sig: string[] = [];
      if (skuKey(es.color) !== skuKey(ms.color)) {
        parts.push(`Colour: acknowledgment ${label("color", es.color)}, order ${label("color", ms.color)}`);
        sig.push(`color:${ms.color}>${es.color}`);
      }
      if (skuKey(es.door) !== skuKey(ms.door)) {
        parts.push(`Door style: acknowledgment ${label("door", es.door)}, order ${label("door", ms.door)}`);
        sig.push(`door:${ms.door}>${es.door}`);
      }
      if ((m.order_qty ?? 0) !== (e.ack_qty ?? 0)) parts.push(`ordered ${m.order_qty}, acknowledged ${e.ack_qty}`);
      if (parts.length === 0) parts.push("written differently on the acknowledgment");
      (out.byKey[skuKey(m.composite_sku)] ??= []).push(parts.join("; "));
      signatures.push(sig.join("|")); pairs += 1;
      if (!pairedHeadline && sig.length > 0) {
        const what = sig.map((s) => s.split(":")[0]);
        const ackSide = [what.includes("door") ? label("door", es.door) : "", what.includes("color") ? label("color", es.color) : ""].filter(Boolean).join(" in ");
        const orderSide = [what.includes("door") ? label("door", ms.door) : "", what.includes("color") ? label("color", ms.color) : ""].filter(Boolean).join(" in ");
        const noun = what.length === 2 ? "Door style and colour" : what[0] === "door" ? "Door style" : "Colour";
        pairedHeadline = `${noun}: the acknowledgment has ${ackSide} on @@N@@ lines; the order is ${orderSide}`;
      }
    }
    extra.forEach((e, k) => {
      if (usedExtra.has(k)) return;
      out.count += 1;
      out.extras.push({ sku: e.composite_sku, text: describeLineIssue(e) });
    });

    // The customer's fields: each on its own row.
    const fieldsOf = ack.result.fields ?? [];
    const hasPhoneResult = fieldsOf.some((f) => f.field === "phone");
    for (const f of fieldsOf) {
      if (f.matched) continue;
      if (f.field === "name") { out.fields.name = `The acknowledgment has "${f.ack_value || "nothing"}"`; out.count += 1; }
      if (f.field === "phone") { out.fields.phone = `The acknowledgment has ${f.ack_value || "no phone"}`; out.count += 1; }
      if (f.field === "address") {
        const addressDiffers = !order || normAddress(order.ship_to ?? "") !== normAddress(f.ack_value);
        if (addressDiffers) { out.fields.address = `The acknowledgment has "${withoutPhone(f.ack_value) || "nothing"}"`; out.count += 1; }
        if (!hasPhoneResult && order) {
          const ackPhone = phoneKey(f.ack_value), orderPhone = phoneKey(order.customer_phone);
          if (ackPhone && orderPhone && ackPhone !== orderPhone) {
            out.fields.phone = `The acknowledgment has ${phoneIn(f.ack_value)}`; out.count += 1;
          }
        }
      }
    }
  }

  // One sentence when every paired line differs the same way.
  if (pairs >= 2 && signatures.every((s) => s && s === signatures[0])) {
    out.headline = pairedHeadline.replace("@@N@@", String(pairs));
  }
  const rest = out.count - (out.headline ? pairs : 0);
  const stale = out.stale ? " (the acknowledgment is older than the order's last change)" : "";
  out.summary = out.headline
    ? out.headline + (rest > 0 ? ` \u00b7 ${rest} other discrepanc${rest === 1 ? "y" : "ies"}` : "") + stale
    : out.count > 0 ? `${out.count} acknowledgment discrepanc${out.count === 1 ? "y" : "ies"}${stale}` : "";
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
