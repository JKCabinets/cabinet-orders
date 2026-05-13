"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Order, ORDER_STAGES, OrderStage, getBackorderStatus } from "@/lib/data";
import { parseOrderDate } from "@/lib/dateUtils";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { ArrowRight, Plus, Search } from "lucide-react";

const STAGE_ACCENT: Record<OrderStage, string> = {
  "New":            "#c97070",
  "Entered":        "#d4922a",
  "In production":  "#c8b84a",
  "At cross dock":  "#5a8db8",
  "Delivered":      "#8fbe70",
};

function stageToSlug(stage: OrderStage): string {
  return stage.toLowerCase().replace(/\s+/g, "-");
}

export function DashboardClient() {
  const { orders } = useStore();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const active = useMemo(() => orders.filter(o => !o.archived), [orders]);

  // ── Stage statistics ────────────────────────────────────────────────
  const byStage = useMemo(() => {
    const map: Record<OrderStage, Order[]> = {} as Record<OrderStage, Order[]>;
    for (const s of ORDER_STAGES) map[s] = [];
    for (const o of active) {
      if (map[o.stage as OrderStage]) map[o.stage as OrderStage].push(o);
    }
    return map;
  }, [active]);

  // ── Needs Attention list ────────────────────────────────────────────
  const needsAttention = useMemo(() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    type Flagged = { order: Order; reason: string; severity: "high" | "med" };
    const items: Flagged[] = [];

    for (const o of active) {
      const orderTime = parseOrderDate(o.date);
      const ageDays = orderTime !== null ? Math.floor((now - orderTime) / dayMs) : null;

      // Overdue in New (>5 days)
      if (o.stage === "New" && ageDays !== null && ageDays > 5) {
        items.push({ order: o, reason: `${ageDays}d in New`, severity: "high" });
        continue;
      }
      // Unclaimed New >24h
      if (o.stage === "New" && !o.claimed_by && ageDays !== null && ageDays >= 1) {
        items.push({ order: o, reason: "Unclaimed >24h", severity: "med" });
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

  // ── Stage-specific sub-stat helpers ─────────────────────────────────
  const todayIso = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(); firstOfMonth.setDate(1);
  const firstOfMonthIso = firstOfMonth.toISOString().split("T")[0];

  const newFromShopify = byStage["New"].filter(o => o.source === "Shopify").length;
  const enteredToday   = byStage["Entered"].filter(o => o.date && o.date.startsWith(todayIso.slice(0,7))).length;
  const crossDockPending = byStage["At cross dock"].filter(o => !o.scheduled_delivery_date).length;
  const deliveredThisMonth = orders.filter(o =>
    o.stage === "Delivered" && o.date && o.date >= firstOfMonthIso
  ).length;
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
        title="Morning"
        accent="briefing"
        right={
          <>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider border border-cream/18 bg-white/4 text-cream/85 hover:bg-white/8 transition-all"
              title="Search (coming soon)"
              disabled
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
            substat={enteredToday > 0 ? `${enteredToday} this month` : "—"}
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
        <SLAMiniPanel byStage={byStage} />

        {/* ── Needs Attention ── */}
        <NeedsAttention
          items={needsAttention}
          onSelect={setSelectedOrder}
        />

      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          tab="orders"
          onClose={() => setSelectedOrder(null)}
          onStageChange={(stage) => setSelectedOrder(prev => prev ? { ...prev, stage } : null)}
        />
      )}
      {showNewForm && (
        <NewOrderModal tab="orders" onClose={() => setShowNewForm(false)} />
      )}
    </>
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

function SLAMiniPanel({ byStage }: { byStage: Record<OrderStage, Order[]> }) {
  // Average age in each stage (in days). Useful as a glanceable SLA view.
  function avgDays(orders: Order[]): number | null {
    if (orders.length === 0) return null;
    const now = Date.now();
    const total = orders.reduce((sum, o) => {
      const t = parseOrderDate(o.date);
      if (t === null) return sum;
      return sum + Math.floor((now - t) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(total / orders.length);
  }

  // Overdue: anything in New >5d (matches OrderCard logic)
  const overdueCount = byStage["New"].filter(o => {
    const t = parseOrderDate(o.date);
    if (t === null) return false;
    return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)) > 5;
  }).length;

  const cells = [
    { label: "New age",        value: avgDays(byStage["New"]) },
    { label: "Entered age",    value: avgDays(byStage["Entered"]) },
    { label: "Production",     value: avgDays(byStage["In production"]) },
    { label: "Cross dock",     value: avgDays(byStage["At cross dock"]) },
  ];

  return (
    <div className="glass-sage rounded-panel p-5 lg:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="eyebrow mb-1">Service levels</div>
          <h2 className="font-display text-[22px] text-cream">
            SLA at <em className="italic-storm">a glance</em>
          </h2>
        </div>
        <button
          disabled
          className="flex items-center gap-1.5 text-[11px] text-cream/55 cursor-not-allowed"
          title="SLA dashboard coming soon"
        >
          Full report
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cells.map(c => (
          <div key={c.label}>
            <div className="text-[10px] uppercase tracking-[0.13em] text-cream/55 mb-1">{c.label}</div>
            <div className="font-display text-[28px] text-cream">
              {c.value ?? "—"}
              {c.value !== null && <span className="text-[12px] text-cream/55 ml-1.5 font-sans">days</span>}
            </div>
          </div>
        ))}
        <div>
          <div className="text-[10px] uppercase tracking-[0.13em] text-cream/55 mb-1">Overdue</div>
          <div
            className="font-display text-[28px]"
            style={{ color: overdueCount > 0 ? "#e89090" : "#8fbe70" }}
          >
            {overdueCount}
            <span className="text-[12px] text-cream/55 ml-1.5 font-sans">orders</span>
          </div>
        </div>
      </div>
    </div>
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
