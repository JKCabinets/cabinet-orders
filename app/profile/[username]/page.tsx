"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ProfileForm } from "@/components/ProfileForm";
import { Avatar } from "@/components/Avatar";
import { User as UserIcon, Lock } from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const targetUsername = params?.username;
  const { data: session, status } = useSession();
  const { team, loading, updateTeamMemberProfile, uploadAvatar, onlineUsers } = useStore();

  const sessionUser = session?.user as
    | { name?: string; role?: string; username?: string }
    | undefined;
  const sessionUsername = sessionUser?.username;
  const isAdmin = sessionUser?.role === "admin";

  const member = useMemo(
    () => team.find((m) => m.username === targetUsername),
    [team, targetUsername],
  );

  const canEdit =
    !!sessionUsername &&
    !!member &&
    (sessionUsername === member.username || isAdmin);

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

  return (
    <AppShell>
      <PageHeader
        eyebrow="Profile"
        title={member.name}
        right={
          <div className="flex items-center gap-2 text-[11px] text-cream/50">
            {canEdit ? (
              <span className="flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5" />
                {sessionUsername === member.username ? "Your profile" : "Admin editing"}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Read-only
              </span>
            )}
          </div>
        }
      />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 pb-12">
        <div className="flex items-center gap-4 mb-6 px-4 py-3 glass rounded-2xl">
          <Avatar member={member} online={isOnline} size="lg" />
          <div className="flex-1">
            <p className="text-base text-[#e8e3da]">{member.name}</p>
            <p className="text-[11px] text-[rgba(232,227,218,0.45)] mt-0.5">
              @{member.username} · {member.role}
              {member.roleTitle ? " · " + member.roleTitle : ""}
            </p>
          </div>
          {member.oooStatus && (
            <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-amber-900/30 text-amber-300 border border-amber-700/40">
              Out of office
            </span>
          )}
        </div>

        <ProfileForm
          member={member}
          canEdit={canEdit}
          onUploadPhoto={(file) => uploadAvatar(member.id, file)}
          onSave={async (fields) => {
            await updateTeamMemberProfile(member.id, fields);
          }}
        />
      </div>
    </AppShell>
  );
}
