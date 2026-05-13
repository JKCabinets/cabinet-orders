import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Public routes that do not require authentication.
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
 * Routes that require admin role at the middleware layer. These are listed in
 * addition to (not instead of) the route-level `requireAdmin()` guard — defense
 * in depth.
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
  function middleware(req) {
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
