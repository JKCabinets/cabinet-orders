"use client";

import { useState, useMemo } from "react";
import { TopBar } from "@/components/TopBar";
import { StatsBar } from "@/components/StatsBar";
import { Controls } from "@/components/Controls";
import { Board } from "@/components/Board";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { ArchiveSection } from "@/components/ArchiveSection";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useStore } from "@/lib/store";
import { Order } from "@/lib/data";

export default function Home() {
  const [tab, setTab] = useState<"orders" | "warranty">("orders");
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterMember, setFilterMember] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Bulk-select mode + selection state. Selection is keyed by order id and
  // clears whenever the user leaves select mode or switches tab.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { orders, warranties, loading } = useStore();
  const allItems = tab === "orders" ? orders : warranties;

  // Active items (not archived) shown on the board
  const activeItems = allItems.filter((o) => !o.archived);

  const filtered = activeItems.filter((o) => {
    if (
      search &&
      !o.name.toLowerCase().includes(search.toLowerCase()) &&
      !o.id.toLowerCase().includes(search.toLowerCase()) &&
      !o.sku.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filterSource && o.source !== filterSource) return false;
    if (filterMember && o.member !== filterMember) return false;
    return true;
  });

  // Selected order objects, drawn from the live store so stage/state stays current
  const selectedOrders = useMemo(
    () => filtered.filter(o => selectedIds.has(o.id)),
    [filtered, selectedIds]
  );

  function toggleSelectMode() {
    setSelectMode(prev => {
      if (prev) setSelectedIds(new Set()); // leaving select mode clears selection
      return !prev;
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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function handleCardClick(order: Order) {
    if (selectMode) {
      toggleSelection(order.id);
    } else {
      setSelectedOrder(order);
    }
  }

  function handleTabChange(newTab: "orders" | "warranty") {
    // Clear selection on tab switch — selections don't carry across tabs
    if (newTab !== tab) {
      setSelectedIds(new Set());
    }
    setTab(newTab);
  }

  return (
    <div className="flex flex-col min-h-screen">
      <TopBar tab={tab} onTabChange={handleTabChange} />
      <StatsBar items={activeItems} tab={tab} />
      <Controls
        search={search}
        onSearch={setSearch}
        filterSource={filterSource}
        onFilterSource={setFilterSource}
        filterMember={filterMember}
        onFilterMember={setFilterMember}
        onNewOrder={() => setShowNewForm(true)}
        tab={tab}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        selectedCount={selectedIds.size}
      />
      {loading ? (
        <div className="flex items-center justify-center flex-1 py-20">
          <div className="text-sm text-[rgba(232,227,218,0.28)]">Loading orders…</div>
        </div>
      ) : (
        <Board
          items={filtered}
          tab={tab}
          onCardClick={handleCardClick}
          selectMode={selectMode}
          selectedIds={selectedIds}
        />
      )}

      {/* Archive section below the board — selection doesn't extend here */}
      <ArchiveSection
        items={allItems}
        tab={tab}
        onCardClick={setSelectedOrder}
      />

      {selectedOrder && (
        <OrderModal
          order={selectedOrder}
          tab={tab}
          onClose={() => setSelectedOrder(null)}
          onStageChange={(stage) => {
            setSelectedOrder((prev) => prev ? { ...prev, stage } : null);
          }}
        />
      )}

      {showNewForm && (
        <NewOrderModal
          tab={tab}
          onClose={() => setShowNewForm(false)}
        />
      )}

      {/* Floating bulk action bar — slides up from the bottom when items are selected */}
      <BulkActionBar
        selectedOrders={selectedOrders}
        tab={tab}
        onClear={clearSelection}
        onDone={exitSelectMode}
      />
    </div>
  );
}
