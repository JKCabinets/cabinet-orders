import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkRateLimit, cleanInput } from "@/lib/auth";
import { CLAIM_MAX_REQUEST_BYTES, CLAIM_TYPES, checkClaimPhotos, normaliseOrderNumber, storeClaimPhotos } from "@/lib/claimIntake";
import { verifyTurnstile } from "@/lib/turnstile";
import { pushClaims } from "@/lib/claimHelpScout";

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

export async function POST(req: NextRequest) {
  // Per request, because the allowed origin is echoed back -- and on EVERY
  // answer below, or the page cannot read it.
  const CORS = corsFor(req);
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
  if (!await checkRateLimit(req, 10, 60_000, "claims:post")) {
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
  const turnstile = await verifyTurnstile({
    secret: process.env.TURNSTILE_CLAIMS_SECRET_KEY,
    secretName: "TURNSTILE_CLAIMS_SECRET_KEY",
    token: form.get("cf-turnstile-response"),
    req,
    label: "claims",
    expect: { action: "claim", hostnames: STOREFRONT_HOSTS },
  });
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
      screening,
      screening_value: screening === "honeypot" ? honeypotValue || null : null,
      // received_at, status and ref take their database defaults. received_at
      // in particular is now(), set by Postgres, not by anything the client sent.
    })
    .select("id, ref")
    .single();

  if (insertError || !row) {
    return answer({ error: "save_failed", message: "We could not record your claim. Please call us so this is not delayed." }, 500);
  }

  // Scrubbed of location and stored, in lib/claimIntake.
  //
  // ⚠ A FAILED PHOTO NEVER FAILS THE CLAIM. The claim is the thing with a
  // deadline. A missing photo is a phone call; a rejected submission is a
  // lost right to claim. So what failed is not even reported here.
  await storeClaimPhotos(row.id, checked.photos);

  // ⚠ ON TO HELP SCOUT, WITHOUT HOLDING THE CUSTOMER (2026-10-05). Not awaited:
  // the customer's answer must never wait on Help Scout, or fail because of it.
  // This box runs one long-lived Node server, so the send finishes after the
  // response is gone; whatever it does not finish -- a deploy restarting the
  // container mid-send -- the retry job sends within 15 minutes.
  pushClaims({ id: row.id }).catch((e) => console.error(`[helpscout] ${row.ref}: ${(e as Error).message}`));

  /**
   * ⚠ THE REFERENCE IS THE SUBMISSION'S, NOT A CLAIM NUMBER. No warranty row
   * exists yet -- a human creates WAR-1033-1 on promotion. CR-1042 says "we have
   * your report", which is true; a claim number would be a promise not yet made.
   * At most 32 letters, digits and hyphens, as the received page requires.
   */
  return answer({ ref: row.ref }, 201);
}
