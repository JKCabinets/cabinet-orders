/**
 * File upload validation — magic bytes, not the Content-Type header.
 *
 * WHY THIS EXISTS
 *   Both upload paths previously trusted `file.type`, which is whatever the
 *   browser (or a script) claims. That value was stored as the object's
 *   content type in Supabase Storage AND persisted to order_attachments.
 *   file_type.
 *
 *   The concrete risk: an SVG or HTML file with an embedded script, uploaded
 *   with an attacker-chosen MIME, later opened by a staff member through a
 *   signed URL and executing in their browser session. The public quote form
 *   is anonymous, so that path needs no credentials at all.
 *
 * THE RULE
 *   Derive the content type from the file's own bytes. If we cannot identify
 *   it, do not guess and do not fall back to the client's claim -- store
 *   application/octet-stream, which browsers download rather than render.
 *
 * SCOPE
 *   Public uploads (the quote form) are restricted to photographs and PDFs and
 *   are REJECTED otherwise. Staff uploads legitimately include spreadsheets and
 *   documents, so they are not restricted -- but a dangerous type is never
 *   stored with a renderable content type.
 */

/** Bytes we need to identify every format below. */
export const SNIFF_BYTES = 32;

interface Signature {
  mime: string;
  /** Byte values; null means "any byte at this position". */
  bytes: (number | null)[];
  offset?: number;
  /** Extra check for container formats that share a prefix. */
  extra?: (buf: Uint8Array) => boolean;
}

const ASCII = (s: string): number[] => Array.from(s, c => c.charCodeAt(0));

const SIGNATURES: Signature[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/gif", bytes: ASCII("GIF8") },
  { mime: "application/pdf", bytes: ASCII("%PDF") },
  {
    // RIFF....WEBP — the four size bytes in between are variable.
    mime: "image/webp",
    bytes: ASCII("RIFF"),
    extra: buf => String.fromCharCode(...buf.slice(8, 12)) === "WEBP",
  },
  {
    // ISO-BMFF: "ftyp" at offset 4, then a brand. Covers HEIC and HEIF.
    mime: "image/heic",
    bytes: ASCII("ftyp"),
    offset: 4,
    extra: buf => ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"]
      .includes(String.fromCharCode(...buf.slice(8, 12))),
  },
  // Office Open XML (xlsx, docx) and every other zip container.
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  // Legacy OLE compound file (xls, doc).
  { mime: "application/x-ole-storage", bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

/**
 * Identify a file from its leading bytes.
 *
 * Returns null when nothing matches. Plain text and CSV have no signature, so
 * they always return null -- callers that accept text must decide what to do
 * with that rather than relying on this.
 */
export function sniffMagicBytes(buf: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    const at = sig.offset ?? 0;
    if (buf.length < at + sig.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const expected = sig.bytes[i];
      if (expected !== null && buf[at + i] !== expected) { matched = false; break; }
    }
    if (!matched) continue;
    if (sig.extra && !sig.extra(buf)) continue;
    return sig.mime;
  }
  return null;
}

/**
 * What the PUBLIC quote form accepts: a photograph of a kitchen, or a PDF.
 * Anything else is rejected outright rather than stored defensively.
 */
export const PUBLIC_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/** Human-readable list for error messages, so the customer knows what to do. */
export const PUBLIC_UPLOAD_LABEL = "JPEG, PNG, GIF, WEBP, HEIC or PDF";

/**
 * Types that execute when a browser renders them. Never stored or served with
 * their claimed content type, whoever uploaded them.
 *
 * Checked against BOTH the filename and the claimed type, because either alone
 * can be manipulated.
 */
const DANGEROUS_MIME = /^(image\/svg|text\/html|application\/xhtml|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;
const DANGEROUS_EXT = /\.(svgz?|x?html?|xml|m?js|jsx?|vbs|hta)$/i;

export function isDangerousUpload(fileName: string, claimedType: string): boolean {
  return DANGEROUS_MIME.test(claimedType) || DANGEROUS_EXT.test(fileName);
}

/**
 * The content type it is actually safe to store an object with.
 *
 * Precedence: the sniffed type wins; a dangerous filename or claim forces
 * octet-stream; anything unidentified becomes octet-stream. The client's
 * claim is never used directly.
 */
export function safeContentType(
  sniffed: string | null,
  fileName: string,
  claimedType: string,
): string {
  if (isDangerousUpload(fileName, claimedType)) return "application/octet-stream";
  return sniffed ?? "application/octet-stream";
}
