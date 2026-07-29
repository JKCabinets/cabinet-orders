"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { Order, WARRANTY_STAGES } from "@/lib/data";
import { PageHeader } from "@/components/AppShell";
import { OrderTable } from "@/components/OrderTable";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Search, CheckSquare, X } from "lucide-react";

const WARRANTY_STAGE_ACCENT: Record<string, string> = {
  "New claim":     "#c97070",
  "In review":     "#d4922a",
  "Parts ordered": "#c8b84a",
  "Shipped":       "#5a8db8",
  "Resolved":      "#8fbe70",
};

export function WarrantyClient() {
  const { warranties } = useStore();
  const [search, setSearch] = useState("");
  const [activeStage, setActiveStage] = useState<string>("__all__");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [modalReason, setModalReason] = useState<"needs-attachment" | undefined>(undefined);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const active = useMemo(() => warranties.filter(w => !w.archived), [warranties]);

  const stageCounts: Record<string, number> = {};
  for (const stage of WARRANTY_STAGES) {
    stageCounts[stage] = active.filter(w => w.stage === stage).length;
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

  // The OrderTable picks column headers from a single `stage` prop. For
  // "All" we use the most permissive value — "New claim" preserves the
  // Update Status column and claim affordances, and each row still
  // renders its own stage-aware status independently.
  const tableStage = activeStage === "__all__" ? "New claim" : activeStage;

  return (
    <>
      <PageHeader
        eyebrow="Customer claims"
        title="Warranty"
        accent="claims"
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
              New claim
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
        {WARRANTY_STAGES.map(s => (
          <button
            key={s}
            onClick={() => setActiveStage(s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider transition-all ${
              activeStage === s
                ? "bg-cream/12 border border-cream/30 text-cream"
                : "bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: WARRANTY_STAGE_ACCENT[s] }} />
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
            placeholder="Search claims…"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            name="warranty-search-no-autofill"
            className="w-full pl-9 pr-4 py-2 rounded-full text-[13px] bg-white/6 border border-cream/15 text-cream placeholder:text-cream/40 focus:border-terracotta/55 transition-colors"
            style={{ fontSize: "16px" }}
          />
        </div>
      </div>

      <div className="px-6 lg:px-8 pb-12">
        {filtered.length === 0 ? (
          <div className="glass rounded-brand p-10 text-center">
            <div className="font-display text-[22px] text-cream/70 mb-1">No claims</div>
            <div className="text-[12px] text-cream/45">
              {search ? `Nothing matched "${search}".` : "No warranty claims yet."}
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
        <NewOrderModal type="warranty" onClose={() => setShowNewForm(false)} />
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
