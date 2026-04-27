"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Plus, ChevronDown } from "lucide-react";
import { useStore } from "@/lib/store";

interface ControlsProps {
  search: string; onSearch: (v: string) => void;
  filterSource: string; onFilterSource: (v: string) => void;
  filterMember: string; onFilterMember: (v: string) => void;
  onNewOrder: () => void; tab: "orders" | "warranty";
}

const GI: React.CSSProperties = {
  background: "rgba(255,255,255,0.15)",
  border: "0.5px solid rgba(255,255,255,0.15)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 2px 8px rgba(0,0,0,0.10)",
  color: "#f0ece4",
};

function Dropdown({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative flex-1">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all hover:brightness-110"
        style={{ ...GI, color: value ? "#f0ece4" : "rgba(232,227,218,0.60)", textAlign: "left" }}>
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 transition-transform duration-150"
          style={{ color: "rgba(232,227,218,0.35)", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-50 rounded-xl overflow-hidden" style={{
          background: "rgba(22,36,50,0.97)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border: "0.5px solid rgba(255,255,255,0.15)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), 0 16px 48px rgba(0,0,0,0.55)",
        }}>
          {options.map(opt => (
            <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-xs transition-colors hover:bg-[rgba(255,255,255,0.20)]"
              style={{
                color: value === opt.value ? "#f0ece4" : "rgba(232,227,218,0.55)",
                borderBottom: "0.5px solid rgba(255,255,255,0.20)",
                background: value === opt.value ? "rgba(86,100,72,0.20)" : "transparent",
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Controls({ search, onSearch, filterSource, onFilterSource, filterMember, onFilterMember, onNewOrder, tab }: ControlsProps) {
  const { team } = useStore();
  const activeTeam = team.filter(m => m.active);
  return (
    <div className="px-3 md:px-5 pb-3 md:pb-4 flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[rgba(232,227,218,0.45)]" />
          <input type="text" value={search} onChange={e => onSearch(e.target.value)}
            placeholder="Search by name, order ID, or SKU…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm placeholder:text-[rgba(232,227,218,0.40)] focus:border-[rgba(86,100,72,0.75)] transition-colors"
            style={{ ...GI, fontSize: "16px" }} />
        </div>
        <button onClick={onNewOrder}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 hover:-translate-y-px hover:brightness-115 whitespace-nowrap"
          style={{
            background: "rgba(86,100,72,0.22)",
            border: "0.5px solid rgba(86,100,72,0.75)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 16px rgba(86,100,72,0.20)",
            color: "#a8dd80",
          }}>
          <Plus className="w-3.5 h-3.5" />
          {tab === "orders" ? "New order" : "New claim"}
        </button>
      </div>
      <div className="flex gap-2">
        <Dropdown value={filterSource} onChange={onFilterSource} placeholder="All sources"
          options={[{ value: "", label: "All sources" }, { value: "Shopify", label: "Shopify" }, { value: "Manual", label: "Manual" }]} />
        <Dropdown value={filterMember} onChange={onFilterMember} placeholder="All team members"
          options={[{ value: "", label: "All team members" }, ...activeTeam.map(m => ({ value: m.initials, label: `${m.initials} — ${m.name}` }))]} />
      </div>
    </div>
  );
}
