"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  Order, OrderStage, OrderType, AVATAR_COLOR_STYLES, Stage,
  STAGE_ACCENT, STAGE_LIST_BY_TYPE, nextStageFor,
} from "@/lib/data";
import {
  SLA_RULES, slaTier, slaRuleFor, hoursInStage, slaAgeHours, formatStageAge,
} from "@/lib/sla";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AlertTriangle, ArrowRight, Archive, Search, User } from "lucide-react";
import { SlaHealthByType, type SlaTypeRow } from "@/components/SlaHealthByType";
import clsx from "clsx";

// Tracked stages are DERIVED per type: the stages of that type's own flow
// that carry a rule in SLA_RULES. There is no hardcoded list here any more,
// so adding a stage or a type grows this page without editing it.
//
// Stage colours come from lib/data's STAGE_ACCENT rather than a private
// copy, and the next stage from nextStageFor rather than a hardcoded map
// that only knew the standard order flow.
const CATEGORIES: { key: OrderType; label: string }[] = [
  { key: "order",    label: "Standard orders" },
  { key: "custom",   label: "Custom orders" },
  { key: "sample",   label: "Sample orders" },
  { key: "warranty", label: "Warranty claims" },
];

export function SLAClient() {
  const {
    orders, customs, samples, warranties,
    team, claimOrder, moveStage, archiveOrder,
  } = useStore();
  const { data: session } = useSession();
  // See OrderTable for the full story. We standardize on team_members.id
  // (post-v18 migration) for ALL ownership comparisons — immutable,
  // survives renames. Render display name via team.find(m => m.id === ...).
  const sessUser = session?.user as { id?: string; name?: string; username?: string } | undefined;
  const currentUserId = sessUser?.id ?? null;

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // ─── Per-category rollup ──────────────────────────────────────────
  // Each order type is its own category with its own stages, rules and
  // overdue list. Stages come from the intersection of the type's flow
  // (STAGE_LIST_BY_TYPE) and the stages that actually carry a rule, so a
  // stage with no SLA -- Delivered, or warranty's Parts ordered -- is simply
  // absent rather than special-cased.
  const categories = useMemo(() => {
    const now = Date.now();
    const lists: Record<OrderType, Order[]> = {
      order: orders, custom: customs, sample: samples, warranty: warranties,
    };
    return CATEGORIES.map(({ key, label }) => {
      const rows = (lists[key] ?? []).filter(o => !o.archived);
      const rules = SLA_RULES[key] ?? {};
      // EVERY stage in the flow, not only those carrying an SLA rule. A
      // stage with no rule -- Delivered, warranty's Parts ordered -- still
      // holds orders, and a "Stage breakdown" that omits stages is
      // misleading. Rule-less stages show their count and a dash in the SLA
      // columns: they have orders, they just have no clock.
      const stages = STAGE_LIST_BY_TYPE[key] ?? [];

      const overdueByStage: Record<string, Order[]> = {};
      for (const s of stages) overdueByStage[s] = [];
      let totalFlagged = 0;
      for (const o of rows) {
        if (slaTier(o, now) === "ok") continue;
        if (!overdueByStage[o.stage]) continue;
        overdueByStage[o.stage].push(o);
        totalFlagged++;
      }
      // Worst offenders first.
      for (const s of stages) {
        overdueByStage[s].sort(
          (a, b) => (hoursInStage(b, now) ?? 0) - (hoursInStage(a, now) ?? 0));
      }

      const trends = stages.map(stage => {
        const inStage = rows.filter(o => o.stage === stage);
        const rule = rules[stage];
        const hasRule = !!rule;
        const soft = rule?.softHours ?? 24;
        const hard = rule?.hardHours ?? 48;

        // Only rows whose clock is RUNNING get bucketed. In production and
        // At cross dock stop their clock once the awaited dates exist, so
        // bucketing everything would report "3 over 48h" beside "0 past
        // target". `count` stays the true population of the stage.
        // No rule means no clock: bucketing those rows would invent an SLA
        // judgement the system is not making.
        const measured = hasRule
          ? inStage.filter(o => !rule?.clockRuns || rule.clockRuns(o))
          : [];

        // Aged on each row's OWN clock: New runs on the order date, so a
        // bounced order shows its real age rather than a reset stage clock.
        const ages = measured
          .map(o => (rule ? slaAgeHours(o, rule, now) : hoursInStage(o, now)))
          .filter((h): h is number => h !== null);

        const buckets = {
          fresh: ages.filter(h => h < soft).length,
          warn: ages.filter(h => h >= soft && h < hard).length,
          over: ages.filter(h => h >= hard).length,
        };
        const oldestHours = ages.length === 0 ? null : Math.max(...ages);
        const flaggedCount = inStage.filter(o => slaTier(o, now) !== "ok").length;

        return {
          stage,
          hasRule,
          count: inStage.length,
          measuredCount: measured.length,
          buckets,
          oldestHours,
          softHours: soft,
          hardHours: hard,
          waitingFor: rule?.waitingFor,
          measuresFrom: rule?.measureFrom === "created" ? "created" : "stage",
          flaggedCount,
        };
      });

      return { key, label, rows, stages, trends, overdueByStage, totalFlagged };
    });
  }, [orders, customs, samples, warranties]);

  // ─── Cross-type views ─────────────────────────────────────────────
  const allActive = useMemo(
    () => [...orders, ...customs, ...samples, ...warranties].filter(o => !o.archived),
    [orders, customs, samples, warranties],
  );

  /**
   * Everything past target, worst first. Each entry carries WHERE its clock is
   * measured from, so the row can say "27d old" for New and "27d in stage"
   * elsewhere rather than mislabelling one of them.
   */
  const flagged = useMemo(() => {
    const now = Date.now();
    const out: FlaggedEntry[] = [];
    for (const o of allActive) {
      const tier = slaTier(o, now);
      if (tier === "ok") continue;
      const rule = slaRuleFor(o);
      const hours = rule ? (slaAgeHours(o, rule, now) ?? 0) : 0;
      out.push({
        order: o, hours, tier,
        from: rule?.measureFrom === "created" ? "created" : "stage",
      });
    }
    return out.sort((a, b) => b.hours - a.hours);
  }, [allActive]);

  const kpis = useMemo(() => {
    const active = allActive.length;
    const past = flagged.length;
    return {
      active,
      past,
      withinPct: active === 0 ? 0 : Math.round(((active - past) / active) * 100),
      oldest: flagged[0] ?? null,
    };
  }, [allActive, flagged]);

  /**
   * One row per type for the shared table. Counts only rows whose clock is
   * RUNNING -- an order sitting in production with its dates set is not "on
   * track", it simply has no clock, and counting it either way would mislead.
   */
  const typeRows: SlaTypeRow[] = useMemo(() => {
    const now = Date.now();
    return categories.map(c => {
      let onTrack = 0, overSoft = 0, overHard = 0;
      let oldestHours: number | null = null;
      let oldestFrom: "created" | "stage" = "stage";
      for (const o of c.rows) {
        const rule = slaRuleFor(o);
        if (!rule) continue;
        if (rule.clockRuns && !rule.clockRuns(o)) continue;
        const t = slaTier(o, now);
        if (t === "hard") overHard++;
        else if (t === "soft") overSoft++;
        else onTrack++;
        const h = slaAgeHours(o, rule, now);
        if (h !== null && (oldestHours === null || h > oldestHours)) {
          oldestHours = h;
          oldestFrom = rule.measureFrom === "created" ? "created" : "stage";
        }
      }
      return {
        key: c.key, label: c.label, active: c.rows.length,
        onTrack, overSoft, overHard, oldestHours, oldestFrom,
      };
    });
  }, [categories]);

  // ─── Section 4: stage breakdown, one type at a time ───────────────
  const [breakdownType, setBreakdownType] = useState<OrderType>("order");
  const breakdown = categories.find(c => c.key === breakdownType) ?? categories[0];

  // ─── Section 5: all orders ────────────────────────────────────────
  const allOrdersRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  /** Apply a filter and scroll to the table, so "view all" stays on-page. */
  function jumpToAllOrders(next: { type?: string; status?: string }) {
    if (next.type !== undefined) setFilterType(next.type);
    if (next.status !== undefined) setFilterStatus(next.status);
    allOrdersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const visibleOrders = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return allActive
      .filter(o => {
        if (filterType !== "all" && o.type !== filterType) return false;
        if (filterStatus !== "all") {
          const past = slaTier(o, now) !== "ok";
          if (filterStatus === "past" && !past) return false;
          if (filterStatus === "ontrack" && past) return false;
        }
        if (!q) return true;
        return (
          o.id.toLowerCase().includes(q)
          || (o.name ?? "").toLowerCase().includes(q)
          || (o.stage ?? "").toLowerCase().includes(q)
        );
      })
      .map(o => {
        const rule = slaRuleFor(o);
        const running = !!rule && (!rule.clockRuns || rule.clockRuns(o));
        return {
          order: o,
          tier: slaTier(o, now),
          hours: rule ? slaAgeHours(o, rule, now) : null,
          from: (rule?.measureFrom === "created" ? "created" : "stage") as "created" | "stage",
          running,
        };
      })
      .sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1));
  }, [allActive, search, filterType, filterStatus]);

  // ─── Hydration ───────────────────────────────────────────────────
  // The store is populated CLIENT-side, so the server renders an empty
  // page and the client renders real data -- React #418. Ages compound it:
  // they come from Date.now(), which differs between the two passes.
  //
  // Render only the header until mounted, so both passes agree. All hooks
  // above run on every render, so this early return is safe.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <AppShell>
        <PageHeader eyebrow="Service levels" title="SLA" accent="deep dive" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Service levels"
        title="SLA"
        accent="deep dive"
      />

      <div className="px-6 lg:px-8 pb-12 space-y-6">

        {/* ── 1. KPI row ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
          <KpiCard
            value={String(kpis.past)}
            color={kpis.past > 0 ? "#e89090" : "#a0cc7a"}
            label="Past SLA"
            hint={kpis.past > 0 ? "Orders past their SLA · need action" : "Everything on track"}
          />
          <KpiCard
            value={String(kpis.active)}
            color="#7aa2d0"
            label="Active orders"
            hint="Across all order types"
          />
          <KpiCard
            value={kpis.active === 0 ? "—" : `${kpis.withinPct}%`}
            color="#a0cc7a"
            label="Within SLA"
            hint={kpis.active === 0
              ? "No active orders"
              : `${kpis.active - kpis.past} of ${kpis.active} active orders on track`}
          />
          <KpiCard
            value={kpis.oldest ? formatStageAge(kpis.oldest.hours) : "—"}
            color={kpis.oldest ? "#d4922a" : "rgba(232,227,218,0.45)"}
            label="Oldest past SLA"
            hint={kpis.oldest
              ? `${kpis.oldest.order.id} in ${kpis.oldest.order.stage}`
              : "Nothing past target"}
          />
        </div>

        {/* ── 2. Needs attention ──────────────────────────────────── */}
        <div className="glass-sage rounded-panel p-5 lg:p-6">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <div>
              <div className="eyebrow mb-1">Needs attention</div>
              <p className="text-[12px] text-cream/55">Orders past their SLA</p>
            </div>
            <span
              className="text-[12px] flex-shrink-0"
              style={{ color: flagged.length > 0 ? "#e89090" : "rgba(232,227,218,0.45)" }}
            >
              {flagged.length} order{flagged.length === 1 ? "" : "s"}
            </span>
          </div>

          {flagged.length === 0 ? (
            <p className="text-[12px] text-cream/45">Nothing past target.</p>
          ) : (
            <>
              <div className="space-y-2">
                {flagged.slice(0, 5).map(f => (
                  <NeedsAttentionRow
                    key={f.order.id}
                    entry={f}
                    team={team}
                    currentUserId={currentUserId}
                    onOpen={setSelectedOrder}
                    onClaim={(id) => claimOrder(id, currentUserId)}
                  />
                ))}
              </div>
              {flagged.length > 5 && (
                <button
                  onClick={() => jumpToAllOrders({ type: "all", status: "past" })}
                  className="w-full mt-3 py-2 text-[11px] text-cream/55 hover:text-cream/85 transition-colors"
                >
                  View all {flagged.length} past SLA orders →
                </button>
              )}
            </>
          )}
        </div>

        {/* ── 3. SLA health by order type (shared with the dashboard) ─ */}
        <div className="glass-sage rounded-panel p-5 lg:p-6">
          <div className="mb-4">
            <div className="eyebrow mb-1">SLA health by order type</div>
            <p className="text-[12px] text-cream/55">
              Active orders by SLA status — select a row for its stage breakdown
            </p>
          </div>
          <SlaHealthByType
            rows={typeRows}
            selectedKey={breakdownType}
            onSelectType={(k) => setBreakdownType(k as OrderType)}
          />
          <button
            onClick={() => jumpToAllOrders({ type: "all", status: "all" })}
            className="w-full mt-3 py-2 text-[11px] text-cream/55 hover:text-cream/85 transition-colors"
          >
            View all orders →
          </button>
        </div>

        {/* ── 4. Stage breakdown ──────────────────────────────────── */}
        {breakdown && (
          <div className="glass-sage rounded-panel p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="eyebrow">Stage breakdown</div>
              <select
                value={breakdownType}
                onChange={(e) => setBreakdownType(e.target.value as OrderType)}
                className="field-glass px-2.5 py-1 rounded-full text-[11px]"
                style={{ fontSize: "16px" }}
              >
                {categories.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            {breakdown.trends.length === 0 ? (
              <p className="text-[12px] text-cream/45">No stages in this flow carry an SLA.</p>
            ) : (
              <StageBreakdownTable trends={breakdown.trends} />
            )}
          </div>
        )}

        {/* ── 5. All orders ───────────────────────────────────────── */}
        <div ref={allOrdersRef} className="glass-sage rounded-panel p-5 lg:p-6 scroll-mt-4">
          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
            <div>
              <div className="eyebrow mb-1">All orders</div>
              <p className="text-[12px] text-cream/55">Filter and view all active orders</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-cream/35" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search orders…"
                  className="field-glass pl-7 pr-2.5 py-1 rounded-full text-[11px] w-40"
                  style={{ fontSize: "16px" }}
                />
              </div>
              <FilterSelect value={filterType} onChange={setFilterType}
                options={[{ v: "all", l: "All types" }, ...categories.map(c => ({ v: c.key, l: c.label }))]} />
              <FilterSelect value={filterStatus} onChange={setFilterStatus}
                options={[
                  { v: "all", l: "All status" },
                  { v: "past", l: "Past SLA" },
                  { v: "ontrack", l: "On track" },
                ]} />
            </div>
          </div>

          {visibleOrders.length === 0 ? (
            <p className="text-[12px] text-cream/45">No orders match these filters.</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full border-collapse min-w-[720px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "rgba(232,227,218,0.10)" }}>
                    {["Order", "Customer", "Type", "Stage", "Age", "SLA status", "Owner", ""].map((h, i) => (
                      <th key={i} className="py-2 px-2 text-left text-[10px] uppercase tracking-wider font-medium text-cream/40 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map(v => (
                    <AllOrdersRow
                      key={v.order.id}
                      entry={v}
                      team={team}
                      currentUserId={currentUserId}
                      onOpen={setSelectedOrder}
                      onClaim={(id) => claimOrder(id, currentUserId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-cream/35 text-center mt-3">
            Showing {visibleOrders.length} of {allActive.length} active orders
          </p>
        </div>
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStageChange={(s) => setSelectedOrder(prev => prev ? { ...prev, stage: s } : null)}
        />
      )}
    </AppShell>
  );
}


/* ─── SLA page pieces ───────────────────────────────────────────────── */

interface FlaggedEntry {
  order: Order;
  hours: number;
  tier: string;
  from: "created" | "stage";
}

/** Age with the right preposition. New measures from the order date. */
function ageLabel(hours: number | null, from: "created" | "stage"): string {
  if (hours === null) return "—";
  return `${formatStageAge(hours)}${from === "created" ? " old" : " in stage"}`;
}

function KpiCard({ value, color, label, hint }: {
  value: string; color: string; label: string; hint: string;
}) {
  return (
    <div className="glass-sage rounded-panel p-4 lg:p-5">
      <div className="font-display text-[30px] leading-none mb-2" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-cream/55 mb-1">{label}</div>
      <div className="text-[10px] text-cream/35 leading-snug">{hint}</div>
    </div>
  );
}

function FilterSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field-glass px-2.5 py-1 rounded-full text-[11px]"
      style={{ fontSize: "16px" }}
    >
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function SlaBadge({ tier }: { tier: string }) {
  const s = tier === "hard"
    ? { background: "rgba(232,144,144,0.16)", color: "#e89090", border: "0.5px solid rgba(232,144,144,0.45)", text: "Past SLA" }
    : tier === "soft"
      ? { background: "rgba(212,146,42,0.16)", color: "#d4922a", border: "0.5px solid rgba(212,146,42,0.45)", text: "At risk" }
      : { background: "rgba(143,190,112,0.14)", color: "#a0cc7a", border: "0.5px solid rgba(143,190,112,0.35)", text: "On track" };
  return (
    <span className="inline-block text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.background, color: s.color, border: s.border }}>
      {s.text}
    </span>
  );
}

function OwnerCell({ order, team }: { order: Order; team: { id: string; name: string }[] }) {
  const owner = order.claimed_by ? team.find(m => m.id === order.claimed_by) : null;
  if (!owner) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-cream/40">
        <User className="w-3 h-3" /> Unclaimed
      </span>
    );
  }
  return <span className="text-[11px] text-cream/75">{owner.name}</span>;
}

function NeedsAttentionRow({ entry, team, currentUserId, onOpen, onClaim }: {
  entry: FlaggedEntry;
  team: { id: string; name: string }[];
  currentUserId: string | null;
  onOpen: (o: Order) => void;
  onClaim: (id: string) => void;
}) {
  const { order, hours, tier, from } = entry;
  const accent = tier === "hard" ? "#e89090" : "#d4922a";
  return (
    <div
      onClick={() => onOpen(order)}
      className="flex items-center gap-3 rounded-lg cursor-pointer hover:bg-white/[0.03] transition-colors overflow-hidden"
      style={{ border: "0.5px solid rgba(232,227,218,0.08)" }}
    >
      <div className="flex flex-col items-center justify-center px-3 py-3 flex-shrink-0 self-stretch"
        style={{ background: `${accent}1a`, borderRight: `0.5px solid ${accent}44` }}>
        <span className="font-mono text-[15px] leading-none" style={{ color: accent }}>
          {formatStageAge(hours)}
        </span>
        <span className="text-[8px] uppercase tracking-wider mt-1" style={{ color: accent }}>
          {tier === "hard" ? "overdue" : "at risk"}
        </span>
      </div>

      <div className="flex-1 min-w-0 py-2.5 grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 items-center">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-cream truncate">{order.id}</div>
          <div className="text-[11px] text-cream/65 truncate">{order.name}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: STAGE_ACCENT[order.stage] ?? "#a0a09a" }} />
            <span className="text-[11px] text-cream/85 truncate">{order.stage}</span>
          </div>
          <div className="text-[10px] text-cream/40">{ageLabel(hours, from)}</div>
        </div>
        <div className="min-w-0"><OwnerCell order={order} team={team} /></div>
      </div>

      {!order.claimed_by && currentUserId && (
        <button
          onClick={(e) => { e.stopPropagation(); onClaim(order.id); }}
          className="mr-3 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium flex-shrink-0 transition-all"
          style={{ background: "rgba(232,144,144,0.18)", color: "#e89090", border: "0.5px solid rgba(232,144,144,0.45)" }}
        >
          Claim
        </button>
      )}
    </div>
  );
}

