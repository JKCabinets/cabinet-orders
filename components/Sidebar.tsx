"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, LineChart, ShieldCheck, Archive, Settings, LogOut,
  Calendar, ChevronDown, Menu, X, PackageX,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ORDER_STAGES, OrderStage } from "@/lib/data";
import { rollupBackorders } from "@/lib/backorders";
import clsx from "clsx";

/**
 * Map a stage label to the dot color shown next to it in the sidebar.
 * Mirrors STAGE_COLOR used on the cards / dashboard tiles.
 */
const STAGE_DOT: Record<OrderStage, string> = {
  "New":            "#c97070",
  "Entered":        "#d4922a",
  "In production":  "#c8b84a",
  "At cross dock":  "#5a8db8",
  "Delivered":      "#8fbe70",
};

/** Convert "In production" → "in-production" for the URL slug. */
import { OnlineUsersInSidebar } from "./OnlineUsersInSidebar";
import { AvatarWithProfile } from "./AvatarWithProfile";

function stageToSlug(stage: OrderStage): string {
  return stage.toLowerCase().replace(/\s+/g, "-");
}

interface SidebarProps {
  /** Mobile drawer open state */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { orders, team, onlineUsers } = useStore();
  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  // Active orders (not archived) grouped by stage for the inline counts
  const activeOrders = orders.filter(o => !o.archived);
  const stageCounts: Record<string, number> = {};
  for (const stage of ORDER_STAGES) {
    stageCounts[stage] = activeOrders.filter(o => o.stage === stage).length;
  }
  // Distinct backordered SKUs across active orders. Shows as the count badge
  // on the Backorders nav item, and the item itself only renders when > 0.
  const backorderCount = rollupBackorders(activeOrders).length;
  const archivedCount = orders.filter(o => o.archived).length;

  const [ordersOpen, setOrdersOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [otherOpen, setOtherOpen] = useState(true);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50 animate-fade-in"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={clsx(
          // Mobile: full-height slide-in drawer. Desktop: fixed sidebar.
          // Use inset-y-3 + left-3 instead of h-full + margin so the panel
          // doesn't overflow the viewport when the margin is applied.
          "fixed top-3 bottom-3 left-3 z-40 w-[232px]",
          "transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-[calc(100%+1rem)] lg:translate-x-0",
        )}
      >
        <div className="h-full glass-sage rounded-panel flex flex-col overflow-hidden">

          {/* Logo + close (mobile) */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 border-[1.5px] border-cream/90 rounded flex flex-col items-center justify-center leading-none">
                <span className="text-[9px] font-medium tracking-wider text-cream">JK</span>
              </div>
              <span className="font-serif text-base text-cream tracking-tight">
                Cabinets <em className="not-italic font-serif italic-storm">OMS</em>
              </span>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1 rounded-md hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4 text-cream/70" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-0.5">

            {/* ── Overview ── */}
            <SidebarSection
              label="Overview"
              open={overviewOpen}
              onToggle={() => setOverviewOpen(v => !v)}
            >
              <NavItem href="/dashboard" icon={<LayoutDashboard className="w-3.5 h-3.5" />} label="Dashboard" pathname={pathname} />
              <NavItem href="/sla" icon={<LineChart className="w-3.5 h-3.5" />} label="SLA" pathname={pathname} />
              {/* Backorders surfaces only when there's something to act on.
                  When the count drops to zero the link disappears — keeps
                  the sidebar quiet on calm days. */}
              {backorderCount > 0 && (
                <NavItem
                  href="/backorders"
                  icon={<PackageX className="w-3.5 h-3.5" />}
                  label="Backorders"
                  count={backorderCount}
                  pathname={pathname}
                />
              )}
            </SidebarSection>

            {/* ── Orders by stage ── */}
            <SidebarSection
              label="Orders"
              open={ordersOpen}
              onToggle={() => setOrdersOpen(v => !v)}
            >
              {ORDER_STAGES.map(stage => (
                <NavItem
                  key={stage}
                  href={`/orders/${stageToSlug(stage)}`}
                  dot={STAGE_DOT[stage]}
                  label={stage}
                  count={stageCounts[stage]}
                  pathname={pathname}
                />
              ))}
            </SidebarSection>

            {/* ── Other ── */}
            <SidebarSection
              label="Other"
              open={otherOpen}
              onToggle={() => setOtherOpen(v => !v)}
            >
              <NavItem href="/calendar" icon={<Calendar className="w-3.5 h-3.5" />} label="Calendar" pathname={pathname} />
              <NavItem href="/warranty" icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Warranty" pathname={pathname} />
              <NavItem
                href="/orders/archived"
                icon={<Archive className="w-3.5 h-3.5" />}
                label="Archive"
                count={archivedCount}
                pathname={pathname}
              />
              {isAdmin && (
                <NavItem href="/admin" icon={<Settings className="w-3.5 h-3.5" />} label="Admin" pathname={pathname} />
              )}
            </SidebarSection>
          </nav>

          {/* Online team members */}
          <OnlineUsersInSidebar />

          {/* User footer */}
          <UserFooter session={session} team={team} onlineUsers={onlineUsers} />
        </div>
      </aside>
    </>
  );
}

