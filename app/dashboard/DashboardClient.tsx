"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  Order, Project, OrderType, STAGE_ACCENT, STAGE_LIST_BY_TYPE,
  getBackorderStatus, displayOrderNumber,
} from "@/lib/data";
import { rollupBackorders, summarizeBackorders, type BackorderSummary } from "@/lib/backorders";
import { attentionFor, attentionForProject, DUE_SOON_HOURS, type AttentionReason } from "@/lib/attention";
import { slaRuleFor, slaAgeHours, hoursInStage, formatStageAge } from "@/lib/sla";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { AvatarWithProfile } from "@/components/AvatarWithProfile";
import {
  Plus, Search, ChevronRight, PackageX, AlertTriangle, UserX, Ban, Clock,
  CheckCircle2, Boxes, Wrench, Package, FileText, ShieldCheck,
} from "lucide-react";

/**
 * The dashboard — a launchpad, not a report.
 *
 * ⚠ THE HIERARCHY IS: why I care → what → where → who → next action.
 *
 * It used to lead with five stage counts and the customer name. Those answer
 * "what does the board look like", which is a fine question and not the one
 * somebody opens a dashboard to ask. The first row now answers "what requires
 * a person to do something", and every number on it is a link into the work
 * queue filtered by that question.
 *
 * ⚠ EVERY COUNT COMES FROM lib/attention.ts. Not one predicate lives here.
 * The tiles, the needs-attention table and the queue must agree, and two
 * filters that happen to agree today are the drift this codebase keeps
 * producing -- four instances in six days of one rule enforced in two places
 * with a clause missing from the second.
 *
 * ENTRIES ARE PURCHASES. The claim moved up to the project on 2026-08-25, so a
 * row here is a thing somebody can own, matching /work.
 */

/** One icon per flow, matching the sidebar's. */
const TYPE_ICON: Record<string, typeof Boxes> = {
  order: Boxes,
  hardware: Wrench,
  sample: Package,
  custom: FileText,
  warranty: ShieldCheck,
};

const TYPE_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
  custom: "Custom",
  warranty: "Warranty",
};

interface Entry {
  key: string;
  project?: Project;
  orders: Order[];
  reasons: AttentionReason[];
  claimedBy: string | null;
  label: string;
  customer: string;
  /** Oldest hours any reason has been waiting, for the tile subtitles. */
  oldestHours: number | null;
}

