import type { NextRequest } from "next/server";

/**
 * Verify a Cloudflare Turnstile token -- the ONE server-side check, for every
 * public form (2026-10-01). It was written inline in the quote webhook on
 * 2026-09-24; the claims endpoint needed the same, and a second copy is how
 * two checks drift apart.
 *
 * ⚠ IT IS THE CONTROL on a public endpoint. A Turnstile token is single-use,
 * short-lived and bound to one widget's secret, so a scripted sender cannot
 * replay one -- and a token solved on another form fails here, because each form
 * has its own widget and its own secret.
 *
 * ⚠ IT FAILS CLOSED, deliberately. A missing secret REFUSES (503) rather than
 * waving submissions through: QUOTE_WEBHOOK_SECRET once sat empty in production
 * behind an `if (secret)` and verified nothing for weeks, invisibly.
 *
 * The answers -- and the page relies on each:
 *   400 turnstile_missing      no token. The only 400 allowed to say "turnstile".
 *   403 turnstile_failed       expired, used, another widget's, or the wrong
 *                              action or hostname. Fetch a fresh token and retry.
 *   503 turnstile_unavailable  our secret is missing, or Cloudflare did not answer.
 *
 * `expect` is optional and only narrows: a caller that passes an action and
 * hostnames also refuses a valid token solved somewhere it should not have been.
 */

export type TurnstileResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 503; body: { error: string; message: string } };

const UNAVAILABLE = { error: "turnstile_unavailable", message: "Verification is unavailable. Please try again shortly." };
const MISSING = { error: "turnstile_missing", message: "Please complete the verification check." };
const FAILED = { error: "turnstile_failed", message: "That verification has expired. Please try again." };

export async function verifyTurnstile(opts: {
  /** The widget's SECRET key, from the environment. */
  secret: string | undefined;
  /** Its environment variable's name, for the log line when it is missing. */
  secretName: string;
  /** What the form sent as cf-turnstile-response. */
  token: unknown;
  req: NextRequest;
  /** Prefixes every log line: "[quote-form] ...". */
  label: string;
  expect?: { action?: string; hostnames?: readonly string[] };
}): Promise<TurnstileResult> {
  const secret = opts.secret ?? "";
  const token = typeof opts.token === "string" ? opts.token.trim() : "";

  if (!secret) {
    console.error(`[${opts.label}] ${opts.secretName} is not set -- refusing submissions`);
    return { ok: false, status: 503, body: UNAVAILABLE };
  }
  if (!token) return { ok: false, status: 400, body: MISSING };

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  // Cloudflare scores the token against the address that solved it. Behind
  // kamal-proxy the socket address is the proxy, so the forwarded header is the
  // only honest answer -- and if it is absent, sending nothing beats sending a
  // wrong one.
  const ip = (opts.req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (ip) form.set("remoteip", ip);

  let outcome: { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] } | null = null;
  try {
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (verify.ok) outcome = await verify.json();
  } catch {
    outcome = null;
  }

  if (outcome === null) {
    // Cloudflare unreachable or slow. Dropping a genuine submission is bad;
    // accepting an unverified one is worse, and the form retries.
    console.error(`[${opts.label}] Turnstile verification unreachable`);
    return { ok: false, status: 503, body: UNAVAILABLE };
  }
  if (!outcome.success) {
    // Expired, already used, or not ours. The form fetches a FRESH token per
    // attempt, so a retry is expected to succeed.
    console.warn(`[${opts.label}] Turnstile rejected: ${(outcome["error-codes"] ?? []).join(",") || "no code"}`);
    return { ok: false, status: 403, body: FAILED };
  }
  const want = opts.expect;
  if (want?.action !== undefined && outcome.action !== want.action) {
    console.warn(`[${opts.label}] Turnstile token for action ${JSON.stringify(outcome.action)}, expected ${JSON.stringify(want.action)}`);
    return { ok: false, status: 403, body: FAILED };
  }
  if (want?.hostnames && !want.hostnames.includes(String(outcome.hostname ?? "").toLowerCase())) {
    console.warn(`[${opts.label}] Turnstile token solved on ${JSON.stringify(outcome.hostname)}, not a storefront host`);
    return { ok: false, status: 403, body: FAILED };
  }
  return { ok: true };
}
