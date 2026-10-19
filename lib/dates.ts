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