export function DashboardClient() {
  const { allOrders, projects, orders, customs, samples, warranties, hardware, team } = useStore();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const active = useMemo(() => orders.filter((o) => !o.archived), [orders]);
  const backorderRollups = useMemo(() => rollupBackorders(active), [active]);
  const backorderSummary = useMemo(() => summarizeBackorders(backorderRollups), [backorderRollups]);

  /** Every purchase or standalone row that wants somebody. */
  const entries = useMemo(() => {
    const out: Entry[] = [];
    const byProject = new Map<string, Order[]>();
    const standalone: Order[] = [];

    for (const o of allOrders) {
      if (o.archived) continue;
      if (o.project_id) {
        const l = byProject.get(o.project_id) ?? [];
        l.push(o);
        byProject.set(o.project_id, l);
      } else {
        standalone.push(o);
      }
    }

    const ageOf = (os: Order[]) => {
      const hs = os.map((o) => {
        const rule = slaRuleFor(o);
        return rule ? slaAgeHours(o, rule) : hoursInStage(o);
      }).filter((h): h is number => h !== null);
      return hs.length > 0 ? Math.max(...hs) : null;
    };

    for (const [id, group] of byProject) {
      const project = projects[id];
      if (!project || project.archived) continue;
      const reasons = attentionForProject(project, group);
      if (reasons.length === 0) continue;
      out.push({
        key: id, project, orders: group, reasons,
        claimedBy: project.claimed_by ?? null,
        label: id, customer: project.name ?? "—",
        oldestHours: ageOf(group),
      });
    }

    for (const o of standalone) {
      const reasons = attentionFor(o);
      if (reasons.length === 0) continue;
      out.push({
        key: o.id, orders: [o], reasons,
        claimedBy: o.claimed_by ?? null,
        label: displayOrderNumber(o), customer: o.name,
        oldestHours: ageOf([o]),
      });
    }
    return out;
  }, [allOrders, projects]);

  /**
   * The four tiles.
   *
   * ⚠ THE BUCKETS OVERLAP, deliberately. A purchase blocked on missing data for
   * sixty hours is in Blocked AND Needs attention AND past SLA. They are four
   * questions about the same rows, not a partition -- and each tile links to
   * the queue filtered by ITS question. Making them exclusive would drop a row
   * out of Blocked the moment it also breached, which is when you most want to
   * see it there.
   *
   * The SUBTITLE is a second, genuinely different figure -- a subset or an age,
   * never a restatement of the number above it.
   */
  const tiles = useMemo(() => {
    const has = (e: Entry, k: string) => e.reasons.some((r) => r.kind === k);
    const oldest = (list: Entry[]) => {
      const hs = list.map((e) => e.oldestHours).filter((h): h is number => h !== null);
      return hs.length > 0 ? formatStageAge(Math.max(...hs)) : null;
    };

    const needing = entries;
    const breached = entries.filter((e) => has(e, "sla_breached"));
    const unclaimed = entries.filter((e) => !e.claimedBy);
    const blocked = entries.filter((e) => has(e, "blocked_missing_data"));
    const dueSoon = entries.filter((e) => has(e, "sla_due_soon"));

    return [
      {
        key: "attention",
        label: "Needs attention",
        count: needing.length,
        sub: breached.length > 0
          ? `${breached.length} past SLA`
          : "none past SLA",
        href: "/work?scope=unclaimed",
        color: "#e08585",
        Icon: AlertTriangle,
      },
      {
        key: "unclaimed",
        label: "Unclaimed",
        count: unclaimed.length,
        sub: oldest(unclaimed) ? `oldest ${oldest(unclaimed)}` : "none waiting",
        href: "/work?scope=unclaimed&reason=unclaimed",
        color: "#5a8db8",
        Icon: UserX,
      },
      {
        key: "blocked",
        label: "Blocked",
        count: blocked.length,
        sub: blocked.length > 0 ? "missing data" : "nothing stalled",
        href: "/work?scope=unclaimed&reason=blocked_missing_data",
        color: "#e08585",
        Icon: Ban,
      },
      {
        key: "due",
        label: "Due soon",
        count: dueSoon.length,
        // Names the WINDOW, so the number means something. "3" alone is not a
        // fact about anything.
        sub: `within ${DUE_SOON_HOURS}h`,
        href: "/work?scope=unclaimed&reason=sla_due_soon",
        color: "#e8b56a",
        Icon: Clock,
      },
    ];
  }, [entries]);

  /** The needs-attention table: the worst first, capped so it stays a glance. */
  const flagged = useMemo(() => {
    return [...entries]
      .sort((a, b) => {
        const sev = (e: Entry) => (e.reasons.some((r) => r.severity === "high") ? 0 : 1);
        if (sev(a) !== sev(b)) return sev(a) - sev(b);
        return (b.oldestHours ?? 0) - (a.oldestHours ?? 0);
      })
      .slice(0, 6);
  }, [entries]);

  /** One row per type, its own stages as segments. */
  const pipelines = useMemo(() => {
    const groups: { type: OrderType; rows: Order[] }[] = [
      { type: "order", rows: orders },
      { type: "hardware", rows: hardware },
      { type: "sample", rows: samples },
      { type: "custom", rows: customs },
      { type: "warranty", rows: warranties },
    ];
    return groups.map(({ type, rows }) => {
      const live = rows.filter((o) => !o.archived);
      const stages = (STAGE_LIST_BY_TYPE[type] ?? []) as readonly string[];
      return {
        type,
        label: TYPE_LABEL[type] ?? type,
        Icon: TYPE_ICON[type] ?? Boxes,
        // ⚠ EACH FLOW RENDERS ITS OWN STAGES. Cabinets run five, hardware and
        // samples three, custom six, warranty five. A fixed grid would either
        // invent stages or hide them.
        segments: stages.map((s) => ({ stage: s, count: live.filter((o) => o.stage === s).length })),
      };
    });
  }, [orders, hardware, samples, customs, warranties]);

  /** The longest flow decides how many Stage N headers to draw. Custom, at six. */
  const maxStages = useMemo(
    () => pipelines.reduce((n, p) => Math.max(n, p.segments.length), 0),
    [pipelines],
  );

  /** SLA / data health: one row per type, counted the way /sla counts. */
  const health = useMemo(() => {
    const groups: { type: OrderType; rows: Order[] }[] = [
      { type: "order", rows: orders },
      { type: "hardware", rows: hardware },
      { type: "sample", rows: samples },
      { type: "custom", rows: customs },
      { type: "warranty", rows: warranties },
    ];
    return groups.map(({ type, rows }) => {
      const live = rows.filter((o) => !o.archived);
      let breached = 0, due = 0, blocked = 0;
      for (const o of live) {
        for (const r of attentionFor(o)) {
          if (r.kind === "sla_breached") breached++;
          else if (r.kind === "sla_due_soon") due++;
          else if (r.kind === "blocked_missing_data") blocked++;
        }
      }
      return {
        type, label: TYPE_LABEL[type] ?? type,
        active: live.length,
        healthy: live.filter((o) => attentionFor(o).length === 0).length,
        due, breached, blocked,
      };
    });
  }, [orders, hardware, samples, customs, warranties]);

  return (
    <>
      <PageHeader
        eyebrow={`Overview · ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`}
        title="JK Cabinets"
        accent="OMS Dashboard"
        right={
          <>
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider border border-cream/18 bg-white/4 text-cream/85 hover:bg-white/8 transition-all"
              title="Search all orders"
            >
              <Search className="w-3.5 h-3.5" />
              Search
            </button>
            <Link
              href="/warranty"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider border border-cream/18 bg-white/4 text-cream/85 hover:bg-white/8 transition-all"
            >
              Warranty claim
            </Link>
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New custom job
            </button>
          </>
        }
      />

      <div className="px-6 lg:px-8 pb-12 flex flex-col gap-5">

        {/* ── What requires somebody ──
            Narrow segmented tiles rather than five large cards: more
            information in less vertical space, and every one is a link. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="lift-card glass-sage rounded-panel px-4 py-3.5 flex items-center gap-3.5 group"
            >
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: `${t.color}1f`, border: `0.5px solid ${t.color}55` }}
              >
                <t.Icon className="w-4 h-4" style={{ color: t.color }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-cream/55">{t.label}</span>
                <span className="block font-display text-[30px] leading-none" style={{ color: t.color }}>
                  {t.count}
                </span>
                <span className="block text-[10px] text-cream/35 mt-0.5 truncate">{t.sub}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-cream/25 group-hover:text-cream/60 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

          {/* ── Needs attention ── */}
          <div className="glass-sage rounded-panel p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display text-[22px] text-cream">
                Needs <em className="italic-storm">attention</em>
              </h2>
              <Link href="/work?scope=unclaimed" className="text-[11px] text-cream/45 hover:text-cream/80 transition-colors">
                View all {entries.length} →
              </Link>
            </div>

            {flagged.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="w-5 h-5 mx-auto mb-2" style={{ color: "#8fbe70" }} />
                <p className="text-[13px] text-cream/55">Nothing flagged.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="grid grid-cols-[1.5fr_0.8fr_0.9fr_0.7fr] gap-3 pb-2 text-[9px] uppercase tracking-wider text-cream/35">
                  <span>Issue</span>
                  <span>Order</span>
                  <span>Type</span>
                  <span className="text-right">Owner</span>
                </div>
                {flagged.map((e) => {
                  const unclaimed = e.reasons.find((r) => r.kind === "unclaimed");
                  const lead = (!e.claimedBy && unclaimed)
                    ? unclaimed
                    : e.reasons.find((r) => r.severity === "high") ?? e.reasons[0];
                  const owner = e.claimedBy ? team.find((m) => m.id === e.claimedBy) : undefined;
                  return (
                    <button
                      key={e.key}
                      onClick={() => setSelectedOrder(e.orders[0])}
                      className="grid grid-cols-[1.5fr_0.8fr_0.9fr_0.7fr] gap-3 py-2.5 text-left transition-colors hover:bg-white/4"
                      style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}
                    >
                      <span className="flex items-start gap-2 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                          style={{ background: lead.severity === "high" ? "#e08585" : "#e8b56a" }}
                        />
                        <span className="min-w-0">
                          <span className="block text-[12px] text-cream/85 truncate">{lead.label}</span>
                          {lead.detail && (
                            <span className="block text-[10px] text-cream/35 truncate">{lead.detail}</span>
                          )}
                        </span>
                      </span>
                      <span className="self-center text-[11px] font-mono text-cream/60 truncate">{e.label}</span>
                      <span className="self-center flex items-center gap-1.5 flex-wrap min-w-0">
                        {e.orders.slice(0, 2).map((o) => (
                          <span key={o.id} className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(232,227,218,0.55)" }}>
                            {TYPE_LABEL[o.type] ?? o.type}
                          </span>
                        ))}
                        {e.orders.length > 2 && (
                          <span className="text-[9px] text-cream/25">+{e.orders.length - 2}</span>
                        )}
                      </span>
                      <span className="self-center flex items-center justify-end gap-1.5 min-w-0">
                        {owner
                          ? <>
                              <AvatarWithProfile member={owner} size="sm" />
                              <span className="text-[10px] text-cream/45 truncate hidden lg:inline">
                                {owner.name.split(" ")[0]}
                              </span>
                            </>
                          : <span className="text-[10px] text-cream/25 italic">unclaimed</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Pipeline snapshot ──
              ⚠ CHEVRONS, NOT PILLS. Each stage points into the next: the row
              reads as one chain a purchase moves along, which is the whole
              point of showing five flows side by side.

              FIXED-WIDTH COLUMNS, LEFT-ALIGNED. A three-stage flow ENDS EARLY
              rather than stretching to fill the row -- flex-1 made hardware's
              three stages span the same width as cabinets' five, which said
              they were the same length. They are not. */}
          <div className="glass-sage rounded-panel p-5 overflow-x-auto">
            <h2 className="font-display text-[22px] text-cream mb-3">
              Pipeline <em className="italic-storm">snapshot</em>
            </h2>

            <div className="min-w-[560px]">
              {/* Stage 1..N header. N is the longest flow -- custom, at six. */}
              <div className="flex items-center gap-0 mb-1.5">
                <span className="w-[110px] flex-shrink-0 text-[9px] uppercase tracking-wider text-cream/35">
                  Order type
                </span>
                {Array.from({ length: maxStages }, (_, i) => (
                  <span key={i} className="w-[112px] flex-shrink-0 text-[9px] uppercase tracking-wider text-cream/35 pl-3">
                    Stage {i + 1}
                  </span>
                ))}
              </div>

              {pipelines.map((p) => (
                <div key={p.type} className="flex items-center gap-0 py-1.5"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.07)" }}>
                  <span className="w-[110px] flex-shrink-0 flex items-center gap-2">
                    <p.Icon className="w-3.5 h-3.5 text-cream/40 flex-shrink-0" />
                    <span className="text-[12px] text-cream/80 truncate">{p.label}</span>
                  </span>

                  {p.segments.map((s, i) => {
                    const terminal = i === p.segments.length - 1;
                    const has = s.count > 0;
                    // Terminal green; anything holding work reads blue; empty
                    // stages sit muted so the eye lands on where things ARE.
                    const bg = terminal
                      ? (has ? "rgba(143,190,112,0.20)" : "rgba(143,190,112,0.10)")
                      : has ? "rgba(90,141,184,0.20)" : "rgba(255,255,255,0.04)";
                    const border = terminal
                      ? "rgba(143,190,112,0.45)"
                      : has ? "rgba(90,141,184,0.50)" : "rgba(255,255,255,0.08)";
                    const fg = terminal
                      ? (has ? "#a0cc7a" : "rgba(160,204,122,0.45)")
                      : has ? "#8fb8dd" : "rgba(232,227,218,0.35)";
                    return (
                      <span
                        key={s.stage}
                        className="w-[112px] flex-shrink-0 flex items-center justify-between gap-1 pl-3 pr-4 py-1.5 text-[11px]"
                        style={{
                          background: bg,
                          borderTop: `0.5px solid ${border}`,
                          borderBottom: `0.5px solid ${border}`,
                          borderLeft: i === 0 ? `0.5px solid ${border}` : "none",
                          // The chevron: point into the next segment, and notch
                          // the left edge so the previous one nests into it.
                          clipPath: terminal
                            ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 8px 50%)"
                            : "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%)",
                          marginLeft: i === 0 ? 0 : -1,
                        }}
                        title={`${s.count} at ${s.stage}`}
                      >
                        <span className="truncate" style={{ color: fg }}>{s.stage}</span>
                        <span className="tabular-nums flex-shrink-0" style={{ color: fg }}>{s.count}</span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {/* ── SLA / data health ── */}
          <div className="glass-sage rounded-panel p-5">
            <h2 className="font-display text-[22px] text-cream mb-3">
              SLA / <em className="italic-storm">data health</em>
            </h2>
            <div className="grid grid-cols-[1.2fr_repeat(4,0.7fr)] gap-2 pb-2 text-[9px] uppercase tracking-wider text-cream/35">
              <span>Order type</span>
              <span className="text-right">Active</span>
              <span className="text-right">Healthy</span>
              <span className="text-right">Due soon</span>
              <span className="text-right">Breached</span>
            </div>
            {health.map((h) => (
              <div key={h.type}
                className="grid grid-cols-[1.2fr_repeat(4,0.7fr)] gap-2 py-2 text-[12px]"
                style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                <span className="text-cream/70">{h.label}</span>
                <span className="text-right tabular-nums text-cream/60">{h.active}</span>
                <span className="text-right tabular-nums" style={{ color: h.healthy > 0 ? "#a0cc7a" : "rgba(232,227,218,0.25)" }}>{h.healthy}</span>
                <span className="text-right tabular-nums" style={{ color: h.due > 0 ? "#e8b56a" : "rgba(232,227,218,0.25)" }}>{h.due}</span>
                <span className="text-right tabular-nums" style={{ color: h.breached > 0 ? "#e08585" : "rgba(232,227,218,0.25)" }}>{h.breached}</span>
              </div>
            ))}
            <Link href="/sla" className="block mt-3 text-[11px] text-cream/45 hover:text-cream/80 transition-colors">
              Open the SLA page →
            </Link>
          </div>

          {/* ── System health ──
              ⚠ NOT WIRED UP. It reads healthchecks.io, and no API key exists in
              .env.kamal yet. Shown as "not configured" rather than absent or
              faked: a panel showing a green tick it did not check is worse than
              no panel, and this is the one place that has to stay trustworthy. */}
          <div className="glass-sage rounded-panel p-5">
            <h2 className="font-display text-[22px] text-cream mb-3">
              System <em className="italic-storm">health</em>
            </h2>
            <div className="flex flex-col">
              {[
                { label: "Shopify ingest", detail: "Orders, products, and webhooks" },
                { label: "Reconciliation", detail: "Hourly order and payment check" },
              ].map((row) => (
                <div key={row.label}
                  className="flex items-center justify-between gap-3 py-2.5"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                  <span className="min-w-0">
                    <span className="block text-[12px] text-cream/75">{row.label}</span>
                    <span className="block text-[10px] text-cream/35 truncate">{row.detail}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.05)", color: "rgba(232,227,218,0.4)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
                    Not configured
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-cream/30 mt-3 leading-relaxed">
              Reads healthchecks.io once an API key is set. Until then this panel
              says so rather than showing a status nobody checked — the crons
              still email on failure.
            </p>
          </div>
        </div>

        {/* Backorders — only when there is something to see. Not in the
            redesign mockup, kept because it surfaces a supply problem nothing
            else does. */}
        {backorderSummary.distinctSkus > 0 && (
          <BackorderPanel summary={backorderSummary} />
        )}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStageChange={(stage) => setSelectedOrder((prev) => (prev ? { ...prev, stage } : null))}
        />
      )}
      {showNewForm && (
        <NewOrderModal type="custom" onClose={() => setShowNewForm(false)} />
      )}
      {searchOpen && (
        <SearchOverlay
          orders={allOrders}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelectOrder={(o) => { setSelectedOrder(o); setSearchOpen(false); }}
          onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
        />
      )}
    </>
  );
}

/* ─── Search overlay ────────────────────────────────────────────────── */

/**
 * Full-page search across all orders (active + archived). Opens from the
 * dashboard "Search" button. Results filter live as the user types; pick
 * one to open it in the modal.
 */
function SearchOverlay({
  orders, query, onQueryChange, onSelectOrder, onClose,
}: {
  orders: Order[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelectOrder: (o: Order) => void;
  onClose: () => void;
}) {
  // Close on Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const results = useMemo(() => {
    if (!query.trim()) return [] as Order[];
    const q = query.trim().toLowerCase();
    return orders
      .filter(o =>
        o.id.toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        (o.sku ?? "").toLowerCase().includes(q) ||
        (o.detail ?? "").toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [orders, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] rounded-panel overflow-hidden flex flex-col animate-slide-in"
        style={{
          background: "rgba(87, 98, 87, 0.28)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: "0.5px solid rgba(145, 165, 151, 0.30)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Search className="w-4 h-4 text-cream/55 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by order #, customer, SKU…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="global-search-no-autofill"
            className="flex-1 bg-transparent text-cream placeholder:text-cream/40 focus:outline-none text-[15px]"
          />
          <kbd className="text-[10px] text-cream/45 px-1.5 py-0.5 rounded border border-white/15 bg-white/5">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {!query.trim() && (
            <div className="px-5 py-12 text-center text-cream/40 text-sm">
              Start typing to search across all orders.
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <div className="px-5 py-12 text-center text-cream/40 text-sm">
              No orders match <span className="text-cream/65">&ldquo;{query}&rdquo;</span>.
            </div>
          )}
          {results.map(o => (
            <button
              key={o.id}
              onClick={() => onSelectOrder(o)}
              className="w-full text-left px-5 py-3 border-b border-white/5 hover:bg-white/8 transition-colors flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[10px] text-cream/45">{displayOrderNumber(o)}</span>
                  <span className="text-[9px] uppercase tracking-wider text-cream/55">{o.stage}</span>
                  {o.archived && (
                    <span className="text-[9px] uppercase tracking-wider text-cream/45 px-1.5 py-px rounded-full border border-white/15">archived</span>
                  )}
                </div>
                <div className="font-display text-[16px] text-cream truncate">{o.name}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-cream/40 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Backorders ────────────────────────────────────────────────────── */

/**
 * Inline dashboard card showing the aggregate backorder picture. Only renders
 * when there's at least one backordered SKU on an active order. Links through
 * to the dedicated /backorders page for the deeper view.
 *
 * Visible metrics, in order of glanceability:
 *   - Headline count: N SKUs across M orders
 *   - "Worst offender": the SKU appearing on the most orders (most-impactful
 *     phone call to make to the vendor)
 *   - Pill row: how many SKUs have overdue commitments vs. undated
 */
function BackorderPanel({
  summary,
}: {
  summary: BackorderSummary;
}) {
  const { distinctSkus, affectedOrders, overdueSkus, undatedSkus, topImpact } = summary;

  return (
    <Link
      href="/backorders"
      className="lift-card glass rounded-brand p-5 lg:p-6 flex flex-col gap-4 group"
      style={{ borderLeft: "2px solid #e8b56a" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(232,181,106,0.12)",
              border: "1px solid rgba(232,181,106,0.30)",
            }}
          >
            <PackageX className="w-4 h-4" style={{ color: "#e8b56a" }} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow mb-0.5">Supply</div>
            <h2 className="font-display text-[22px] text-cream leading-none">
              Backordered <em className="italic-storm">SKUs</em>
            </h2>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-cream/45 group-hover:text-cream/85 transition-colors flex-shrink-0" />
      </div>

      {/* Headline numbers */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="font-display text-[42px] leading-none" style={{ color: "#e8b56a" }}>
          {distinctSkus}
        </span>
        <span className="text-[13px] text-cream/65 leading-tight">
          {distinctSkus === 1 ? "SKU" : "SKUs"} across {affectedOrders} {affectedOrders === 1 ? "order" : "orders"}
        </span>
      </div>

      {/* Worst-offender callout — only if a SKU is on multiple orders */}
      {topImpact && topImpact.orderCount > 1 && (
        <div className="text-[12px] text-cream/65 leading-relaxed">
          <span className="font-mono text-cream/85">{topImpact.sku}</span>
          {" is on "}
          <span className="text-cream/85">{topImpact.orderCount} orders</span>
          {topImpact.description ? ` — ${topImpact.description}` : null}
        </div>
      )}

      {/* Status pills — only render the ones that apply */}
      {(overdueSkus > 0 || undatedSkus > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {overdueSkus > 0 && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                background: "rgba(232,144,144,0.15)",
                color: "#e89090",
                border: "0.5px solid rgba(232,144,144,0.45)",
              }}
            >
              {overdueSkus} past commit
            </span>
          )}
          {undatedSkus > 0 && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                background: "rgba(160,160,154,0.12)",
                color: "#cfc8b6",
                border: "0.5px solid rgba(160,160,154,0.35)",
              }}
            >
              {undatedSkus} no date set
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
