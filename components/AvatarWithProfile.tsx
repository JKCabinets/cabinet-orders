"use client";

/**
 * Wraps the base Avatar with two interaction layers:
 *
 *   1. Hover (500ms delay)  → small popup card with name, status, OOO msg
 *   2. Click                 → full profile modal with all details +
 *                              an "Edit profile" link when permitted
 *
 * Both layers render the same ProfileSummary component (different
 * variants) so contact info, bio, etc. stay in sync.
 *
 * The Avatar inside stays unchanged — only the wrapping behavior
 * is new. Drop this into any place avatars need to be interactive.
 */

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { TeamMember } from "@/lib/data";
import { Avatar } from "./Avatar";
import { ProfileSummary } from "./ProfileSummary";
import { useStore } from "@/lib/store";
import { Pencil, X } from "lucide-react";

const HOVER_DELAY_MS = 500;

export function AvatarWithProfile({
  member,
  size = "md",
  className = "",
}: {
  member: TeamMember;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const { onlineUsers } = useStore();
  const { data: session } = useSession();
  const isOnline = onlineUsers.includes(member.username);

  const sessionUser = session?.user as { role?: string; username?: string } | undefined;
  const isAdmin = sessionUser?.role === "admin";
  const isSelf  = sessionUser?.username === member.username;
  const canEdit = isAdmin || isSelf;

  // Hover card state. We use a delay so the card doesn't fire on every
  // mouse move across a list of avatars (e.g. the OnlineUsersInSidebar).
  const [showCard, setShowCard]   = useState(false);
  const [showModal, setShowModal] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseEnter() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setShowCard(true), HOVER_DELAY_MS);
  }
  function handleMouseLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setShowCard(false);
  }
  function handleClick() {
    // Open modal; close hover card so they don't double-render
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowCard(false);
    setShowModal(true);
  }

  // Close modal on Escape for a11y
  useEffect(() => {
    if (!showModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowModal(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

  // Clean up hover timer on unmount
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <>
      <span
        className={`relative inline-block cursor-pointer ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <Avatar member={member} online={isOnline} size={size} />

        {/* Hover card — absolutely positioned below the avatar.
            We render via a sibling so it can extend outside the avatar's
            inline box without affecting layout. */}
        {showCard && (
          <span
            className="absolute z-50 mt-2 left-0 top-full w-64 pointer-events-none"
            // pointer-events-none on the wrapper means moving onto the
            // card itself won't keep it open; if you want sticky behavior
            // later, flip this to auto and add timer guards.
          >
            <span className="block bg-[#0c0c0c] border border-[rgba(255,255,255,0.12)] rounded-xl shadow-2xl shadow-black/60 p-3">
              <ProfileSummary member={member} online={isOnline} variant="card" />
            </span>
          </span>
        )}
      </span>

      {/* Click modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-2xl shadow-2xl shadow-black/70 w-full max-w-md max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[rgba(255,255,255,0.06)]">
              <div className="flex items-center gap-3">
                <Avatar member={member} online={isOnline} size="lg" />
                <div>
                  <p className="text-base text-[#e8e3da]">{member.name}</p>
                  <p className="text-[11px] text-[rgba(232,227,218,0.45)] mt-0.5">
                    @{member.username} · {member.role}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-md hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-[rgba(232,227,218,0.65)]" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <ProfileSummary member={member} online={isOnline} variant="full" />
            </div>

            {/* Footer: Edit link when permitted */}
            {canEdit && (
              <div className="px-5 py-3 border-t border-[rgba(255,255,255,0.06)] flex justify-end">
                <Link
                  href={`/profile/${member.username}`}
                  onClick={() => setShowModal(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(86,100,72,0.55)] bg-[rgba(255,255,255,0.04)] text-xs text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {isSelf ? "Edit my profile" : "Edit profile"}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
