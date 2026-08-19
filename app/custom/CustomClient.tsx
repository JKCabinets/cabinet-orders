"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { Order, CUSTOM_STAGES, STAGE_ACCENT } from "@/lib/data";
import { PageHeader } from "@/components/AppShell";
import { OrderTable } from "@/components/OrderTable";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Search, CheckSquare, X } from "lucide-react";

/**
 * /custom — Custom Orders.
 *
 * A manually-entered order and a quote-form order are the same thing
 * arriving two ways, so both are type "custom" and both live here. Flow:
 * New → In review → Ordered → In production → At cross dock → Delivered.
 *
 * These never sync to Shopify — they are handled separately from the site.
 */
export function CustomClient() {
  const { customs } = useStore();
  const [search, setSearch] = useState("");
  const [activeStage, setActiveStage] = useState<string>("__all__");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [modalReason, setModalReason] = useState<"needs-attachment" | undefined>(undefined);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const active = useMemo(() => customs.filter(o => !o.archived), [customs]);

  const stageCounts: Record<string, number> = {};
  for (const stage of CUSTOM_STAGES) {
    stageCounts[stage] = active.filter(o => o.stage === stage).length;
  }

  const filtered = useMemo(() => {
    let list = active;
    if (activeStage !== "__all__") list = list.filter(o => o.stage === activeStage);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.sku.toLowerCase().includes(q)
      );
    }
    return list;
  }, [active, activeStage, search]);

  function toggleSelectMode() {
    setSelectMode(v => { if (v) setSelectedIds(new Set()); return !v; });
  }
  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectedOrders = useMemo(
    () => filtered.filter(o => selectedIds.has(o.id)),
    [filtered, selectedIds],
  );

  // OrderTable's action column branches on THIS prop, not per row. Passing
  // "New" would render "Mark Entered" on claimed rows, and markEntered calls
  // moveStage(id, "Entered") -- a stage that is NOT in CUSTOM_STAGES. Stage
  // validation is still global (ALLOWED_STAGES), so the server would accept
  // it and strand the row outside its own flow.
  //
  // "In review" is a real custom stage that matches no order-stage branch, so
  // the action column stays inert -- the same technique WarrantyClient uses
  // with "New claim". Stage moves go through the modal, which offers the
  // correct per-type list. Phase 2c makes this column type-aware.
  // Was hardcoded to "In review" as a placeholder believed inert. It was
  // not -- it matched the WARRANTY branch and moved a custom order to
  // "Parts ordered". OrderTable now guards on the row's own flow, so the
  // real stage is safe to pass; on the All tab no single stage describes
  // the rows, so nothing is offered.
  const tableStage = activeStage === "__all__" ? "__none__" : activeStage;

  return (
    <>
      <PageHeader
        eyebrow="Quotes & manual orders"
        title="Custom"
        accent="orders"
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
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] uppercase tracking-wider bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New custom order
            </button>
          </>
        }
      />

      {/* Stage tabs */}
      <div className="px-6 lg:px-8 pb-3 flex gap-1.5 flex-wrap">
        <button
          onClick={() => setActiveStage("__all__")}
          className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all ${
            activeStage === "__all__"
              ? "bg-cream/12 border border-cream/30 text-cream"
              : "bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8"
          }`}
        >
          All <span className="opacity-65 ml-1">{active.length}</span>
        </button>
        {CUSTOM_STAGES.map(s => (
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
            {s} <span className="opacity-65 ml-0.5">{stageCounts[s]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-6 lg:px-8 pb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cream/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search custom orders…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="custom-search-no-autofill"
            className="w-full pl-9 pr-4 py-2 rounded-full text-[13px] bg-white/6 border border-cream/15 text-cream placeholder:text-cream/40 focus:border-terracotta/55 transition-colors"
            style={{ fontSize: "16px" }}
          />
        </div>
      </div>

      <div className="px-6 lg:px-8 pb-12">
        {filtered.length === 0 ? (
          <div className="glass rounded-brand p-10 text-center">
            <div className="font-display text-[22px] text-cream/70 mb-1">No custom orders</div>
            <div className="text-[12px] text-cream/45">
              {search ? `Nothing matched "${search}".` : "No custom orders yet."}
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
          onStageChange={(s) => setSelectedOrder(prev => prev ? { ...prev, stage: s } : null)}
        />
      )}
      {showNewForm && (
        <NewOrderModal type="custom" onClose={() => setShowNewForm(false)} />
      )}
      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedOrders={selectedOrders}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => { setSelectMode(false); setSelectedIds(new Set()); }}
        />
      )}
    </>
  );
}
