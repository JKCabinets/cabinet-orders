/**
 * A person's change to a cabinet group's ship dates, judged (2026-11-02,
 * feature 9 phase 1, part 2). Pure -- the order route asks it, with the row as
 * stored and the update as it would be written, and does what it answers.
 *
 * Garrett's rulings (2026-10-29):
 *   - a mixed group may carry a ship date per vendor; the group's date is the
 *     LATEST of them (the database holds that too);
 *   - "Still on schedule?" -> "On schedule" is recorded for that date, by who,
 *     when; "Delayed: new date" is a date change like any other;
 *   - LOCKED ONCE SHIPPED: a vendor's ship date cannot change once its lines
 *     are marked shipped in Shopify, nor a shipped line's backorder -- the
 *     SERVER refuses, not just the screen; a backward move that would clear a
 *     locked date is refused, naming the vendor, the date and the remedy.
 */
import { cabinetVendorsOf, vendorShipDate, lineShipDate, lineKeyOf, shippedAt, type ShipGroup } from "./shipDates";
import { EDITABLE_LINE_FIELDS, isIsoDate } from "./lineFields";
import { formatMDY, stageDate } from "./dates";
import type { SkuItem } from "./data";

export type ShipEditRow = ShipGroup & {
  id?: string;
  production_start_date?: string | null;
  scheduled_delivery_date?: string | null;
  vendor_start_dates?: Record<string, string> | null;
  vendor_delivery_targets?: Record<string, string> | null;
};

export type ShipEdit =
  | { ok: true; set: Record<string, unknown>; finish?: string | null; groupDates: Record<string, string | null>; notes: string[] }
  | { ok: false; status: number; error: string; message: string };

const no = (status: number, error: string, message: string): ShipEdit => ({ ok: false, status, error, message });
const REMEDY = "If it didn’t ship, tell the customer through Help Scout.";

/**
 * The three per-line dates and the order's own date each sets (2026-11-02,
 * feature 10). The ship dates' words are phase 1's, unchanged.
 */
const PER_LINE = [
  { field: "vendor_ship_dates", group: "production_est_finish_date", pick: "latest", code: "vendor_dates",
    noun: "ship date", aNoun: "a ship date", notCabinets: "Only a cabinet order ships per vendor.",
    invalid: "The vendor ship dates were not a list of vendors and dates.",
    single: "This order has one cabinet vendor, so it ships on one date.",
    perVendorCode: "ships_per_vendor", perVendor: "This order ships per vendor: change the vendor’s own ship date." },
  { field: "vendor_start_dates", group: "production_start_date", pick: "earliest", code: "start_dates",
    noun: "production start date", aNoun: "a production start date", notCabinets: "Only a cabinet order starts production per vendor.",
    invalid: "The vendor start dates were not a list of vendors and dates.",
    single: "This order has one cabinet vendor, so it starts production on one date.",
    perVendorCode: "starts_per_vendor", perVendor: "This order starts production per vendor: change the vendor’s own start date." },
  { field: "vendor_delivery_targets", group: "scheduled_delivery_date", pick: "latest", code: "delivery_targets",
    noun: "delivery target", aNoun: "a delivery target", notCabinets: "Only a cabinet order is delivered per vendor.",
    invalid: "The vendor delivery targets were not a list of vendors and dates.",
    single: "This order has one cabinet vendor, so it has one delivery target.",
    perVendorCode: "delivers_per_vendor", perVendor: "This order is delivered per vendor: change the vendor’s own delivery target." },
] as const;

/**
 * @param row      the row as stored (with sku_items, the three ship columns, vendor, type)
 * @param body     the request
 * @param updates  everything else this request would write (after the line merge
 *                 and the backward-move clearing) -- the locks judge the row AS WRITTEN
 * @param clearing the order dates a backward move is clearing (its clearedFields'
 *                 keys); `true` is phase 1's "the ship date"
 */
