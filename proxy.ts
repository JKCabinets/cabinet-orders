import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Authentication + admin-route guard.
 *
 * NOTE: this file used to be `middleware.ts` and was renamed to `proxy.ts`
 * as part of the Next.js 16 deprecation. The inner function name also
 * changed from `middleware` → `proxy`. Behavior is identical; the rename
 * is to clarify (per Next.js docs) that this code runs at the network
 * boundary rather than as Express-style middleware.
 *
 * `withAuth` is still imported from "next-auth/middleware" — NextAuth v4
 * keeps that import path. The wrapped function it returns is a plain
 * request handler that works in either runtime; proxy.ts runs in Node.
 *
 * # CSP — currently set in next.config.mjs
 *
 * An earlier iteration tried to move to nonce-based CSP here in the proxy,
 * but `strict-dynamic` + the Next.js framework scripts didn't reliably
 * pick up the per-request nonce on Vercel (production saw all client JS
 * blocked, app rendered as logged-out "Guest"). Until that's investigated
 * properly with a staging deploy, CSP stays in next.config.mjs with the
 * documented unsafe-inline/unsafe-eval directives.
 */

/** Public routes that do not require authentication.
 *
 * Each entry is matched as either:
 *   - an exact path, OR
 *   - a path prefix followed by "/" (so "/api/auth" allows "/api/auth/signin"
 *     but NOT "/api/auth-bypass-attempt").
 */
const PUBLIC_PATHS: readonly string[] = [
  "/login",
  "/api/auth",
  "/api/shopify/webhook",
  "/api/webhooks",
  "/api/cron",
];

function isPublicPath(pathname: string): boolean {
  // Normalize trailing slashes for the equality check
  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  return PUBLIC_PATHS.some(
    (p) => normalized === p || normalized.startsWith(p + "/")
  );
}

/**
 * Routes that require admin role at the proxy layer. These are listed in
 * addition to (not instead of) the route-level `requireAdmin()` guard —
 * defense in depth.
 *
 * NOTE: this must match the *actual* route paths in /app/api, not aspirational
 * paths like "/api/orders/delete" that don't exist. The DELETE handlers live at
 * /api/orders/[id] and /api/team/[id], so admin enforcement happens inside
 * those route files (see app/api/orders/[id]/route.ts).
 */
const ADMIN_PREFIXES: readonly string[] = [
  "/api/admin",
  "/api/shopify/sync",
  "/api/shopify/orders",
];

function isAdminPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export default withAuth(
  function proxy(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    if (isAdminPath(pathname) && token?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const { pathname } = req.nextUrl;

        // Allow public paths through (strict match — no prefix-substring bypass)
        if (isPublicPath(pathname)) return true;

        // Require a valid, non-invalidated token. The jwt callback in
        // lib/authOptions.ts sets `invalidated` when a server-side
        // privilege change should force the user to re-authenticate
        // (role change, deactivation, hard delete).
        if (!token || token.invalidated) return false;
        return true;
      },
    },
  }
);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
