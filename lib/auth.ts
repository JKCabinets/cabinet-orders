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

/** Sanitize a string to prevent XSS — strips HTML tags. */
export function sanitize(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

/**
 * Rate limiting — uses Upstash Redis if env vars are set, otherwise falls back
 * to an in-memory map (dev only — resets on cold start in production).
 */
const inMemoryMap = new Map<string, { count: number; resetAt: number }>();

export async function checkRateLimit(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000
): Promise<boolean> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

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
      });

      const { success } = await ratelimit.limit(ip);
      return success;
    } catch {
      // If Redis is down, fail open (don't block users)
      return true;
    }
  }

  // ── In-memory fallback (dev / no Redis configured) ────────────────────────
  const now = Date.now();
  const entry = inMemoryMap.get(ip);
  if (!entry || now > entry.resetAt) {
    inMemoryMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
