"use client";

import { TeamMember } from "@/lib/data";
import { Phone, Mail, MessageSquare, Clock, Globe, Power } from "lucide-react";

/**
 * Profile preview shown on avatar hover and inside the click modal.
 *
 * variant="card" -- compact: name, role badge, status, OOO message
 * variant="full" -- adds: phone, email, slack, working hours, timezone, bio
 */

export function ProfileSummary({
  member,
  online,
  variant,
}: {
  member: TeamMember;
  online: boolean;
  variant: "card" | "full";
}) {
  const status = member.oooStatus
    ? { label: "Out of office", color: "amber" as const }
    : online
      ? { label: "Online", color: "emerald" as const }
      : { label: "Offline", color: "neutral" as const };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-[#e8e3da] truncate">{member.name}</p>
          <p className="text-[10px] text-[rgba(232,227,218,0.45)] truncate mt-0.5">
            @{member.username}{member.roleTitle ? " · " + member.roleTitle : ""}
          </p>
        </div>
        <span className={statusBadgeClass(status.color)}>
          {status.color === "emerald" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
          {status.color === "amber" && <Power className="w-2.5 h-2.5" />}
          {status.label}
        </span>
      </div>

      {member.oooStatus && (member.oooMessage || member.oooUntil) && (
        <div className="mt-2 text-[11px] text-[rgba(232,227,218,0.65)] bg-amber-950/20 border border-amber-900/40 rounded-md px-2.5 py-2">
          {member.oooMessage && <p className="leading-snug">{member.oooMessage}</p>}
          {member.oooUntil && (
            <p className="text-[10px] text-amber-300/80 mt-1">
              Back {new Date(member.oooUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          )}
        </div>
      )}

      {variant === "full" && (
        <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] space-y-1.5 text-[11px]">
          {member.email        && <DetailRow icon={<Mail className="w-3 h-3" />} value={member.email} />}
          {member.phone        && <DetailRow icon={<Phone className="w-3 h-3" />} value={member.phone} />}
          {member.slackHandle  && <DetailRow icon={<MessageSquare className="w-3 h-3" />} value={member.slackHandle} />}
          {member.workingHours && <DetailRow icon={<Clock className="w-3 h-3" />} value={member.workingHours} />}
          {member.timezone     && <DetailRow icon={<Globe className="w-3 h-3" />} value={member.timezone} mono />}
        </div>
      )}

      {variant === "full" && member.bio && (
        <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)]">
          <p className="text-[11px] text-[rgba(232,227,218,0.65)] leading-relaxed whitespace-pre-wrap">
            {member.bio}
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, value, mono }: { icon: React.ReactNode; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[rgba(232,227,218,0.65)]">
      <span className="text-[rgba(232,227,218,0.30)]">{icon}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function statusBadgeClass(color: "emerald" | "amber" | "neutral") {
  const base = "shrink-0 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md border";
  if (color === "emerald") return base + " bg-emerald-900/20 text-emerald-300 border-emerald-800/40";
  if (color === "amber")   return base + " bg-amber-900/30 text-amber-300 border-amber-700/40";
  return base + " bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.45)] border-[rgba(255,255,255,0.10)]";
}
