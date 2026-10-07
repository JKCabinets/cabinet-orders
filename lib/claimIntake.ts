import { supabase } from "@/lib/supabase";
import { cleanInput } from "@/lib/auth";
import { SNIFF_BYTES, sniffMagicBytes } from "@/lib/fileValidation";
import { stripImageMetadata } from "@/lib/stripExif";

/**
 * How a claim's photos and order number are taken in -- ONE copy, for the
 * public claim form (/api/public/claims) and for claims staff enter from a
 * customer's email (/api/claim-submissions) (2026-10-06).
 *
 * ⚠ ONE COPY ON PURPOSE. Checking a file by its own bytes and scrubbing its
 * location are security steps; two copies of a security step drift, and the
 * one that drifts is the one nobody is looking at. Moved here word for word
 * from the public route, its answers proven unchanged.
 */

export const CLAIM_MAX_PHOTOS = 6;
export const CLAIM_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * The largest claim REQUEST accepted: six 10 MB photos and the form, with room
 * to spare (2026-10-07). ⚠ MUST EQUAL experimental.proxyClientMaxBodySize in
 * next.config.mjs. Next CUTS OFF a longer body rather than refusing it, so the
 * public route checks Content-Length against this first and answers a clear
 * 413 `photos_too_large_total` instead of an unreadable form.
 */
export const CLAIM_MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_FILENAME_LEN = 200;
const BUCKET = "claim-photos";

/**
 * ⚠ NARROWER THAN PUBLIC_UPLOAD_TYPES. The form's own `accept` is JPEG and PNG,
 * so anything else is a mismatch between what the page promised and what
 * arrived. Accepting more here would mean the bucket's allowed_mime_types
 * rejects it at the storage layer instead, which surfaces as a failed upload
 * rather than a clear message. Staff entering an emailed claim get the same
 * two types, and no PDFs (Garrett, 2026-10-06).
 */
export const CLAIM_PHOTO_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);

export const CLAIM_TYPES: ReadonlySet<string> = new Set([
  "visible", "shortage", "concealed", "defect",
]);

/** Same rule as the attachments and quote-form paths, so all three agree. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.replace(/^\.+/, "_").slice(0, MAX_FILENAME_LEN) || "file";
}

/**
 * Best-effort only. An unrecognisable number is stored raw and left for a
 * human -- see the migration for why this is not a foreign key.
 */
export function normaliseOrderNumber(raw: string): string | null {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/ORDER/g, "").replace(/#/g, "").replace(/\s+/g, "");
  if (!s) return null;
  for (const suffix of ["-CAB", "-HW", "-SMP", "-CST"]) {
    if (s.endsWith(suffix)) { s = s.slice(0, -suffix.length); break; }
  }
  if (/^\d+$/.test(s)) s = `SHO-${s}`;
  return /^[A-Z]{3}-[A-Z0-9-]+$/.test(s) ? s : null;
}

export interface CheckedPhoto { file: File; mime: string }

/**
 * A refusal says which rule, in words, and which file (2026-10-07): the
 * website's page uses `key` and `file` to tell the customer exactly what to
 * fix, and staff read `message`.
 */
export type PhotoCheck =
  | { ok: true; photos: CheckedPhoto[] }
  | { ok: false; status: 413 | 415 | 422; key: "too_many_photos" | "photo_too_large" | "photo_unreadable"; message: string; file?: string };

/**
 * ⚠ TYPE COMES FROM THE FILE'S OWN BYTES, NEVER file.type. The public route is
 * anonymous, so the browser's claim is an attacker's claim. An SVG or HTML
 * file with an embedded script and a chosen MIME would otherwise execute when
 * a staff member opened it through a signed URL.
 */
export async function checkClaimPhotos(files: File[]): Promise<PhotoCheck> {
  if (files.length > CLAIM_MAX_PHOTOS) {
    return { ok: false, status: 422, key: "too_many_photos", message: `Please attach no more than ${CLAIM_MAX_PHOTOS} photos.` };
  }
  const photos: CheckedPhoto[] = [];
  for (const file of files) {
    if (file.size > CLAIM_MAX_PHOTO_BYTES) {
      return { ok: false, status: 413, key: "photo_too_large", message: `"${cleanInput(file.name)}" is larger than 10 MB.`, file: cleanInput(file.name) };
    }
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const mime = sniffMagicBytes(head);
    if (!mime || !CLAIM_PHOTO_TYPES.has(mime)) {
      return { ok: false, status: 415, key: "photo_unreadable", message: `"${cleanInput(file.name)}" is not a JPEG or PNG photo.`, file: cleanInput(file.name) };
    }
    photos.push({ file, mime });
  }
  return { ok: true, photos };
}

/**
 * Stores checked photos under the submission and records their paths on it.
 * Returns the names of any that failed: the public route ignores them (a
 * failed photo never fails a customer's claim -- a missing photo is a phone
 * call); the staff route reports them, because staff can simply try again.
 */
export async function storeClaimPhotos(submissionId: string, photos: CheckedPhoto[]): Promise<{ paths: string[]; failed: string[] }> {
  const paths: string[] = [];
  const failed: string[] = [];
  for (const { file, mime } of photos) {
    const safeName = sanitizeFileName(file.name);
    const path = `${submissionId}/${Date.now()}-${safeName}`;
    // ⚠ METADATA OUT BEFORE IT IS STORED (2026-10-01). These are photographs
    // taken in customers' homes and carry where they were taken. Until this
    // line, claim photos were stored exactly as they arrived. The Orientation
    // survives, so a portrait photo still shows upright.
    const bytes = stripImageMetadata(await file.arrayBuffer(), mime);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        // The sniffed type, never file.type. Validated above, so it is present.
        contentType: mime,
        upsert: false,
      });

    if (uploadError) failed.push(cleanInput(file.name));
    else paths.push(path);
  }

  if (paths.length > 0) {
    await supabase
      .from("claim_submissions")
      .update({ photo_paths: paths })
      .eq("id", submissionId);
  }
  return { paths, failed };
}
