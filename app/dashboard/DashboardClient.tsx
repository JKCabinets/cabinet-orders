"use client";

import React, { useMemo, useState, useEffect } from "react";
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


/**
 * Stages merged FOR DISPLAY ONLY on this snapshot.
 *
 * ⚠ THE FLOW IS UNCHANGED. CUSTOM_STAGES still has six entries and must: the
 * stage rail, backward-move detection, fieldsToClearOnBackwardMove and the SLA
 * rules all read STAGE_LIST_BY_TYPE / CUSTOM_STAGE_ORDER. Merging there would
 * be a real change to how custom orders move, not a layout tweak.
 *
 * Custom's "In production" and "At cross dock" are one thing to a designer --
 * the job is being built and delivered, both scheduled by conversation -- so on
 * a five-across snapshot they read as one segment. It also keeps every row at
 * five, which is what removes the horizontal scroll.
 *
 * The COUNT is the sum, so nothing disappears: an order at cross dock is still
 * counted, just under a wider heading.
 */
/**
 * The narrowest a chevron can get before its label stops being readable, and
 * the width reserved for the type name. Together they set the point at which
 * the snapshot starts scrolling instead of shrinking.
 */
const MIN_SEG = 104;
const LABEL_W = 104;

const DISPLAY_MERGE: Record<string, { label: string; stages: readonly string[] }[]> = {
  custom: [{ label: "Production & delivery", stages: ["In production", "At cross dock"] }],
};

