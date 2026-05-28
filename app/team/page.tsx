"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { Phone, Mail, Power, Users } from "lucide-react";
import { TeamMember } from "@/lib/data";

/**
 * /team — team directory.
 *
 * Card grid of all active team members showing avatar, name, role/title,
 * phone, email, online/OOO status, and an OOO note when out. Clicking a
 * card opens that member\'s read-only profile page.
 *
 * Read-only and visible to any signed-in user. Editing still happens on
 * the individual profile page (self/admin), reached via the card.
 */
export default function TeamPage() {
  const router = useRouter();
  const { team, onlineUsers, loading } = useStore();

  const members = team
    .filter((m) => m.active)
    // Online first, then alphabetical — puts available people up top.
    .sort((a, b) => {
      const aOnline = onlineUsers.includes(a.id) ? 0 : 1;
      const bOnline = onlineUsers.includes(b.id) ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return a.name.localeCompare(b.name);
    });

  if (loading) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-sm text-cream/35">Loading team...</p>
        </div>
      </AppShell>
    );
  }

  const onlineCount = members.filter((m) => onlineUsers.includes(m.id)).length;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Directory"
        title="Team"
        accent="members"
        right={
          <div className="flex items-center gap-2 text-[11px] text-cream/50">
            <Users className="w-4 h-4" />
            <span className="tabular-nums">{onlineCount} online · {members.length} total</span>
          </div>
        }
      />

      <div className="max-w-5xl mx-auto px-6 lg:px-8 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m) => (
            <TeamCard
              key={m.id}
              member={m}
              online={onlineUsers.includes(m.id)}
              onClick={() => router.push(`/profile/${m.username}`)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function TeamCard({
  member,
  online,
  onClick,
}: {
  member: TeamMember;
  online: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="glass rounded-2xl p-5 text-left transition-all hover:border-[rgba(145,165,151,0.50)] hover:bg-[rgba(255,255,255,0.08)] group"
    >
      {/* Avatar + status row */}
      <div className="flex items-start justify-between mb-4">
        <Avatar member={member} online={online} size="lg" />
        <StatusBadge member={member} online={online} />
      </div>

      {/* Name + role */}
      <div className="mb-3">
        <p className="text-base text-[#e8e3da] group-hover:text-white transition-colors">{member.name}</p>
        <p className="text-[11px] text-[rgba(232,227,218,0.45)] mt-0.5">
          {member.roleTitle || member.role}
        </p>
      </div>

      {/* OOO note when out */}
      {member.oooStatus && (member.oooMessage || member.oooUntil) && (
        <div className="mb-3 text-[11px] text-[rgba(232,227,218,0.65)] bg-amber-950/20 border border-amber-900/40 rounded-md px-2.5 py-1.5">
          {member.oooMessage && <p className="leading-snug">{member.oooMessage}</p>}
          {member.oooUntil && (
            <p className="text-[10px] text-amber-300/80 mt-0.5">
              Back {new Date(member.oooUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          )}
        </div>
      )}

      {/* Contact */}
      <div className="space-y-1.5 pt-3 border-t border-[rgba(255,255,255,0.06)]">
        {member.phone ? (
          <div className="flex items-center gap-2 text-[11px] text-[rgba(232,227,218,0.60)]">
            <Phone className="w-3 h-3 text-[rgba(232,227,218,0.30)] shrink-0" />
            <span className="truncate">{member.phone}</span>
          </div>
        ) : null}
        {member.email ? (
          <div className="flex items-center gap-2 text-[11px] text-[rgba(232,227,218,0.60)]">
            <Mail className="w-3 h-3 text-[rgba(232,227,218,0.30)] shrink-0" />
            <span className="truncate">{member.email}</span>
          </div>
        ) : null}
        {!member.phone && !member.email && (
          <p className="text-[11px] text-[rgba(232,227,218,0.30)] italic">No contact info</p>
        )}
      </div>
    </button>
  );
}

function StatusBadge({ member, online }: { member: TeamMember; online: boolean }) {
  if (member.oooStatus) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-900/30 text-amber-300 border border-amber-700/40">
        <Power className="w-2.5 h-2.5" />
        OOO
      </span>
    );
  }
  if (online) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-900/20 text-emerald-300 border border-emerald-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Online
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.45)] border border-[rgba(255,255,255,0.10)]">
      Offline
    </span>
  );
}
