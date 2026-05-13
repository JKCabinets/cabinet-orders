import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { NextRequest, NextResponse } from "next/server";

export type AuthSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role: "admin" | "member";
    username: string;
  };
};

export async function requireAuth(): Promise<{ session: AuthSession } | NextResponse> {
  const session = (await getServerSession(authOptions)) as AuthSession | null;
  if (!session) {
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
 * Sanitize a string for safe DB storage — encodes &, <, >, ", ', / so values
 * are safe to interpolate into HTML later. Use this on any text that may end
 * up inside server-rendered HTML (e.g. the order export route).
 *
 * NOTE: This is encoding, not full HTML sanitization. It does not preserve
 * any markup — every angle bracket becomes `&lt;` / `&gt;`.
 */
export function sanitize(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/`/g, "&#x60;")
    .trim();
}

/**
 * Escape a string for HTML *output*. Use this in any route that templates
 * data (including data read from the DB) into raw HTML. Unlike `sanitize()`
 * above, this does not trim.
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
