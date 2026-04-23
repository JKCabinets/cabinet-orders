import CredentialsProvider from "next-auth/providers/credentials";
import { NextAuthOptions } from "next-auth";
import bcrypt from "bcryptjs";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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
            await logAuditEvent("login_failed", credentials.username, ip, { reason: "user_not_found" });
            return null;
          }

          // Check lockout
          if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
            await logAuditEvent("login_blocked", user.username, ip, { reason: "account_locked", minutes_left: minutesLeft });
            throw new Error(`Account locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`);
          }

          // Verify password — bcrypt hash preferred, plain text fallback if no hash set
          let valid = false;
          if (user.password_hash) {
            valid = await bcrypt.compare(credentials.password, user.password_hash);
          } else if (user.password) {
            valid = credentials.password === user.password;
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

          // Success — reset failed attempts, update last_login
          await supabase.from("team_members").update({
            failed_attempts: 0,
            locked_until: null,
            last_login: new Date().toISOString(),
          }).eq("id", user.id);

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
  session: { strategy: "jwt", maxAge: 28800 },
  secret: process.env.NEXTAUTH_SECRET,
};
