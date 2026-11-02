/**
 * What only the OMS knows about a Shopify line, and how a line is told apart
 * from its neighbours. ONE HOME (2026-10-29, feature 9 phase 1): the webhook's
 * carry-over across Shopify updates (item 63), the order route's merge of a
 * staff edit, and the fulfilment run's matching all read these, so no two of
 * them can disagree about which line is which.
 *
 * No imports: the client's line editor and the server's routes both use it.
 */

/**
 * The fields STAFF set on a line. Shopify knows none of them, so a Shopify
 * update carries them over from the stored line (item 63), and on a Shopify
 * group they are the ONLY fields a person may change.
 *
 * ⚠ A NEW STAFF-SET LINE FIELD MUST JOIN THIS LIST (OMS-STATE §3), or the
 * next Shopify update erases it and the order route refuses it.
 */
export const STAFF_LINE_FIELDS = ["backordered", "expected_ready_date", "backorder_notes", "ready_confirmed"] as const;
export type StaffLineField = typeof STAFF_LINE_FIELDS[number];

/**
 * The staff fields a PERSON edits on a line, through the line editor: the
 * backorder. `ready_confirmed` is a staff field too -- kept across Shopify
 * updates -- but only the order route writes it, from an "On schedule" answer
 * it stamps with who and when; a client's list cannot set it.
 */
export const EDITABLE_LINE_FIELDS = ["backordered", "expected_ready_date", "backorder_notes"] as const;

/**
 * A Shopify line item's id in ONE form: its number, as text.
 *
 * The webhook's payload carries it as a number (`line_items[].id`,
 * 15093812345678) and GraphQL as `gid://shopify/LineItem/15093812345678`
 * (Garrett, 2026-10-29: normalise both to one form). Anything else -- empty,
 * a gid of another kind, a stray value -- is null: no id, never a guess.
 */
export function lineItemIdOf(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  const m = /^(?:gid:\/\/shopify\/LineItem\/)?(\d{1,20})$/.exec(s);
  return m && !/^0+$/.test(m[1]) ? m[1] : null;
}

type LineLike = { sku?: unknown; variant_id?: unknown; line_item_id?: unknown } & Record<string, unknown>;

const vid = (v: unknown) => String(v ?? "").trim();
const skuOf = (v: unknown) => String(v ?? "").trim().toUpperCase();

/**
 * ⚠ WHAT ONLY THE OMS KNOWS ABOUT A LINE SURVIVES A SHOPIFY UPDATE (item 63,
 * 2026-10-29). orders/updated rebuilds every group's lines from the payload --
 * Shopify is the source of what was bought -- and the staff fields are carried
 * over from the stored line; everything else comes from the payload.
 *
 * Matched in Shopify's line order, each stored line used at most once:
 *
 *   1. LINE ID (Garrett, 2026-10-29: the first pass). Two Waypoint cabinets on
 *      one variant in two finishes are two Shopify lines with one variant id;
 *      only the line id tells them apart.
 *   2-4. Item 63's passes -- variant id AND SKU; variant id; SKU alone for lines
 *      with no variant id -- for STORED LINES WITH NO LINE ID ONLY: lines
 *      stored before line ids were kept, until this update gives them one.
 *
 * ⚠ A STORED LINE THAT HAS AN ID IS MATCHED BY ITS ID OR NOT AT ALL. Were the
 * fallbacks to reach it, a line removed in Shopify and another added on the
 * same variant would hand the removed line's backorder to the new one -- and
 * item 63's promise is that a removed line takes its mark with it.
 */
export function keepStaffLineFields<T extends LineLike>(rebuilt: T[], stored: unknown): T[] {
  const prior = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
  if (!prior.some((p) => p && STAFF_LINE_FIELDS.some((k) => p[k] !== undefined))) return rebuilt;
  const legacy = (p: Record<string, unknown>) => lineItemIdOf(p.line_item_id) === null;
  const passes: Array<(r: Record<string, unknown>, p: Record<string, unknown>) => boolean> = [
    (r, p) => lineItemIdOf(r.line_item_id) !== null && lineItemIdOf(r.line_item_id) === lineItemIdOf(p.line_item_id),
    (r, p) => legacy(p) && !!vid(r.variant_id) && vid(r.variant_id) === vid(p.variant_id) && skuOf(r.sku) === skuOf(p.sku),
    (r, p) => legacy(p) && !!vid(r.variant_id) && vid(r.variant_id) === vid(p.variant_id),
    (r, p) => legacy(p) && !vid(r.variant_id) && !vid(p.variant_id) && !!skuOf(r.sku) && skuOf(r.sku) === skuOf(p.sku),
  ];
  // Plain records inside, the caller's type outside: a generic T cannot be written to.
  const out = rebuilt.map((r) => ({ ...r }) as Record<string, unknown>);
  const used = new Set<number>();
  const matched = new Set<number>();
  for (const pass of passes) {
    out.forEach((r, ri) => {
      if (matched.has(ri)) return;
      const pi = prior.findIndex((p, i) => !used.has(i) && !!p && pass(r, p));
      if (pi < 0) return;
      used.add(pi);
      matched.add(ri);
      for (const k of STAFF_LINE_FIELDS) if (prior[pi][k] !== undefined) r[k] = prior[pi][k];
    });
  }
  return out as T[];
}

