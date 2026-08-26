"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  Order, OrderStage, OrderType, STAGE_ACCENT, STAGE_LIST_BY_TYPE,
} from "@/lib/data";
import { PageHeader } from "@/components/AppShell";
import { OrderTable } from "@/components/OrderTable";
import { OrderModal } from "@/components/OrderModal";
import { BulkActionBar } from "@/components/BulkActionBar";
import { NewOrderModal } from "@/components/NewOrderModal";
import { Search, CheckSquare, X, CalendarDays, Plus } from "lucide-react";

/**
 * The hub for a Shopify order type — cabinets, hardware, samples.
 *
 * ONE TABLE, STAGE CARDS ON TOP. Every stage of the flow is a card that filters
 * the table beneath it; "All" is a card like any other. This replaces five
 * separate per-stage pages, which meant five URLs, five empty states and no way
 * to see the whole pipeline at once.
 *
 * ⚠ THE OLD PER-STAGE URLS STILL WORK. /orders/new lands here with the New card
 * selected -- same page, different starting filter. Nothing that links to them
 * breaks, and retiring them later costs one deletion in stageSlugs.ts because
 * they were never separate pages to begin with.
 *
 * GENERIC OVER TYPE on purpose. Hardware needs exactly this page, and
 * SamplesClient already IS this component written a second time. A
 * cabinets-only hub would have made three copies of one table -- the drift this
 * codebase keeps producing. /samples can adopt this in a one-line change.
 */

const TYPE_COPY: Record<OrderType, { eyebrow: string; title: string; accent: string }> = {
  order:    { eyebrow: "Shopify cabinet orders", title: "Cabinet",  accent: "orders" },
  hardware: { eyebrow: "Shopify hardware",       title: "Hardware", accent: "orders" },
  sample:   { eyebrow: "Shopify sample orders",  title: "Sample",   accent: "orders" },
  custom:   { eyebrow: "Offline contract work",  title: "Custom",   accent: "jobs" },
  warranty: { eyebrow: "Service",                title: "Warranty", accent: "claims" },
};

/**
 * Stages with a matching calendar view.
 *
 * Only meaningful when ONE stage is selected: on "All" the list spans stages
 * and no single calendar describes it. Same reasoning as `tableStage` below.
 */
const STAGE_CALENDAR_VIEW: Partial<Record<string, "production" | "delivery">> = {
  "In production": "production",
  "At cross dock": "delivery",
};

const ALL = "__all__";