function mergeForDisplay(
  type: OrderType,
  segments: { stage: string; count: number }[],
): { stage: string; count: number }[] {
  const merges = DISPLAY_MERGE[type];
  if (!merges) return segments;

  const out: { stage: string; count: number }[] = [];
  const consumed = new Set<string>();

  for (const seg of segments) {
    if (consumed.has(seg.stage)) continue;
    const m = merges.find((x) => x.stages[0] === seg.stage);
    if (!m) { out.push(seg); continue; }
    // Sum every stage in the group, and mark them consumed so the later ones
    // are not also emitted on their own.
    let total = 0;
    for (const s of m.stages) {
      total += segments.find((x) => x.stage === s)?.count ?? 0;
      consumed.add(s);
    }
    out.push({ stage: m.label, count: total });
  }
  return out;
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
      // ⚠ FIVE, not six. The panel sits beside the pipeline snapshot, which is
      // five rows tall -- a sixth entry made the left column taller than
      // anything on the right could fill. A dashboard list is a glance with a
      // "view all" beneath it, so the cap is a layout decision as much as an
      // editorial one.
      .slice(0, 5);
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
      const raw = stages.map((s) => ({ stage: s, count: live.filter((o) => o.stage === s).length }));
      return {
        type,
        label: TYPE_LABEL[type] ?? type,
        Icon: TYPE_ICON[type] ?? Boxes,
        // ⚠ EACH FLOW RENDERS ITS OWN STAGES. Cabinets run five, hardware and
        // samples three, warranty five. A fixed grid would either invent stages
        // or hide them.
        segments: mergeForDisplay(type, raw),
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
              className="lift-card glass-sage rounded-panel px-4 py-3 flex items-center gap-3.5 group"
            >
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: `${t.color}1f`, border: `0.5px solid ${t.color}55` }}
              >
                <t.Icon className="w-4 h-4" style={{ color: t.color }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-cream/55">{t.label}</span>
                <span className="block font-display text-[26px] leading-none" style={{ color: t.color }}>
                  {t.count}
                </span>
                <span className="block text-[10px] text-cream/35 mt-0.5 truncate">{t.sub}</span>
              </span>
              <ChevronRight className="w-4 h-4 text-cream/25 group-hover:text-cream/60 transition-colors flex-shrink-0" />
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">

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
                      className="grid grid-cols-[1.5fr_0.8fr_0.9fr_0.7fr] gap-3 py-1.5 text-left transition-colors hover:bg-white/4"
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
          <div className="glass-sage rounded-panel p-5">
            <h2 className="font-display text-[22px] text-cream mb-3">
              Pipeline <em className="italic-storm">snapshot</em>
            </h2>

            {/* ⚠ FLUID, WITH A FLOOR. Cells share the width equally and only
                scroll once they would go below MIN_SEG -- fixed widths left
                dead space on a wide screen AND forced a scroll on a narrow one
                even where three segments would have fitted.

                The scroll lives HERE, around the grid, so the panel's padding
                and heading stay put while only the chart moves. */}
            <div className="overflow-x-auto -mx-1 px-1">
              <div style={{ minWidth: `${LABEL_W + maxStages * MIN_SEG}px` }}>

                {/* ⚠ ONE GRID FOR EVERY ROW, sized by the LONGEST flow. A
                    three-stage row must line up column-for-column with a
                    five-stage one, so the track count comes from maxStages and
                    a short flow simply leaves its trailing cells empty. Sizing
                    each row by its own length would stagger the columns. */}
                <div
                  className="grid items-center"
                  style={{
                    gridTemplateColumns: `${LABEL_W}px repeat(${maxStages}, minmax(${MIN_SEG}px, 1fr))`,
                  }}
                >
                  <span className="text-[9px] uppercase tracking-wider text-cream/35 pb-1.5">
                    Order type
                  </span>
                  {Array.from({ length: maxStages }, (_, i) => (
                    <span key={i} className="text-[9px] uppercase tracking-wider text-cream/35 pb-1.5 pl-3">
                      Stage {i + 1}
                    </span>
                  ))}

                  {pipelines.map((p, rowIdx) => (
                    <React.Fragment key={p.type}>
                      {/* ⚠ ONE LINE ACROSS THE WHOLE ROW, drawn as its own
                          full-width grid item.

                          Per-cell borderTop was drawn on the label and the
                          filled stage cells but NOT on the empty trailing
                          cells of a short flow -- so the line ran under
                          hardware's three stages and stopped dead. A grid
                          cannot draw a border across cells; it needs an
                          element that spans them. */}
                      {rowIdx > 0 && (
                        <span
                          style={{
                            gridColumn: `1 / span ${maxStages + 1}`,
                            borderTop: "0.5px solid rgba(255,255,255,0.07)",
                          }}
                        />
                      )}
                      {/* ⚠ THE SEPARATOR IS ON THE LABEL CELL ONLY, and the
                          stage cells carry their own only where a segment
                          exists. In a CSS grid every cell draws its own border,
                          so putting one on all of them left hairlines floating
                          in the blank space past the end of a three-stage flow.
                          The first row has none at all -- the header above it
                          already separates. */}
                      <span
                        className="flex items-center gap-2 py-2 pr-2 min-w-0"
                      >
                        <p.Icon className="w-3.5 h-3.5 text-cream/40 flex-shrink-0" />
                        <span className="text-[12px] text-cream/80 truncate">{p.label}</span>
                      </span>

                      {Array.from({ length: maxStages }, (_, i) => {
                        const s = p.segments[i];
                        // Past the end of a short flow: an empty cell that
                        // holds the column open, drawn as nothing.
                        // Past the end of a short flow: an empty cell holding
                        // the column open, drawing NOTHING. It used to carry a
                        // borderTop, which is where the hairlines trailing off
                        // into blank space came from.
                        if (!s) return <span key={i} className="py-2" />;
                        const terminal = i === p.segments.length - 1;
                        const has = s.count > 0;
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
                          <span key={i} className="py-2 min-w-0">
                            <span
                              className="flex items-center justify-between gap-1 pl-3 pr-4 py-2 text-[11px] min-w-0"
                              style={{
                                background: bg,
                                borderTop: `0.5px solid ${border}`,
                                borderBottom: `0.5px solid ${border}`,
                                borderLeft: i === 0 ? `0.5px solid ${border}` : "none",
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
                          </span>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
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
              ⚠ EVERY CHECK THE KEY CAN SEE, not a hardcoded pair. Naming two in
              code would hide a cron added next month -- which is the same shape
              as the failure this panel exists for. */}
          <SystemHealthPanel />
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
/**
 * System health, read from healthchecks.io.
 *
 * ⚠ WHY IT IS HERE. On 2026-08-20 three ping URLs were pasted carrying angle
 * brackets. Every ping returned HTTP 400 and the caller discarded the result --
 * jobs ran, cron logged rc=0, and the dead-man's switch was dead for six days.
 * The only visible symptom was a stale timestamp on a dashboard nobody opened.
 * This is that dashboard, put where it will be seen.
 *
 * It renders three distinct states and never conflates them: not configured,
 * upstream unreachable, and the real list. A panel that shows green because it
 * failed to ask is worse than no panel.
 */
/**
 * The eleven healthchecks, rolled up to three concerns.
 *
 * ⚠ THE FULL LIST LIVES ON /admin. Eleven rows on a dashboard is a list nobody
 * reads, and a check named `jk-orphan-mapping` means nothing to somebody
 * entering orders. Three rows answer the question a team member actually has:
 * is the system doing its job?
 *
 * ⚠ EACH ROW TAKES THE WORST STATUS IN ITS GROUP. One check down turns the row
 * red -- a problem cannot hide behind nine green siblings, which is the whole
 * point of a rollup rather than an average.
 *
 * ⚠ AND ANYTHING UNMAPPED FALLS INTO "Other", which appears ONLY when it has
 * members. Without it a check added next month would be invisible -- exactly
 * the failure this panel was built for, in different clothes.
 */
const HEALTH_GROUPS: { label: string; detail: string; checks: string[] }[] = [
  {
    label: "Shopify ingest",
    detail: "Orders arriving from the storefront",
    checks: ["jk-webhook-health", "jk-storefront", "jk-stale-sync"],
  },
  {
    label: "Catalog sync",
    detail: "Products and SKU mappings current",
    checks: ["sync-avis-catalog", "jk-sync-failure", "jk-orphan-mapping",
             "jk-option-rename", "jk-new-option-values"],
  },
  {
    label: "Scheduled jobs",
    detail: "Nightly and hourly automation",
    checks: ["production-complete", "teams-digest", "jk-orders-overdue"],
  },
];

/** down beats grace beats new/paused beats up -- the worst wins. */
function worstStatus(statuses: string[]): string {
  const rank = (s: string) =>
    s === "down" ? 0 : s === "grace" ? 1 : s === "new" ? 2 : s === "paused" ? 3 : 4;
  return statuses.slice().sort((a, b) => rank(a) - rank(b))[0] ?? "up";
}

function SystemHealthPanel() {
  const [state, setState] = useState<{
    loading: boolean;
    configured: boolean;
    error?: string;
    checks: { name: string; status: string; last_ping: string | null; schedule: string | null }[];
  }>({ loading: true, configured: false, checks: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/health");
        const body = await res.json();
        if (!cancelled) {
          setState({
            loading: false,
            configured: !!body.configured,
            error: body.error,
            checks: body.checks ?? [],
          });
        }
      } catch {
        if (!cancelled) {
          setState({ loading: false, configured: true, error: "Could not load", checks: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const STATUS: Record<string, { label: string; color: string }> = {
    up:     { label: "Healthy", color: "#8fbe70" },
    down:   { label: "Down",    color: "#e08585" },
    grace:  { label: "Late",    color: "#e8b56a" },
    paused: { label: "Paused",  color: "rgba(232,227,218,0.4)" },
    new:    { label: "No pings", color: "rgba(232,227,218,0.4)" },
  };

  /** "5 days ago" beats an ISO timestamp when the question is "is this stale". */
  const ago = (iso: string | null) => {
    if (!iso) return "never";
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  return (
    <div className="glass-sage rounded-panel p-5">
      <h2 className="font-display text-[22px] text-cream mb-3">
        System <em className="italic-storm">health</em>
      </h2>

      {state.loading ? (
        <p className="text-[12px] text-cream/45 py-4">Checking…</p>
      ) : !state.configured ? (
        <>
          <p className="text-[12px] text-cream/55">Not configured.</p>
          <p className="text-[10px] text-cream/30 mt-2 leading-relaxed">
            Set HEALTHCHECKS_API_KEY in .env.kamal <em>and</em> add it to the
            secret list in config/deploy.yml — one without the other reaches
            nothing, and Kamal does not warn. The crons still email on failure.
          </p>
        </>
      ) : state.error ? (
        <>
          <p className="text-[12px]" style={{ color: "#e8b56a" }}>{state.error}</p>
          <p className="text-[10px] text-cream/30 mt-2">
            The monitor is unreachable — which is not the same as a job failing,
            and does not mean anything is wrong with the app.
          </p>
        </>
      ) : state.checks.length === 0 ? (
        <p className="text-[12px] text-cream/45 py-4">No checks on this account.</p>
      ) : (
        <>
          <div className="flex flex-col">
            {(() => {
              const byName = new Map(state.checks.map((c) => [c.name, c]));
              const claimed = new Set<string>();
              const rows = HEALTH_GROUPS.map((g) => {
                const members = g.checks
                  .map((n) => { claimed.add(n); return byName.get(n); })
                  .filter((c): c is NonNullable<typeof c> => !!c);
                return { ...g, members };
              }).filter((g) => g.members.length > 0);

              // Anything the groups above do not name. Hidden while empty --
              // visible the moment a check is added and nobody maps it.
              const orphans = state.checks.filter((c) => !claimed.has(c.name));
              if (orphans.length > 0) {
                rows.push({
                  label: "Other checks",
                  detail: `${orphans.length} not grouped — see /admin`,
                  checks: orphans.map((o) => o.name),
                  members: orphans,
                });
              }

              return rows.map((g) => {
                const status = worstStatus(g.members.map((m) => m.status));
                const s = STATUS[status] ?? { label: status, color: "rgba(232,227,218,0.4)" };
                const oldest = g.members
                  .map((m) => m.last_ping)
                  .filter((p): p is string => !!p)
                  .sort()[0] ?? null;
                return (
                  <div key={g.label}
                    className="flex items-center justify-between gap-3 py-3"
                    style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                    <span className="min-w-0">
                      <span className="block text-[12px] text-cream/80 truncate">{g.label}</span>
                      <span className="block text-[10px] text-cream/35 truncate">
                        {g.detail} · {g.members.length} check{g.members.length === 1 ? "" : "s"}
                        {oldest ? ` · oldest ${ago(oldest)}` : ""}
                      </span>
                    </span>
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                      style={{ background: `${s.color}1f`, color: s.color, border: `0.5px solid ${s.color}55` }}>
                      {s.label}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
          <Link href="/admin" className="block mt-3 text-[11px] text-cream/45 hover:text-cream/80 transition-colors">
            All {state.checks.length} checks →
          </Link>
        </>
      )}
    </div>
  );
}

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
