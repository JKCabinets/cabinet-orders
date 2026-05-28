import CredentialsProvider from "next-auth/providers/credentials";
import { NextAuthOptions } from "next-auth";
import bcrypt from "bcryptjs";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Cost factor for bcrypt — 12 is the application's standard (see team/[id]/route.ts)
const BCRYPT_COST = 12;

async function getSupabase() {
  const { supabase } = await import("@/lib/supabase");
  return supabase;
}

async function logAuditEvent(event: string, username: string, ip?: string, details?: Record<string, unknown>) {
  // Emit a structured line to stderr for security-relevant auth events so
  // fail2ban (running on the host) can detect repeated failures and ban
  // offending IPs. Stays terse — one line, easy to parse with a regex.
  // The audit DB write below is the system of record; this is just a
  // signal for the firewall layer.
  if (event === "login_failed" || event === "login_blocked") {
    const safeIp = (ip ?? "unknown").replace(/[^0-9a-fA-F:.]/g, "");
    const safeUser = String(username).replace(/[^a-zA-Z0-9._@-]/g, "").slice(0, 64);
    console.error(`[AUTH_FAIL] event=${event} user=${safeUser} ip=${safeIp}`);
  }
  try {
    const supabase = await getSupabase();
    await supabase.from("audit_log").insert({ event, username, ip_address: ip ?? "unknown", details });
  } catch { /* non-critical */ }
}

