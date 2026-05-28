"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ProfileForm } from "@/components/ProfileForm";
import { ProfileView } from "@/components/ProfileView";
import { Pencil, X, Lock } from "lucide-react";

/**
 * /profile/[username]
 *
 * Two modes, switched by the ?edit=1 query param:
 *   - VIEW (default): read-only ProfileView. Any signed-in user can see
 *     any team member\'s profile here.
 *   - EDIT (?edit=1): the fillable ProfileForm. Only reachable by the
 *     profile owner or an admin; if a non-permitted user hits ?edit=1
 *     directly we silently fall back to view mode.
 */
export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const searchParams = useSearchParams();
  const targetUsername = params?.username;
  const wantsEdit = searchParams.get("edit") === "1";

  const { data: session, status } = useSession();
  const { team, loading, updateTeamMemberProfile, uploadAvatar, onlineUsers } = useStore();

  const sessionUser = session?.user as
    | { id?: string; name?: string; role?: string; username?: string }
    | undefined;
  const isAdmin = sessionUser?.role === "admin";

  const member = useMemo(
    () => team.find((m) => m.username === targetUsername),
    [team, targetUsername],
  );

  // Permission to edit: self (by immutable id) OR admin.
  const canEdit =
    !!sessionUser?.id &&
    !!member &&
    (sessionUser.id === member.id || isAdmin);

  // Only actually render edit mode if they want it AND are allowed.
  const editing = wantsEdit && canEdit;
  const isSelf = !!member && sessionUser?.id === member.id;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=/profile/${targetUsername ?? ""}`);
    }
  }, [status, router, targetUsername]);

  if (status === "loading" || loading) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-sm text-cream/35">Loading profile...</p>
        </div>
      </AppShell>
    );
  }

  if (!member) {
    return (
      <AppShell>
        <PageHeader eyebrow="Profile" title="Not found" />
        <div className="max-w-3xl mx-auto px-6 lg:px-8 pb-12">
          <p className="text-sm text-cream/55">
            No team member found with username
            <span className="font-mono ml-1.5 text-cream/80">@{targetUsername}</span>.
          </p>
        </div>
      </AppShell>
    );
  }

  const isOnline = onlineUsers.includes(member.id);

  // Navigation helpers for flipping modes (preserve the username path).
  const goEdit = () => router.push(`/profile/${member.username}?edit=1`);
  const goView = () => router.push(`/profile/${member.username}`);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Profile"
        title={member.name}
        right={
          editing ? (
            <button
              onClick={goView}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-cream/55 hover:text-cream hover:border-[rgba(86,100,72,0.55)] transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Cancel edit
            </button>
          ) : canEdit ? (
            <button
              onClick={goEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(86,100,72,0.55)] bg-[rgba(255,255,255,0.04)] text-[11px] text-cream hover:bg-[rgba(255,255,255,0.06)] transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
              {isSelf ? "Edit my profile" : "Edit profile"}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-cream/50">
              <Lock className="w-3.5 h-3.5" />
              Read-only
            </span>
          )
        }
      />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 pb-12">
        {editing ? (
          <ProfileForm
            member={member}
            canEdit
            onUploadPhoto={(file) => uploadAvatar(member.id, file)}
            onSave={async (fields) => {
              await updateTeamMemberProfile(member.id, fields);
              // Flip back to the read-only view so the save feels complete.
              goView();
            }}
            onCancel={goView}
          />
        ) : (
          <ProfileView member={member} online={isOnline} />
        )}
      </div>
    </AppShell>
  );
}
