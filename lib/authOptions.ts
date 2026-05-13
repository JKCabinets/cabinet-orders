import CredentialsProvider from "next-auth/providers/credentials";
import { NextAuthOptions } from "next-auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Cost factor for bcrypt — 12 is the application's standard (see team/[id]/route.ts)
const BCRYPT_COST = 12;

async function getSupabase() {
  const { supabase } = await import("@/lib/supabase");
  return supabase;
}

async function logAuditEvent(event: string, username: string, ip?: string, details?: Record<string, unknown>) {
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
function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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
            .select("id, username, name, role, password, password_hash, active, failed_attempts, locked_until")
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
          let upgradedFromPlaintext = false;

          if (user.password_hash) {
            valid = await bcrypt.compare(credentials.password, user.password_hash);
          } else if (user.password) {
            // Legacy migration path — constant-time compare, single use.
            valid = timingSafeStringEqual(credentials.password, user.password);
            upgradedFromPlaintext = valid;
          } else {
            // No credentials on file at all — treat as invalid.
            valid = false;
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

          if (upgradedFromPlaintext) {
            successUpdates.password_hash = await bcrypt.hash(credentials.password, BCRYPT_COST);
            successUpdates.password = null; // wipe plaintext immediately
            await logAuditEvent("password_upgraded", user.username, ip, {
              note: "Legacy plaintext password replaced with bcrypt hash on login",
            });
          }

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

          return {
            id: user.username,
            name: user.name,
            email: `${user.username}@jkcabinets.com`,
            role: user.role,
          };
        } catch (err) {
          if (err instanceof Error && err.message.includes("locked")) throw err;
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = ((user as { role?: string }).role ?? "member") as "admin" | "member";
        token.username = user.id;
        token.sessionVersion = Date.now(); // used to invalidate sessions on password change
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string; username?: string }).role = token.role as string;
        (session.user as { role?: string; username?: string }).username = token.username as string;
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
