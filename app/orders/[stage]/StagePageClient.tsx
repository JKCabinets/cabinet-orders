"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { Order, OrderStage } from "@/lib/data";
import { PageHeader } from "@/components/AppShell";
import { OrderCard } from "@/components/OrderCard";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Search, CheckSquare, X } from "lucide-react";

/** All valid stage URL slugs. Includes "archived" as a special-case stage. */
export const VALID_STAGE_SLUGS = [
  "new", "entered", "in-production", "at-cross-dock", "delivered", "archived",
] as const;

/** Convert URL slug back to canonical stage name. "archived" maps to itself. */
export function slugToStage(slug: string): OrderStage | "Archived" {
  switch (slug) {
    case "new":            return "New";
    case "entered":        return "Entered";
    case "in-production":  return "In production";
    case "at-cross-dock":  return "At cross dock";
    case "delivered":      return "Delivered";
    case "archived":       return "Archived";
    default:               return "New"; // unreachable; guarded by VALID_STAGE_SLUGS
  }
}

const STAGE_ACCENT: Record<string, string> = {
  "New":            "#c97070",
  "Entered":        "#d4922a",
  "In production":  "#c8b84a",
  "At cross dock":  "#5a8db8",
  "Delivered":      "#8fbe70",
  "Archived":       "#91a597",
};

const STAGE_DESCRIPTION: Record<string, { eyebrow: string; accent: string }> = {
  "New":            { eyebrow: "Orders awaiting entry",         accent: "orders" },
  "Entered":        { eyebrow: "Acknowledged with the vendor",  accent: "vendor" },
  "In production":  { eyebrow: "Currently being built",         accent: "production" },
  "At cross dock":  { eyebrow: "Awaiting customer call & delivery", accent: "scheduling" },
  "Delivered":      { eyebrow: "Completed",                     accent: "delivered" },
  "Archived":       { eyebrow: "Stored archive",                accent: "archive" },
};

interface Props {
  stage: OrderStage | "Archived";
}

export function StagePageClient({ stage }: Props) {
  const { orders } = useStore();
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isArchive = stage === "Archived";

  // Filter to this stage (or archive)
  const stageOrders = useMemo(() => {
    if (isArchive) return orders.filter(o => o.archived);
    return orders.filter(o => !o.archived && o.stage === stage);
  }, [orders, stage, isArchive]);

  // Apply text search
  const filtered = useMemo(() => {
    if (!search) return stageOrders;
    const q = search.toLowerCase();
    return stageOrders.filter(o =>
      o.name.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      o.sku.toLowerCase().includes(q)
    );
  }, [stageOrders, search]);

  // Selection helpers
  function toggleSelectMode() {
    setSelectMode(v => {
      if (v) setSelectedIds(new Set());
      return !v;
    });
  }
  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function handleCardClick(order: Order) {
    if (selectMode) toggleSelection(order.id);
    else setSelectedOrder(order);
  }
  const selectedOrders = useMemo(
    () => filtered.filter(o => selectedIds.has(o.id)),
    [filtered, selectedIds],
  );

  const desc = STAGE_DESCRIPTION[stage] ?? { eyebrow: "Orders", accent: "" };
  const accent = STAGE_ACCENT[stage];

  return (
    <>
      <PageHeader
        eyebrow={desc.eyebrow}
        title={stage}
        right={
          <>
            <button
              onClick={toggleSelectMode}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all ${
                selectMode
                  ? "bg-terracotta/22 border border-terracotta/55 text-terracotta"
                  : "bg-white/4 border border-cream/18 text-cream/85 hover:bg-white/8"
              }`}
            >
              {selectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
              {selectMode ? (selectedIds.size > 0 ? `${selectedIds.size} selected` : "Cancel") : "Select"}
            </button>
            {!isArchive && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                New order
              </button>
            )}
          </>
        }
      />

      {/* Search row */}
      <div className="px-6 lg:px-8 pb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this stage…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="stage-search-no-autofill"
            className="w-full pl-9 pr-4 py-2 rounded-full text-[13px] bg-white/6 border border-cream/15 text-cream placeholder:text-cream/40 focus:border-terracotta/55 transition-colors"
            style={{ fontSize: "16px" }}
          />
        </div>
      </div>

      <div className="px-6 lg:px-8 pb-12">
        {filtered.length === 0 ? (
          <div className="glass rounded-brand p-10 text-center">
            <div className="font-display text-[22px] text-cream/70 mb-1">
              {search ? "No matches" : "Empty"}
            </div>
            <div className="text-[12px] text-cream/45">
              {search
                ? `Nothing in "${stage}" matched "${search}".`
                : isArchive
                  ? "No archived orders yet."
                  : `No orders are currently in "${stage}".`}
            </div>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              // Subtle column divider — reinforces the stage's accent color
              // without overpowering the cards
              borderTop: `1px solid ${accent}24`,
              paddingTop: "1rem",
            }}
          >
            {filtered.map((order, i) => (
              <OrderCard
                key={order.id}
                order={order}
                onClick={() => handleCardClick(order)}
                style={{ animationDelay: `${Math.min(i * 20, 400)}ms` }}
                selectMode={selectMode}
                selected={selectedIds.has(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          tab="orders"
          onClose={() => setSelectedOrder(null)}
          onStageChange={(s) => setSelectedOrder(prev => prev ? { ...prev, stage: s } : null)}
        />
      )}
      {showNewForm && (
        <NewOrderModal tab="orders" onClose={() => setShowNewForm(false)} />
      )}

      <BulkActionBar
        selectedOrders={selectedOrders}
        tab="orders"
        onClear={() => setSelectedIds(new Set())}
        onDone={() => { setSelectMode(false); setSelectedIds(new Set()); }}
      />
    </>
  );
}