/**
 * Per-stage counts for one type. The three buckets are the same numbers the
 * type table shows, split by stage: under soft, soft-to-hard, past hard --
 * counted only across rows whose clock is running.
 */
function StageBreakdownTable({ trends }: {
  trends: Array<{
    stage: string; hasRule: boolean; count: number; measuredCount: number;
    buckets: { fresh: number; warn: number; over: number };
    oldestHours: number | null; softHours: number; hardHours: number;
    waitingFor?: string; measuresFrom: string;
  }>;
}) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse min-w-[640px]">
        <thead>
          <tr className="border-b" style={{ borderColor: "rgba(232,227,218,0.10)" }}>
            <th className="py-2 px-2 text-left text-[10px] uppercase tracking-wider font-medium text-cream/40">Stage</th>
            <th className="py-2 px-2 text-center text-[10px] uppercase tracking-wider font-medium text-cream/40">Active</th>
            <th className="py-2 px-2 text-center text-[10px] uppercase tracking-wider font-medium text-cream/40">On track</th>
            <th className="py-2 px-2 text-center text-[10px] uppercase tracking-wider font-medium text-cream/40">&gt; 24h</th>
            <th className="py-2 px-2 text-center text-[10px] uppercase tracking-wider font-medium text-cream/40">&gt; 48h</th>
            <th className="py-2 px-2 text-right text-[10px] uppercase tracking-wider font-medium text-cream/40">Oldest</th>
            <th className="py-2 px-2 text-left text-[10px] uppercase tracking-wider font-medium text-cream/40 w-32">Status</th>
          </tr>
        </thead>
        <tbody>
          {trends.map(t => {
            const total = Math.max(1, t.measuredCount);
            const pct = (n: number) => `${(n / total) * 100}%`;
            const ageWord = t.measuresFrom === "created" ? " old" : "";
            return (
              <tr key={t.stage} className="border-b" style={{ borderColor: "rgba(232,227,218,0.06)" }}>
                <td className="py-3 px-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: STAGE_ACCENT[t.stage] ?? "#a0a09a" }} />
                    <span className="text-[12px] text-cream/85 whitespace-nowrap">{t.stage}</span>
                  </div>
                  {t.waitingFor && (
                    <div className="text-[9px] text-cream/35 pl-3">awaiting {t.waitingFor}</div>
                  )}
                </td>
                <td className="py-3 px-2 text-center text-[12px] font-mono text-cream/85">{t.count}</td>
                {t.hasRule ? (
                  <>
                    <td className="py-3 px-2 text-center text-[12px] font-mono"
                      style={{ color: t.buckets.fresh > 0 ? "#a0cc7a" : "rgba(232,227,218,0.30)" }}>{t.buckets.fresh}</td>
                    <td className="py-3 px-2 text-center text-[12px] font-mono"
                      style={{ color: t.buckets.warn > 0 ? "#d4922a" : "rgba(232,227,218,0.30)" }}>{t.buckets.warn}</td>
                    <td className="py-3 px-2 text-center text-[12px] font-mono"
                      style={{ color: t.buckets.over > 0 ? "#e89090" : "rgba(232,227,218,0.30)" }}>{t.buckets.over}</td>
                    <td className="py-3 px-2 text-right text-[11px] font-mono text-cream/65 whitespace-nowrap">
                      {t.oldestHours === null ? "—" : `${formatStageAge(t.oldestHours)}${ageWord}`}
                    </td>
                  </>
                ) : (
                  /* No SLA rule on this stage. Show the count, and dashes rather
                     than zeroes -- a zero would claim nothing is overdue, when
                     the truth is that nothing is being measured. */
                  <td colSpan={4} className="py-3 px-2 text-center text-[10px] text-cream/30">
                    no SLA on this stage
                  </td>
                )}
                <td className="py-3 px-2">
                  {t.measuredCount === 0 ? (
                    <div className="h-1.5 rounded-full bg-white/6" />
                  ) : (
                    <div className="h-1.5 rounded-full overflow-hidden flex bg-white/6">
                      {t.buckets.fresh > 0 && <div style={{ width: pct(t.buckets.fresh), background: "rgba(143,190,112,0.55)" }} />}
                      {t.buckets.warn > 0 && <div style={{ width: pct(t.buckets.warn), background: "#d4922a" }} />}
                      {t.buckets.over > 0 && <div style={{ width: pct(t.buckets.over), background: "#e89090" }} />}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AllOrdersRow({ entry, team, currentUserId, onOpen, onClaim }: {
  entry: { order: Order; tier: string; hours: number | null; from: "created" | "stage"; running: boolean };
  team: { id: string; name: string }[];
  currentUserId: string | null;
  onOpen: (o: Order) => void;
  onClaim: (id: string) => void;
}) {
  const { order, tier, hours, from, running } = entry;
  const typeLabel = CATEGORIES.find(c => c.key === order.type)?.label ?? order.type;
  return (
    <tr
      onClick={() => onOpen(order)}
      className="border-b cursor-pointer hover:bg-white/[0.03] transition-colors"
      style={{ borderColor: "rgba(232,227,218,0.06)" }}
    >
      <td className="py-2.5 px-2 text-[11px] font-mono text-cream whitespace-nowrap">{order.id}</td>
      <td className="py-2.5 px-2 text-[11px] text-cream/75 max-w-[160px] truncate">{order.name}</td>
      <td className="py-2.5 px-2 text-[11px] text-cream/55 whitespace-nowrap">{typeLabel}</td>
      <td className="py-2.5 px-2">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: STAGE_ACCENT[order.stage] ?? "#a0a09a" }} />
          <span className="text-[11px] text-cream/85 whitespace-nowrap">{order.stage}</span>
        </div>
      </td>
      <td className="py-2.5 px-2 text-[11px] font-mono whitespace-nowrap"
        style={{ color: tier === "hard" ? "#e89090" : tier === "soft" ? "#d4922a" : "rgba(232,227,218,0.55)" }}>
        {running ? ageLabel(hours, from) : "—"}
      </td>
      <td className="py-2.5 px-2">
        {running ? <SlaBadge tier={tier} /> : <span className="text-[10px] text-cream/30">no clock</span>}
      </td>
      <td className="py-2.5 px-2"><OwnerCell order={order} team={team} /></td>
      <td className="py-2.5 px-2 text-right">
        {!order.claimed_by && currentUserId && (
          <button
            onClick={(e) => { e.stopPropagation(); onClaim(order.id); }}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/5 border border-cream/15 text-cream/75 hover:bg-white/10"
          >
            Claim
          </button>
        )}
      </td>
    </tr>
  );
}

/* ─── Stage aging ───────────────────────────────────────────────────── */

/**
 * One stage's queue, as a shape rather than an average.
 *
 * A segmented bar splits the rows whose clock is running into under-soft,
 * soft-to-hard and over-hard, and the oldest is called out separately because
 * that is the row you act on. An average across one or two orders told you
 * nothing an individual row did not.
 */
function StageAgingRow({ trend }: {
  trend: {
    stage: string;
    count: number;
    measuredCount: number;
    buckets: { fresh: number; warn: number; over: number };
    oldestHours: number | null;
    softHours: number;
    hardHours: number;
    waitingFor?: string;
    measuresFrom: string;
    flaggedCount: number;
  };
}) {
  const t = trend;
  const total = Math.max(1, t.measuredCount);
  const pct = (n: number) => `${(n / total) * 100}%`;
  const color = STAGE_ACCENT[t.stage] ?? "#a0a09a";
  const ageWord = t.measuresFrom === "created" ? "old" : "in stage";

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="text-[12px] text-cream/85">{t.stage}</span>
        {t.waitingFor && (
          <span className="text-[10px] text-cream/40">awaiting {t.waitingFor}</span>
        )}
        <span className="text-[10px] text-cream/40 ml-auto">
          {t.count} in stage
          {t.measuredCount !== t.count && ` · ${t.measuredCount} on the clock`}
        </span>
        <span
          className="text-[11px] font-mono"
          style={{ color: t.flaggedCount > 0 ? "#e89090" : "rgba(232,227,218,0.45)" }}
        >
          {t.oldestHours === null
            ? "—"
            : `oldest ${formatStageAge(t.oldestHours)} ${ageWord}`}
        </span>
      </div>

      {t.measuredCount === 0 ? (
        <div className="h-1.5 rounded-full bg-white/6" />
      ) : (
        <div className="h-1.5 rounded-full overflow-hidden flex bg-white/6">
          {t.buckets.fresh > 0 && (
            <div style={{ width: pct(t.buckets.fresh), background: "rgba(143,190,112,0.55)" }} />
          )}
          {t.buckets.warn > 0 && (
            <div style={{ width: pct(t.buckets.warn), background: "#d4922a" }} />
          )}
          {t.buckets.over > 0 && (
            <div style={{ width: pct(t.buckets.over), background: "#e89090" }} />
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mt-1 text-[10px]">
        <span className="text-cream/40">{t.buckets.fresh} under {t.softHours}h</span>
        <span style={{ color: t.buckets.warn > 0 ? "#d4922a" : "rgba(232,227,218,0.30)" }}>
          {t.buckets.warn} over {t.softHours}h
        </span>
        <span style={{ color: t.buckets.over > 0 ? "#e89090" : "rgba(232,227,218,0.30)" }}>
          {t.buckets.over} over {t.hardHours}h
        </span>
      </div>
    </div>
  );
}

/* ─── Overdue stage block ───────────────────────────────────────────── */

function OverdueStageBlock({
  stage, orders, team, currentUserId, onOpenOrder,
  onClaim, onAdvance, onArchive,
}: {
  // `string`, not OrderStage: this block now renders warranty and custom
  // stages too, which are not members of OrderStage.
  stage: string;
  orders: Order[];
  team: Array<{ id: string; name: string; username: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserId: string | null;
  onOpenOrder: (o: Order) => void;
  onClaim: (id: string) => Promise<unknown>;
  onAdvance: (id: string, target: Stage) => Promise<unknown>;
  onArchive: (id: string) => Promise<unknown>;
}) {
  const color = STAGE_ACCENT[stage] ?? "#a0a09a";
  // Rule and next stage both come from the FIRST row, because a block only
  // ever holds rows of one type at one stage.
  const rule = orders.length > 0 ? slaRuleFor(orders[0]) : undefined;
  const next = orders.length > 0 ? nextStageFor(orders[0]) : undefined;

  return (
    <div className="glass-sage rounded-panel overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/10">
        <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
        <h3 className="font-display text-[17px] text-cream">
          {stage}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-cream/45 ml-auto">
          {rule ? `${rule.softHours}h / ${rule.hardHours}h` : "—"}
          {rule?.waitingFor ? ` awaiting ${rule.waitingFor}` : ""}
          {` · ${orders.length} past target`}
        </span>
      </div>

      <div className="divide-y divide-white/5">
        {orders.map(o => (
          <OverdueRow
            key={o.id}
            order={o}
            team={team}
            currentUserId={currentUserId}
            color={color}
            nextStage={next}
            onOpen={() => onOpenOrder(o)}
            onClaim={() => onClaim(o.id)}
            onAdvance={next ? () => onAdvance(o.id, next) : undefined}
            onArchive={() => onArchive(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

function OverdueRow({
  order, team, currentUserId, color, nextStage,
  onOpen, onClaim, onAdvance, onArchive,
}: {
  order: Order;
  team: Array<{ id: string; name: string; username: string; initials: string; avatarColor: keyof typeof AVATAR_COLOR_STYLES }>;
  currentUserId: string | null;
  color: string;
  nextStage?: Stage;
  onOpen: () => void;
  onClaim: () => Promise<unknown>;
  onAdvance?: () => Promise<unknown>;
  onArchive: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const hours = hoursInStage(order);
  const tier = slaTier(order);
  const rule = slaRuleFor(order);
  // Terracotta past the hard threshold, amber past the soft one.
  const tierColor = tier === "hard" ? "#e89090" : "#d4922a";

  // Stage-aware owner (matches the rest of the app)
  const isNew = order.stage === "New";
  const ownerName = isNew ? order.claimed_by ?? null : order.entered_by ?? order.claimed_by ?? null;
  // ownerName is now a team_members.id (post-v18 migration); lookup by id.
  const ownerMember = ownerName ? team.find(m => m.id === ownerName) : null;
  const ownerInitials = ownerMember?.initials ?? (ownerName ? ownerName.slice(0, 2).toUpperCase() : "");
  const ownerStyle = ownerMember
    ? AVATAR_COLOR_STYLES[ownerMember.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-white/4 transition-colors">
      {/* Days-over badge */}
      <div
        className="flex flex-col items-center justify-center rounded-brand px-2.5 py-1.5 flex-shrink-0"
        style={{
          background: `${tierColor}1f`,
          border: `0.5px solid ${tierColor}59`,
          minWidth: 52,
        }}
        title={
          rule
            ? `${formatStageAge(hours)} in stage · warn ${rule.softHours}h · act ${rule.hardHours}h`
            : `${formatStageAge(hours)} in stage`
        }
      >
        <span className="font-display text-[18px] leading-none" style={{ color: tierColor }}>
          {formatStageAge(hours)}
        </span>
        <span className="text-[8px] uppercase tracking-wider text-cream/55 mt-0.5">
          {tier === "hard" ? "act now" : "in stage"}
        </span>
      </div>

      {/* Order body */}
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[10px] text-cream/45">{order.id}</span>
          {order.source === "Shopify" && (
            <span className="text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full"
              style={{ background: "rgba(184,130,106,0.15)", color: "#d9a888", border: "0.5px solid rgba(184,130,106,0.40)" }}>
              Shopify
            </span>
          )}
          {order.source === "Manual" && (
            <span className="text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full"
              style={{ background: "rgba(145,165,151,0.18)", color: "#b8d0bd", border: "0.5px solid rgba(145,165,151,0.45)" }}>
              Custom
            </span>
          )}
        </div>
        <div className="font-display text-[15px] text-cream truncate">{order.name}</div>
      </button>

      {/* Owner */}
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0 mr-2" title={ownerName ?? "unclaimed"}>
        {ownerName ? (
          <>
            <div style={{ ...ownerStyle, borderWidth: 1, borderStyle: "solid" }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold">
              {ownerInitials}
            </div>
            <span className="text-[11px] text-cream/55 hidden lg:inline truncate max-w-[120px]">{ownerName}</span>
          </>
        ) : (
          <span className="text-[10px] text-cream/30 italic">unclaimed</span>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* New + unclaimed → Claim */}
        {isNew && !order.claimed_by && (
          <button
            onClick={() => withBusy(onClaim)}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
          >
            {busy ? "…" : "Claim"}
          </button>
        )}
        {/* New + claimed by me → Mark Entered (the attachment gate still applies; modal handles it) */}
        {isNew && order.claimed_by === currentUserId && onAdvance && (
          <button
            onClick={() => withBusy(onAdvance)}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
            title="Requires an attached PDF"
          >
            {busy ? "…" : <>Mark Entered <ArrowRight className="w-3 h-3" /></>}
          </button>
        )}
        {/* Entered → either show prompt to set start date (which auto-advances) or open modal */}
        {order.stage === "Entered" && (
          order.production_start_date ? (
            // Date is set but somehow still in Entered (e.g. stale state) — open modal
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
            >
              Open
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
              title="Set production start date — order auto-advances once set"
            >
              Set start date →
            </button>
          )
        )}
        {/* In production → Early Push (with soft confirm) or normal advance if past est finish */}
        {order.stage === "In production" && onAdvance && (() => {
          const advance = onAdvance;
          const finish = order.production_est_finish_date;
          const todayIso = new Date().toISOString().slice(0, 10);
          const pastFinish = finish && finish <= todayIso;
          function go() {
            const displayName = order.name;
            const msg = pastFinish
              ? `Move "${displayName}" to At cross dock now?`
              : finish
              ? `Production isn't scheduled to finish until ${finish}.\n\nPush "${displayName}" to At cross dock anyway?`
              : `No estimated finish date set.\n\nPush "${displayName}" to At cross dock now?`;
            if (typeof window !== "undefined" && !window.confirm(msg)) return Promise.resolve();
            return advance();
          }
          return (
            <button
              onClick={() => withBusy(go)}
              disabled={busy}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all border",
                pastFinish
                  ? "bg-terracotta/20 border-terracotta/45 text-terracotta hover:bg-terracotta/30"
                  : "bg-white/6 border-cream/15 text-cream/85 hover:bg-white/10"
              )}
            >
              {busy ? "…" : pastFinish ? <>Cross dock <ArrowRight className="w-3 h-3" /></> : "Early Push"}
            </button>
          );
        })()}
        {/* At cross dock → Confirm Delivery only when delivery date is set */}
        {order.stage === "At cross dock" && onAdvance && (
          order.scheduled_delivery_date ? (
            <button
              onClick={() => withBusy(onAdvance)}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50"
            >
              {busy ? "…" : <>Confirm Delivery <ArrowRight className="w-3 h-3" /></>}
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
              title="Open order to set delivery date"
            >
              Set delivery date →
            </button>
          )
        )}

        {/* Archive (secondary) */}
        <button
          onClick={() => withBusy(onArchive)}
          disabled={busy}
          className="p-1.5 rounded-full transition-colors hover:bg-white/10 text-cream/45 hover:text-cream/85 disabled:opacity-50"
          title="Archive"
          aria-label="Archive"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── Bar row (trends section) ─────────────────────────────────────── */

function BarRow({
  label, value, max, target, valueLabel, secondaryLabel, targetLabel, color, pastTarget,
}: {
  label: string;
  value: number;
  max: number;
  target?: number;
  valueLabel: string;
  secondaryLabel?: string;
  targetLabel?: string;
  color: string;
  pastTarget: boolean;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100);
  const targetPct = target !== undefined && max > 0 ? Math.min(100, (target / max) * 100) : null;
  const barColor = pastTarget ? "#e89090" : color;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[12px] text-cream/75">{label}</span>
        <div className="flex items-baseline gap-2">
          {targetLabel && <span className="text-[9px] text-cream/35 font-mono">{targetLabel}</span>}
          {secondaryLabel && <span className="text-[9px] text-cream/40">{secondaryLabel}</span>}
          <span
            className={clsx("text-[12px] font-medium tabular-nums")}
            style={{ color: pastTarget ? "#e89090" : "#e8e3da" }}
          >
            {valueLabel}
          </span>
        </div>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden relative"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
        {targetPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${targetPct}%`, background: "rgba(255,255,255,0.35)" }}
            title={`target ${target}d`}
          />
        )}
      </div>
    </div>
  );
}
