/**
 * Remove metadata segments from an uploaded JPEG.
 *
 * ⚠ WHY. A customer photographs their kitchen on a phone and the file carries
 * the GPS coordinates of their house. The website team raised it on 2026-09-24
 * and they were right: we stored what arrived. Nobody in the OMS needs the
 * camera model, and nobody needs the address twice.
 *
 * ⚠ NO NEW DEPENDENCY, ON PURPOSE. Re-encoding through an image library would
 * pull a native package into the build for one operation, and would change the
 * pixels. This walks the JPEG's own marker structure and drops the metadata
 * segments, leaving the image data untouched byte for byte.
 *
 * Handles: JPEG (APP1/Exif, APP2, and the XMP and comment segments). PNG and
 * PDF are returned unchanged -- a PNG's optional eXIf chunk is rare and a PDF's
 * metadata is not a photograph's location. Anything that is not a JPEG, or any
 * JPEG this cannot parse, comes back exactly as it went in: a file we cannot
 * scrub is still a file we must store, and refusing it would lose the customer's
 * drawing over a metadata question.
 */
const SOI = 0xd8;          // start of image
const SOS = 0xda;          // start of scan -- pixel data follows, stop here
const DROP = new Set([
  0xe1, // APP1 -- Exif, and XMP
  0xe2, // APP2 -- ICC, Flashpix
  0xed, // APP13 -- Photoshop IRB, often carries IPTC location
  0xfe, // COM -- comment
]);

export function stripImageMetadata(input: ArrayBuffer, mime: string): ArrayBuffer {
  if (mime !== "image/jpeg") return input;
  const b = new Uint8Array(input);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) return input;

  const keep: Array<[number, number]> = [[0, 2]]; // the SOI marker itself
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return input;               // not a marker boundary: do not guess
    const marker = b[i + 1];
    if (marker === SOS) { keep.push([i, b.length]); break; }
    const size = (b[i + 2] << 8) | b[i + 3];
    if (size < 2 || i + 2 + size > b.length) return input;
    if (!DROP.has(marker)) keep.push([i, i + 2 + size]);
    i += 2 + size;
  }

  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  if (total === b.length) return input;            // nothing to drop
  const out = new Uint8Array(total);
  let at = 0;
  for (const [s, e] of keep) { out.set(b.subarray(s, e), at); at += e - s; }
  return out.buffer;
}
