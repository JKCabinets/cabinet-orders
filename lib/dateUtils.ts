const MONTHS: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

function parseMMMDD(dateStr: string): number | null {
  const match = dateStr.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!match) return null;
  const monthIdx = MONTHS[match[1].toLowerCase()];
  const day = parseInt(match[2], 10);
  if (monthIdx === undefined || isNaN(day)) return null;

  const now = Date.now();
  const currentYear = new Date().getFullYear();

  // Always try current year first — orders are recent by default.
  // Only fall back to previous year if current year would be in the future.
  for (const year of [currentYear, currentYear - 1]) {
    const d = new Date(year, monthIdx, day);
    if (d.getTime() <= now) return d.getTime();
  }
  return null;
}

export function parseOrderDate(dateStr: string): number | null {
  if (!dateStr) return null;
  if (/\d{4}/.test(dateStr)) {
    const ms = Date.parse(dateStr);
    if (!isNaN(ms)) return ms;
  }
  return parseMMMDD(dateStr);
}

export function formatDateWithYear(dateStr: string): string {
  if (!dateStr) return "";
  if (/\d{4}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime()))
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  const ms = parseMMMDD(dateStr);
  if (ms !== null)
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return dateStr;
}

export function getOldestAge(orders: { date: string; activity?: { time: string }[] }[]): string | null {
  if (orders.length === 0) return null;
  const now = Date.now();
  let oldest: number | null = null;
  for (const o of orders) {
    const ms = parseOrderDate(o.date);
    if (ms !== null && (oldest === null || ms < oldest)) oldest = ms;
  }
  if (oldest === null) return null;
  const days = Math.floor((now - oldest) / (1000 * 60 * 60 * 24));
  if (days === 0) return "added today";
  if (days === 1) return "oldest: 1 day";
  return `oldest: ${days} days`;
}
