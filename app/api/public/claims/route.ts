import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit, cleanInput } from "@/lib/auth";
import { SNIFF_BYTES, sniffMagicBytes } from "@/lib/fileValidation";

/**
 * POST /api/public/claims — the warranty claim form on /pages/warranty-claims.
 *
 * Multipart, because it carries photographs. Unlike the lookup, the page posts
 * a plain form and takes a redirect, so THERE IS NO CORS HERE and none is
 * needed: the browser never reads the response.
 *
 * ⚠ THIS WRITES. Everything below is shaped by that. The lookup could fail
 * closed on any doubt because a refused read costs a customer nothing. A
 * refused claim costs them their claim: Terms 12.3 makes the reporting windows
 * conditions precedent, and visible damage has 48 hours from delivery. So this
 * route accepts nearly everything and resolves nothing -- a human promotes it.
 *
 * ⚠ RUNS AS THE SERVICE ROLE, like every route on this box. The `public_api`
 * role intended to be the real boundary does not exist. The column list on the
 * insert below is therefore a security control, not a convenience.
 */

const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FIELD_LEN = 200;
const MAX_MESSAGE_LEN = 1000;
const MAX_FILENAME_LEN = 200;
const MIN_ELAPSED_MS = 2_000;

const BUCKET = "claim-photos";

/**
 * ⚠ NARROWER THAN PUBLIC_UPLOAD_TYPES. The form's own `accept` is JPEG and PNG,
 * so anything else is a mismatch between what the page promised and what
 * arrived. Accepting more here would mean the bucket's allowed_mime_types
 * rejects it at the storage layer instead, which surfaces as a failed upload
 * rather than a clear message.
 */
const CLAIM_PHOTO_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);

const CLAIM_TYPES: ReadonlySet<string> = new Set([
  "visible", "shortage", "concealed", "defect",
]);

const RECEIVED_URL = "https://www.jkcabinets2you.com/pages/claim-received";

/**
 * ⚠ 303, NOT 302. A 303 tells the browser to follow with GET; a 302 after a
 * POST is handled inconsistently and can re-submit the form.
 */
function redirect(ref?: string): NextResponse {
  const url = ref ? `${RECEIVED_URL}?ref=${encodeURIComponent(ref)}` : RECEIVED_URL;
  return NextResponse.redirect(url, 303);
}

/** Same rule as the attachments and quote-form paths, so all three agree. */
function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.replace(/^\.+/, "_").slice(0, MAX_FILENAME_LEN) || "file";
}

/**
 * Best-effort only. An unrecognisable number is stored raw and left for a
 * human -- see the migration for why this is not a foreign key.
 */
function normaliseOrderNumber(raw: string): string | null {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/ORDER/g, "").replace(/#/g, "").replace(/\s+/g, "");
  if (!s) return null;
  for (const suffix of ["-CAB", "-HW", "-SMP", "-CST"]) {
    if (s.endsWith(suffix)) { s = s.slice(0, -suffix.length); break; }
  }
  if (/^\d+$/.test(s)) s = `SHO-${s}`;
  return /^[A-Z]{3}-[A-Z0-9-]+$/.test(s) ? s : null;
}

function field(form: FormData, key: string, max = MAX_FIELD_LEN): string {
  const v = form.get(key);
  return typeof v === "string" ? cleanInput(v.slice(0, max)) : "";
}

