import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Authentication + admin-route guard.
 *
 * # Rename note
 *
 * This file used to be `middleware.ts` and was renamed to `proxy.ts`
 * as part of the Next.js 16 deprecation. The inner function name also
 * changed from `middleware` → `proxy`. Behavior is identical; the rename
 * is to clarify (per Next.js docs) that this code runs at the network
 * boundary rather than as Express-style middleware.
 *
 * `withAuth` is still imported from "next-auth/middleware" — NextAuth v4
 * keeps that import path. The wrapped function it returns is a plain
 * request handler that works in either runtime; proxy.ts runs in Node.
 *
 * # CSP strategy
 *
 * The enforced Content-Security-Policy lives in next.config.mjs. It is
 * same-origin by default and additionally allows Supabase (images,
 * realtime) and the app's own inline framework scripts/styles. That is
 * the policy the browser actually applies, and it is sound.
 *
 * ## Retired: report-only nonce CSP experiment
 *
 * This file previously ALSO emitted a strict, nonce-based
 * `Content-Security-Policy-Report-Only` header. The goal was to observe
 * violations, tighten the policy, then flip it to enforcing and drop the
 * permissive `'unsafe-inline'` from the enforced policy.
 *
 * That experiment was retired. The strict policy depends on
 * `script-src 'strict-dynamic' 'nonce-…'`, which requires Next.js to
 * stamp its framework bootstrap scripts with our per-request nonce.
 * Next.js 16 / Turbopack does NOT reliably propagate the nonce
 * (`getScriptNonceFromHeader` doesn't extract it), so framework scripts
 * always violated the strict policy and it could never be safely
 * enforced. Several days of collected reports confirmed every violation
 * fell into one of three non-actionable buckets:
 *   1. framework inline/eval bootstrap scripts that can't be nonced
 *      until the upstream bug is fixed,
 *   2. legitimate Supabase avatar images,
 *   3. stale noise from the old Vercel deploy and the www. variant.
 * No genuine security finding ever surfaced.
 *
 * The `/api/csp-report` endpoint and the `csp_reports` table are left in
 * place, unused, so the experiment can be revived cheaply.
 *
 * ## Reviving (when Next.js fixes nonce propagation)
 *   1. Re-add a `buildReportOnlyCsp(nonce)` that emits
 *      `script-src 'self' 'nonce-…' 'strict-dynamic'` (+ 'unsafe-eval'
 *      in dev only) and `report-uri /api/csp-report`.
 *   2. Set the request-side `Content-Security-Policy` header + `x-nonce`
 *      so Next.js applies the nonce, and set the response-side
 *      `Content-Security-Policy-Report-Only` header.
 *   3. Confirm via /api/csp-report that framework scripts are now nonced
 *      (no more `script-src-elem: inline` framework hits).
 *   4. Only then flip it to enforcing and remove `'unsafe-inline'` from
 *      the enforced policy in next.config.mjs.
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
  // CSP violation reports are POSTed by the browser without any
  // session — has to be public. (Endpoint retained for the future
  // report-only revival; see the CSP strategy note above.)
  "/api/csp-report",
  "/api/health",  //
  // ⚠ EVERY ROUTE UNDER app/api/public/ IS UNAUTHENTICATED, BY CONSTRUCTION.
  // Adding a file to that directory makes it public; there is no second
  // decision anywhere that would catch a mistake. Put a route there only when
  // a customer's browser must reach it with no session -- today the order
  // lookup, next the claims intake -- and give it its own rate limiting,
  // because the proxy is doing nothing for it.
  //
  // Prefix form matches the entries above: this permits "/api/public/lookup"
  // and not "/api/public-anything".
  "/api/public",
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
