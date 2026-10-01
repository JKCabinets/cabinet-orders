/**
 * Remove metadata from an uploaded JPEG or PNG.
 *
 * ⚠ WHY. A customer photographs their kitchen, or the damage to a cabinet, on a
 * phone and the file carries the GPS coordinates of their house. The website
 * team raised it on 2026-09-24 and they were right: we stored what arrived.
 * Nobody in the OMS needs the camera model, and nobody needs the address twice.
 *
 * ⚠ NO NEW DEPENDENCY, ON PURPOSE. Re-encoding through an image library would
 * pull a native package into the build for one operation, and would change the
 * pixels. This walks each format's own structure and drops the metadata,
 * leaving the image data untouched byte for byte.
 *
 * JPEG: APP1 (Exif, XMP), APP2 (ICC, Flashpix), APP13 (Photoshop IRB, often IPTC
 * location) and COM are dropped -- EXCEPT ONE FACT.
 *
 * ⚠ THE ORIENTATION IS KEPT (2026-10-01). Many phones store a portrait photo's
 * pixels sideways and say "rotate 90°" in the Exif Orientation tag, which every
 * current browser obeys. Dropping the whole Exif segment, as this did from
 * 2026-09-24, dropped that tag with it, and those photos then displayed on their
 * side. Proven against this function that day. So the Exif segment is replaced
 * by a minimal one carrying the Orientation and nothing else -- no position, no
 * date, no device.
 *
 * ⚠ THE COLOUR PROFILE GOES WITH APP2. A photo from a wide-gamut phone may look
 * slightly less saturated. Kept that way on purpose: it is a photograph of a
 * cabinet, and APP2 is also where Flashpix data lives.
 *
 * PNG (2026-10-01): eXIf (Exif, GPS included), tEXt / zTXt / iTXt (free text --
 * XMP lives in iTXt) and tIME are dropped; everything that affects how the
 * image looks is kept, and anything after IEND is cut. Until 2026-10-01 a PNG
 * went through untouched, GPS included -- proven that day. A PNG's Orientation
 * lives in eXIf too and goes with it; phones take photos as JPEG or HEIC, and a
 * screenshot has no orientation to lose.
 *
 * Anything else, and any file this cannot parse, comes back exactly as it went
 * in: a file we cannot scrub is still a file we must store, and refusing it would
 * lose the customer's photo over a metadata question.
 */

export function stripImageMetadata(input: ArrayBuffer, mime: string): ArrayBuffer {
  if (mime === "image/jpeg") return stripJpeg(input);
  if (mime === "image/png") return stripPng(input);
  return input;
}

// ── JPEG ───────────────────────────────────────────────────────────────────

const SOI = 0xd8;          // start of image
const SOS = 0xda;          // start of scan -- pixel data follows, stop here
const APP1 = 0xe1;
const DROP = new Set([
  APP1, // Exif, and XMP -- an Exif segment is replaced, see orientationSegment
  0xe2, // APP2 -- ICC, Flashpix
  0xed, // APP13 -- Photoshop IRB, often carries IPTC location
  0xfe, // COM -- comment
]);

function stripJpeg(input: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(input);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return input;

  const parts: Uint8Array[] = [b.subarray(0, 2)]; // the SOI marker itself
  let changed = false;
  let orientationWritten = false;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return input;               // not a marker boundary: do not guess
    const marker = b[i + 1];
    if (marker === SOS) { parts.push(b.subarray(i)); break; }
    const size = (b[i + 2] << 8) | b[i + 3];
    if (size < 2 || i + 2 + size > b.length) return input;
    const segment = b.subarray(i, i + 2 + size);
    if (!DROP.has(marker)) {
      parts.push(segment);
    } else {
      changed = true;
      // The first Exif segment's Orientation, if it says to rotate, survives
      // in a segment of its own, where the Exif segment was.
      if (marker === APP1 && !orientationWritten) {
        const o = exifOrientation(b.subarray(i + 4, i + 2 + size));
        if (o !== null && o !== 1) { parts.push(orientationSegment(o)); orientationWritten = true; }
      }
    }
    i += 2 + size;
  }
  if (!changed) return input;                      // nothing to drop

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

/** The Orientation (1-8) in an APP1 payload, or null if it is not Exif or has none. */
function exifOrientation(p: Uint8Array): number | null {
  // "Exif\0\0", then a TIFF header.
  if (p.length < 14 || p[0] !== 0x45 || p[1] !== 0x78 || p[2] !== 0x69 || p[3] !== 0x66 || p[4] !== 0 || p[5] !== 0) return null;
  const t = p.subarray(6);
  const little = t[0] === 0x49 && t[1] === 0x49;
  if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o: number) => (little ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (little
    ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0
    : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {   // Orientation, SHORT
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A complete APP1 Exif segment holding one tag: Orientation. Big-endian TIFF. */
function orientationSegment(orientation: number): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,  // "MM", 42, IFD0 at offset 8
    0x00, 0x01,                                      // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,  // Orientation, SHORT, count 1
    0x00, orientation, 0x00, 0x00,                   // its value, left-justified
    0x00, 0x00, 0x00, 0x00,                          // no next IFD
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const length = payload.length + 2;
  return new Uint8Array([0xff, APP1, length >> 8, length & 0xff, ...payload]);
}

// ── PNG ────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(input: ArrayBuffer): ArrayBuffer {
  const b = new Uint8Array(input);
  if (b.length < 8 || PNG_SIGNATURE.some((v, k) => b[k] !== v)) return input;

  const keep: Array<[number, number]> = [[0, 8]];
  let i = 8;
  let ended = false;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const end = i + 12 + len;                      // length, type, data, CRC
    if (end > b.length) return input;              // truncated chunk: do not guess
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (!PNG_DROP.has(type)) keep.push([i, end]);
    i = end;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended) return input;                        // no IEND: not a PNG we understand

  // Anything after IEND is not part of the image, and is where things get hidden.
  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  if (total === b.length) return input;            // nothing to drop
  const out = new Uint8Array(total);
  let at = 0;
  for (const [s, e] of keep) { out.set(b.subarray(s, e), at); at += e - s; }
  return out.buffer;
}