/**
 * Constant-time string comparison. Used for the legacy plain-text password
 * migration path so failed comparisons don't leak timing info. Returns false
 * if the strings differ in length.
 */

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) return null;

        const ip = (req?.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? "unknown";

        try {
          const supabase = await getSupabase();
          const { data: user, error } = await supabase
            .from("team_members")
            .select("id, username, name, role, password, password_hash, active, failed_attempts, locked_until, session_version")
            .eq("username", credentials.username.toLowerCase())
            .eq("active", true)
            .single();

          if (error || !user) {
            // Defeat user-enumeration timing: do a dummy bcrypt compare so the
            // "user not found" path takes about the same time as a real check.
            await bcrypt.compare(credentials.password, "$2a$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinvX");
            await logAuditEvent("login_failed", credentials.username, ip, { reason: "user_not_found" });
            return null;
          }

          // Check lockout
          if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
            await logAuditEvent("login_blocked", user.username, ip, { reason: "account_locked", minutes_left: minutesLeft });
            throw new Error(`Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`);
          }

          // ─── Password verification ─────────────────────────────────────────
          // Hashed password is REQUIRED. If a legacy plain-text `password`
          // column is present (from older seed data), accept it ONCE using a
          // constant-time compare, then immediately upgrade to a bcrypt hash
          // and CLEAR the plain-text column so it can never be used again.
          let valid = false;
          if (user.password_hash) {
            valid = await bcrypt.compare(credentials.password, user.password_hash);
          }

          if (!valid) {
            const newAttempts = (user.failed_attempts ?? 0) + 1;
            const shouldLock = newAttempts >= MAX_ATTEMPTS;
            const lockedUntil = shouldLock
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
              : null;

            await supabase.from("team_members").update({
              failed_attempts: newAttempts,
              ...(shouldLock ? { locked_until: lockedUntil } : {}),
            }).eq("id", user.id);

            await logAuditEvent("login_failed", user.username, ip, {
              reason: "wrong_password",
              attempts: newAttempts,
              locked: shouldLock,
            });

            if (shouldLock) {
              throw new Error(`Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`);
            }

            return null;
          }

          // ─── Success — reset failed attempts, upgrade plaintext if needed ─
          const successUpdates: Record<string, unknown> = {
            failed_attempts: 0,
            locked_until: null,
            last_login: new Date().toISOString(),
          };


          await supabase.from("team_members").update(successUpdates).eq("id", user.id);

          // Concurrent-session warning (unchanged)
          try {
            const { data: recentLogins } = await supabase
              .from("audit_log")
              .select("ip_address, created_at")
              .eq("username", user.username)
              .eq("event", "login_success")
              .order("created_at", { ascending: false })
              .limit(1);

            if (recentLogins?.length && recentLogins[0].ip_address !== ip) {
              const lastLoginAge = Date.now() - new Date(recentLogins[0].created_at).getTime();
              if (lastLoginAge < 30 * 60 * 1000) {
                await logAuditEvent("concurrent_session_warning", user.username, ip, {
                  previous_ip: recentLogins[0].ip_address,
                  warning: "Login from different IP within 30 minutes — possible account sharing",
                });
              }
            }
          } catch { /* non-critical */ }

          await logAuditEvent("login_success", user.username, ip);

          // We pass three identity fields downstream:
          //   id        – team_members.id (immutable surrogate key, used
          //               for claimed_by / entered_by ownership writes)
          //   username  – the login string (changeable by admins)
          //   name      – the display name (changeable by user)
          // Storing all three in the session lets every callsite pick
          // the right one for its purpose without ambiguity.
          return {
            id: user.id,
            username: user.username,
            name: user.name,
            email: `${user.username}@jkcabinets.com`,
            role: user.role,
            sessionVersion: user.session_version ?? 1,
          };
        } catch (err) {
          if (err instanceof Error && err.message.includes("locked")) throw err;
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      // Sign-in path: `user` is populated only on the call that follows
      // a successful authorize(). Snapshot the role and session_version
      // into the token, plus a timestamp so we know how stale our last
      // verification is.
      if (user) {
        const u = user as { role?: string; sessionVersion?: number; username?: string };
        token.role = (u.role ?? "member") as "admin" | "member";
        // Two identities flow through the token:
        //   token.sub      — NextAuth's primary subject. We set this
        //                    to user.id (team_members.id) so it survives
        //                    username changes.
        //   token.username — the login string (may change over time).
        token.sub = user.id;
        token.username = u.username ?? user.id;
        token.sessionVersion = u.sessionVersion ?? 1;
        token.lastVerifiedAt = Date.now();
        token.invalidated = false;
        return token;
      }

      // Subsequent calls: verify the token's snapshot against the DB.
      // To keep the verification cost reasonable, we only re-check at
      // most once per VERIFY_INTERVAL_MS. That trades a small window of
      // staleness for the bulk of authenticated requests not paying a
      // Supabase round-trip.
      //
      // Window math: a demoted admin / deactivated user keeps their
      // session for up to VERIFY_INTERVAL_MS after the bump lands.
      // Versus the previous 4-hour token TTL, this is roughly 1/240th
      // the blast radius.
      const VERIFY_INTERVAL_MS = 60_000;
      const lastVerified = (token.lastVerifiedAt as number | undefined) ?? 0;
      const now = Date.now();
      // trigger === "update" means the client called useSession().update().
      // That's a deliberate "I want fresh data NOW" signal, so we bypass
      // the throttle. Without this, an admin rename takes up to 60s to
      // propagate even when our realtime hook fires update() immediately.
      if (trigger !== "update" && now - lastVerified < VERIFY_INTERVAL_MS) {
        return token;
      }

      // Time to re-verify. Fetch the current session_version and active
      // flag for this user from Supabase. If the user has been hard-
      // deleted, the lookup returns no rows — treat that as invalidation.
      try {
        const supabase = await getSupabase();
        // Look up by team_members.id (token.sub, immutable). Looking up
        // by username would break the moment an admin renames the user,
        // because the in-flight token still holds the OLD username.
        // We also pull the latest username + name so the session can
        // reflect renames without forcing a sign-out.
        const { data, error } = await supabase
          .from("team_members")
          .select("session_version, active, role, username, name")
          .eq("id", token.sub as string)
          .single();

        if (error || !data) {
          // No row found (hard-deleted) — mark the token invalidated.
          // We can't actually delete the JWT from here (it's stored as
          // a cookie on the client), but the session callback below
          // will reject the user when it sees `invalidated`.
          token.invalidated = true;
          return token;
        }

        if (!data.active) {
          // Soft-deleted — invalidate.
          token.invalidated = true;
          return token;
        }

        if ((data.session_version ?? 1) !== token.sessionVersion) {
          // Version bumped server-side — token is stale, force re-login.
          token.invalidated = true;
          return token;
        }

        // Role drift can happen if an admin's role was changed but the
        // session_version bump didn't fire (e.g. a future bug). Refresh
        // the role on the token so the audit-log story stays sane.
        if (data.role !== token.role) {
          token.role = data.role as "admin" | "member";
        }

        // Pull the latest username + display name onto the token so a
        // rename in admin propagates to session.user.username/name on
        // the next session.update() or next 60s verify cycle — no
        // forced sign-out needed.
        if (typeof data.username === "string" && data.username !== token.username) {
          token.username = data.username;
        }
        if (typeof data.name === "string" && data.name !== token.name) {
          token.name = data.name;
        }
        token.lastVerifiedAt = now;
        token.invalidated = false;
        return token;
      } catch {
        // Supabase outage / network error: fail open. The whole app is
        // already broken in this state — every API route hits Supabase —
        // so an attacker holding a stale token can't do anything that
        // touches the DB anyway. Better than mass-logging-out every user
        // on a transient blip.
        return token;
      }
    },
    async session({ session, token }) {
      // If the JWT callback flagged this token as invalidated (role
      // change, deactivation, deletion), return a session without a
      // user. NextAuth's client-side useSession() will then surface
      // status "unauthenticated" and trigger redirect-to-login on
      // protected pages.
      if (token.invalidated) {
        return { ...session, user: undefined as unknown as typeof session.user };
      }
      if (session.user) {
        // session.user.id is the team_members.id (immutable). All
        // ownership writes (claimed_by, entered_by) reference this.
        // session.user.username is the login string (may change).
        // session.user.name is the display name (may change).
        session.user.id = token.sub as string;
        session.user.role = token.role;
        session.user.username = token.username;
        if (typeof token.name === "string") {
          session.user.name = token.name;
        }
      }
      return session;
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.username) {
        await logAuditEvent("logout", token.username as string);
      }
    },
  },
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 14400 }, // 4 hour sessions
  secret: process.env.NEXTAUTH_SECRET,
};
