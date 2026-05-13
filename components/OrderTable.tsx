"use client";

import { useState, useMemo } from "react";
import { Order, AVATAR_COLOR_STYLES, getBackorderStatus } from "@/lib/data";
import { useStore } from "@/lib/store";
import { useSession } from "next-auth/react";
import { formatDateWithYear, parseOrderDate } from "@/lib/dateUtils";
import { checkAttachmentGate } from "@/lib/stageGates";
import { ArrowUp, ArrowDown, RotateCcw, ChevronRight, Download } from "lucide-react";

/**
 * Sortable, dense, brand-styled table view of orders. Used on each stage
 * page (and the archive page) in place of the card grid.
 *
 * Click anywhere on a row except the inline primary action → opens the modal.
 * The primary action column varies by stage:
 *   - New:                 "Claim" if unclaimed; "Mark Entered" if claimed
 *   - Entered:             "Export PDF"
 *   - In production:       "Mark Cross-dock" (sets scheduled delivery)
 *   - At cross dock:       "Confirm Delivery"
 *   - Delivered / Archive: "Restore" (archive only) / status text
 */

type SortKey = "id" | "date" | "name" | "source" | "payment_status" | "claimed_by";
type SortDir = "asc" | "desc";

interface OrderTableProps {
  orders: Order[];
  stage: string;
  /**
   * Called when a row is clicked (opens the modal in the parent). The
   * optional `reason` is passed to the modal so it can render a
   * contextual banner / auto-focus action.
   */
  onSelect: (order: Order, reason?: "needs-attachment") => void;
  /** Bulk-select mode props */
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

const STAGE_COLOR: Record<string, string> = {
  "New":            "#c97070",
  "Entered":        "#d4922a",
  "In production":  "#c8b84a",
  "At cross dock":  "#5a8db8",
  "Delivered":      "#8fbe70",
  "Archived":       "#91a597",
};

// Payment status pills — Shopify financial_status values mapped to brand colors
const PAYMENT_PILL: Record<string, { bg: string; color: string; border: string; label: string }> = {
  paid:               { bg: "rgba(143,190,112,0.15)", color: "#a0cc7a", border: "rgba(143,190,112,0.35)", label: "Paid" },
  partially_paid:     { bg: "rgba(232,181,106,0.15)", color: "#e8b56a", border: "rgba(232,181,106,0.40)", label: "Partial" },
  pending:            { bg: "rgba(232,144,144,0.15)", color: "#e89090", border: "rgba(232,144,144,0.40)", label: "Pending" },
  authorized:         { bg: "rgba(140,170,200,0.15)", color: "#a8c8e0", border: "rgba(140,170,200,0.35)", label: "Authorized" },
  refunded:           { bg: "rgba(240,236,228,0.08)", color: "#d8d4cc", border: "rgba(240,236,228,0.20)", label: "Refunded" },
  partially_refunded: { bg: "rgba(240,236,228,0.08)", color: "#d8d4cc", border: "rgba(240,236,228,0.20)", label: "Part. refunded" },
  voided:             { bg: "rgba(240,236,228,0.04)", color: "#a0a09a", border: "rgba(240,236,228,0.12)", label: "Voided" },
};

export function OrderTable({
  orders, stage, onSelect, selectMode = false, selectedIds, onToggleSelect,
}: OrderTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...orders];
    arr.sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "id":   av = a.id; bv = b.id; break;
        case "name": av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case "source": av = a.source; bv = b.source; break;
        case "payment_status": av = a.payment_status ?? "zzz"; bv = b.payment_status ?? "zzz"; break;
        case "claimed_by": av = a.claimed_by ?? "zzz"; bv = b.claimed_by ?? "zzz"; break;
        case "date":
          av = parseOrderDate(a.date) ?? 0;
          bv = parseOrderDate(b.date) ?? 0;
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [orders, sortKey, sortDir]);

  const accent = STAGE_COLOR[stage] ?? "#91a597";

  return (
    <div className="glass rounded-brand overflow-hidden" style={{ borderTop: `2px solid ${accent}` }}>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="border-b border-white/10">
              {selectMode && <th className="w-8 px-2 py-2.5"></th>}
              <SortableHeader label="Order #"   col="id"             current={sortKey} dir={sortDir} onClick={setSort} width="w-[120px]" />
              <SortableHeader label="Date"      col="date"           current={sortKey} dir={sortDir} onClick={setSort} width="w-[110px]" />
              <SortableHeader label="Customer"  col="name"           current={sortKey} dir={sortDir} onClick={setSort} />
              <SortableHeader label="Type"      col="source"         current={sortKey} dir={sortDir} onClick={setSort} width="w-[95px]" />
              <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium">Status</th>
              <SortableHeader label="Payment"   col="payment_status" current={sortKey} dir={sortDir} onClick={setSort} width="w-[120px]" />
              <SortableHeader label="Team"      col="claimed_by"     current={sortKey} dir={sortDir} onClick={setSort} width="w-[80px]" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((order, i) => (
              <OrderRow
                key={order.id}
                order={order}
                stage={stage}
                onSelect={onSelect}
                selectMode={selectMode}
                selected={selectedIds?.has(order.id) ?? false}
                onToggleSelect={onToggleSelect}
                rowIdx={i}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={selectMode ? 8 : 7} className="px-3 py-10 text-center text-cream/45 text-[12px]">
                  No orders in this stage.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: rendered as compact cards (a table won't fit) */}
      <div className="md:hidden flex flex-col">
        {sorted.length === 0 && (
          <div className="px-4 py-10 text-center text-cream/45 text-[12px]">No orders in this stage.</div>
        )}
        {sorted.map(order => (
          <MobileRow
            key={order.id}
            order={order}
            stage={stage}
            onSelect={onSelect}
            selectMode={selectMode}
            selected={selectedIds?.has(order.id) ?? false}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Sortable header ─────────────────────────────────────────────── */

function SortableHeader({
  label, col, current, dir, onClick, width,
}: {
  label: string; col: SortKey; current: SortKey; dir: SortDir;
  onClick: (col: SortKey) => void; width?: string;
}) {
  const active = current === col;
  return (
    <th className={`text-left px-3 py-2.5 ${width ?? ""}`}>
      <button
        onClick={() => onClick(col)}
        className={`flex items-center gap-1 text-[10px] uppercase tracking-[0.13em] font-medium transition-colors ${
          active ? "text-cream" : "text-cream/55 hover:text-cream/75"
        }`}
      >
        {label}
        {active && (dir === "asc" ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
      </button>
    </th>
  );
}

/* ─── Desktop row ─────────────────────────────────────────────────── */

function OrderRow({
  order, stage, onSelect, selectMode, selected, onToggleSelect, rowIdx,
}: {
  order: Order; stage: string;
  onSelect: (o: Order, reason?: "needs-attachment") => void;
  selectMode: boolean; selected: boolean; onToggleSelect?: (id: string) => void;
  rowIdx: number;
}) {
  const { team } = useStore();
  const member = team.find(m => m.initials === order.member);
  const memberStyle = member
    ? AVATAR_COLOR_STYLES[member.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
  const memberName = member?.name ?? order.member;

  function handleRowClick() {
    if (selectMode) onToggleSelect?.(order.id);
    else onSelect(order);
  }

  // Click bubbling: anything in the action cell calls e.stopPropagation()
  // so it doesn't open the modal.
  return (
    <tr
      onClick={handleRowClick}
      className="border-b border-white/5 hover:bg-white/4 cursor-pointer transition-colors"
      style={{ background: selected ? "rgba(184,130,106,0.10)" : undefined }}
    >
      {selectMode && (
        <td className="px-2 py-2.5">
          <div
            className="w-4 h-4 rounded-sm border flex items-center justify-center"
            style={{
              background: selected ? "rgba(184,130,106,0.85)" : "rgba(0,0,0,0.30)",
              borderColor: selected ? "rgba(184,130,106,1)" : "rgba(255,255,255,0.30)",
            }}
          >
            {selected && (
              <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="3,8 7,12 13,4" />
              </svg>
            )}
          </div>
        </td>
      )}
      <td className="px-3 py-2.5 font-mono text-[10px] text-cream/65">{order.id}</td>
      <td className="px-3 py-2.5 text-cream/75 text-[11px]">{formatDateWithYear(order.date)}</td>
      <td className="px-3 py-2.5">
        <div className="font-display text-[15px] leading-tight text-cream truncate">{order.name}</div>
        {/* SKU detail line hidden — too noisy for a list view. The SKU
            breakdown is available in the modal. */}
      </td>
      <td className="px-3 py-2.5">
        <TypePill source={order.source} />
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <StatusCell order={order} stage={stage} onOpenModal={onSelect} />
      </td>
      <td className="px-3 py-2.5">
        <PaymentPill status={order.payment_status} />
      </td>
      <td className="px-3 py-2.5">
        {order.claimed_by ? (
          <div className="flex items-center gap-1.5" title={`Claimed by ${order.claimed_by}`}>
            <div style={{ ...memberStyle, borderWidth: 1, borderStyle: "solid" }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">
              {order.member}
            </div>
            <span className="text-[10px] text-cream/55 truncate hidden xl:inline">{memberName}</span>
          </div>
        ) : (
          <span className="text-[10px] text-cream/30 italic">unclaimed</span>
        )}
      </td>
    </tr>
  );
}

/* ─── Mobile row (compact card) ──────────────────────────────────── */

function MobileRow({
  order, stage, onSelect, selectMode, selected, onToggleSelect,
}: {
  order: Order; stage: string;
  onSelect: (o: Order, reason?: "needs-attachment") => void;
  selectMode: boolean; selected: boolean; onToggleSelect?: (id: string) => void;
}) {
  function handleClick() {
    if (selectMode) onToggleSelect?.(order.id);
    else onSelect(order);
  }
  return (
    <button
      onClick={handleClick}
      className="text-left px-4 py-3 border-b border-white/5 hover:bg-white/4 transition-colors flex items-center gap-3"
      style={{ background: selected ? "rgba(184,130,106,0.10)" : undefined }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-mono text-[9px] text-cream/45">{order.id}</span>
          <TypePill source={order.source} />
          <PaymentPill status={order.payment_status} />
        </div>
        <div className="font-display text-[15px] leading-tight text-cream truncate">{order.name}</div>
        <div className="text-[10px] text-cream/45 truncate">{formatDateWithYear(order.date)}</div>
      </div>
      <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
        <StatusCell order={order} stage={stage} mobile onOpenModal={onSelect} />
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-cream/40 flex-shrink-0" />
    </button>
  );
}

/* ─── Type pill (Shopify / Custom) ───────────────────────────────── */

function TypePill({ source }: { source: string }) {
  const isShopify = source === "Shopify";
  const style = isShopify
    ? { background: "rgba(184,130,106,0.15)", color: "#d9a888", border: "0.5px solid rgba(184,130,106,0.40)" }
    : { background: "rgba(145,165,151,0.18)", color: "#b8d0bd", border: "0.5px solid rgba(145,165,151,0.45)" };
  return (
    <span className="text-[9px] px-2 py-px rounded-full font-medium uppercase tracking-wider" style={style}>
      {isShopify ? "Shopify" : "Custom"}
    </span>
  );
}

/* ─── Payment pill ────────────────────────────────────────────────── */

function PaymentPill({ status }: { status?: string | null }) {
  if (!status) {
    return <span className="text-[10px] text-cream/30 italic">—</span>;
  }
  const pill = PAYMENT_PILL[status] ?? {
    bg: "rgba(240,236,228,0.06)", color: "#d8d4cc", border: "rgba(240,236,228,0.18)",
    label: status,
  };
  return (
    <span
      className="text-[9px] px-2 py-px rounded-full font-medium uppercase tracking-wider whitespace-nowrap"
      style={{ background: pill.bg, color: pill.color, border: `0.5px solid ${pill.border}` }}
    >
      {pill.label}
    </span>
  );
}

/* ─── Status cell — text + primary action button ─────────────────── */

function StatusCell({
  order, stage, mobile = false, onOpenModal,
}: {
  order: Order; stage: string; mobile?: boolean;
  /** Called when a gate fails so the user can fix it in the modal. */
  onOpenModal?: (o: Order, reason?: "needs-attachment") => void;
}) {
  const { data: session } = useSession();
  const { claimOrder, moveStage, archiveOrder, unarchiveOrder } = useStore();
  const currentUserName = session?.user?.name ?? null;
  const [busy, setBusy] = useState(false);

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  /**
   * Run the New→Entered attachment gate. If it fails, surface the error
   * inline AND open the modal so the user can attach a file directly.
   */
  async function markEntered() {
    setBusy(true);
    try {
      const gate = await checkAttachmentGate(order.id);
      if (!gate.ok) {
        // Open the modal pre-flagged so it shows the banner + opens the
        // file picker automatically.
        onOpenModal?.(order, "needs-attachment");
        return;
      }
      await moveStage(order.id, "Entered", currentUserName ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  // ── Archived ──
  if (stage === "Archived") {
    return (
      <button
        onClick={() => withBusy(() => unarchiveOrder(order.id))}
        disabled={busy}
        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all"
        style={{
          background: busy ? "rgba(145,165,151,0.08)" : "rgba(145,165,151,0.18)",
          border: "0.5px solid rgba(145,165,151,0.45)",
          color: busy ? "rgba(184,210,189,0.40)" : "#b8d0bd",
          cursor: busy ? "wait" : "pointer",
        }}
      >
        <RotateCcw className="w-3 h-3" />
        {busy ? "..." : "Restore"}
      </button>
    );
  }

  // ── New ──
  if (stage === "New") {
    const claimedBy = order.claimed_by ?? null;
    const isClaimedByMe = !!currentUserName && claimedBy === currentUserName;
    const isClaimedByOther = !!claimedBy && !isClaimedByMe;

    if (isClaimedByOther) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-cream/55">Claimed</span>
          <span className="text-[10px] text-cream/40">by {claimedBy}</span>
        </div>
      );
    }
    if (isClaimedByMe) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-cream/55">Yours —</span>
          <button
            onClick={markEntered}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
            title="Requires an attached PDF"
          >
            {busy ? "..." : (mobile ? "Enter" : "Mark Entered")}
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={() => withBusy(() => claimOrder(order.id, currentUserName))}
        disabled={busy || !currentUserName}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
      >
        {busy ? "..." : "Claim"}
      </button>
    );
  }

  // ── Entered ──
  if (stage === "Entered") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-cream/55">Awaiting prod</span>
        <a
          href={`/api/orders/${order.id}/export`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        >
          <Download className="w-3 h-3" />
          Export
        </a>
      </div>
    );
  }

  // ── In production ──
  if (stage === "In production") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-cream/55">Building</span>
        <button
          onClick={() => withBusy(() => moveStage(order.id, "At cross dock"))}
          disabled={busy}
          className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        >
          {busy ? "..." : (mobile ? "Cross dock" : "Mark Cross-dock")}
        </button>
      </div>
    );
  }

  // ── At cross dock ──
  if (stage === "At cross dock") {
    const bo = getBackorderStatus(order.sku_items);
    return (
      <div className="flex items-center gap-1.5">
        {bo.status === "pending" ? (
          <span className="text-[10px]" style={{ color: "#e89090" }}>{bo.count} backordered</span>
        ) : order.scheduled_delivery_date ? (
          <span className="text-[10px] text-cream/55">Sched {order.scheduled_delivery_date}</span>
        ) : (
          <span className="text-[10px] text-cream/55">Awaiting call</span>
        )}
        <button
          onClick={() => withBusy(() => archiveOrder(order.id))}
          disabled={busy}
          className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        >
          {busy ? "..." : (mobile ? "Confirm" : "Confirm Delivery")}
        </button>
      </div>
    );
  }

  // ── Delivered ──
  if (stage === "Delivered") {
    return <span className="text-[10px] text-cream/55">Completed</span>;
  }

  // ── Warranty fallback ──
  return <span className="text-[10px] text-cream/55">{stage}</span>;
}
