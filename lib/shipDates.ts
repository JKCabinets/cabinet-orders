/**
 * When a cabinet group's lines ship, and what is due -- ONE DEFINITION
 * (2026-10-29, feature 9 phase 1), read by the daily fulfilment run, the order
 * route's locks, the band's "Still on schedule?" and the attention list. The
 * run and the screens must agree to the line about what ships when: a screen
 * that asks "still on schedule?" about a line the run will not mark is worse
 * than asking nothing (lib/autoAdvance's rule, here too).
 *
 * The rules (Garrett, docs/SESSION-HANDOFF-2026-10-29.md §4 and the rulings
 * of 2026-10-29):
 *   - A single-vendor group's lines ship on production_est_finish_date. A
 *     mixed group may carry a date per vendor (vendor_ship_dates); without
 *     one, every vendor ships on the group's date.
 *   - A BACKORDERED line is held back and ships on its own expected_ready_date
 *     -- never before its vendor's ship date (see lineShipDate).
 *   - "Still on schedule?" shows from the business day before a date through
 *     the date itself, until answered for THAT date or shipped.
 *   - The run acts at In production and At cross dock only (an allowlist).
 *
 * Pure: no clock but the `now`/`today` it is given, no imports with effects.
 */
import { arizonaToday, businessDayBefore, stageDate } from "./dates";
import { lineItemIdOf } from "./lineFields";
import type { Order, SkuItem } from "./data";

/** The stages the run marks lines shipped at -- an ALLOWLIST (Garrett, 2026-10-29). */
export const FULFIL_STAGES: readonly string[] = ["In production", "At cross dock"];

export type ShipGroup = Pick<Order,
  "type" | "stage" | "vendor" | "sku_items" | "production_est_finish_date"
  | "vendor_ship_dates" | "ship_checks" | "shipped_in_shopify">;

const lines = (g: ShipGroup): SkuItem[] => (Array.isArray(g.sku_items) ? g.sku_items : []);

/**
 * A line's vendor: its own (from Shopify, since 2026-08-24), else the group's.
 * ⚠ THE SAME FIRST ANSWER AS lib/vendorLookup's layer 0 (2026-11-02, feature
 * 10, decision E): on every line that has its own vendor, the two agree.
 */
export function lineVendor(line: SkuItem, g: ShipGroup): string {
  return String(line.vendor || g.vendor || "").trim();
}

