/**
 * Decode common HTML entities back to their raw characters.
 *
 * Why this exists: legacy data stored via `sanitize()` was HTML-encoded
 * on write, which means everywhere we render that data as text (React
 * children, PDF templating with auto-escape, plain-text export) ends
 * up double-escaping. This decoder lets us paper over that until we
 * can move sanitize() to render-time-only.
 *
 * Covers the entities sanitize() introduces:
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
