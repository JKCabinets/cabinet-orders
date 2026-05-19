"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Order } from "@/lib/data";
import {
  rollupBackorders,
  summarizeBackorders,
  type BackorderedSkuRollup,
} from "@/lib/backorders";
import { PageHeader } from "@/components/AppShell";
import { OrderModal } from "@/components/OrderModal";
import { PackageX, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";

/** Colors for the impact pills — match the dashboard card. */
const COLOR_OVERDUE = "#e89090";
const COLOR_UNDATED = "#cfc8b6";
const COLOR_AMBER = "#e8b56a";

export function BackordersClient() {
  const { orders } = useStore();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const active = useMemo(() => orders.filter(o => !o.archived), [orders]);
  const rollups = useMemo(() => rollupBackorders(active), [active]);
  const summary = useMemo(() => summarizeBackorders(rollups), [rollups]);

  function toggle(sku: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Supply"
        title="Backordered"
        accent="SKUs"
      />

      <div className="px-6 lg:px-8 pb-12 flex flex-col gap-5">

        {/* ── Summary tiles ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryTile
            label="Backordered SKUs"
            value={summary.distinctSkus}
            accent={COLOR_AMBER}
          />
          <SummaryTile
            label="Affected orders"
            value={summary.affectedOrders}
            accent={COLOR_AMBER}
          />
          <SummaryTile
            label="Past commitment"
            value={summary.overdueSkus}
            accent={summary.overdueSkus > 0 ? COLOR_OVERDUE : undefined}
            sub={summary.overdueSkus > 0 ? "Vendor missed" : "On track"}
          />
          <SummaryTile
            label="No date set"
            value={summary.undatedSkus}
            accent={summary.undatedSkus > 0 ? COLOR_UNDATED : undefined}
            sub={summary.undatedSkus > 0 ? "Awaiting estimate" : "All quoted"}
          />
        </div>

        {/* ── Rollup table ── */}
        {rollups.length === 0 ? (
          <div className="glass rounded-brand p-10 text-center">
            <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ background: "rgba(143,190,112,0.12)", border: "1px solid rgba(143,190,112,0.30)" }}>
              <PackageX className="w-5 h-5" style={{ color: "#8fbe70" }} />
            </div>
            <div className="font-display text-[22px] text-cream/85 mb-1">
              No backorders right now
            </div>
            <div className="text-[12px] text-cream/55">
              Every active SKU on every active order is on track.
            </div>
          </div>
        ) : (
          <div className="glass-sage rounded-panel overflow-hidden">
            <div className="px-5 lg:px-6 py-4 border-b border-white/10">
              <div className="eyebrow mb-0.5">Detail</div>
              <h2 className="font-display text-[22px] text-cream">
                By <em className="italic-storm">SKU</em>
              </h2>
            </div>
            <div className="divide-y divide-white/5">
              {rollups.map(rollup => (
                <RollupRow
                  key={rollup.sku}
                  rollup={rollup}
                  expanded={expanded.has(rollup.sku)}
                  onToggle={() => toggle(rollup.sku)}
                  onSelectOrder={setSelectedOrder}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          tab="orders"
          onClose={() => setSelectedOrder(null)}
          onStageChange={(stage) =>
            setSelectedOrder(prev => prev ? { ...prev, stage } : null)
          }
        />
      )}
    </>
  );
}

/* ─── Summary tiles ─────────────────────────────────────────────────── */

function SummaryTile({
  label, value, accent, sub,
}: {
  label: string;
  value: number;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="glass rounded-brand p-4 lg:p-5 flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-[0.13em] text-cream/55">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="font-display text-[32px] leading-none"
          style={{ color: accent ?? "#e8e3da" }}
        >
          {value}
        </span>
      </div>
      {sub && (
        <div className="text-[10px] text-cream/45">{sub}</div>
      )}
    </div>
  );
}

/* ─── Rollup row ────────────────────────────────────────────────────── */

function RollupRow({
  rollup, expanded, onToggle, onSelectOrder,
}: {
  rollup: BackorderedSkuRollup;
  expanded: boolean;
  onToggle: () => void;
  onSelectOrder: (o: Order) => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-5 lg:px-6 py-3.5 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
      >
        <Chevron className="w-4 h-4 text-cream/45 flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[13px] text-cream">{rollup.sku}</span>
          {rollup.description && (
            <span className="text-[12px] text-cream/55 truncate">
              {rollup.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rollup.hasOverdueCommitment && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                background: "rgba(232,144,144,0.15)",
                color: COLOR_OVERDUE,
                border: "0.5px solid rgba(232,144,144,0.45)",
              }}
            >
              Past
            </span>
          )}
          {rollup.hasUndatedCommitment && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                background: "rgba(160,160,154,0.12)",
                color: COLOR_UNDATED,
                border: "0.5px solid rgba(160,160,154,0.35)",
              }}
            >
              No date
            </span>
          )}
          <div className="text-[11px] text-cream/65 tabular-nums">
            {rollup.orderCount} {rollup.orderCount === 1 ? "order" : "orders"}
          </div>
          <div className="text-[10px] text-cream/45 tabular-nums w-8 text-right">
            ×{rollup.totalQuantity}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 lg:px-6 pb-3 pt-1">
          {/* Soonest / latest dates summary */}
          {(rollup.soonestExpected || rollup.latestExpected) && (
            <div className="text-[11px] text-cream/55 mb-2 flex items-baseline gap-3 flex-wrap pl-7">
              {rollup.soonestExpected && (
                <span>Earliest expected: <span className="text-cream/85">{rollup.soonestExpected}</span></span>
              )}
              {rollup.latestExpected && rollup.latestExpected !== rollup.soonestExpected && (
                <span>Latest: <span className="text-cream/85">{rollup.latestExpected}</span></span>
              )}
            </div>
          )}
          {/* Affected orders */}
          <div className="flex flex-col gap-1 pl-7">
            {rollup.orders.map(o => (
              <AffectedOrderLine
                key={o.id}
                order={o}
                sku={rollup.sku}
                onClick={() => onSelectOrder(o)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Single row showing one affected order with its expected date / notes. */
function AffectedOrderLine({
  order, sku, onClick,
}: {
  order: Order;
  sku: string;
  onClick: () => void;
}) {
  // Find the matching SKU item on this order so we can show its specific
  // expected date and notes (different orders for the same SKU may have
  // different commitments).
  const item = (order.sku_items ?? []).find(i => i.sku === sku && i.backordered);
  const today = new Date().toISOString().split("T")[0];
  const overdue = !!item?.expected_ready_date && item.expected_ready_date < today;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full px-3 py-2 rounded-md text-left hover:bg-white/5 transition-colors",
        "flex items-baseline gap-3 flex-wrap",
      )}
    >
      <span className="font-mono text-[10px] text-cream/55 flex-shrink-0">
        {order.id}
      </span>
      <span className="text-[12px] text-cream/85 flex-1 min-w-0 truncate">
        {order.name}
      </span>
      <span className="text-[10px] text-cream/45 flex-shrink-0">
        {order.stage}
      </span>
      {item?.expected_ready_date ? (
        <span
          className="text-[10px] tabular-nums flex-shrink-0"
          style={{ color: overdue ? COLOR_OVERDUE : "#e8e3da" }}
        >
          Exp {item.expected_ready_date}
          {overdue && " · past"}
        </span>
      ) : (
        <span className="text-[10px] text-cream/45 flex-shrink-0">No date</span>
      )}
      {item?.backorder_notes && (
        <span className="text-[10px] text-cream/45 w-full pl-3 italic">
          “{item.backorder_notes}”
        </span>
      )}
    </button>
  );
}