/**
 * Bottom-of-sidebar user pill. Looks up the signed-in user's full team
 * member row so the Avatar can render their photo + OOO ring. Falls back
 * to a colored initials disc when the team row isn't loaded yet.
 */
function UserFooter({
  session,
  team,
  onlineUsers,
}: {
  session: ReturnType<typeof useSession>["data"];
  team: import("@/lib/data").TeamMember[];
  onlineUsers: string[];
}) {
  const user = session?.user as { name?: string; role?: string; username?: string } | undefined;
  const me = user?.username ? team.find((m) => m.username === user.username) : undefined;
  const meId = (session?.user as { id?: string } | undefined)?.id;
            const isOnline = meId ? onlineUsers.includes(meId) : false;

  return (
    <div className="px-3 py-3 border-t border-white/10 flex items-center gap-2.5">
      {me ? (
        <AvatarWithProfile member={me} size="sm" />
      ) : (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium border border-terracotta/45 bg-terracotta/20 text-terracotta">
          {user?.name?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-cream truncate">{user?.name ?? "Guest"}</div>
        <div className="text-[10px] text-cream/55 capitalize">{user?.role ?? "—"}</div>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
        title="Sign out"
      >
        <LogOut className="w-3.5 h-3.5 text-cream/65" />
      </button>
    </div>
  );
}

/* ─── Subcomponents ─────────────────────────────────────────────────── */

function SidebarSection({
  label, open, onToggle, children,
}: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 mb-1.5">
      <button
        onClick={onToggle}
        className="flex items-center justify-between px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.16em] text-cream/45 hover:text-cream/65 transition-colors"
      >
        <span>{label}</span>
        <ChevronDown
          className={clsx(
            "w-3 h-3 transition-transform duration-200",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function NavItem({
  href, label, icon, dot, count, pathname, comingSoon = false,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  dot?: string;
  count?: number;
  pathname: string;
  comingSoon?: boolean;
}) {
  // Match exact path or path with trailing segment (so /orders/new doesn't match /orders/new-claim)
  const active = pathname === href;

  if (comingSoon) {
    return (
      <div
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs text-cream/35 cursor-not-allowed"
        title="Coming soon"
      >
        {icon}
        {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
        <span className="flex-1">{label}</span>
        <span className="text-[9px] uppercase tracking-wider text-cream/30">Soon</span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-all",
        active
          ? "bg-cream/12 text-cream"
          : "text-cream/65 hover:text-cream hover:bg-white/8",
      )}
    >
      {icon}
      {dot && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />}
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className={clsx(
            "text-[10px] tabular-nums",
            active ? "text-cream/75" : "text-cream/45",
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

/* ─── Mobile menu trigger (used in page headers) ─────────────────────── */

export function SidebarMobileTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="lg:hidden p-2 rounded-md hover:bg-white/10 transition-colors"
      aria-label="Open menu"
    >
      <Menu className="w-5 h-5 text-cream/85" />
    </button>
  );
}
