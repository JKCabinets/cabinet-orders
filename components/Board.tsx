"use client";

import { Order, ORDER_STAGES, WARRANTY_STAGES } from "@/lib/data";
import { OrderCard } from "./OrderCard";

interface BoardProps { items: Order[]; tab: "orders" | "warranty"; onCardClick: (order: Order) => void; }

const STAGE_COLOR: Record<string, string> = {
  "New": "#e05555", "Entered": "#d4922a", "In production": "#c8b84a",
  "At cross dock": "#4a8fd4", "Delivered": "#4caf7a",
  "New claim": "#e05555", "In review": "#d4922a", "Parts ordered": "#c8b84a",
  "Repair scheduled": "#4a8fd4", "Resolved": "#4caf7a",
};

export function Board({ items, tab, onCardClick }: BoardProps) {
  const stages = tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES;
  return (
    <div className="flex-1 overflow-x-auto px-3 md:px-5">
      <div className="flex gap-2.5 md:gap-3 pb-6 min-w-max md:min-w-0 md:w-full snap-x snap-mandatory md:snap-none">
        {stages.map((stage) => (
          <Column key={stage} stage={stage} items={items.filter(o => o.stage === stage)} onCardClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}

function Column({ stage, items, onCardClick }: { stage: string; items: Order[]; onCardClick: (o: Order) => void }) {
  const color = STAGE_COLOR[stage] ?? "#566448";
  return (
    <div className="w-[160px] flex-shrink-0 md:flex-1 md:min-w-0 md:w-auto flex flex-col gap-2 snap-start">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{
        background: "rgba(255,255,255,0.15)",
        border: "0.5px solid rgba(255,255,255,0.15)",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 16px rgba(0,0,0,0.15)`,
        borderTopColor: color,
        borderTopWidth: "2px",
      }}>
        <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color }}>{stage}</span>
        <span className="w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-semibold"
          style={{ background: `${color}25`, border: `0.5px solid ${color}60`, color }}>
          {items.length}
        </span>
      </div>
      {/* Lane */}
      <div className="flex flex-col gap-1.5 min-h-[50px] rounded-2xl p-2" style={{
        background: "rgba(0,0,0,0.12)",
        border: "0.5px solid rgba(255,255,255,0.20)",
        boxShadow: "inset 0 3px 12px rgba(0,0,0,0.30)",
      }}>
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-[rgba(255,255,255,0.15)] h-10 flex items-center justify-center">
            <span className="text-[9px] text-[rgba(232,227,218,0.18)]">Empty</span>
          </div>
        )}
        {items.map((item, i) => (
          <OrderCard key={item.id} order={item} onClick={() => onCardClick(item)} style={{ animationDelay: `${i * 25}ms` }} />
        ))}
      </div>
    </div>
  );
}
