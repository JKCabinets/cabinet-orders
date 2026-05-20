import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import jwt from "jsonwebtoken";

/**
 * Realtime token endpoint.
 *
 * Mints a short-lived JWT that the browser uses to authenticate with
 * Supabase Realtime. The JWT is signed with the project's JWT secret,
 * so Supabase will trust it as a regular auth token.
 *
 * Claims the token carries (RLS policies can inspect these):
 *   - sub: the user's identifier (we use username, which IS the user id
 *     in this app per authOptions.ts:180)
 *   - role: "authenticated" (Supabase's standard role; required so our
 *     RLS policies that target `TO authenticated` actually apply)
 *   - app_user: redundant with sub, kept for clarity in future policies
 *   - app_role: admin | member — for any future per-role RLS filtering
 *
 * Token TTL is 30 minutes. The client refreshes ~5 min before expiry.
 * If refresh fails (e.g., NextAuth session also expired), realtime
 * subscriptions die; the next page nav redirects to login.
 *
 * Security:
 *   - The signing secret never leaves the server.
 *   - Tokens are read-only by design — RLS policies only allow SELECT.
 *     Browsers CANNOT write to the database with this token; all
 *     mutations still flow through our /api/orders/* endpoints.
 *   - 30-min TTL limits blast radius if a token is leaked.
 *   - Invalidated sessions (role change, deactivation) return 401 here
 *     because getServerSession() returns no user when token.invalidated
 *     is true (see authOptions.ts session callback).
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    // Deployment bug — env var missing. Log loudly.
    console.error("[realtime-token] SUPABASE_JWT_SECRET not configured");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + 30 * 60; // 30 minutes

  // The token shape Supabase Realtime expects:
  //   - `role: "authenticated"` makes Supabase apply our `TO authenticated`
  //     RLS policy.
  //   - `sub` is the user id. We use `username` because per authOptions.ts
  //     token.username IS the user's id.
  //   - Custom claims (`app_user`, `app_role`) are passthrough data RLS
  //     can inspect if we ever want per-user or per-role filtering.
  const claims = {
    sub: session.user.username,
    role: "authenticated",
    app_user: session.user.username,
    app_role: session.user.role,
    iat: nowSeconds,
    exp: expSeconds,
  };

  const token = jwt.sign(claims, jwtSecret, { algorithm: "HS256" });

  return NextResponse.json({
    token,
    expiresAt: expSeconds * 1000, // milliseconds, for client-side Date math
  });
}
