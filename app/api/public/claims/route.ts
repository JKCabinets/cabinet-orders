import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit, cleanInput } from "@/lib/auth";
import { CLAIM_MAX_REQUEST_BYTES, CLAIM_TYPES, checkClaimPhotos, normaliseOrderNumber, sanitizeFileName, storeClaimPhotos, type CheckedPhoto } from "@/lib/claimIntake";
import { verifyTurnstile } from "@/lib/turnstile";
import { pushClaims } from "@/lib/claimHelpScout";
import { TIMED_OUT, afterAnswer, requestBudget } from "@/lib/publicForms";

/**
 * POST /api/public/claims — the warranty claim form on /pages/warranty-claims.
 *
 * ⚠ THE CONTRACT IS THE WEBSITE'S NOTE OF 2026-10-01 ("website-to-oms open items",
 * section 1). Multipart, because it carries photographs, sent IN THE BACKGROUND
 * by the page's script -- so the page never loses what the customer typed -- and
 * the page reads this route's answer. Hence, unlike the route this replaced:
 *
 *   - CORS on EVERY answer, for both storefront hosts. Without it the page
 *     cannot read the reference, or tell a missing token from anything else.
 *   - 201 with JSON {"ref": "CR-1042"}, not a redirect. The page goes to its
 *     own received page with that reference.
 *   - Cloudflare Turnstile, on the CLAIMS widget's own secret. A token solved on
 *     the quote form fails here, as the website asked.
 *
 * The page acts on exactly these, so no other path may return them:
 *   400 turnstile_missing   (the page looks for the word "turnstile" in a 400)
 *   403 turnstile_failed    (ANY 403 counts as a failed check on the page)
 *   429                     wait and retry
 *   503 turnstile_unavailable  the page retries once with a fresh token
 * Anything else -- a 422, 413, 415, 500 -- shows the customer the email route.
 *
 * ⚠ FEATURE 12 (2026-11-04; SESSION-HANDOFF-2026-11-03.md §7.3, lib/publicForms).
 * The answer comes once the claim is SAVED, inside one time budget well under
 * the gateway's 30 s; the photos and the Help Scout send follow it. Two
 * answers are new, both of which the website's page already handles (their
 * note of 2026-11-04):
 *   201 {"ref", "duplicate": true}  a submission_id already saved: the SAME claim,
 *                                   answered with its reference, nothing saved again
 *   503 try_again                   the save itself ran too long; the page retries
 *                                   once, with the same submission_id -- safe
 * And every answer carries CORS: anything unexpected is caught, logged and
 * answered 500 save_failed, never Next's bare error.
 *
 * ⚠ THIS WRITES. Everything below is shaped by that. The lookup could fail
 * closed on any doubt because a refused read costs a customer nothing. A
 * refused claim costs them their claim: Terms 12.3 makes the reporting windows
 * conditions precedent, and visible damage has 48 hours from delivery. So this
 * route accepts nearly everything and resolves nothing -- a human promotes it.
 * The one exception is Turnstile, which fails closed: and when it does, the page
 * shows the customer the email route, and an email inside the window counts as
 * the report (the Refund Policy and the Terms say so). So the claim is not lost.
 *
 * ⚠ RUNS AS THE SERVICE ROLE, like every route on this box. The `public_api`
 * role intended to be the real boundary does not exist. The column list on the
 * insert below is therefore a security control, not a convenience.
 */

const MAX_FIELD_LEN = 200;
const MAX_MESSAGE_LEN = 1000;
const MIN_ELAPSED_MS = 2_000;

// The photo limits, the claim types, the photo check and store, and the order
// number's normalising live in lib/claimIntake (2026-10-06): one copy, shared
// with claims staff enter from a customer's email.

/**
 * The storefront: who may read these answers, and where a claims token may
 * have been solved. One list for both, so they cannot disagree.
 */
const STOREFRONT_HOSTS = ["jkcabinets2you.com", "www.jkcabinets2you.com"] as const;
const ALLOWED_ORIGINS = STOREFRONT_HOSTS.map((h) => `https://${h}`);

