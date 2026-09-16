import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export type AuthSession = {
  user: {
    /**
     * The team_members.id (immutable surrogate key). Use this for any
     * ownership write (claimed_by, entered_by) or permission check
     * that needs to survive username / display-name changes.
     */
    id: string;
    name?: string | null;
    email?: string | null;
    role: "admin" | "member";
    /**
     * Login string. May be changed by admins.
     */
    username: string;
  };
};

export async function requireAuth(): Promise<{ session: AuthSession } | NextResponse> {
  const session = (await getServerSession(authOptions)) as AuthSession | null;
  // A session object may exist but lack `.user` if the JWT callback
  // marked the token invalidated (role change, deactivation, hard
  // delete — see lib/authOptions.ts session callback). Treat that as
  // unauthorized so the request doesn't get to a route that assumes
  // session.user is populated.
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { session };
}

/**
 * Who owns this order, resolved THROUGH THE PROJECT for a Shopify group.
 *
 * ⚠ `orders.claimed_by` IS NULL ON EVERY PROJECT-LINKED ROW since the claim
 * moved up on 2026-08-25. A check reading it raw finds no owner on any
 * Shopify purchase and therefore enforces nothing on the type with the most
 * hands on it. Mirrors `resolvedClaimedBy` in components/OrderModal.
 */
export async function claimOwnerOf(
  row: { project_id?: string | null; claimed_by?: string | null },
): Promise<string | null> {
  if (!row.project_id) return row.claimed_by ?? null;
  const { data: project } = await supabase
    .from("projects")
    .select("claimed_by")
    .eq("id", row.project_id)
    .single();
  return project?.claimed_by ?? null;
}

/**
 * Admin overrides of a claim, recorded during ONE request and written only if
 * that request succeeds.
 *
 * ⚠ WHY THE ROW IS NO LONGER WRITTEN IN THE GUARD. requireOrderClaim used to
 * insert it the moment it let an admin through. Every caller can still stop
 * after that -- PATCH /api/orders/[id] has eleven refusals below its guard,
 * and all four callers can fail a write -- and each of those left "Edited by X
 * (admin) while claimed by another member" on the trail for an edit that never
 * happened. Fixed 2026-09-16 (handoff item 12).
 *
 * ⚠ WHY A WRAPPER, NOT A SECOND CALL. The guard wrote the row itself so that
 * four callers would not each have to remember to. A "now record it" call after
 * the write would bring that back. Instead the log exists only inside
 * withClaimOverrideLog, and requireOrderClaim REQUIRES one: a route that is not
 * wrapped has nothing to pass, and tsc refuses it.
 *
 * Written after the handler returns, so on the trail the override row follows
 * the route's own rows for the same edit rather than preceding them.
 */
export type ClaimOverrideLog = { readonly kind: "claim-override-log" };

type OverrideRow = { order_id: string; text: string; time: string };

// Module-private. Only withClaimOverrideLog creates an entry and only it reads
// one back, so a route can neither flush early nor hand the guard a recorder
// that silently drops rows.
const pendingOverrides = new WeakMap<ClaimOverrideLog, OverrideRow[]>();

/**
 * Wrap a route handler that calls requireOrderClaim.
 *
 * The handler receives the log as its FIRST argument and the route's own
 * arguments after it; the function returned has exactly the route's
 * signature, so `export const POST = withClaimOverrideLog(...)` is a normal
 * Next.js handler.
 */
export function withClaimOverrideLog<Args extends unknown[], R extends Response>(
  handler: (overrides: ClaimOverrideLog, ...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const overrides: ClaimOverrideLog = Object.freeze({ kind: "claim-override-log" as const });
    pendingOverrides.set(overrides, []);
    const res = await handler(overrides, ...args);
    // 2xx only. A refusal, a 500 from a failed write, or a thrown error means
    // the edit did not happen, so neither does its override row.
    if (res.status >= 200 && res.status < 300) {
      for (const row of pendingOverrides.get(overrides) ?? []) {
        await supabase.from("order_activity").insert(row);
      }
    }
    return res;
  };
}

