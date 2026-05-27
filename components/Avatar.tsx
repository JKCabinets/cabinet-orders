"use client";

/**
 * Reusable team-member avatar.
 *
 * Shows the member's initials in their assigned color. When `online` is
 * true, draws a thin green ring around it.
 *
 * Colors are pulled from the shared AVATAR_COLOR_STYLES map in lib/data
 * so this component stays in sync with the rest of the app.
 *
 * Usage:
 *   <Avatar member={teamMember} online size="md" />
 */

import { TeamMember, AVATAR_COLOR_STYLES } from "@/lib/data";

const SIZE_CLASSES = {
  xs: { box: "w-6 h-6", text: "text-[9px]", ring: "ring-[1.5px]" },
  sm: { box: "w-7 h-7", text: "text-[10px]", ring: "ring-2" },
  md: { box: "w-9 h-9", text: "text-xs", ring: "ring-2" },
  lg: { box: "w-12 h-12", text: "text-sm", ring: "ring-[3px]" },
};

interface AvatarProps {
  member: Pick<TeamMember, "name" | "initials" | "avatarColor">;
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
  const colorStyle = AVATAR_COLOR_STYLES[member.avatarColor];
  const sz = SIZE_CLASSES[size];

  // Tailwind ring offset uses --tw-ring-offset-color; we set the offset
  // color to match the sidebar's sage panel background so the ring sits
  // cleanly. If the avatar appears on a different bg, override via
  // className with `ring-offset-[YOUR_BG]`.
  const ringClasses = online
    ? `${sz.ring} ring-emerald-400/70 ring-offset-2 ring-offset-transparent`
    : "";

  return (
    <div
      title={online ? `${member.name} · online` : member.name}
      className={`${sz.box} rounded-full flex items-center justify-center ${sz.text} font-medium ${ringClasses} ${className}`}
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
