"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import {
  Order, OrderType, Stage,
  STAGE_ACCENT, STAGE_LIST_BY_TYPE, TYPE_LIST_LABEL, nextStageFor,
  displayOrderNumber,
} from "@/lib/data";
import {
  SLA_RULES, slaTier, slaRuleFor, hoursInStage, slaAgeHours, formatStageAge,
} from "@/lib/sla";
import { AppShell, PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { AlertTriangle, Search, User } from "lucide-react";
import { SlaHealthByType, type SlaTypeRow } from "@/components/SlaHealthByType";

// Tracked stages are DERIVED per type: the stages of that type's own flow
// that carry a rule in SLA_RULES. There is no hardcoded list here any more,
// so adding a stage or a type grows this page without editing it.
//
// Stage colours come from lib/data's STAGE_ACCENT rather than a private
// copy, and the next stage from nextStageFor rather than a hardcoded map
// that only knew the standard order flow.
// Derived from TYPE_LIST_LABEL so the comment above is true of TYPES as well
// as stages. This was four hardcoded entries, and a fifth type would have
// rendered nothing at all here -- silently, since an absent category is not
// a type error. Order follows the declaration order in lib/data.ts.
const CATEGORIES: { key: OrderType; label: string }[] =
  (Object.keys(TYPE_LIST_LABEL) as OrderType[])
    .map(key => ({ key, label: TYPE_LIST_LABEL[key] }));

export function SLAClient() {
  const {
    orders, customs, samples, warranties, hardware,
    team, claimOrder,
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
      // Every hardware stage is rule-less by design (see HARDWARE_RULES).
      // This page already renders rule-less stages with a count and a dash
      // rather than inventing an SLA judgement, so hardware needs no
      // special-casing beyond appearing at all.
      hardware: hardware,
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
          <div className="text-[11px] font-mono text-cream truncate">{displayOrderNumber(order)}</div>
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
      <td className="py-2.5 px-2 text-[11px] font-mono text-cream whitespace-nowrap">{displayOrderNumber(order)}</td>
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

/* ─── Deleted 2026-09-16 ─────────────────────────────────────────────
 *
 * StageAgingRow, OverdueStageBlock, OverdueRow and BarRow lived here: 389
 * lines, defined and never rendered. Nothing in this file or any other
 * referenced them -- OverdueRow only from OverdueStageBlock, which nothing
 * rendered either -- and none was exported, so nothing outside could.
 *
 * ⚠ THE SLA PAGE'S "ARCHIVE" BUTTON WAS IN THERE. On 2026-09-16 a search for
 * archive controls found it and counted this page as a live surface that
 * needed the project rule applied; it never rendered. Dead code is not free:
 * it answers searches.
 *
 * `archiveOrder` and `moveStage` came out of the store destructure above with
 * them, for the same reason.
 */
