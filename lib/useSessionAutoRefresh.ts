"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { getRealtimeClient } from "./realtimeClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Subscribe to team_members realtime changes and trigger a NextAuth
 * session refresh whenever the CURRENT user\'s row changes server-side.
 *
 * Why: an admin can rename a user\'s username or display name from
 * the admin page. The team store updates immediately for everyone else,
 * but the renamed user\'s OWN session still holds the stale username
 * until the JWT verify cycle runs (up to 60s). Calling session.update()
 * forces the JWT callback to re-run NOW, pulling the new username and
 * name from the DB — see the verify branch of lib/authOptions.ts.
 *
 * Hook is a no-op until a session exists. Safe to call from any client
 * component; the underlying realtime channel is shared / deduped.
 */
export function useSessionAutoRefresh() {
  const { data: session, update } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // Keep `update` in a ref so the effect doesn\'t re-subscribe on every
  // render — useSession returns a fresh function reference each render.
  const updateRef = useRef(update);
  useEffect(() => { updateRef.current = update; }, [update]);

  useEffect(() => {
    if (!userId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      const client = await getRealtimeClient();
      if (cancelled || !client) return;

      channel = client
        .channel("session-self-watch")
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "team_members",
            filter: `id=eq.${userId}`,
          },
          () => {
            // Don\'t care about what changed — any UPDATE to our own
            // row could affect username / name / role, so we refresh.
            // NextAuth\'s update() returns a promise; we don\'t await it
            // because the UI re-renders automatically when the session
            // changes via useSession.
            updateRef.current();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        // The realtime client is shared across the app; just remove
        // this specific channel.
        channel.unsubscribe();
      }
    };
  }, [userId]);
}
