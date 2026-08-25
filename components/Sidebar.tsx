"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard, LineChart, ShieldCheck, Archive, Settings, LogOut,
  Calendar, ChevronDown, Menu, X, PackageX, FileText, Package,
  Inbox, Layers, Boxes, Wrench,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { Order, OrderType, STAGE_LIST_BY_TYPE } from "@/lib/data";
import { attentionFor } from "@/lib/attention";
import { rollupBackorders } from "@/lib/backorders";
import clsx from "clsx";

import { OnlineUsersInSidebar } from "./OnlineUsersInSidebar";
import { AvatarWithProfile } from "./AvatarWithProfile";

interface SidebarProps {
  /** Mobile drawer open state */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { allOrders, orders, customs, samples, warranties, hardware, projects, team, onlineUsers } = useStore();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const user = session?.user as { name?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";

  const activeOrders = orders.filter(o => !o.archived);

  /**
   * Category badges count rows AT THE FIRST STAGE OF THEIR OWN FLOW.
   *
   * Not the total. A badge reading 40 on Cabinets tells you nothing you can
   * act on -- most of those are moving along fine. A badge reading 6 means six
   * orders are sitting unentered, which is a thing somebody does today.
   *
   * "First stage" rather than "New" as a string: hardware starts at Ordered
   * and warranty at New claim. One rule, read from STAGE_LIST_BY_TYPE, so a
   * sixth type gets a correct badge without anyone remembering to add it.
   */
  const atFirstStage = (list: Order[]) => list.filter(o => {
    if (o.archived) return false;
    const flow = STAGE_LIST_BY_TYPE[o.type as OrderType] as readonly string[] | undefined;
    return !!flow && flow.length > 0 && o.stage === flow[0];
  }).length;

  const cabinetCount  = atFirstStage(orders);
  const hardwareCount = atFirstStage(hardware);
  const sampleCount   = atFirstStage(samples);
  const customCount   = atFirstStage(customs);
  const warrantyCount = atFirstStage(warranties);

  /**
   * My Work: rows I have claimed that need something doing.
   *
   * Straight from the attention engine, so this badge and the /work queue
   * cannot disagree -- the number you see here is the number of rows you find
   * when you click it. Counting "claimed by me" alone would be a workload
   * figure, which is a different question and not one a badge should answer.
   */
  const myWorkCount = allOrders.filter(
    o => o.claimed_by === currentUserId && attentionFor(o).length > 0).length;

  /** Anything breached or coming due, across every type. */
  const slaCount = allOrders.filter(o =>
    attentionFor(o).some(r => r.kind === "sla_breached" || r.kind === "sla_due_soon")).length;

  const backorderCount = rollupBackorders(activeOrders).length;

  /**
   * Archived PROJECTS, not archived orders.
   *
   * Archiving moved up to the project on 2026-08-25: a Shopify checkout is
   * archived as a whole purchase and its groups are hidden by lookup, never by
   * their own flag. Counting `orders.archived` here would read zero forever
   * for Shopify work and only ever see standalone custom jobs.
   */
  const archivedCount =
    Object.values(projects).filter(p => p.archived).length
    + customs.filter(o => o.archived).length;

  const [ordersOpen, setOrdersOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [altOpen, setAltOpen] = useState(true);
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
              {/* My Work above everything else that is not the dashboard.
                  Groups are claimed independently -- a cabinet group and a
                  sample group of one checkout belong to different people -- so
                  "what have I got" is the question most often asked. */}
              <NavItem href="/work" icon={<Inbox className="w-3.5 h-3.5" />} label="My Work" count={myWorkCount} pathname={pathname} />
              <NavItem href="/work?scope=all" icon={<Inbox className="w-3.5 h-3.5" />} label="All Work" pathname={pathname} />
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

            {/* ── Shopify ──
                Everything under here arrives by ingest. Projects first: a
                checkout is the purchase, and the orders beneath it are how it
                gets worked.

                The five cabinet STAGES used to live in this sidebar. They moved
                into the Cabinets hub as stage cards, so the pipeline is visible
                where the orders are rather than in the navigation. */}
            <SidebarSection
              label="Shopify"
              open={ordersOpen}
              onToggle={() => setOrdersOpen(v => !v)}
            >
              <NavItem href="/projects" icon={<Layers className="w-3.5 h-3.5" />} label="Projects" pathname={pathname} />
              <NavItem href="/orders/cabinets" icon={<Boxes className="w-3.5 h-3.5" />} label="Cabinets" count={cabinetCount} pathname={pathname} />
              <NavItem href="/orders/hardware" icon={<Wrench className="w-3.5 h-3.5" />} label="Hardware" count={hardwareCount} pathname={pathname} />
              <NavItem href="/samples" icon={<Package className="w-3.5 h-3.5" />} label="Samples" count={sampleCount} pathname={pathname} />
            </SidebarSection>

            {/* ── Offline / service ──
                Neither of these comes from Shopify. A custom job is contract
                work carrying no Shopify products; a warranty claim is ABOUT a
                purchase rather than part of one. Both are standalone rows with
                no project, which is exactly why they are not above. */}
            <SidebarSection
              label="Offline / service"
              open={altOpen}
              onToggle={() => setAltOpen(v => !v)}
            >
              <NavItem href="/custom" icon={<FileText className="w-3.5 h-3.5" />} label="Custom Jobs" count={customCount} pathname={pathname} />
              <NavItem href="/warranty" icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Warranty Claims" count={warrantyCount} pathname={pathname} />
            </SidebarSection>

            {/* ── Other ── */}
            <SidebarSection
              label="Operations"
              open={otherOpen}
              onToggle={() => setOtherOpen(v => !v)}
            >
              <NavItem href="/sla" icon={<LineChart className="w-3.5 h-3.5" />} label="SLA & Exceptions" count={slaCount} pathname={pathname} />
              <NavItem href="/calendar" icon={<Calendar className="w-3.5 h-3.5" />} label="Calendar" pathname={pathname} />
              {/* Archived PROJECTS, not archived order rows -- archiving moved
                  up to the purchase, so /orders/archived would show an empty
                  list forever. */}
              <NavItem
                href="/projects?filter=archived"
                icon={<Archive className="w-3.5 h-3.5" />}
                label="Archive"
                count={archivedCount}
                pathname={pathname}
              />
              {isAdmin && (
                <>
                  <NavItem href="/admin/team" icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Team" pathname={pathname} />
                  <NavItem href="/admin" icon={<Settings className="w-3.5 h-3.5" />} label="Admin" pathname={pathname} />
                </>
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
