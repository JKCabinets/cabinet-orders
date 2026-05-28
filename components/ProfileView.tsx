"use client";

import { TeamMember } from "@/lib/data";
import { Avatar } from "./Avatar";
import { Phone, Mail, MessageSquare, Clock, Globe, Power } from "lucide-react";

/**
 * Read-only profile display for the /profile/[username] page (view mode).
 *
 * This is the public-facing presentation: anyone signed in can see a
 * team member\'s profile here. Editing happens separately — the page
 * shows an "Edit profile" button (self/admin only) that flips into the
 * ProfileForm. This component intentionally has NO inputs.
 */
export function ProfileView({
  member,
  online,
}: {
  member: TeamMember;
  online: boolean;
}) {
  const hasContact = member.email || member.phone || member.slackHandle;
  const hasSchedule = member.workingHours || member.timezone;

  return (
    <div className="glass rounded-2xl p-6">
      {/* Header: avatar + name + status */}
      <div className="flex items-start gap-4 pb-5 border-b border-[rgba(255,255,255,0.06)]">
        <Avatar member={member} online={online} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-lg text-[#e8e3da]">{member.name}</p>
          <p className="text-xs text-[rgba(232,227,218,0.45)] mt-1">
            @{member.username} · {member.role}
            {member.roleTitle ? " · " + member.roleTitle : ""}
          </p>
        </div>
        <StatusBadge member={member} online={online} />
      </div>

      {/* Out of office banner */}
      {member.oooStatus && (member.oooMessage || member.oooUntil) && (
        <div className="mt-5 text-xs text-[rgba(232,227,218,0.70)] bg-amber-950/20 border border-amber-900/40 rounded-lg px-4 py-3">
          <div className="flex items-center gap-1.5 text-amber-300/90 uppercase tracking-wider text-[10px] mb-1.5">
            <Power className="w-3 h-3" />
            Out of office
          </div>
          {member.oooMessage && <p className="leading-relaxed">{member.oooMessage}</p>}
          {member.oooUntil && (
            <p className="text-[11px] text-amber-300/70 mt-1.5">
              Back {new Date(member.oooUntil).toLocaleDateString(undefined, { month: "long", day: "numeric" })}
            </p>
          )}
        </div>
      )}

      {/* Contact details */}
      {hasContact && (
        <div className="mt-5">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-3">Contact</p>
          <div className="space-y-2.5">
            {member.email       && <DetailRow icon={<Mail className="w-3.5 h-3.5" />}          label="Email"  value={member.email} />}
            {member.phone       && <DetailRow icon={<Phone className="w-3.5 h-3.5" />}         label="Phone"  value={member.phone} />}
            {member.slackHandle && <DetailRow icon={<MessageSquare className="w-3.5 h-3.5" />} label="Slack"  value={member.slackHandle} />}
          </div>
        </div>
      )}

      {/* Schedule */}
      {hasSchedule && (
        <div className="mt-5 pt-5 border-t border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-3">Schedule</p>
          <div className="space-y-2.5">
            {member.workingHours && <DetailRow icon={<Clock className="w-3.5 h-3.5" />}  label="Hours"    value={member.workingHours} />}
            {member.timezone     && <DetailRow icon={<Globe className="w-3.5 h-3.5" />}  label="Timezone" value={member.timezone} mono />}
          </div>
        </div>
      )}

      {/* Bio */}
      {member.bio && (
        <div className="mt-5 pt-5 border-t border-[rgba(255,255,255,0.06)]">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-3">About</p>
          <p className="text-sm text-[rgba(232,227,218,0.75)] leading-relaxed whitespace-pre-wrap">{member.bio}</p>
        </div>
      )}

      {/* Empty state when there\'s nothing filled in */}
      {!hasContact && !hasSchedule && !member.bio && !member.oooStatus && (
        <p className="mt-5 text-sm text-[rgba(232,227,218,0.35)] italic">
          This profile hasn\'t been filled out yet.
        </p>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[rgba(232,227,218,0.30)] shrink-0">{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-[rgba(232,227,218,0.30)] w-16 shrink-0">{label}</span>
      <span className={"text-[rgba(232,227,218,0.75)] " + (mono ? "font-mono" : "")}>{value}</span>
    </div>
  );
}

function StatusBadge({ member, online }: { member: TeamMember; online: boolean }) {
  if (member.oooStatus) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-amber-900/30 text-amber-300 border border-amber-700/40">
        <Power className="w-2.5 h-2.5" />
        Out of office
      </span>
    );
  }
  if (online) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-emerald-900/20 text-emerald-300 border border-emerald-800/40">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Online
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.45)] border border-[rgba(255,255,255,0.10)]">
      Offline
    </span>
  );
}
