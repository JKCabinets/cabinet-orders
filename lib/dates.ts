/**
 * Dates for people to read.
 *
 * ⚠ PARSED AS A STRING, NOT THROUGH `new Date()`. The date columns here are
 * DATE, not timestamp, and arrive as "2026-09-16". `new Date("2026-09-16")` is
 * parsed as UTC midnight, which in Phoenix (UTC-7) is 5pm on the 15th -- so
 * every date in the app would render one day early, every day, and look like a
 * data problem rather than a formatting one.
 *
 * Anything that is not a plain ISO date is returned unchanged rather than
 * mangled: `orders.date` and `order_activity.time` are stored as display
 * strings ("Sep 14"), not ISO, and must not be reformatted here.
 */
export function formatMDY(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * ⚠ AN ORDER'S DATE AND AN ACTIVITY LINE'S TIME ARE READ FROM `created_at`
 * (2026-10-19). `orders.date` and `order_activity.time` are display strings
 * ("Oct 15") with no year -- the table guessed one, the trail showed none, and
 * neither had a clock. Every writer stores the Phoenix day the row was made,
 * which is exactly `created_at`'s day (checked against every row, 2026-10-19:
 * no exception), so the screens read the timestamp and the strings are no
 * longer what anyone sees. Garrett, 2026-10-19: an order's date reads
 * MM/DD/YYYY like every other date -- the vendor PDF's "Ordered On" too -- and
 * an activity line reads "10/15/2026 4:35 PM", Phoenix time. A row without a
 * `created_at` (none today) shows its stored string, as before.
 */
const PHOENIX = "America/Phoenix";

function phoenixMDY(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: PHOENIX });
}

/**
 * The Phoenix day of a timestamp, MM/DD/YYYY -- a stage's date on the rail
 * (2026-10-21, item 7; Garrett: MM/DD/YYYY like every other date). "" for none.
 */
export function stageDate(at: string | null | undefined): string {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? phoenixMDY(t) : "";
}

/** An order's date, MM/DD/YYYY: the Phoenix day it was created. */
export function orderDate(order: { created_at?: string | null; date?: string | null }): string {
  const t = order.created_at ? Date.parse(order.created_at) : NaN;
  return Number.isFinite(t) ? phoenixMDY(t) : (order.date ?? "");
}

/** An activity line's time: "10/15/2026 4:35 PM", Phoenix time. */
export function activityStamp(entry: { at?: string | null; time?: string | null }): string {
  const t = entry.at ? Date.parse(entry.at) : NaN;
  if (!Number.isFinite(t)) return entry.time ?? "";
  const clock = new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: PHOENIX });
  return `${phoenixMDY(t)} ${clock}`;
}

/**
 * ⚠ ARIZONA'S DATE, "2026-11-02" (2026-10-29, feature 9 phase 1). What day it
 * is for the business -- when a ship date has come, when "Still on schedule?"
 * shows. `new Date().toISOString().slice(0, 10)` is UTC's date, which in
 * Arizona (UTC-7, no daylight saving) is TOMORROW from 5 p.m.: a line due
 * today read overdue, "ready" came a day early (five places found 2026-10-29).
 * Read from the clock's own parts in America/Phoenix, never from a formatted
 * string whose shape depends on the locale.
 */
export function arizonaToday(now: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PHOENIX, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The business day before an ISO date: Friday for a Saturday, Sunday or
 * Monday, otherwise the day before (Garrett, 2026-10-29: "Still on schedule?"
 * shows on the business day before the ship date -- Friday for a Monday).
 * Calendar arithmetic only, in UTC, where an ISO date has no clock to shift.
 * Not a date: returned unchanged. Holidays are not business days off here.
 */
export function businessDayBefore(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const back = { 0: 2, 1: 3, 6: 1 }[d.getUTCDay() as 0 | 1 | 6] ?? 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
