import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * Authentication + admin-route guard + CSP nonce (report-only).
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
 * The static CSP in next.config.mjs (with `'unsafe-inline'` /
 * `'unsafe-eval'`) is still the *enforced* policy. In addition, we
 * set a SEPARATE `Content-Security-Policy-Report-Only` header here
 * with a strict nonce-based policy. The browser evaluates both:
 *
 *   - Enforced policy → permissive, app keeps working
 *   - Report-only policy → strict, but only reports violations
 *
 * Violations get POSTed to `/api/csp-report` where they're logged to
 * Supabase. After a few days of observation we'll know exactly which
 * scripts/styles get flagged, fix the policy (likely with hashes for
 * framework bootstrap), then flip the report-only one to enforcing
 * and remove the permissive one.
 *
 * Why we're doing it this way: a previous attempt set the strict policy
 * as the enforced one directly and shipped to production. The Next.js
 * framework bootstrap script didn't reliably pick up the nonce, all
 * client JS got blocked, the app rendered as logged-out "Guest." This
 * time we observe before enforcing.
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
  // session — has to be public.
  "/api/csp-report",
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

/**
 * Build the strict nonce-based CSP we're testing in report-only mode.
 *
 * `strict-dynamic` tells the browser "trust this nonce and anything it
 * transitively loads" — without it we'd have to enumerate every JS chunk
 * URL. The trade is that `strict-dynamic` IGNORES `'self'` and URL
 * allowlists in script-src, so anything not nonced or loaded transitively
 * via a nonced script gets blocked.
 *
 * Dev allows `'unsafe-eval'` because React's dev runtime uses eval for
 * better error messages. Production does not.
 */
function buildReportOnlyCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // For styles, 'self' covers framework CSS files; the nonce covers
    // any streaming inline styles Next.js may inject. Keeping
    // `'unsafe-inline'` only in dev (where HMR pushes inline updates).
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
    // Send violation reports to our endpoint. `report-uri` is the
    // widely-supported directive; the newer Reporting API uses
    // `report-to`, but our endpoint accepts both payload shapes.
    "report-uri /api/csp-report",
  ];
  return directives.join("; ");
}

export default withAuth(
  function proxy(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    if (isAdminPath(pathname) && token?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Generate a fresh nonce per request. randomUUID is from node:crypto,
    // base64-encoded so it's safe in HTTP headers and HTML attributes.
    const nonce = Buffer.from(randomUUID()).toString("base64");
    const csp = buildReportOnlyCsp(nonce);

    // Forward the nonce to downstream RSC code via a request header so
    // Next.js can apply it to its framework scripts. Read it from a
    // server component with `(await headers()).get("x-nonce")` if you
    // ever need to nonce a custom inline script.
    //
    // The Content-Security-Policy header we set on the *request* is
    // what Next.js looks at to decide whether to apply nonces to its
    // own scripts (per the docs). The header on the response is what
    // the browser actually sees.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    // The export route at /api/orders/[id]/export sets its own CSP
    // (with 'unsafe-inline' for print stylesheets in the generated
    // HTML). Don't override its response with our report-only header
    // for that path — the export's CSP is correct for its own HTML.
    const isExportRoute = /^\/api\/orders\/[^/]+\/export(\/|$)/.test(pathname);
    if (!isExportRoute) {
      // Report-only: browser evaluates the policy and reports
      // violations, but does NOT block. The static permissive CSP in
      // next.config.mjs is the actually-enforced one.
      response.headers.set("Content-Security-Policy-Report-Only", csp);
    }

    return response;
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