/**
 * May this session change this order?
 *
 *   unclaimed          -> yes. Claiming is how you take a row, and requiring
 *                        a claim before any edit would make every first
 *                        touch a two-step on a queue full of unpicked work.
 *   claimed by you     -> yes.
 *   claimed by another -> 409 `claimed_by_other`.
 *   ...unless admin    -> yes, AND recorded for the activity trail -- written
 *                        by withClaimOverrideLog if, and only if, the request
 *                        succeeds. See ClaimOverrideLog.
 *
 * ⚠ `overrides` IS REQUIRED, ON PURPOSE. It is what makes an unwrapped caller
 * a compile error rather than an override that never reaches the trail. The
 * caller still gets `{ override }` back if it wants to say something in the UI.
 *
 * Returns a NextResponse to return as-is, or `{ override }` to continue.
 */
export async function requireOrderClaim(
  orderId: string,
  session: AuthSession,
  overrides: ClaimOverrideLog,
  action = "Edited",
): Promise<{ override: boolean } | NextResponse> {
  const pending = pendingOverrides.get(overrides);
  if (!pending) {
    // Not made by withClaimOverrideLog. Thrown rather than tolerated: the
    // alternative is an admin override that silently never reaches the trail.
    throw new Error("requireOrderClaim: `overrides` must come from withClaimOverrideLog");
  }
  const { data: row } = await supabase
    .from("orders")
    .select("id, project_id, claimed_by")
    .eq("id", orderId)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const owner = await claimOwnerOf(row);
  if (!owner || owner === session.user.id) return { override: false };

  if (session.user.role !== "admin") {
    return NextResponse.json(
      {
        error: "claimed_by_other",
        claimed_by: owner,
        message: "This order is claimed by someone else. Ask them to release it, or have an admin make the change.",
      },
      { status: 409 },
    );
  }

  const who = session.user.name ?? session.user.username;
  pending.push({
    order_id: orderId,
    text: `${action} by ${who} (admin) while claimed by another member`,
    time: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  });
  return { override: true };
}

export async function requireAdmin(): Promise<{ session: AuthSession } | NextResponse> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;
  if (result.session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }
  return result;
}

/**
 * Allow either an admin OR the user editing their own row. Used for
 * profile-only fields where users should be able to update themselves
 * but not anyone else.
 *
 * Looks up the target row's username (since the URL key is `id`, not
 * `username`) so we can compare against the session's username — the
 * canonical identity in our JWT.
 *
 * Returns:
 *   - 401 if no session
 *   - 404 if target row doesn't exist
 *   - 403 if session is neither admin nor the target
 *   - { session, isAdmin: true|false } on success — callers can use
 *     isAdmin to gate privilege-affecting fields within the same handler
 */
export async function requireSelfOrAdmin(
  targetId: string,
): Promise<
  | { session: AuthSession; isAdmin: boolean; targetUsername: string }
  | NextResponse
