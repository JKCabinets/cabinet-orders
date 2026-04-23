"use client";

import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { StatsBar } from "@/components/StatsBar";
import { Controls } from "@/components/Controls";
import { Board } from "@/components/Board";
import { OrderModal } from "@/components/OrderModal";
import { NewOrderModal } from "@/components/NewOrderModal";
import { ArchiveSection } from "@/components/ArchiveSection";
import { useStore } from "@/lib/store";
import { Order } from "@/lib/data";

export default function Home() {
  const [tab, setTab] = useState<"orders" | "warranty">("orders");
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterMember, setFilterMember] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

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

  return (
    <div className="flex flex-col min-h-screen">
      <TopBar tab={tab} onTabChange={setTab} />
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
      />
      {loading ? (
        <div className="flex items-center justify-center flex-1 py-20">
          <div className="text-sm text-[rgba(232,227,218,0.28)]">Loading orders…</div>
        </div>
      ) : (
        <Board
          items={filtered}
          tab={tab}
          onCardClick={setSelectedOrder}
        />
      )}

      {/* Archive section below the board */}
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
    </div>
  );
}
