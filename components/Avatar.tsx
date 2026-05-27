"use client";

/**
 * Reusable team-member avatar.
 *
 * Renders either the member's uploaded photo (if set) or their initials
 * in their assigned color. The ring around the avatar conveys live
 * status:
 *
 *   - OOO    → amber/orange ring (takes precedence over online,
 *                because "out of office" is a deliberate state)
 *   - Online → emerald green ring
 *   - Neither → no ring
 *
 * Colors and the photo URL come from the shared TeamMember type, so this
 * component stays in sync with whatever the API returns.
 *
 * Usage:
 *   <Avatar member={teamMember} online size="md" />
 */

import { TeamMember, AVATAR_COLOR_STYLES } from "@/lib/data";

const SIZE_CLASSES = {
  xs: { box: "w-6 h-6",  text: "text-[9px]",  ring: "ring-[1.5px]" },
  sm: { box: "w-7 h-7",  text: "text-[10px]", ring: "ring-2" },
  md: { box: "w-9 h-9",  text: "text-xs",     ring: "ring-2" },
  lg: { box: "w-12 h-12", text: "text-sm",     ring: "ring-[3px]" },
};

interface AvatarProps {
  member: Pick<TeamMember, "name" | "initials" | "avatarColor"> &
    Partial<Pick<TeamMember, "photoUrl" | "oooStatus">>;
  online?: boolean;
  size?: keyof typeof SIZE_CLASSES;
  /** Extra Tailwind classes appended to the root */
  className?: string;
}

export function Avatar({
  member,
  online = false,
  size = "md",
  className = "",
}: AvatarProps) {
  const sz = SIZE_CLASSES[size];

  // Ring color: OOO wins over online. A team member marked out-of-office
  // is intentionally unavailable even if their browser tab is open, so
  // showing them as "green/online" would be misleading.
  let ringClasses = "";
  if (member.oooStatus) {
    ringClasses = `${sz.ring} ring-amber-400/70 ring-offset-2 ring-offset-transparent`;
  } else if (online) {
    ringClasses = `${sz.ring} ring-emerald-400/70 ring-offset-2 ring-offset-transparent`;
  }

  // Tooltip mirrors the ring state so the user can hover to confirm.
  const tooltip = member.oooStatus
    ? `${member.name} · out of office`
    : online
      ? `${member.name} · online`
      : member.name;

  const rootClasses = `${sz.box} rounded-full flex items-center justify-center overflow-hidden ${ringClasses} ${className}`;

  // Photo path: render an <img>. We intentionally keep the same ring
  // logic on the wrapper so OOO/online indicators show on photos too.
  if (member.photoUrl) {
    return (
      <div
        title={tooltip}
        className={rootClasses}
        style={{ borderWidth: 2, borderStyle: "solid", borderColor: "rgba(86,100,72,0.55)" }}
      >
        <img
          src={member.photoUrl}
          alt={member.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  // Initials fallback — original behavior.
  const colorStyle = AVATAR_COLOR_STYLES[member.avatarColor];
  return (
    <div
      title={tooltip}
      className={`${rootClasses} ${sz.text} font-medium`}
      style={{
        ...colorStyle,
        borderWidth: 2,
        borderStyle: "solid",
      }}
    >
      {member.initials}
    </div>
  );
}
