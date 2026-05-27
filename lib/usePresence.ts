"use client";

/**
 * Tracks which team members are currently online via Supabase Realtime
 * presence.
 *
 * One presence entry per user_id regardless of tab count — Supabase
 * dedupes by the `key` we pass when joining the channel.
 *
 * Returns an array of user_id strings currently online. The caller (the
 * store) holds this in state and passes it down via context so any
 * component can ask "is X online".
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { getRealtimeClient } from "./realtimeClient";

interface PresenceEntry {
  user_id: string;
  username?: string;
  joined_at?: string;
}

export function usePresence(): string[] {
  const { status, data: session } = useSession();
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (status !== "authenticated") return;
    // Key presence on team_members.id (immutable). Username would drop
    // us offline briefly during admin renames since other clients\'
    // team data still has the old username momentarily.
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        const client = await getRealtimeClient();
        if (cancelled) return;

        // Channel name is fixed for the entire app — everyone joins the
        // same presence channel. `key` is the per-user dedup ref; multi-
        // tab sessions for the same user count as one presence entry.
        channel = client.channel("presence-global", {
          config: { presence: { key: userId } },
        });

        channel
          .on("presence", { event: "sync" }, () => {
            if (!channel) return;
            const state = channel.presenceState<PresenceEntry>();
            // state is { [key]: PresenceEntry[] } — keys are the user_ids
            const ids = Object.keys(state);
            setOnlineUserIds(ids);
          })
          .subscribe(async (subscribeStatus) => {
            if (subscribeStatus === "SUBSCRIBED" && channel) {
              await channel.track({
                user_id: userId,
                joined_at: new Date().toISOString(),
              });
            }
          });
      } catch (err) {
        // Presence is best-effort. If it can't connect, the app works
        // just fine without online indicators.
        console.warn("[presence] could not establish channel", err);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) {
        // untrack first to remove ourselves from the presence state for
        // other clients, then unsubscribe.
        void channel.untrack().then(() => {
          if (channel) void channel.unsubscribe();
        });
      }
    };
  }, [status, (session?.user as { id?: string } | undefined)?.id]);

  return onlineUserIds;
}
