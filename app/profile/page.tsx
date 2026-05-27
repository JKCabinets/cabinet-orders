"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";

/**
 * /profile — redirect to /profile/[your-username]. Keeps one canonical
 * surface so the dynamic route handles all the rendering/permission
 * logic in one place.
 */
export default function ProfileRedirect() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/login?callbackUrl=/profile");
      return;
    }
    const user = session?.user as { username?: string } | undefined;
    if (user?.username) {
      router.replace(`/profile/${user.username}`);
    } else {
      router.replace("/dashboard");
    }
  }, [status, session, router]);

  return (
    <AppShell>
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-sm text-cream/35">Loading your profile...</p>
      </div>
    </AppShell>
  );
}
