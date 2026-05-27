import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      /**
       * The team_members.id (immutable surrogate key). Use this for
       * ownership writes (claimed_by, entered_by) and any permission
       * comparison that must survive username/display-name changes.
       */
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: "admin" | "member";
      /**
       * The login string. May be changed by admins. Use this for
       * audit text and identity verification at login time only.
       */
      username: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "admin" | "member";
    username: string;
    /**
     * Display name, refreshed from team_members.name on every JWT
     * verify cycle. The session callback copies this into
     * session.user.name so a rename propagates without re-login.
     */
    name?: string;
    /**
     * Snapshot of `team_members.session_version` at sign-in. The JWT
     * callback (lib/authOptions.ts) compares this to the live DB value
     * to detect privilege changes that should invalidate the session.
     */
    sessionVersion?: number;
    /**
     * Last time the JWT callback re-verified `sessionVersion` against
     * the DB, as a Unix timestamp in ms. Used to throttle Supabase
     * round-trips — we only re-check every 60s.
     */
    lastVerifiedAt?: number;
    /**
     * Marked true by the JWT callback when the token has been
     * invalidated server-side (role change, deactivation, hard delete).
     * The session callback then drops the user from the returned
     * session, which forces re-login on the client.
     */
    invalidated?: boolean;
  }
}
