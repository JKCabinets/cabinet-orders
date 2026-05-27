"use client";

/**
 * Renders a small "Online" section to drop into the sidebar.
 *
 * Shows up to N online team-member avatars in a row. If more are online
 * than fit, shows a +N indicator. If nobody is online (just you), it
 * still renders your own avatar so the section isn't empty.
 *
 * Reads `team` and `onlineUsers` from the store. No props.
 */

import { useStore } from "@/lib/store";
import { AvatarWithProfile } from "./AvatarWithProfile";

const MAX_VISIBLE = 6;

export function OnlineUsersInSidebar() {
  const { team, onlineUsers } = useStore();

  // Filter to active team members who are currently online
  const onlineTeam = team
    .filter((m) => m.active)
    .filter((m) => onlineUsers.includes(m.username))
    // Stable sort by name so positions don't jump around as presence syncs
    .sort((a, b) => a.name.localeCompare(b.name));

  if (onlineTeam.length === 0) {
    // No one (not even us) — usually means presence hasn't synced yet
    return null;
  }

  const visible = onlineTeam.slice(0, MAX_VISIBLE);
  const extra = onlineTeam.length - visible.length;

  return (
    <div className="px-3 py-3 border-t border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-cream/45">
          Online
        </span>
        <span className="text-[10px] tabular-nums text-cream/45">
          {onlineTeam.length}
        </span>
      </div>
      <div className="flex items-center -space-x-1.5">
        {visible.map((m) => (
          <AvatarWithProfile key={m.id} member={m} size="sm" />
        ))}
        {extra > 0 && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium border border-white/15 bg-white/5 text-cream/60"
            title={`${extra} more online`}
          >
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
}
