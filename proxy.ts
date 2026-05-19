import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Authentication + admin-route guard + nonce-based CSP.
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
 * # CSP — nonce-based, strict
 *
 * Previously the CSP was set in next.config.mjs with `'unsafe-inline'` and
 * `'unsafe-eval'` in script-src, which effectively disabled XSS protection
 * (the entire point of CSP is to block inline scripts; allowing them via
 * `unsafe-inline` reads "we have a CSP" but means almost nothing).
 *
 * We now generate a fresh nonce per request here in the proxy, set the CSP
 * header on the response with `'nonce-${nonce}'` in script-src and style-src,
 * and forward the nonce to downstream code via the `x-nonce` request header.
 * Next.js automatically picks up the nonce from the CSP header and applies
 * it to its own injected hydration scripts. Any user-authored inline
 * scripts would need the attribute explicitly via `headers().get('x-nonce')`
 * — we don't currently have any, but the plumbing is there if we add some.
 *
 * Tradeoff: nonce-CSP requires all pages to render dynamically (no static
 * optimization, no ISR, no CDN cache). For this app that's a non-issue —
 * every page is auth-gated and reads fresh from Supabase already.
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

/**
 * Build the per-request CSP string. The nonce is the only dynamic part;
 * everything else is static policy.
 *
 * `strict-dynamic` is what makes nonce-based CSP usable in practice — it
 * tells the browser "trust this nonce and anything it loads transitively"
 * so we don't have to enumerate every JS chunk URL.
 *
 * Dev allows `'unsafe-eval'` because React's dev runtime uses eval for
 * better error messages. Production does not.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // 'self' covers framework CSS files; the nonce covers any streaming
    // inline styles Next.js may inject. Keeping `'unsafe-inline'` only in
    // dev (where HMR pushes inline updates).
    `style-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
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

    // Generate a fresh nonce per request. crypto.randomUUID is available
    // in both Node and Edge runtimes; base64-encoding gives us a value
    // that's safe to drop into HTML attributes and CSP headers.
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const csp = buildCsp(nonce);

    // Forward the nonce to downstream RSC code via a request header. Read it
    // with `(await headers()).get("x-nonce")` in a server component or
    // layout when you need to apply nonce={...} to a custom inline script.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    // The PDF export route at /api/orders/[id]/export sets its own CSP with
    // 'unsafe-inline' (needed for print stylesheets in the generated HTML).
    // Skip setting our strict CSP for that path so the route's response
    // header wins unambiguously.
    const isExportRoute = /^\/api\/orders\/[^/]+\/export(\/|$)/.test(pathname);
    if (!isExportRoute) {
      response.headers.set("Content-Security-Policy", csp);
    }

    return response;
  },
  {
    callbacks: {
      authorized({ req, token }) {
        const { pathname } = req.nextUrl;

        // Allow public paths through (strict match — no prefix-substring bypass)
        if (isPublicPath(pathname)) return true;

        // Require token for everything else
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
