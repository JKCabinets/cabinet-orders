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

import Link from "next/link";
import { Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { AvatarWithProfile } from "./AvatarWithProfile";

const MAX_VISIBLE = 6;

export function OnlineUsersInSidebar() {
  const { team, onlineUsers } = useStore();

  // Filter to active team members who are currently online
  const onlineTeam = team
    .filter((m) => m.active)
    .filter((m) => onlineUsers.includes(m.id))
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
      <Link
        href="/team"
        className="flex items-center justify-between mb-2 group"
        title="View all team members"
      >
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-cream/45 group-hover:text-cream/80 transition-colors">
          <Users className="w-3 h-3" />
          Team
        </span>
        <span className="text-[10px] tabular-nums text-cream/45 group-hover:text-cream/80 transition-colors">
          {onlineTeam.length} online
        </span>
      </Link>
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
