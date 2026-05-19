/**
 * Decode common HTML entities back to their raw characters.
 *
 * Where this is used: the Shopify webhook ingress (`app/api/shopify/webhook`).
 * Shopify occasionally serves text with HTML entities pre-encoded in JSON
 * payloads (e.g. `&amp;` in a line-item name), so we decode at the boundary
 * to normalize everything onto the same convention — raw text in storage,
 * React/escapeHtml at render.
 *
 * Historically this was called everywhere as defensive cover for legacy
 * rows that had been stored under the old `sanitize()` helper (which
 * HTML-encoded on insert). The v11 backfill migration decoded those rows,
 * and the sanitize refactor stopped re-encoding new inserts, so the helper
 * is no longer needed at render sites — only at the Shopify boundary.
 *
 * Covers the entities the old sanitize() introduced and the variants
 * Shopify is known to emit:
 *   &amp;   &   ampersand
 *   &lt;    <   less than
 *   &gt;    >   greater than
 *   &quot;  "   double quote
 *   &#x27;  '   single quote
 *   &#x2F;  /   forward slash
 *   &#x60;  `   backtick
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
