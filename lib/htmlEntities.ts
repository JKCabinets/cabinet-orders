/**
 * Decode common HTML entities back to their raw characters.
 *
 * Why this exists: legacy rows stored under the old `sanitize()` helper
 * (which HTML-encoded everything on insert) have entity-encoded text in
 * the DB. Post-refactor inserts go in raw — but until the one-time backfill
 * SQL has run against your DB, you'll have a mix of legacy-encoded and raw
 * rows. This decoder bridges that: it's a no-op on raw strings, and on
 * legacy rows it restores readable characters.
 *
 * Once the backfill has run, every render site can drop the decode call —
 * it'll be a true no-op everywhere. Until then, keep the calls in place.
 *
 * Covers the entities the old sanitize() introduced:
 *   &amp;   &   ampersand
 *   &lt;    <   less than
 *   &gt;    >   greater than
 *   &quot;  "   double quote
 *   &#x27;  '   single quote
 *   &#x2F;  /   forward slash
 *   &#x60;  `   backtick
 *
 * Plus a few common numeric-entity forms that show up in Shopify data
 * (Shopify itself encodes a handful before serving its REST API).
 *
 * Safe to call on already-decoded strings — it's a no-op.
 */
export function decodeHtmlEntities(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  if (typeof input !== "string") return String(input);

  // Order matters: decode &amp; LAST so we don't double-decode a string
  // like "&amp;lt;" (which means a literal "&lt;", not "<").
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#96;/g, "`")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
