"use client";

import { Order } from "@/lib/data";
import { getOldestAge } from "@/lib/dateUtils";

interface StatsBarProps { items: Order[]; tab: "orders" | "warranty"; }

const STAGE_STYLES: Record<string, { border: string; text: string; glow: string }> = {
  "New orders":    { border: "#e05555", text: "#e05555", glow: "rgba(224,85,85,0.15)" },
  "Entered":       { border: "#d4922a", text: "#d4922a", glow: "rgba(212,146,42,0.15)" },
  "In production": { border: "#c8b84a", text: "#c8b84a", glow: "rgba(200,184,74,0.12)" },
  "At cross dock": { border: "#4a8fd4", text: "#4a8fd4", glow: "rgba(74,143,212,0.15)" },
  "Delivered":     { border: "#4caf7a", text: "#4caf7a", glow: "rgba(76,175,122,0.15)" },
  "New claims":    { border: "#e05555", text: "#e05555", glow: "rgba(224,85,85,0.15)" },
  "In review":     { border: "#d4922a", text: "#d4922a", glow: "rgba(212,146,42,0.15)" },
  "Parts ordered": { border: "#c8b84a", text: "#c8b84a", glow: "rgba(200,184,74,0.12)" },
  "Resolved":      { border: "#4caf7a", text: "#4caf7a", glow: "rgba(76,175,122,0.15)" },
};

export function StatsBar({ items, tab }: StatsBarProps) {
  const enteredOrders = items.filter((o) => o.stage === "Entered");
  const stats = tab === "orders" ? [
    { label: "New orders",    value: items.filter(o => o.stage === "New").length,            sub: `${items.filter(o => o.source === "Shopify" && o.stage === "New").length} from Shopify` },
    { label: "Entered",       value: enteredOrders.length,                                   sub: getOldestAge(enteredOrders) ?? "none pending" },
    { label: "In production", value: items.filter(o => o.stage === "In production").length,  sub: "Avg 14 days" },
    { label: "At cross dock", value: items.filter(o => o.stage === "At cross dock").length,  sub: "Pending customer call" },
    { label: "Delivered",     value: items.filter(o => o.stage === "Delivered").length,      sub: "This month" },
  ] : [
    { label: "New claims",    value: items.filter(o => o.stage === "New claim").length,      sub: "" },
    { label: "In review",     value: items.filter(o => o.stage === "In review").length,      sub: "" },
    { label: "Parts ordered", value: items.filter(o => o.stage === "Parts ordered").length,  sub: "" },
    { label: "Resolved",      value: items.filter(o => o.stage === "Resolved").length,       sub: "This month" },
  ];

  const cols = tab === "orders" ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4";

  return (
    <div className={`grid ${cols} gap-2 md:gap-3 px-3 md:px-5 pb-3`}>
      {stats.map((s) => {
        const st = STAGE_STYLES[s.label] ?? { border: "#566448", text: "#8fbe70", glow: "rgba(86,100,72,0.12)" };
        return (
          <div key={s.label} className="rounded-2xl px-4 py-4 relative overflow-hidden" style={{
            background: "rgba(255,255,255,0.15)",
            border: "0.5px solid rgba(255,255,255,0.15)",
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.30), 0 0 40px ${st.glow}`,
            borderTopColor: st.border,
            borderTopWidth: "2px",
          }}>
            <div className="absolute inset-0 pointer-events-none" style={{
              background: `radial-gradient(ellipse at 50% 0%, ${st.glow} 0%, transparent 70%)`,
            }} />
            <p className="text-[11px] text-[rgba(232,227,218,0.70)] mb-2 relative">{s.label}</p>
            <p className="text-3xl font-bold mb-1 tabular-nums relative" style={{ color: st.text }}>{s.value}</p>
            {s.sub && <p className="text-[11px] text-[rgba(232,227,218,0.50)] relative">{s.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}