export function OrdersHubClient({
  type,
  initialStage,
  archive = false,
  createLabel,
}: {
  type: OrderType;
  /** Stage to preselect, from a legacy /orders/<stage> URL. null = All. */
  initialStage?: OrderStage | null;
  /** Archive mode: archived rows of this type, no stage cards. */
  archive?: boolean;
  /**
   * Label for a create button, or absent for none.
   *
   * ⚠ ONLY CUSTOM JOBS AND WARRANTY CLAIMS can be created by hand -- cabinets,
   * samples and hardware are groups of a Shopify project. The caller decides,
   * and MANUAL_CREATABLE_TYPES is the server's answer to the same question.
   */
  createLabel?: string;
}) {
  const { allOrders } = useStore();
  const [activeStage, setActiveStage] = useState<string>(initialStage ?? ALL);
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [modalReason, setModalReason] = useState<"needs-attachment" | undefined>(undefined);
  const [selectMode, setSelectMode] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const stages = (STAGE_LIST_BY_TYPE[type] ?? []) as readonly string[];

  const rows = useMemo(
    () => allOrders.filter((o) => o.type === type && (archive ? o.archived : !o.archived)),
    [allOrders, type, archive],
  );

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of stages) c[s] = rows.filter((o) => o.stage === s).length;
    return c;
  }, [rows, stages]);

  const filtered = useMemo(() => {
    let list = rows;
    if (!archive && activeStage !== ALL) list = list.filter((o) => o.stage === activeStage);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        o.name.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.sku ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [rows, activeStage, search, archive]);

  function toggleSelectMode() {
    setSelectMode((v) => { if (v) setSelectedIds(new Set()); return !v; });
  }
  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectedOrders = useMemo(
    () => filtered.filter((o) => selectedIds.has(o.id)),
    [filtered, selectedIds],
  );

  // OrderTable's action column is keyed on a stage. On "All" the list spans
  // stages, so no single value describes it -- passing one would offer every
  // row the actions of a stage most of them are not in. "__none__" is the
  // sentinel SamplesClient already used for exactly this.
  // NULL, not a sentinel -- see the `stage` prop on OrderTable. "__none__"
  // matched no branch and printed itself into the Status column.
  const tableStage = activeStage === ALL ? null : archive ? "Archived" : activeStage;
  const calendarView = activeStage === ALL ? undefined : STAGE_CALENDAR_VIEW[activeStage];
  // Exhaustive Record, so a sixth OrderType is a compile error here rather
  // than a page silently titled "Orders".
  const copy = TYPE_COPY[type];

  return (
    <>
      <PageHeader
        eyebrow={archive ? "Stored archive" : copy.eyebrow}
        title={archive ? "Archive" : copy.title}
        accent={archive ? "archive" : copy.accent}
        right={
          <>
            {calendarView && (
              <Link
                href={`/calendar?view=${calendarView}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-white/4 border border-cream/18 text-cream/85 hover:bg-white/8 transition-all"
                title="Open the matching calendar view"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                Calendar
              </Link>
            )}
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
            {/* Cabinets, samples and hardware get NO create button: they are
                groups of a Shopify PROJECT, split from one checkout by vendor
                at ingest. A hand-made one would have no project, no shopify_id
                and no line items while sitting here looking real. */}
            {createLabel && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                {createLabel}
              </button>
            )}
          </>
        }
      />

      {/* Stage cards. Archive has none: an archived row keeps whatever stage it
          was archived at, so filtering by stage there answers a question nobody
          is asking. */}
      {!archive && (
        <div className="px-6 lg:px-8 pb-3 flex gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveStage(ALL)}
            className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all ${
              activeStage === ALL
                ? "bg-cream/12 border border-cream/30 text-cream"
                : "bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8"
            }`}
          >
            All <span className="opacity-65 ml-1">{rows.length}</span>
          </button>
          {stages.map((s) => (
            <button
              key={s}
              onClick={() => setActiveStage(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all ${
                activeStage === s
                  ? "bg-cream/12 border border-cream/30 text-cream"
                  : "bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE_ACCENT[s] }} />
              {s} <span className="opacity-65 ml-0.5">{stageCounts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      <div className="px-6 lg:px-8 pb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={archive ? "Search the archive…" : "Search these orders…"}
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="orders-hub-search-no-autofill"
            className="field-glass w-full pl-9 pr-4 py-2 rounded-full text-[13px] transition-colors"
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
                ? `Nothing here matched "${search}".`
                : archive
                  ? "No archived orders yet."
                  : activeStage === ALL
                    ? "No orders of this type yet."
                    : `No orders are currently in "${activeStage}".`}
            </div>
          </div>
        ) : (
          <OrderTable
            orders={filtered}
            stage={tableStage}
            onSelect={(o, reason) => { setSelectedOrder(o); setModalReason(reason); }}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelection}
          />
        )}
      </div>

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          initialReason={modalReason}
          onClose={() => { setSelectedOrder(null); setModalReason(undefined); }}
          onStageChange={(s) => setSelectedOrder((prev) => (prev ? { ...prev, stage: s } : null))}
        />
      )}

      {showNewForm && (
        <NewOrderModal type={type} onClose={() => setShowNewForm(false)} />
      )}

      <BulkActionBar
        selectedOrders={selectedOrders}
        onClear={() => setSelectedIds(new Set())}
        onDone={() => { setSelectMode(false); setSelectedIds(new Set()); }}
      />
    </>
  );
}