/**
 * No Allow-Credentials: the endpoint authenticates on the body, not a cookie.
 * The page sends no custom headers, so the request needs no preflight -- the
 * OPTIONS answer below is for any browser that sends one anyway.
 */
function corsFor(req: NextRequest): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const origin = (req.headers.get("origin") ?? "").toLowerCase();
  if ((ALLOWED_ORIGINS as readonly string[]).includes(origin)) base["Access-Control-Allow-Origin"] = origin;
  return base;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsFor(req) });
}

function field(form: FormData, key: string, max = MAX_FIELD_LEN): string {
  const v = form.get(key);
  return typeof v === "string" ? cleanInput(v.slice(0, max)) : "";
}

const SAVE_FAILED = { error: "save_failed", message: "We could not record your claim. Please call us so this is not delayed." };
const TRY_AGAIN = { error: "try_again", message: "This is taking longer than it should. Please try again in a moment." };

/** The whole handler, under a catch that still answers with CORS (feature 12). */
export async function POST(req: NextRequest) {
  try {
    return await handleClaim(req);
  } catch (e) {
    console.error(`[claims] unexpected: ${(e as Error)?.message ?? String(e)}`);
    return NextResponse.json(SAVE_FAILED, { status: 500, headers: corsFor(req) });
  }
}

/**
 * After the answer (feature 12): the photos, every attempt; then the hold on
 * Help Scout released and the claim sent on. Saved HOLDING its own lease, the
 * claim cannot be sent by the retry job before its photos are settled; if the
 * server restarts first, the lease expires in ten minutes and the retry job
 * sends it, the note naming the photos that never arrived.
 */
async function settleClaim(id: string, ref: string, photos: CheckedPhoto[]): Promise<void> {
  if (photos.length > 0) {
    const { failed } = await storeClaimPhotos(id, photos, { attempts: 3 });
    if (failed.length > 0) console.error(`[claims] ${ref}: ${failed.length} photo(s) not stored after every attempt`);
  }
  const { error } = await supabase.from("claim_submissions")
    .update({ helpscout_leased_at: null }).eq("id", id).eq("helpscout_state", "pending");
  if (error) console.error(`[claims] ${ref}: the Help Scout hold not released (${error.message}); the retry job sends it within 25 minutes`);
  await pushClaims({ id });
}