> {
  const result = await requireAuth();
  if (result instanceof NextResponse) return result;

  const { data: row, error } = await supabase
    .from("team_members")
    .select("username")
    .eq("id", targetId)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = result.session.user.role === "admin";
  const isSelf = result.session.user.username === row.username;
  if (!isAdmin && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { session: result.session, isAdmin, targetUsername: row.username };
}

/**
 * Normalize free-form text input for DB storage. Coerces to string, trims
 * whitespace. Does NOT HTML-encode — that was the old `sanitize()` behavior
 * and it caused widespread "&#x27;" / "&quot;" rot in the UI because React
 * already escapes everything it renders, so encoding on insert produced
 * double-escaping at every read site.
 *
 * Render-time escaping (for raw HTML templates like the PDF export route)
 * still happens via `escapeHtml()` below — that's the correct boundary.
 *
 * Returns "" for non-string input so callers don't have to null-guard.
 */
/**
 * Coerce to a trimmed string. Returns "" for anything that is not a string.
 *
 * ⚠ THIS DOES NOT SANITISE. It trims whitespace and nothing else. The name
 * is misleading and several call sites have carried comments claiming that
 * calling it makes a value safe for HTML output. It does not.
 *
 * For HTML output use escapeHtml() below, at the point of templating.
 * Values rendered by React need neither -- React escapes its own children.
 */
export function cleanInput(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

/**
 * Escape a string for raw-HTML output. Use this in any route that templates
 * data (including data read from the DB) into HTML strings — the PDF export
 * is the main consumer. Do NOT use on values being rendered by React; React
 * escapes its own children automatically and double-escaping is what the
 * old `sanitize()` function caused.
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  const s = String(input);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/`/g, "&#x60;");
}

/**
 * Rate limiting — uses Upstash Redis if env vars are set, otherwise falls back
 * to an in-memory map (dev only — resets on cold start in production).
 *
 * Returns true if the request is allowed, false if rate-limited.
 *
 * IMPORTANT: this is async. Always `await` it. Calling `if (!checkRateLimit(req))`
 * without await silently disables the limit (a Promise is truthy).
 */
const inMemoryMap = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions {
  /**
   * Refuse when the limiter itself fails, instead of allowing.
   *
   * ⚠ DEFAULTS TO FALSE, WHICH IS RIGHT FOR AUTHENTICATED ROUTES. Locking the
   * team out of the OMS because Upstash blinked is worse than letting a burst
   * through, and every one of those routes has auth behind the limiter.
   *
   * A PUBLIC route has nothing behind it. There, failing open converts a Redis
   * outage into an unlimited endpoint, and for the order lookup that means an
   * oracle confirming which order numbers exist.
   */
  failClosed?: boolean;
  /**
   * Bucket on this instead of the caller's IP.
   *
   * ⚠ FOR LIMITING ATTEMPTS AGAINST ONE TARGET, not attempts from one source.
   * The two answer different questions and a route may want both: an IP bucket
   * limits how fast anyone can WALK order numbers, a subject bucket limits how
   * many times ANYONE can guess at a single one. A subject is also not
   * spoofable by a request header, which an IP may be.
   */
  subject?: string;
}

export async function checkRateLimit(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  bucket = "default",
  opts: RateLimitOptions = {}
): Promise<boolean> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${bucket}:${opts.subject ?? ip}`;

  // ── Upstash Redis path ────────────────────────────────────────────────────
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    try {
      const { Ratelimit } = await import("@upstash/ratelimit");
      const { Redis } = await import("@upstash/redis");

      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });

      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowMs}ms`),
        analytics: false,
        prefix: `ratelimit:${bucket}`,
      });

      const { success } = await ratelimit.limit(key);
      return success;
    } catch {
      // Redis transient failure. Fail OPEN by default, to avoid locking out
      // legitimate users over an outage they cannot see; those routes enforce
      // auth as well, so the limiter is not the only control.
      //
      // ⚠ A PUBLIC ROUTE MUST PASS failClosed. There is no auth behind it, so
      // an open failure is an unlimited endpoint for as long as Redis is down.
      return opts.failClosed !== true;
    }
  }

  // ── In-memory fallback (dev / no Redis configured) ────────────────────────
  const now = Date.now();
  const entry = inMemoryMap.get(key);
  if (!entry || now > entry.resetAt) {
    inMemoryMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * Convenience helper: returns a 429 NextResponse when rate-limited, or null
 * when the request should proceed. Reduces caller boilerplate and makes it
 * harder to forget the `await`.
 *
 * Usage:
 *   const limited = await rateLimitOr429(req, 20);
 *   if (limited) return limited;
 */
export async function rateLimitOr429(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  bucket = "default"
): Promise<NextResponse | null> {
  const ok = await checkRateLimit(req, limit, windowMs, bucket);
  if (!ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } }
    );
  }
  return null;
}

/**
 * Bounded integer parser for query-string params that drive DB limits, page
 * sizes, offsets, etc. Prevents CWE-1285 (improper index/offset validation):
 *   - rejects NaN, negative numbers, and floats
 *   - clamps to [min, max]
 *   - falls back to `fallback` if param is missing or invalid
 */
export function parseBoundedInt(
  raw: string | null | undefined,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
