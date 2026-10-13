/**
 * Reading what staff paste from Help Scout and type about it -- ONE copy, for
 * an emailed claim (app/api/claim-submissions) and consent obtained by email
 * (app/api/projects/[id]/consent). Moved here 2026-10-13 from the claims
 * route, its first user, when the second arrived.
 */

/** The conversation's id from its Help Scout link: .../conversation/{id}/{number}. */
export function conversationIdFrom(link: string): number | null {
  const m = /helpscout\.net\/conversation\/(\d{1,18})(?:[/?#]|$)/.exec(link.trim());
  const id = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The conversation's link, as staff open it. */
export function conversationUrl(id: number): string {
  return `https://secure.helpscout.net/conversation/${id}`;
}

/**
 * "2026-10-06T14:05", read as ARIZONA time. Arizona keeps no daylight saving,
 * so it is UTC-7 every day of the year and the conversion is exact.
 *
 * ⚠ TIGHTENED WHEN MOVED (2026-10-13): the claims route's copy refused a date
 * that rolled over (Feb 30) but read "10:75" as 11:15. An hour or minute that
 * rolls over is refused now too.
 */
export function arizonaToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h + 7, mi));
  // Rejects a date that rolled over (Feb 30) by checking it reads back the same.
  const back = new Date(t.getTime() - 7 * 3600_000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d
      || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) return null;
  return t;
}
