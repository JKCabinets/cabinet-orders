"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import { Order, Stage, AVATAR_COLOR_STYLES, getBackorderStatus } from "@/lib/data";
import { useStore } from "@/lib/store";
import { useSession } from "next-auth/react";
import { formatDateWithYear, parseOrderDate } from "@/lib/dateUtils";
import { checkAttachmentGate } from "@/lib/stageGates";
import { decodeHtmlEntities } from "@/lib/htmlEntities";
import { ArrowUp, ArrowDown, RotateCcw, ChevronRight, Download, X } from "lucide-react";

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
              {stage !== "Archived" && (
                <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium w-[180px]">Update Status</th>
              )}
              {stage !== "New" && (
                <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium w-[110px]">Info</th>
              )}
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
                <td
                  colSpan={
                    (selectMode ? 8 : 7)
                    + (stage !== "New" ? 1 : 0)
                    + (stage !== "Archived" ? 1 : 0)
                  }
                  className="px-3 py-10 text-center text-cream/45 text-[12px]"
                >
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

  // The team avatar is driven by stage:
  //   - New: show whoever has claimed the order; if unclaimed → "unclaimed"
  //     (entered_by is intentionally ignored here — a previously-Entered
  //     order that rolled back to New is unclaimed until someone picks it
  //     up again)
  //   - Entered & beyond: show whoever entered it (entered_by); claimed_by
  //     is cleared on stage advance so it shouldn't apply here.
  const isNewStage = stage === "New";
  const ownerName = isNewStage
    ? order.claimed_by ?? null
    : order.entered_by ?? order.claimed_by ?? null;
  const ownerMember = ownerName ? team.find(m => m.name === ownerName) : null;
  const ownerInitials = ownerMember?.initials ?? (ownerName ? ownerName.slice(0, 2).toUpperCase() : "");
  const ownerStyle = ownerMember
    ? AVATAR_COLOR_STYLES[ownerMember.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
  const ownerDisplayName = ownerMember?.name ?? ownerName ?? "";

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
        <div className="font-display text-[15px] leading-tight text-cream truncate">{decodeHtmlEntities(order.name)}</div>
        {/* SKU detail line hidden — too noisy for a list view. The SKU
            breakdown is available in the modal. */}
      </td>
      <td className="px-3 py-2.5">
        <TypePill source={order.source} />
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <StatusCell order={order} stage={stage} onOpenModal={onSelect} />
      </td>
      {stage !== "Archived" && (
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <UpdateStatusActions order={order} stage={stage} onOpenModal={onSelect} />
        </td>
      )}
      {stage !== "New" && (
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <a
            href={`/api/orders/${order.id}/export`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/85 hover:bg-white/8"
            title="Open the exported order PDF"
          >
            <Download className="w-3 h-3" />
            Order PDF
          </a>
        </td>
      )}
      <td className="px-3 py-2.5">
        <PaymentPill status={order.payment_status} />
      </td>
      <td className="px-3 py-2.5">
        {ownerName ? (
          <div className="flex items-center gap-1.5" title={`Owned by ${ownerDisplayName}`}>
            <div style={{ ...ownerStyle, borderWidth: 1, borderStyle: "solid" }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">
              {ownerInitials}
            </div>
            <span className="text-[10px] text-cream/55 truncate hidden xl:inline">{ownerDisplayName}</span>
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
        <div className="font-display text-[15px] leading-tight text-cream truncate">{decodeHtmlEntities(order.name)}</div>
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

/**
 * StatusCell is now split into two pieces:
 *   - StatusLabel: descriptive text only (e.g. "Awaiting order entry",
 *     "Starts May 21", "Sched Jun 4"). Renders in the Status column on
 *     every stage.
 *   - UpdateStatusActions: the actionable buttons (Claim, Mark Entered,
 *     Set start date, Early Push, Confirm Delivery, Archive Order, etc.).
 *     Renders in the new Update Status column on every stage except
 *     Archived (which uses StatusCell's full output for the Restore
 *     button via the legacy code path).
 *
 * Mobile rows still use a single combined renderer for compactness;
 * the desktop table renders them separately into their own columns.
 */

function useRowActions(order: Order) {
  const { data: session } = useSession();
  const { claimOrder, moveStage, archiveOrder, unarchiveOrder } = useStore();
  const currentUserName = session?.user?.name ?? null;
  const [busy, setBusy] = useState(false);
  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }
  return { session, currentUserName, claimOrder, moveStage, archiveOrder, unarchiveOrder, busy, withBusy, orderId: order.id };
}

function StatusLabel({ order, stage }: { order: Order; stage: string }) {
  if (stage === "Archived") {
    return <span className="text-[10px] text-cream/55 italic">archived</span>;
  }

  if (stage === "New") {
    const claimedBy = order.claimed_by ?? null;
    if (claimedBy) {
      return <span className="text-[10px] text-cream/55">Claimed by {claimedBy}</span>;
    }
    return <span className="text-[10px] text-cream/55">Awaiting order entry</span>;
  }

  if (stage === "Entered") {
    if (order.production_start_date) {
      return <span className="text-[10px] text-cream/55">Starts {order.production_start_date}</span>;
    }
    return <span className="text-[10px] text-cream/55 italic">Awaiting production dates</span>;
  }

  if (stage === "In production") {
    const start = order.production_start_date;
    const finish = order.production_est_finish_date;
    if (start || finish) {
      return (
        <div className="flex flex-col gap-0.5 text-[10px] leading-tight">
          {start && <span className="text-cream/65">Start <span className="text-cream/85">{start}</span></span>}
          {finish && <span className="text-cream/65">Finish <span className="text-cream/85">{finish}</span></span>}
        </div>
      );
    }
    return <span className="text-[10px] text-cream/55 italic">Building</span>;
  }

  if (stage === "At cross dock") {
    const bo = getBackorderStatus(order.sku_items);
    if (bo.status === "pending") {
      return <span className="text-[10px]" style={{ color: "#e89090" }}>{bo.count} backordered</span>;
    }
    if (order.scheduled_delivery_date) {
      return <span className="text-[10px] text-cream/55">Sched {order.scheduled_delivery_date}</span>;
    }
    return <span className="text-[10px] text-cream/55 italic">Awaiting delivery date</span>;
  }

  if (stage === "Delivered") {
    return <span className="text-[10px] text-cream/55">Completed</span>;
  }

  // ── Warranty stages ────────────────────────────────────────────────
  if (stage === "New claim") {
    const claimedBy = order.claimed_by ?? null;
    if (claimedBy) {
      return <span className="text-[10px] text-cream/55">Claimed by {claimedBy}</span>;
    }
    return <span className="text-[10px] text-cream/55 italic">Awaiting review</span>;
  }
  if (stage === "In review") {
    return <span className="text-[10px] text-cream/55 italic">Under review</span>;
  }
  if (stage === "Parts ordered") {
    return <span className="text-[10px] text-cream/55">Parts on order</span>;
  }
  if (stage === "Shipped") {
    return <span className="text-[10px] text-cream/55">In transit</span>;
  }
  if (stage === "Resolved") {
    return <span className="text-[10px] text-cream/55">Resolved</span>;
  }

  return <span className="text-[10px] text-cream/55">{stage}</span>;
}

function UpdateStatusActions({
  order, stage, mobile = false, onOpenModal,
}: {
  order: Order; stage: string; mobile?: boolean;
  onOpenModal?: (o: Order, reason?: "needs-attachment") => void;
}) {
  const { currentUserName, claimOrder, moveStage, archiveOrder, busy, withBusy } = useRowActions(order);

  async function markEntered() {
    const result = await (async () => {
      const gate = await checkAttachmentGate(order.id);
      if (!gate.ok) {
        onOpenModal?.(order, "needs-attachment");
        return;
      }
      await moveStage(order.id, "Entered", currentUserName ?? undefined);
    })();
    return result;
  }

  // ── New ─────────────────────────────────────────────────────────────
  if (stage === "New") {
    const claimedBy = order.claimed_by ?? null;
    const isClaimedByMe = !!currentUserName && claimedBy === currentUserName;
    const isClaimedByOther = !!claimedBy && !isClaimedByMe;

    if (isClaimedByOther) {
      // No action available — claimed by someone else
      return <span className="text-[10px] text-cream/30 italic">—</span>;
    }
    if (isClaimedByMe) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => withBusy(markEntered)}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
            title="Requires an attached PDF"
          >
            {busy ? "..." : (mobile ? "Enter" : "Mark Entered")}
          </button>
          <button
            onClick={() => withBusy(() => claimOrder(order.id, null))}
            disabled={busy}
            title="Release claim"
            aria-label="Release claim"
            className="w-6 h-6 flex items-center justify-center rounded-full text-cream/55 hover:text-cream hover:bg-white/10 transition-all"
          >
            <X className="w-3 h-3" />
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

  // ── Entered ─────────────────────────────────────────────────────────
  if (stage === "Entered") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        title="Open order to set production start date — order auto-advances once set"
      >
        Set start date →
      </button>
    );
  }

  // ── In production ──────────────────────────────────────────────────
  if (stage === "In production") {
    const finish = order.production_est_finish_date;
    const today = new Date().toISOString().slice(0, 10);
    const isPastFinish = finish && finish <= today;
    function earlyPush() {
      const displayName = decodeHtmlEntities(order.name);
      const msg = isPastFinish
        ? `Move "${displayName}" to At cross dock now?`
        : finish
        ? `Production isn't scheduled to finish until ${finish}.\n\nPush "${displayName}" to At cross dock anyway?`
        : `No estimated finish date set.\n\nPush "${displayName}" to At cross dock now?`;
      if (typeof window !== "undefined" && !window.confirm(msg)) return Promise.resolve();
      return moveStage(order.id, "At cross dock");
    }
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => withBusy(earlyPush)}
          disabled={busy}
          className={clsx(
            "px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all border",
            isPastFinish
              ? "bg-terracotta/20 border-terracotta/45 text-terracotta hover:bg-terracotta/30"
              : "bg-white/6 border-cream/15 text-cream/85 hover:bg-white/10"
          )}
          title={isPastFinish ? "Move to At cross dock" : "Push to At cross dock before est finish"}
        >
          {busy ? "..." : isPastFinish ? (mobile ? "Cross dock" : "Mark Cross-dock") : "Early Push"}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
          className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8 hover:text-cream/85"
          title="Open order to change production dates"
        >
          {mobile ? "Dates" : "Change dates"}
        </button>
      </div>
    );
  }

  // ── At cross dock ──────────────────────────────────────────────────
  if (stage === "At cross dock") {
    const hasDate = !!order.scheduled_delivery_date;
    if (hasDate) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => withBusy(() => moveStage(order.id, "Delivered"))}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
          >
            {busy ? "..." : (mobile ? "Confirm" : "Confirm Delivery")}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8 hover:text-cream/85"
            title="Open order to change delivery date"
          >
            {mobile ? "Date" : "Change date"}
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        title="Open order to set delivery date — Confirm Delivery appears once scheduled"
      >
        Set delivery date →
      </button>
    );
  }

  // ── Delivered ──────────────────────────────────────────────────────
  if (stage === "Delivered") {
    return (
      <button
        onClick={() => withBusy(() => archiveOrder(order.id))}
        disabled={busy}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
        title="Move to archive"
      >
        {busy ? "..." : "Archive Order"}
      </button>
    );
  }

  // ── Warranty stages ────────────────────────────────────────────────
  // Warranty has its own pipeline: New claim → In review → Parts ordered
  // → Shipped → Resolved. No production/delivery date gates apply.
  if (stage === "New claim") {
    const claimedBy = order.claimed_by ?? null;
    const isClaimedByMe = !!currentUserName && claimedBy === currentUserName;
    const isClaimedByOther = !!claimedBy && !isClaimedByMe;
    if (isClaimedByOther) {
      return <span className="text-[10px] text-cream/30 italic">—</span>;
    }
    if (isClaimedByMe) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => withBusy(() => moveStage(order.id, "In review" as Stage, currentUserName ?? undefined))}
            disabled={busy}
            className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
          >
            {busy ? "..." : (mobile ? "Review" : "Start review")}
          </button>
          <button
            onClick={() => withBusy(() => claimOrder(order.id, null))}
            disabled={busy}
            title="Release claim"
            aria-label="Release claim"
            className="w-6 h-6 flex items-center justify-center rounded-full text-cream/55 hover:text-cream hover:bg-white/10 transition-all"
          >
            <X className="w-3 h-3" />
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
  if (stage === "In review") {
    return (
      <button
        onClick={() => withBusy(() => moveStage(order.id, "Parts ordered" as Stage))}
        disabled={busy}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
      >
        {busy ? "..." : (mobile ? "Order parts" : "Order parts →")}
      </button>
    );
  }
  if (stage === "Parts ordered") {
    return (
      <button
        onClick={() => withBusy(() => moveStage(order.id, "Shipped" as Stage))}
        disabled={busy}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
      >
        {busy ? "..." : (mobile ? "Ship" : "Mark shipped →")}
      </button>
    );
  }
  if (stage === "Shipped") {
    return (
      <button
        onClick={() => withBusy(() => moveStage(order.id, "Resolved" as Stage))}
        disabled={busy}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
      >
        {busy ? "..." : (mobile ? "Resolve" : "Mark resolved →")}
      </button>
    );
  }
  if (stage === "Resolved") {
    return (
      <button
        onClick={() => withBusy(() => archiveOrder(order.id))}
        disabled={busy}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
      >
        {busy ? "..." : "Archive"}
      </button>
    );
  }

  return null;
}

function StatusCell({
  order, stage, mobile = false, onOpenModal,
}: {
  order: Order; stage: string; mobile?: boolean;
  /** Called when a gate fails so the user can fix it in the modal. */
  onOpenModal?: (o: Order, reason?: "needs-attachment") => void;
}) {
  const { unarchiveOrder, busy, withBusy } = useRowActions(order);

  // Archived still uses the combined renderer (the Restore button is
  // the entire "status" for that stage).
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

  // Mobile combines label + actions inline for compactness
  if (mobile) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusLabel order={order} stage={stage} />
        <UpdateStatusActions order={order} stage={stage} mobile onOpenModal={onOpenModal} />
      </div>
    );
  }

  // Desktop renders only the label here; the actions live in their own
  // column rendered by OrderRow.
  return <StatusLabel order={order} stage={stage} />;
}