/** The cabinet vendors of a group, in line order, once each. Only cabinet groups ship this way. */
export function cabinetVendorsOf(g: ShipGroup): string[] {
  if (g.type !== "order") return [];
  const out: string[] = [];
  for (const l of lines(g)) {
    const v = lineVendor(l, g);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * How the record and the row's copy name a line: "li:<Shopify line item id>",
 * or "v:<variant id>" for a line stored before line ids (the run uses that
 * only where it is unambiguous -- ruling 5). Null: nothing to name it by.
 */
export function lineKeyOf(line: SkuItem): string | null {
  const id = lineItemIdOf(line.line_item_id);
  if (id) return `li:${id}`;
  const v = String(line.variant_id ?? "").trim();
  return v ? `v:${v}` : null;
}

/** A vendor's ship date: its own in a mixed group, else the group's. */
export function vendorShipDate(g: ShipGroup, vendor: string): string | null {
  const own = g.vendor_ship_dates?.[vendor];
  return (typeof own === "string" && own) || g.production_est_finish_date || null;
}

/**
 * ⚠ A BACKORDERED LINE SHIPS ON ITS OWN DATE -- BUT NEVER BEFORE ITS VENDOR'S.
 * A line marked "ready 11-05" on a vendor shipping 11-10 is still in that
 * shipment; marking it shipped on the 5th would tell the customer one cabinet
 * left ahead of the rest. So: the later of the two. Null while either is
 * missing -- a backordered line with no ready date waits for one.
 */
export function lineShipDate(g: ShipGroup, line: SkuItem): string | null {
  if (!line.backordered) return null;
  const ready = line.expected_ready_date || null;
  const vendorDate = vendorShipDate(g, lineVendor(line, g));
  if (!ready || !vendorDate) return null;
  return ready > vendorDate ? ready : vendorDate;
}

/** When the OMS marked it shipped in Shopify (ISO), or null. Keys: vendor:<name>, line:<key>. */
export function shippedAt(g: ShipGroup, key: string): string | null {
  const at = g.shipped_in_shopify?.[key];
  return typeof at === "string" && at ? at : null;
}

/** "Marked shipped in Shopify on MM/DD/YYYY" -- the Phoenix day -- or null. */
export function shippedOnText(g: ShipGroup, key: string): string | null {
  const at = shippedAt(g, key);
  return at ? `Marked shipped in Shopify on ${stageDate(at)}` : null;
}

/** Whether a line is marked shipped (with its vendor, or on its own). */
export function lineShipped(g: ShipGroup, line: SkuItem): boolean {
  const k = lineKeyOf(line);
  if (k) return !!shippedAt(g, `line:${k}`);
  // ⚠ A LINE WITH NO KEY (no line id, no variant id) cannot be named in the
  // record, so the row's copy can never list it. Not backordered, it can only
  // have gone in its vendor's shipment -- else it would come due every morning.
  return !line.backordered && !!shippedAt(g, `vendor:${lineVendor(line, g)}`);
}

/** What is due to be marked shipped. `index` is the line's place in sku_items. */
export type DueUnit =
  | { scope: "vendor"; vendor: string; date: string; lines: { index: number; key: string | null }[] }
  | { scope: "line"; vendor: string; date: string; index: number; key: string | null };

/**
 * Everything due on or before `today` and not yet shipped -- ignoring stage,
 * purchase and start day, which the run decides (and records) itself.
 *
 *   - Per vendor not yet shipped: its lines that are not backordered.
 *   - Per backordered line: on its lineShipDate.
 *   - ⚠ A LINE LEFT BEHIND BY ITS SHIPPED VENDOR -- a backorder cleared after
 *     the vendor shipped, or a line Shopify added since -- is due on its own,
 *     on the vendor's date. Otherwise it would never be marked at all.
 */
export function dueFulfilments(g: ShipGroup, today: string): DueUnit[] {
  const out: DueUnit[] = [];
  const all = lines(g);
  for (const vendor of cabinetVendorsOf(g)) {
    const date = vendorShipDate(g, vendor);
    if (!date || date > today) continue;
    const mine = all.map((l, index) => ({ l, index })).filter(({ l }) => lineVendor(l, g) === vendor);
    const plain = mine.filter(({ l }) => !l.backordered && !lineShipped(g, l));
    const vendorOpen = !shippedAt(g, `vendor:${vendor}`);
    // ⚠ A BACKORDERED LINE WHOSE DATE IS ITS VENDOR'S (ready by then) GOES IN
    // THE VENDOR'S SHIPMENT -- one fulfilment, one email, not two that morning.
    const riding = vendorOpen
      ? mine.filter(({ l }) => l.backordered && lineShipDate(g, l) === date && !lineShipped(g, l))
      : [];
    if (vendorOpen) {
      const go = [...plain, ...riding].sort((a, b) => a.index - b.index);
      if (go.length) out.push({ scope: "vendor", vendor, date, lines: go.map(({ l, index }) => ({ index, key: lineKeyOf(l) })) });
    } else {
      for (const { l, index } of plain) out.push({ scope: "line", vendor, date, index, key: lineKeyOf(l) });
    }
    for (const { l, index } of mine) {
      if (riding.some((r) => r.index === index)) continue;
      const d = lineShipDate(g, l);
      if (d && d <= today && !lineShipped(g, l)) out.push({ scope: "line", vendor, date: d, index, key: lineKeyOf(l) });
    }
  }
  return out;
}

/** A "Still on schedule?" that is due: for a vendor, or for one backordered line. */
export type DueCheck =
  | { scope: "vendor"; vendor: string; date: string }
  | { scope: "line"; vendor: string; date: string; index: number; key: string | null; sku: string };

/**
 * The "Still on schedule?" checks due now (Garrett, 2026-10-29): from the
 * business day before a date through the date itself, until answered "On
 * schedule" FOR THAT DATE, or shipped. Only where the run would act:
 * a cabinet group at an allowed stage whose purchase does not stop it.
 *
 * @param purchaseStops REQUIRED: does the purchase stop the run for this group
 *   (lib/autoAdvance's productionAutoAdvanceSkip, or the caller's own reading of
 *   a payment hold)? A caller cannot ask "still on schedule?" without having
 *   asked whether it will ship at all.
 */
export function dueShipChecks(g: ShipGroup, now: number, purchaseStops: boolean): DueCheck[] {
  if (g.type !== "order" || !FULFIL_STAGES.includes(g.stage as string) || purchaseStops) return [];
  const today = arizonaToday(now);
  const inWindow = (date: string) => businessDayBefore(date) <= today && today <= date;
  const out: DueCheck[] = [];
  const all = lines(g);
  for (const vendor of cabinetVendorsOf(g)) {
    const date = vendorShipDate(g, vendor);
    if (!date || !inWindow(date) || shippedAt(g, `vendor:${vendor}`)) continue;
    const hasPlain = all.some((l) => lineVendor(l, g) === vendor && !l.backordered && !lineShipped(g, l));
    if (!hasPlain) continue;
    if (g.ship_checks?.[vendor]?.date === date) continue;
    out.push({ scope: "vendor", vendor, date });
  }
  all.forEach((l, index) => {
    const date = lineShipDate(g, l);
    if (!date || !inWindow(date) || lineShipped(g, l)) return;
    if (l.ready_confirmed?.date === date) return;
    // ⚠ A LINE RIDING IN ITS VENDOR'S SHIPMENT (its date IS the vendor's, the
    // vendor not yet shipped) is asked about through the vendor: one shipment,
    // one question (2026-11-02; dueFulfilments puts it in the vendor's fulfilment).
    const vendor = lineVendor(l, g);
    if (date === vendorShipDate(g, vendor) && !shippedAt(g, `vendor:${vendor}`)) return;
    out.push({ scope: "line", vendor: lineVendor(l, g), date, index, key: lineKeyOf(l), sku: l.sku });
  });
  return out;
}
