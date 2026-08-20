"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Order, ORDER_STAGES, OrderStage, STAGE_ACCENT, getBackorderStatus } from "@/lib/data";
import { rollupBackorders, summarizeBackorders, type BackorderSummary } from "@/lib/backorders";
import { parseOrderDate } from "@/lib/dateUtils";
import {
  slaTier, slaRuleFor, hoursInStage, slaAgeHours, formatStageAge, type SlaTier,
} from "@/lib/sla";
import { SlaHealthByType, type SlaTypeRow } from "@/components/SlaHealthByType";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { Plus, Search, ChevronRight, PackageX } from "lucide-react";

// STAGE_ACCENT now comes from lib/data.ts, shared with the Custom and
// Sample pages instead of being a sixth private copy.

function stageToSlug(stage: OrderStage): string {
  return stage.toLowerCase().replace(/\s+/g, "-");
}

export function DashboardClient() {
  const { orders, customs, samples, warranties } = useStore();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const active = useMemo(() => orders.filter(o => !o.archived), [orders]);

  // ── Backorder rollup (used by the dashboard panel + sidebar count) ──
  const backorderRollups = useMemo(() => rollupBackorders(active), [active]);
  const backorderSummary = useMemo(() => summarizeBackorders(backorderRollups), [backorderRollups]);

  // ── Stage statistics ────────────────────────────────────────────────
  const byStage = useMemo(() => {
    const map: Record<OrderStage, Order[]> = {} as Record<OrderStage, Order[]>;
    for (const s of ORDER_STAGES) map[s] = [];
    for (const o of active) {
      if (map[o.stage as OrderStage]) map[o.stage as OrderStage].push(o);
    }
    return map;
  }, [active]);

  // ── SLA per order type ──────────────────────────────────────────────
  // One row per category, not per stage: four stages x four types is
  // sixteen cells, which is not a glance. /sla carries the stage detail.
  const slaCategories: SlaTypeRow[] = useMemo(() => {
    const groups: { key: string; label: string; rows: Order[] }[] = [
      { key: "order",    label: "Standard", rows: orders },
      { key: "custom",   label: "Custom",   rows: customs },
      { key: "sample",   label: "Samples",  rows: samples },
      { key: "warranty", label: "Warranty", rows: warranties },
    ];
    const now = Date.now();
    return groups.map(g => {
      const rows = g.rows.filter(o => !o.archived);
      // Identical to the computation on /sla, because both feed the same
      // component. Only rows whose clock is RUNNING are counted: a stage with
      // no rule, or one whose clockRuns has stopped because the awaited dates
      // exist, is neither on track nor overdue -- it simply is not measured.
      let onTrack = 0, overSoft = 0, overHard = 0;
      let oldestHours: number | null = null;
      let oldestFrom: "created" | "stage" = "stage";
      for (const o of rows) {
        const rule = slaRuleFor(o);
        if (!rule) continue;
        if (rule.clockRuns && !rule.clockRuns(o)) continue;
        const tier: SlaTier = slaTier(o, now);
        if (tier === "hard") overHard++;
        else if (tier === "soft") overSoft++;
        else onTrack++;
        const h = slaAgeHours(o, rule, now);
        if (h !== null && (oldestHours === null || h > oldestHours)) {
          oldestHours = h;
          // New measures from the ORDER DATE, so its age reads "28d old"
          // rather than an elapsed stage time. The table decides the wording.
          oldestFrom = rule.measureFrom === "created" ? "created" : "stage";
        }
      }
      return {
        key: g.key, label: g.label, active: rows.length,
        onTrack, overSoft, overHard, oldestHours, oldestFrom,
      };
    });
  }, [orders, customs, samples, warranties]);

  // ── Needs Attention list ────────────────────────────────────────────
  const needsAttention = useMemo(() => {
    const now = Date.now();
    type Flagged = { order: Order; reason: string; severity: "high" | "med" };
    const items: Flagged[] = [];

    for (const o of active) {
      // One shared rule replaces a hardcoded "> 5 days in New" plus a
      // separate ">= 1 day unclaimed" check. lib/sla covers every stage,
      // measures from stage_entered_at rather than order age, and knows a
      // production order with its dates set is fine at 42 days.
      const tier = slaTier(o, now);
      if (tier !== "ok") {
        const rule = slaRuleFor(o);
        const age = formatStageAge(hoursInStage(o, now));
        const unclaimed = o.stage === "New" && !o.claimed_by;
        const reason = unclaimed
          ? `Unclaimed ${age}`
          : rule?.waitingFor
            ? `${age} awaiting ${rule.waitingFor}`
            : `${age} in ${o.stage}`;
        items.push({ order: o, reason, severity: tier === "hard" ? "high" : "med" });
        continue;
      }
      // Has backorders pending
      const bo = getBackorderStatus(o.sku_items);
      if (bo.status === "pending") {
        items.push({ order: o, reason: `${bo.count} backordered`, severity: "med" });
        continue;
      }
    }

    // Sort high severity first, then by oldest order date
    items.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
      const ta = parseOrderDate(a.order.date) ?? 0;
      const tb = parseOrderDate(b.order.date) ?? 0;
      return ta - tb;
    });

    return items.slice(0, 6);
  }, [active]);

  // Stage-specific sub-stat helpers
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthStartMs = monthStart.getTime();

  const newFromShopify = byStage["New"].filter(o => o.source === "Shopify").length;
  // "Entered today" — orders entered this month. We don't track a separate
  // "entered_at" date, so we approximate by looking at orders whose date is
  // recent enough. Falls back to 0 if dates can't be parsed.
  const enteredThisMonth = byStage["Entered"].filter(o => {
    const t = parseOrderDate(o.date);
    return t !== null && t >= monthStartMs;
  }).length;
  const crossDockPending = byStage["At cross dock"].filter(o => !o.scheduled_delivery_date).length;
  const deliveredThisMonth = orders.filter(o => {
    if (o.stage !== "Delivered") return false;
    const t = parseOrderDate(o.date);
    return t !== null && t >= monthStartMs;
  }).length;
  // Average production age in days
  const avgProductionDays = (() => {
    const prod = byStage["In production"];
    if (prod.length === 0) return null;
    const totalDays = prod.reduce((sum, o) => {
      const t = parseOrderDate(o.date);
      if (t === null) return sum;
      return sum + Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(totalDays / prod.length);
  })();

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
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New order
            </button>
          </>
        }
      />

      <div className="px-6 lg:px-8 pb-12 flex flex-col gap-5">

        {/* ── Stage stat cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <StageCard
            stage="New"
            count={byStage["New"].length}
            substat={`${newFromShopify} from Shopify`}
            accent={STAGE_ACCENT["New"]}
          />
          <StageCard
            stage="Entered"
            count={byStage["Entered"].length}
            substat={enteredThisMonth > 0 ? `${enteredThisMonth} this month` : "—"}
            accent={STAGE_ACCENT["Entered"]}
          />
          <StageCard
            stage="In production"
            count={byStage["In production"].length}
            substat={avgProductionDays !== null ? `Avg ${avgProductionDays} days` : "—"}
            accent={STAGE_ACCENT["In production"]}
          />
          <StageCard
            stage="At cross dock"
            count={byStage["At cross dock"].length}
            substat={crossDockPending > 0 ? `${crossDockPending} pending call` : "All scheduled"}
            accent={STAGE_ACCENT["At cross dock"]}
          />
          <StageCard
            stage="Delivered"
            count={byStage["Delivered"].length}
            substat={`${deliveredThisMonth} this month`}
            accent={STAGE_ACCENT["Delivered"]}
          />
        </div>

        {/* ── SLA mini panel ── */}
        <SLAMiniPanel categories={slaCategories} />

        {/* ── Backorders — only shown when there's something to see ── */}
        {backorderSummary.distinctSkus > 0 && (
          <BackorderPanel summary={backorderSummary} />
        )}

        {/* ── Needs Attention ── */}
        <NeedsAttention
          items={needsAttention}
          onSelect={setSelectedOrder}
        />

      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStageChange={(stage) => setSelectedOrder(prev => prev ? { ...prev, stage } : null)}
        />
      )}
      {showNewForm && (
        <NewOrderModal type="order" onClose={() => setShowNewForm(false)} />
      )}
      {searchOpen && (
        <SearchOverlay
          orders={orders}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSelectOrder={(o) => {
            setSelectedOrder(o);
            setSearchOpen(false);
          }}
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
                  <span className="font-mono text-[10px] text-cream/45">{o.id}</span>
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

/* ─── Stage stat card ──────────────────────────────────────────────── */

function StageCard({
  stage, count, substat, accent,
}: {
  stage: OrderStage; count: number; substat: string; accent: string;
}) {
  return (
    <Link
      href={`/orders/${stageToSlug(stage)}`}
      className="lift-card glass rounded-brand p-4 flex flex-col gap-2 cursor-pointer"
      style={{ borderTop: `2px solid ${accent}` }}
    >
      <div className="eyebrow text-cream/55">{stage}</div>
      <div
        className="font-display text-[44px] leading-none"
        style={{ color: accent }}
      >
        {count}
      </div>
      <div className="text-[11px] text-cream/55">{substat}</div>
    </Link>
  );
}

/* ─── SLA mini panel ──────────────────────────────────────────────── */

// SLA thresholds and the definition of "overdue" live in lib/sla.ts. This
// file used to carry a private copy of SLA_TARGETS with identical values --
// which was luck, not design, since nothing kept them in step.

/**
 * SLA at a glance.
 *
 * The table itself is components/SlaHealthByType -- the SAME component /sla
 * renders. No onSelectType here, so the rows are read-only; the markup does
 * not fork between the two pages.
 *
 * The private SlaCategory interface this used to carry is gone; the shared
 * SlaTypeRow is the one shape.
 */
function SLAMiniPanel({ categories }: { categories: SlaTypeRow[] }) {
  return (
    <div className="glass-sage rounded-panel p-5 lg:p-6">
      <div className="mb-4">
        <div className="eyebrow mb-1">Service levels</div>
        <h2 className="font-display text-[22px] text-cream">
          SLA at <em className="italic-storm">a glance</em>
        </h2>
      </div>
      <p className="text-[12px] text-cream/55 -mt-2 mb-4">
        Active orders by SLA status — the same table as the SLA page.
      </p>
      <SlaHealthByType rows={categories} />
      <Link
        href="/sla"
        className="block w-full mt-3 py-2 text-center text-[11px] text-cream/55 hover:text-cream/85 transition-colors"
      >
        Open the SLA page →
      </Link>
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

/* ─── Needs Attention ──────────────────────────────────────────────── */

function NeedsAttention({
  items, onSelect,
}: {
  items: { order: Order; reason: string; severity: "high" | "med" }[];
  onSelect: (o: Order) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-display text-[22px] text-cream">
          Needs <em className="italic-storm">attention</em>
        </h2>
        {items.length > 0 && (
          <span className="text-[11px] text-cream/55">{items.length} flagged</span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="glass rounded-brand p-6 text-center">
          <div className="font-display text-[20px] text-cream/70 mb-1">All clear</div>
          <div className="text-[12px] text-cream/45">No orders flagged right now.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map(({ order, reason, severity }) => (
            <button
              key={order.id}
              onClick={() => onSelect(order)}
              className="lift-card glass rounded-brand p-3 text-left flex flex-col gap-1.5"
              style={{
                borderLeft: `2px solid ${severity === "high" ? "#e89090" : "#d4922a"}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-cream/55">{order.id}</span>
                <span
                  className="text-[9px] px-1.5 py-px rounded-full font-medium uppercase tracking-wider"
                  style={{
                    background: severity === "high" ? "rgba(232,144,144,0.15)" : "rgba(212,146,42,0.15)",
                    color: severity === "high" ? "#e89090" : "#e8b56a",
                    border: `0.5px solid ${severity === "high" ? "rgba(232,144,144,0.45)" : "rgba(212,146,42,0.45)"}`,
                  }}
                >
                  {reason}
                </span>
              </div>
              <div className="text-[13px] font-medium text-cream truncate">{order.name}</div>
              <div className="text-[10px] text-cream/55">{order.stage} · {order.date}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