export async function POST(req: NextRequest) {
  /**
   * ⚠ FAILS OPEN, UNLIKE THE LOOKUP, AND THE DIFFERENCE IS DELIBERATE.
   *
   * On the lookup, failing open during a Redis outage turns a read endpoint
   * into an unthrottled order-number oracle -- so it fails closed.
   *
   * Here, failing closed would refuse a customer's claim during an outage they
   * cannot see, inside a window that decides whether the claim is valid at
   * all. Spam is recoverable; a missed 48-hour deadline is not.
   */
  if (!await checkRateLimit(req, 10, 60_000, "claims:post")) {
    return NextResponse.json(
      { error: "Too many submissions. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission" }, { status: 400 });
  }

  /**
   * ⚠ BOTS GET A SUCCESSFUL-LOOKING REDIRECT AND NO DATABASE ROW.
   *
   * Telling a bot it was detected tells whoever wrote it what to change. The
   * same page a real customer sees, and nothing stored.
   *
   * Both signals are client-supplied and are friction rather than controls.
   * The field names match the quote-form handler exactly -- the website team
   * renamed them from company_website/form_loaded_at on 2026-09-01 for that
   * reason, and under the old names this check would have found nothing and
   * silently passed every submission.
   */
  const honeypot = form.get("website");
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return redirect();
  }
  const elapsed = Number(form.get("elapsed_ms"));
  if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < MIN_ELAPSED_MS) {
    return redirect();
  }

  // ── Fields ───────────────────────────────────────────────────────────────
  const orderNumberRaw = field(form, "order_number");
  const claimType      = field(form, "claim_type", 32).toLowerCase();
  const name           = field(form, "name");
  const email          = field(form, "email");
  const phone          = field(form, "phone");
  const message        = field(form, "message", MAX_MESSAGE_LEN);
  const policyVersion  = field(form, "policy_version", 64);
  const deliveredOnRaw = field(form, "delivered_on", 32);

  /**
   * ⚠ THE MINIMUM THAT MAKES A CLAIM ACTIONABLE, AND NOTHING MORE. Every
   * additional required field is another way to lose a real claim. If we
   * cannot reach them and cannot tell what they are claiming, a human has
   * nothing to work with; everything else can be chased.
   */
  if (!orderNumberRaw || !name || !email || !CLAIM_TYPES.has(claimType)) {
    return NextResponse.json(
      { error: "Please give your order number, your name, your email and the type of claim." },
      { status: 422 },
    );
  }

  // Date-only, and only if it is one. A malformed date is dropped rather than
  // rejecting the claim around it.
  const deliveredOn = /^\d{4}-\d{2}-\d{2}$/.test(deliveredOnRaw) ? deliveredOnRaw : null;

  // ── Photos ───────────────────────────────────────────────────────────────
  //
  // ⚠ TYPE COMES FROM THE FILE'S OWN BYTES, NEVER file.type. This endpoint is
  // anonymous, so the browser's claim is an attacker's claim. An SVG or HTML
  // file with an embedded script and a chosen MIME would otherwise execute
  // when a staff member opened it through a signed URL.
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Please attach no more than ${MAX_FILES} photos.` },
      { status: 422 },
    );
  }

  const sniffed = new Map<File, string>();
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `"${cleanInput(file.name)}" is larger than 10 MB.` },
        { status: 413 },
      );
    }
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const mime = sniffMagicBytes(head);
    if (!mime || !CLAIM_PHOTO_TYPES.has(mime)) {
      return NextResponse.json(
        { error: `"${cleanInput(file.name)}" is not a JPEG or PNG photo.` },
        { status: 415 },
      );
    }
    sniffed.set(file, mime);
  }

  // ── The row first, then the photos ───────────────────────────────────────
  //
  // ⚠ ORDER MATTERS. If the row is written first and an upload then fails, the
  // claim still exists and a human can ask for the photos again. The other way
  // round leaves orphaned images in a bucket with nothing pointing at them and
  // no record that anybody claimed anything.
  const { data: row, error: insertError } = await supabase
    .from("claim_submissions")
    .insert({
      order_number_raw: orderNumberRaw,
      order_number:     normaliseOrderNumber(orderNumberRaw),
      delivered_on:     deliveredOn,
      claim_type:       claimType,
      claimant_name:    name,
      claimant_email:   email,
      claimant_phone:   phone || null,
      message:          message || null,
      policy_version:   policyVersion || null,
      // received_at and status take their database defaults. received_at in
      // particular is now(), set by Postgres, not by anything the client sent.
    })
    .select("id")
    .single();

  if (insertError || !row) {
    return NextResponse.json(
      { error: "We could not record your claim. Please call us so this is not delayed." },
      { status: 500 },
    );
  }

  const paths: string[] = [];
  for (const file of files) {
    const safeName = sanitizeFileName(file.name);
    const path = `${row.id}/${Date.now()}-${safeName}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, {
        // The sniffed type, never file.type. Validated above, so it is present.
        contentType: sniffed.get(file) ?? "application/octet-stream",
        upsert: false,
      });

    // ⚠ A FAILED PHOTO NEVER FAILS THE CLAIM. The claim is the thing with a
    // deadline. A missing photo is a phone call; a rejected submission is a
    // lost right to claim.
    if (!uploadError) paths.push(path);
  }

  if (paths.length > 0) {
    await supabase
      .from("claim_submissions")
      .update({ photo_paths: paths })
      .eq("id", row.id);
  }

  /**
   * ⚠ THE REFERENCE IS THE SUBMISSION ID, NOT A CLAIM NUMBER. No warranty row
   * exists yet -- a human creates WAR-1033-1 on promotion. Handing the
   * customer a number that looks like a claim reference before the claim has
   * been accepted would be a promise we have not made.
   */
  return redirect(row.id);
}
