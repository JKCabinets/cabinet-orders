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

export async function checkRateLimit(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  bucket = "default"
): Promise<boolean> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${bucket}:${ip}`;

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
      // Redis transient failure — fail open to avoid locking out legit users.
      // Sensitive endpoints must additionally enforce auth at the route level.
      return true;
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
