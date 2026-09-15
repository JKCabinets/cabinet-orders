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
