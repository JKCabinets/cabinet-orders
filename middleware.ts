import { withAuth } from "next-auth/middleware";

/**
 * Server-side page gate (security review, Phase 1).
 *
 * Before this file existed there was NO middleware: every page's protection
 * was client-side (useSession checks inside the component). A logged-out
 * visitor received the full page shell and JS bundle, and admin pages'
 * `if (session && !isAdmin)` pattern falls through entirely when the session
 * is null — rendering the admin UI skeleton (data-empty, since every API
 * route checks auth server-side, but not the intent).
 *
 * This gate redirects unauthenticated PAGE requests to /login before any
 * HTML is served. It also means the next page someone adds is protected by
 * default instead of depending on them remembering the client-side pattern.
 *
 * DELIBERATELY EXCLUDED — and why:
 *   /api/*        Every API route was individually verified to carry its own
 *                 auth (requireAuth / requireAdmin / requireSelfOrAdmin /
 *                 cron bearer / Shopify HMAC), each returning a proper 401
 *                 JSON. Running withAuth over /api would turn those 401s
 *                 into HTML redirects, which breaks fetch() error handling,
 *                 cron (Bearer, no cookie), and both webhooks. Route-level
 *                 auth stays the source of truth for APIs.
 *   /login        The one page that must render logged-out.
 *   /_next, files Static assets; gating them breaks the login page itself.
 *
 * Session strategy: withAuth validates the NextAuth JWT using
 * NEXTAUTH_SECRET, which Kamal already provides to the container.
 */
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    /*
     * Match every path EXCEPT:
     *  - api            (route-level auth, verified complete — see above)
     *  - login          (must be reachable logged-out)
     *  - _next/static, _next/image   (build assets)
     *  - favicon.ico and any file with an extension (public assets)
     */
    "/((?!api|login|_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};
