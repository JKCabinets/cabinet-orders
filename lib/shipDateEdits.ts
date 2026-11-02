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

export type ShipEditRow = ShipGroup & { id?: string };

export type ShipEdit =
  | { ok: true; set: Record<string, unknown>; finish?: string | null; notes: string[] }
  | { ok: false; status: number; error: string; message: string };

const no = (status: number, error: string, message: string): ShipEdit => ({ ok: false, status, error, message });
const REMEDY = "If it didn’t ship, tell the customer through Help Scout.";

/**
 * @param row      the row as stored (with sku_items, the three ship columns, vendor, type)
 * @param body     the request
 * @param updates  everything else this request would write (after the line merge
 *                 and the backward-move clearing) -- the locks judge the row AS WRITTEN
 * @param clearing whether a backward move is clearing the ship date
 */
export function shipDateEdit(
  row: ShipEditRow,
  body: Record<string, unknown>,
  updates: Record<string, unknown>,
  actor: { id: string; name: string },
  nowIso: string,
  clearing: boolean,
): ShipEdit {
  const set: Record<string, unknown> = {};
  const notes: string[] = [];
  let finish: string | null | undefined;
  const vendors = cabinetVendorsOf(row);

  // ── Per-vendor ship dates ──────────────────────────────────────────────
  if (body.vendor_ship_dates !== undefined) {
    const v = body.vendor_ship_dates;
    if (v === null) {
      set.vendor_ship_dates = null;
    } else {
      if (row.type !== "order") return no(422, "not_cabinets", "Only a cabinet order ships per vendor.");
      if (typeof v !== "object" || Array.isArray(v)) return no(422, "invalid_vendor_dates", "The vendor ship dates were not a list of vendors and dates.");
      if (vendors.length < 2) return no(422, "single_vendor", "This order has one cabinet vendor, so it ships on one date.");
      const dates = v as Record<string, unknown>;
      const keys = Object.keys(dates);
      if (keys.length !== vendors.length || vendors.some((x) => !keys.includes(x))) {
        return no(422, "vendor_dates_incomplete", `Set a ship date for each vendor: ${vendors.join(", ")}.`);
      }
      for (const x of vendors) if (!isIsoDate(dates[x])) return no(422, "invalid_vendor_dates", `${x}’s ship date must be a date.`);
      const latest = vendors.map((x) => dates[x] as string).sort().at(-1)!;
      if (body.production_est_finish_date !== undefined && (body.production_est_finish_date || null) !== latest) {
        return no(422, "dates_disagree", `The order’s ship date must be the latest vendor’s, ${formatMDY(latest)}.`);
      }
      set.vendor_ship_dates = Object.fromEntries(vendors.map((x) => [x, dates[x]]));
      set.production_est_finish_date = latest;
      finish = latest;
    }
  } else if (row.vendor_ship_dates && !clearing && body.production_est_finish_date !== undefined
             && (body.production_est_finish_date || null) !== (row.production_est_finish_date || null)) {
    return no(422, "ships_per_vendor", "This order ships per vendor: change the vendor’s own ship date.");
  }

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
        `${vendor}’s lines are marked shipped in Shopify on ${stageDate(at)}, so its date can’t be ${clearing && !after ? "cleared" : "changed"}. ${REMEDY}`);
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
  if (body.vendor_ship_dates !== undefined && vendors.length > 1) {
    for (const vendor of vendors) {
      const before = row.vendor_ship_dates ? vendorShipDate(row, vendor) : null;
      const after = vendorShipDate(written, vendor);
      if (before !== after && after) {
        notes.push(`${vendor}’s ship date ${before ? `changed from ${formatMDY(before)} to ${formatMDY(after)}` : `set to ${formatMDY(after)}`} by ${actor.name}`);
      }
    }
  }
  return { ok: true, set, finish, notes };
}