export function shipDateEdit(
  row: ShipEditRow,
  body: Record<string, unknown>,
  updates: Record<string, unknown>,
  actor: { id: string; name: string },
  nowIso: string,
  clearing: boolean | string[],
): ShipEdit {
  const set: Record<string, unknown> = {};
  const notes: string[] = [];
  let finish: string | null | undefined;
  /** The order's own dates the per-line dates set: the route puts them in the body. */
  const groupDates: Record<string, string | null> = {};
  const vendors = cabinetVendorsOf(row);
  // The order dates a BACKWARD MOVE is clearing (its own list, from the route --
  // not any date a request happens to send as nothing): a per-line set may go
  // with them. A boolean is phase 1's "the ship date is being cleared".
  const clearingGroups: string[] = Array.isArray(clearing) ? clearing : clearing ? ["production_est_finish_date"] : [];
  const clearingFinish = clearingGroups.includes("production_est_finish_date");

  // ── Dates per line: ship, start, delivery target (2026-11-02, feature 10) ──
  // ONE RULE FOR ALL THREE, phase 1's for the ship dates: a mixed cabinet group
  // only, a date for every line or none, the order's own date derived -- the
  // latest ship date, the EARLIEST start, the latest delivery target (Garrett,
  // decision B) -- and the database holds it so.
  for (const f of PER_LINE) {
    const v = body[f.field];
    if (v !== undefined) {
      if (v === null) {
        set[f.field] = null;
        continue;
      }
      if (row.type !== "order") return no(422, "not_cabinets", f.notCabinets);
      if (typeof v !== "object" || Array.isArray(v)) return no(422, `invalid_${f.code}`, f.invalid);
      if (vendors.length < 2) return no(422, "single_vendor", f.single);
      const dates = v as Record<string, unknown>;
      const keys = Object.keys(dates);
      if (keys.length !== vendors.length || vendors.some((x) => !keys.includes(x))) {
        return no(422, `${f.code}_incomplete`, `Set ${f.aNoun} for each vendor: ${vendors.join(", ")}.`);
      }
      for (const x of vendors) if (!isIsoDate(dates[x])) return no(422, `invalid_${f.code}`, `${x}’s ${f.noun} must be a date.`);
      const sorted = vendors.map((x) => dates[x] as string).sort();
      const derived = f.pick === "earliest" ? sorted[0] : sorted.at(-1)!;
      if (body[f.group] !== undefined && (body[f.group] || null) !== derived) {
        return no(422, "dates_disagree", `The order’s ${f.noun} must be the ${f.pick} vendor’s, ${formatMDY(derived)}.`);
      }
      set[f.field] = Object.fromEntries(vendors.map((x) => [x, dates[x]]));
      set[f.group] = derived;
      groupDates[f.group] = derived;
    } else if (row[f.field as keyof ShipEditRow] && !clearingGroups.includes(f.group)
               && body[f.group] !== undefined
               && (body[f.group] || null) !== ((row[f.group as keyof ShipEditRow] as string | null | undefined) || null)) {
      return no(422, f.perVendorCode, f.perVendor);
    }
  }
  finish = groupDates.production_est_finish_date;

  const next = { ...row, ...updates, ...set } as ShipEditRow;

  // ── "On schedule" ──────────────────────────────────────────────────────
  if (body.ship_check !== undefined) {
    const c = body.ship_check as { vendor?: unknown; line_key?: unknown; date?: unknown } | null;
    if (!c || typeof c !== "object" || !isIsoDate(c.date)) return no(422, "invalid_ship_check", "The answer did not say which date it was for.");
    if (body.sku_items !== undefined || body.vendor_ship_dates !== undefined) {
      return no(422, "one_at_a_time", "Answer the schedule question on its own, then make other changes.");
    }
    if (typeof c.vendor === "string") {
      const vendor = c.vendor;
      if (!vendors.includes(vendor)) return no(422, "unknown_vendor", `${vendor} is not a vendor on this order.`);
      if (shippedAt(row, `vendor:${vendor}`)) return no(409, "already_shipped", `${vendor}’s lines are already marked shipped in Shopify.`);
      const date = vendorShipDate(next, vendor);
      if (date !== c.date) return no(409, "check_stale", `${vendor}’s ship date is now ${formatMDY(date) || "not set"}. Reload, then answer again.`);
      set.ship_checks = { ...(row.ship_checks ?? {}), [vendor]: { date, by: actor.id, at: nowIso } };
      notes.push(`On schedule: ${vendor} ships from the factory on ${formatMDY(date)}, confirmed by ${actor.name}`);
    } else if (typeof c.line_key === "string") {
      const lines: SkuItem[] = Array.isArray(row.sku_items) ? row.sku_items : [];
      const i = lines.findIndex((l) => lineKeyOf(l) === c.line_key);
      if (i < 0) return no(409, "check_stale", "That line is no longer on the order. Reload, then answer again.");
      const line = lines[i];
      if (shippedAt(row, `line:${c.line_key}`)) return no(409, "already_shipped", `${line.sku} is already marked shipped in Shopify.`);
      const date = lineShipDate(row, line);
      if (!line.backordered || date !== c.date) {
        return no(409, "check_stale", `${line.sku}’s ready date is now ${formatMDY(date) || "not set"}. Reload, then answer again.`);
      }
      set.sku_items = lines.map((l, j) => (j === i ? { ...l, ready_confirmed: { date, by: actor.id, at: nowIso } } : l));
      notes.push(`On schedule: ${line.sku} (backordered) ready on ${formatMDY(date)}, confirmed by ${actor.name}`);
    } else {
      return no(422, "invalid_ship_check", "The answer did not say which vendor or line it was for.");
    }
  }

  const written = { ...row, ...updates, ...set } as ShipEditRow;

  // ── The locks: judged on the row as it would be written ─────────────────
  for (const vendor of vendors) {
    const at = shippedAt(row, `vendor:${vendor}`);
    if (!at) continue;
    const before = vendorShipDate(row, vendor);
    const after = vendorShipDate(written, vendor);
    if (before !== after) {
      return no(409, "vendor_date_locked",
        `${vendor}’s lines are marked shipped in Shopify on ${stageDate(at)}, so its date can’t be ${clearingFinish && !after ? "cleared" : "changed"}. ${REMEDY}`);
    }
  }
  const was: SkuItem[] = Array.isArray(row.sku_items) ? row.sku_items : [];
  const now: SkuItem[] = Array.isArray(written.sku_items) ? written.sku_items : [];
  if (now !== was) {
    for (const line of was) {
      const key = lineKeyOf(line);
      const at = key ? shippedAt(row, `line:${key}`) : null;
      if (!at) continue;
      const after = now.find((l) => lineKeyOf(l) === key);
      const changed = !after || EDITABLE_LINE_FIELDS.some((f) => JSON.stringify(line[f] ?? null) !== JSON.stringify(after[f] ?? null));
      if (changed) {
        return no(409, "line_locked", `${line.sku} is marked shipped in Shopify on ${stageDate(at)}, so its backorder can’t be changed. ${REMEDY}`);
      }
    }
  }

  // ── The trail: a vendor's own date, when it moves ──────────────────────
  for (const f of PER_LINE) {
    if (body[f.field] === undefined || vendors.length < 2) continue;
    const own = (r: ShipEditRow, vendor: string): string | null => {
      const m = r[f.field as keyof ShipEditRow] as Record<string, string> | null | undefined;
      return (m && typeof m[vendor] === "string" && m[vendor]) || (r[f.group as keyof ShipEditRow] as string | null | undefined) || null;
    };
    for (const vendor of vendors) {
      const before = row[f.field as keyof ShipEditRow] ? own(row, vendor) : null;
      const after = own(written, vendor);
      if (before !== after && after) {
        notes.push(`${vendor}’s ${f.noun} ${before ? `changed from ${formatMDY(before)} to ${formatMDY(after)}` : `set to ${formatMDY(after)}`} by ${actor.name}`);
      }
    }
  }
  return { ok: true, set, finish, groupDates, notes };
}