/** What `mergeStaffLineEdits` answers: the lines to store, or why not. */
export type StaffLineMerge =
  | { ok: true; lines: Record<string, unknown>[] }
  | { ok: false; error: "lines_changed" | "invalid_line_edit"; message: string };

/**
 * A real calendar date in ISO form, or not. ⚠ ROUND-TRIPPED, NOT Date.parse:
 * V8 parses "2026-02-30T00:00:00Z" as March 2 rather than refusing it (found
 * 2026-10-29, proving this). The same rule as the database's oms_iso_date.
 */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
const BACKORDER_NOTES_MAX = 500;

/** A line's fields other than the staff fields and its id, canonical, for comparison. */
function shopifyPart(line: Record<string, unknown>): string {
  const keys = Object.keys(line)
    .filter((k) => !(STAFF_LINE_FIELDS as readonly string[]).includes(k) && k !== "line_item_id" && line[k] !== undefined)
    .sort();
  return JSON.stringify(keys.map((k) => [k, line[k]]));
}

/**
 * A staff edit of a SHOPIFY group's lines, as the order route stores it.
 *
 * ⚠ THE STORED LINES ARE THE BASE, NOT THE LIST SENT (2026-10-29). The route
 * stored what the client sent, so a line kept its Shopify line id, and Shopify
 * kept its lines, only as long as every client sent them back -- and the line
 * editor sends a copy it took when it opened. Now: each sent line must be the
 * stored line at the same place, Shopify's part unchanged; only the staff
 * fields are taken from it; the line id and the rest come from what is stored.
 * A sent line that omits a staff field leaves the stored value standing, and
 * `ready_confirmed` is never taken from it.
 *
 * A list that does not match -- a line added, removed or reordered, Shopify's
 * part different -- is a copy taken before the lines changed (an orders/updated,
 * a Re-decode, another tab), and is refused rather than written over them.
 */
export function mergeStaffLineEdits(stored: unknown, sent: unknown): StaffLineMerge {
  const before = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
  if (!Array.isArray(sent) || sent.some((l) => !l || typeof l !== "object" || Array.isArray(l))) {
    return { ok: false, error: "invalid_line_edit", message: "The lines sent were not a list of lines." };
  }
  const changed = {
    ok: false as const, error: "lines_changed" as const,
    message: "This order's lines changed since you opened it. Reload, then make the change again.",
  };
  if (sent.length !== before.length) return changed;
  const lines: Record<string, unknown>[] = [];
  for (let i = 0; i < before.length; i++) {
    const s = sent[i] as Record<string, unknown>;
    const b = before[i] ?? {};
    const storedId = lineItemIdOf(b.line_item_id);
    if (storedId !== null && s.line_item_id !== undefined && lineItemIdOf(s.line_item_id) !== storedId) return changed;
    if (shopifyPart(s) !== shopifyPart(b)) return changed;
    const next: Record<string, unknown> = { ...b };
    for (const k of EDITABLE_LINE_FIELDS) if (k in s) next[k] = s[k];
    if (next.backordered !== undefined && typeof next.backordered !== "boolean") {
      return { ok: false, error: "invalid_line_edit", message: "A line's backordered mark must be yes or no." };
    }
    const d = next.expected_ready_date;
    if (d !== undefined && d !== null && !isIsoDate(d)) {
      return { ok: false, error: "invalid_line_edit", message: "A line's expected ready date must be a date." };
    }
    const n = next.backorder_notes;
    if (n !== undefined && n !== null && (typeof n !== "string" || n.length > BACKORDER_NOTES_MAX)) {
      return { ok: false, error: "invalid_line_edit", message: `Backorder notes are text of at most ${BACKORDER_NOTES_MAX} characters.` };
    }
    lines.push(next);
  }
  return { ok: true, lines };
}
