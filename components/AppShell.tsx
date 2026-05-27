"use client";

import { useState } from "react";
import { Sidebar, SidebarMobileTrigger } from "./Sidebar";
import { useSessionAutoRefresh } from "@/lib/useSessionAutoRefresh";

/**
 * Standard page shell — sidebar on the left (fixed), scrollable main on the right.
 * The sidebar is always visible on lg+ screens and slides in on mobile.
 *
 * Usage:
 *   <AppShell>
 *     <PageHeader title="..." />
 *     <main>...</main>
 *   </AppShell>
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  // Subscribe to realtime updates on the signed-in user\'s own
  // team_members row so a rename by an admin (username, display name,
  // role) propagates to session.user immediately instead of waiting
  // up to 60s for the next JWT verify cycle.
  useSessionAutoRefresh();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* Main content area, offset to make room for the sidebar on desktop */}
      <div className="lg:pl-[252px]">
        {/* Mobile bar with hamburger — visible only on mobile/tablet */}
        <div className="lg:hidden sticky top-0 z-20 px-3 py-2 flex items-center gap-2 bg-[#162432]/80 backdrop-blur-xl border-b border-white/8">
          <SidebarMobileTrigger onClick={() => setDrawerOpen(true)} />
          <div className="flex items-center gap-2 text-sm text-cream/85">
            <div className="w-5 h-5 border border-cream/85 rounded flex items-center justify-center">
              <span className="text-[7px] font-medium tracking-wider text-cream">JK</span>
            </div>
            <span className="font-serif text-base">Cabinets <em className="italic-storm">OMS</em></span>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

/**
 * Standard page header — eyebrow + serif headline with optional italic accent.
 *
 *   <PageHeader
 *     eyebrow="Overview · May 2026"
 *     title="Morning"
 *     accent="briefing"
 *   />
 *   → renders "Morning *briefing*" with the accent in storm blue italic
 */
export function PageHeader({
  eyebrow,
  title,
  accent,
  right,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between px-6 lg:px-8 pt-6 lg:pt-8 pb-5">
      <div>
        {eyebrow && (
          <div className="eyebrow mb-1.5">{eyebrow}</div>
        )}
        <h1 className="font-display text-[28px] lg:text-[36px] text-cream">
          {title}
          {accent && <> <em className="italic-storm">{accent}</em></>}
        </h1>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
