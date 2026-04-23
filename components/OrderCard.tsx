"use client";

import { Order, AVATAR_COLOR_STYLES } from "@/lib/data";
import { useStore } from "@/lib/store";
import { formatDateWithYear } from "@/lib/dateUtils";

interface OrderCardProps { order: Order; onClick: () => void; style?: React.CSSProperties; }

const STAGE_BORDER: Record<string, string> = {
  "New": "#e05555", "Entered": "#d4922a", "In production": "#c8b84a",
  "At cross dock": "#4a8fd4", "Delivered": "#4caf7a",
  "New claim": "#e05555", "In review": "#d4922a", "Parts ordered": "#c8b84a",
  "Repair scheduled": "#4a8fd4", "Resolved": "#4caf7a",
};

export function OrderCard({ order, onClick, style }: OrderCardProps) {
  const { team } = useStore();
  const stageBorder = STAGE_BORDER[order.stage] ?? "rgba(255,255,255,0.15)";
  const member = team.find((m) => m.initials === order.member);
  const memberStyle = member ? AVATAR_COLOR_STYLES[member.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
  const memberName = member?.name ?? order.member;
  const displayDate = formatDateWithYear(order.date);

  return (
    <button onClick={onClick}
      className="w-full text-left rounded-xl p-2 transition-all duration-150 cursor-pointer animate-card-in hover:-translate-y-0.5"
      style={{
        ...style,
        background: "rgba(255,255,255,0.15)",
        border: "0.5px solid rgba(255,255,255,0.15)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.28)",
        borderTopColor: stageBorder,
        borderTopWidth: "2px",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-mono text-[rgba(232,227,218,0.45)] flex-shrink-0">{order.id}</span>
        <span className="text-[11px] font-semibold text-[#e8e3da] truncate flex-1">{order.name}</span>
        <SourceBadge source={order.source} />
      </div>
      <div className="flex items-center gap-1.5">
        <div style={{ ...memberStyle, borderWidth: 1, borderStyle: "solid" }}
          className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">
          {order.member}
        </div>
        <span className="text-[10px] text-[rgba(232,227,218,0.60)] truncate flex-1">{memberName}</span>
        <span className="text-[9px] text-[rgba(232,227,218,0.45)]">{displayDate}</span>
      </div>
    </button>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="text-[9px] px-1.5 py-px rounded font-semibold flex-shrink-0"
      style={source === "Shopify"
        ? { background: "rgba(86,100,72,0.25)", color: "#a0cc7a", border: "0.5px solid rgba(86,100,72,0.75)" }
        : { background: "rgba(74,111,143,0.22)", color: "rgba(110,170,230,0.95)", border: "0.5px solid rgba(74,111,143,0.45)" }}>
      {source}
    </span>
  );
}