async function handleClaim(req: NextRequest): Promise<NextResponse> {
  // Per request, because the allowed origin is echoed back -- and on EVERY
  // answer below, or the page cannot read it.
  const CORS = corsFor(req);
  // ⚠ ONE BUDGET FOR EVERYTHING BEFORE THE ANSWER (feature 12): each step is
  // capped, and the sum stays well under the gateway's 30 s.
  const budget = requestBudget(20_000);
  const answer = (body: unknown, status: number, extra?: Record<string, string>) =>
    NextResponse.json(body, { status, headers: { ...CORS, ...extra } });

  /**
   * ⚠ FAILS OPEN, UNLIKE THE LOOKUP, AND THE DIFFERENCE IS DELIBERATE.
   *
   * On the lookup, failing open during a Redis outage turns a read endpoint
   * into an unthrottled order-number oracle -- so it fails closed.
   *
   * Here, failing closed would refuse a customer's claim during an outage they
   * cannot see, inside a window that decides whether the claim is valid at
   * all. Spam is recoverable; a missed 48-hour deadline is not. Turnstile, now
   * in front, is what stops a script.
   */
  // Capped too: an Upstash that does not answer in time lets the claim through,
  // the way its failure already does (above).
  if (await budget.within(checkRateLimit(req, 10, 60_000, "claims:post"), 4_000) === false) {
    return answer({ error: "rate_limited", message: "Too many submissions. Please wait a minute and try again." }, 429, { "Retry-After": "60" });
  }

  // ⚠ TOO LARGE IS REFUSED HERE, CLEARLY, BEFORE IT IS READ (2026-10-07). Next
  // cuts a body longer than its proxy buffer off instead of refusing it, and a
  // cut-off form only reads as "unreadable" -- which is what a customer with a
  // 15 MB claim was told, until the buffer was raised to match this limit.
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > CLAIM_MAX_REQUEST_BYTES) {
    return answer({
      error: "photos_too_large_total",
      message: `This claim is larger than ${CLAIM_MAX_REQUEST_BYTES / (1024 * 1024)} MB. Photos may be up to 10 MB each, six at most.`,
    }, 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // ⚠ NO "turnstile" IN THIS 400. The page reads that word as "no token".
    return answer({ error: "form_unreadable", message: "We could not read this submission." }, 400);
  }

  // ── Cloudflare Turnstile, FIRST ──────────────────────────────────────────
  //
  // Before the spam checks, before any validation, any upload and any row: a
  // submission that cannot prove itself never touches storage or the database.
  // The claims widget's OWN secret, its action ("claim", set by the page) and
  // the storefront's hostnames -- a token solved anywhere else is refused.
  const turnstile = await budget.within(verifyTurnstile({
    secret: process.env.TURNSTILE_CLAIMS_SECRET_KEY,
    secretName: "TURNSTILE_CLAIMS_SECRET_KEY",
    token: form.get("cf-turnstile-response"),
    req,
    label: "claims",
    expect: { action: "claim", hostnames: STOREFRONT_HOSTS },
  }), 9_000);
  // Its own fetch is capped at 8 s; past the budget it is "unavailable", which
  // the page retries with a fresh token.
  if (turnstile === TIMED_OUT) return answer({ error: "turnstile_unavailable", message: "Verification is unavailable. Please try again shortly." }, 503);
  if (!turnstile.ok) return answer(turnstile.body, turnstile.status);

  /**
   * ⚠ THE SPAM CHECKS FLAG; THEY NO LONGER DROP (Garrett, 2026-10-01).
   *
   * They used to answer a successful-looking redirect and store nothing. But
   * some browsers autofill a field named "website" despite autocomplete="off",
   * and a customer told "received" whose claim was thrown away has lost their
   * reporting window -- the outcome this route exists to prevent. Turnstile now
   * runs first, so whatever reaches here has proven itself to Cloudflare. It is
   * kept, at `new` like any other, with `screening` telling staff to look twice.
   *
   * The field names match the quote form's exactly -- `website` and
   * `elapsed_ms`, renamed by the website team from company_website /
   * form_loaded_at on 2026-09-01 for that reason.
   */
  const honeypot = form.get("website");
  // ⚠ WHAT IT CONTAINED, TOO (2026-10-05). CR-1003, the first genuine claim from
  // the live page, was flagged here because Chrome's autofill filled this field.
  // A flag that says only "filled" cannot tell an autofilled company name from a
  // bot's junk; the first 100 characters can.
  const honeypotValue = typeof honeypot === "string" ? cleanInput(honeypot.slice(0, 100)) : "";
  const elapsed = Number(form.get("elapsed_ms"));
  const screening: "honeypot" | "too_fast" | null =
    typeof honeypot === "string" && honeypot.trim() !== "" ? "honeypot"
    : Number.isFinite(elapsed) && elapsed > 0 && elapsed < MIN_ELAPSED_MS ? "too_fast"
    : null;

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
  // The first field missing is named, so the page can point at it (2026-10-07).
  const missing = !orderNumberRaw ? "order_number" : !name ? "name" : !email ? "email"
    : !CLAIM_TYPES.has(claimType) ? "claim_type" : null;
  if (missing) {
    return answer({
      error: "field_invalid", field: missing,
      message: "Please give your order number, your name, your email and the type of claim.",
    }, 422);
  }

  // Date-only, and only if it is one. A malformed date is dropped rather than
  // rejecting the claim around it.
  const deliveredOn = /^\d{4}-\d{2}-\d{2}$/.test(deliveredOnRaw) ? deliveredOnRaw : null;

  // ── Photos ───────────────────────────────────────────────────────────────
  //
  // Checked by their own bytes -- never file.type, since this endpoint is
  // anonymous -- in lib/claimIntake, before anything is written.
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const checked = await checkClaimPhotos(files);
  if (!checked.ok) {
    return answer({ error: checked.key, message: checked.message, ...(checked.file ? { file: checked.file } : {}) }, checked.status);
  }

  // ── A repeat is the same claim (feature 12) ──────────────────────────────
  //
  // The form's own id for ONE submission, the same on every resubmit until one
  // succeeds. Already saved: answered with its reference, nothing saved again.
  // The unique index decides a race (below); this is the quick answer.
  const submissionId = field(form, "submission_id", 100) || null;
  const existingRef = async (): Promise<string | null> => {
    if (!submissionId) return null;
    const found = await budget.within(
      supabase.from("claim_submissions").select("ref").eq("submission_id", submissionId).maybeSingle(), 5_000);
    return found === TIMED_OUT ? null : ((found.data as { ref?: string } | null)?.ref ?? null);
  };
  const prior = await existingRef();
  if (prior) return answer({ ref: prior, duplicate: true }, 201);

  // ── The row first, then the photos ───────────────────────────────────────
  //
  // ⚠ ORDER MATTERS. If the row is written first and an upload then fails, the
  // claim still exists and a human can ask for the photos again. The other way
  // round leaves orphaned images in a bucket with nothing pointing at them and
  // no record that anybody claimed anything.
  //
  // ⚠ THE PHOTOS NOW FOLLOW THE ANSWER (feature 12), started the moment the row
  // lands -- even if that is after this request has stopped waiting for it, so
  // a save the page retries still gets its photos. The claim is saved holding
  // its own Help Scout lease (settleClaim), with the names of the photos sent.
  const saving = Promise.resolve(supabase
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
      screening,
      screening_value: screening === "honeypot" ? honeypotValue || null : null,
      submission_id:   submissionId,
      photos_sent:     checked.photos.map((p) => sanitizeFileName(p.file.name)),
      // Held from the retry job until settleClaim has stored the photos.
      helpscout_leased_at: new Date().toISOString(),
      // received_at, status and ref take their database defaults. received_at
      // in particular is now(), set by Postgres, not by anything the client sent.
    })
    .select("id, ref")
    .single());
  // Scrubbed of location and stored, in lib/claimIntake -- after the answer.
  // ⚠ A FAILED PHOTO NEVER FAILS THE CLAIM. The claim is the thing with a
  // deadline. A missing photo is a phone call; a rejected submission is a lost
  // right to claim. ⚠ ON TO HELP SCOUT, WITHOUT HOLDING THE CUSTOMER
  // (2026-10-05): the send follows the photos, after the answer.
  saving.then(({ data }) => {
    const saved = data as { id: string; ref: string } | null;
    if (saved) afterAnswer(`claims ${saved.ref}`, () => settleClaim(saved.id, saved.ref, checked.photos));
  }, () => {});

  const result = await budget.within(saving, 8_000);
  if (result === TIMED_OUT) return answer(TRY_AGAIN, 503);
  const { data: row, error: insertError } = result as { data: { id: string; ref: string } | null; error: { code?: string; message: string } | null };
  // ⚠ A RACE IS A REPEAT TOO: twenty at once, one row -- the unique index lets
  // one save, and the others answer with its reference.
  if (insertError?.code === "23505" && submissionId) {
    const winner = await existingRef();
    return winner ? answer({ ref: winner, duplicate: true }, 201) : answer(TRY_AGAIN, 503);
  }
  if (insertError || !row) return answer(SAVE_FAILED, 500);

  /**
   * ⚠ THE REFERENCE IS THE SUBMISSION'S, NOT A CLAIM NUMBER. No warranty row
   * exists yet -- a human creates WAR-1033-1 on promotion. CR-1042 says "we have
   * your report", which is true; a claim number would be a promise not yet made.
   * At most 32 letters, digits and hyphens, as the received page requires.
   */
  return answer({ ref: row.ref }, 201);
}
