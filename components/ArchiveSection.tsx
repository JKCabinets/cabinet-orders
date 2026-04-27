"use client";

import { useState } from "react";
import { Archive, ChevronDown, ChevronUp, Search, RotateCcw } from "lucide-react";
import { Order, AVATAR_COLOR_STYLES } from "@/lib/data";
import { useStore } from "@/lib/store";

interface ArchiveSectionProps {
  items: Order[];
  tab: "orders" | "warranty";
  onCardClick: (order: Order) => void;
}

const TH = "text-left px-3 py-2.5 text-[10px] uppercase tracking-widest font-medium text-[rgba(232,227,218,0.28)]";
const TD = "px-3 py-3";

export function ArchiveSection({ items, tab, onCardClick }: ArchiveSectionProps) {
  const { unarchiveOrder, team } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");

  const archived = items.filter((o) => o.archived);
  const filtered = archived.filter((o) => {
    if (!search) return true;
    return (
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.id.toLowerCase().includes(search.toLowerCase()) ||
      o.sku.toLowerCase().includes(search.toLowerCase())
    );
  });

  if (archived.length === 0) return null;

  const label = tab === "orders" ? "Delivered orders" : "Resolved claims";
  const stageDoneLabel = tab === "orders" ? "Delivered" : "Resolved";

  function getMemberAvatarStyle(initials: string) {
    const member = team.find((m) => m.initials === initials);
    if (member) return AVATAR_COLOR_STYLES[member.avatarColor];
    return { backgroundColor: "rgba(86,100,72,0.20)", color: "#7a8f6a", borderColor: "rgba(86,100,72,0.40)" };
  }

  return (
    <div
      className="mx-4 md:mx-6 mb-8 rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "0.5px solid rgba(255,255,255,0.08)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Header toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-[rgba(255,255,255,0.03)]"
      >
        <div className="flex items-center gap-2.5">
          <Archive className="w-3.5 h-3.5 text-[rgba(232,227,218,0.35)]" />
          <span className="text-sm font-medium text-[rgba(232,227,218,0.55)]">{label}</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-md font-medium"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "0.5px solid rgba(255,255,255,0.10)",
              color: "rgba(232,227,218,0.40)",
            }}
          >
            {archived.length}
          </span>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-[rgba(232,227,218,0.30)]" />
          : <ChevronDown className="w-4 h-4 text-[rgba(232,227,218,0.30)]" />}
      </button>

      {expanded && (
        <div style={{ borderTop: "0.5px solid rgba(255,255,255,0.07)" }}>
          {/* Search */}
          <div className="px-5 py-3" style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}>
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-[rgba(232,227,218,0.28)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search archive…"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs placeholder:text-[rgba(232,227,218,0.20)] transition-colors"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "0.5px solid rgba(255,255,255,0.10)",
                  color: "#e8e3da",
                  fontSize: "16px",
                }}
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}>
                  <th className={`${TH} pl-5`}>ID</th>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Detail</th>
                  <th className={TH}>SKU</th>
                  <th className={TH}>Source</th>
                  <th className={TH}>Member</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-6 text-center text-[rgba(232,227,218,0.30)]">
                      No results for &ldquo;{search}&rdquo;
                    </td>
                  </tr>
                )}
                {filtered.map((order) => (
                  <tr
                    key={order.id}
                    className="group transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                    style={{ borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}
                  >
                    <td className={`${TD} pl-5`}>
                      <button
                        onClick={() => onCardClick(order)}
                        className="font-mono text-[rgba(232,227,218,0.35)] hover:text-[#e8e3da] transition-colors"
                      >
                        {order.id}
                      </button>
                    </td>
                    <td className={TD}>
                      <button
                        onClick={() => onCardClick(order)}
                        className="text-[rgba(232,227,218,0.60)] hover:text-[#e8e3da] transition-colors text-left"
                      >
                        {order.name}
                      </button>
                    </td>
                    <td className={`${TD} text-[rgba(232,227,218,0.35)] max-w-[160px] truncate`}>{order.detail}</td>
                    <td className={`${TD} font-mono text-[rgba(232,227,218,0.35)]`}>{order.sku}</td>
                    <td className={TD}>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={
                          order.source === "Shopify"
                            ? { background: "rgba(86,100,72,0.18)", color: "#7a8f6a", border: "0.5px solid rgba(86,100,72,0.35)" }
                            : { background: "rgba(74,111,143,0.12)", color: "rgba(74,143,212,0.75)", border: "0.5px solid rgba(74,111,143,0.30)" }
                        }
                      >
                        {order.source}
                      </span>
                    </td>
                    <td className={TD}>
                      <div
                        style={{ ...getMemberAvatarStyle(order.member), borderWidth: 1, borderStyle: "solid" }}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                      >
                        {order.member}
                      </div>
                    </td>
                    <td className={`${TD} text-[rgba(232,227,218,0.35)] whitespace-nowrap`}>{order.date}</td>
                    <td className={TD}>
                      <span className="flex items-center gap-1.5" style={{ color: "#4caf7a" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4caf7a] flex-shrink-0" />
                        {stageDoneLabel}
                      </span>
                    </td>
                    <td className={TD}>
                      <button
                        onClick={() => unarchiveOrder(order.id)}
                        title="Restore to board"
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] transition-all hover:text-[#e8e3da]"
                        style={{ color: "rgba(232,227,218,0.40)" }}
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
