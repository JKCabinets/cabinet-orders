"use client";

import { useState, useMemo } from "react";
import clsx from "clsx";
import { Order, Stage, AVATAR_COLOR_STYLES, getBackorderStatus, nextStageFor, displayOrderNumber } from "@/lib/data";
import { STAGE_ORDER_BY_TYPE, ORDER_STAGE_ORDER } from "@/lib/stageLogic";
import type { Project } from "@/lib/data";
import { useStore } from "@/lib/store";
import { useSession } from "next-auth/react";
import { formatDateWithYear, parseOrderDate } from "@/lib/dateUtils";
import { checkAttachmentGate, checkDeliveryProofGate } from "@/lib/stageGates";
import { OrderEntryActions } from "./OrderEntryActions";
import { ArrowUp, ArrowDown, RotateCcw, ChevronRight, X } from "lucide-react";
import { AvatarWithProfile } from "./AvatarWithProfile";
import { VendorExportPills } from "./VendorExportPills";
import { useToast } from "./Toast";

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
  /**
   * The stage this table represents, or NULL when it shows several -- an
   * "All" tab, or the archive.
   *
   * ⚠ NULL, NOT A SENTINEL. OrdersHubClient and SamplesClient passed the
   * string "__none__", which no branch in this file matches, so StatusLabel
   * fell through every case and rendered `__none__` in the Status column of
   * every row on every All view. A magic string that looks like data will be
   * treated as data by something eventually; null cannot be.
   */
  stage: string | null;
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

  const accent = (stage ? STAGE_COLOR[stage] : undefined) ?? "#91a597";

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
              <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium w-[140px]">PDF</th>
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
  order: Order; stage: string | null;
  onSelect: (o: Order, reason?: "needs-attachment") => void;
  selectMode: boolean; selected: boolean; onToggleSelect?: (id: string) => void;
  rowIdx: number;
}) {
  const { team, projects } = useStore();

  // The team avatar is driven by stage:
  //   - New: show whoever has claimed the order; if unclaimed → "unclaimed"
  //     (entered_by is intentionally ignored here — a previously-Entered
  //     order that rolled back to New is unclaimed until someone picks it
  //     up again)
  //   - Entered & beyond: show whoever entered it (entered_by); claimed_by
  //     is cleared on stage advance so it shouldn't apply here.
  const isNewStage = stage === "New";
  const rowOwner = ownerOf(order, projects);
  const ownerName = isNewStage
    ? rowOwner
    : order.entered_by ?? rowOwner;
  // ownerName is now a team_members.id (post-v18 migration). Look up
  // by id; m.name is shown to the user.
  const ownerMember = ownerName ? team.find(m => m.id === ownerName) : null;
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
      <td className="px-3 py-2.5 font-mono text-[10px] text-cream/65">{displayOrderNumber(order)}</td>
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
      {stage !== "Archived" && (
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <UpdateStatusActions order={order} stage={stage} onOpenModal={onSelect} />
        </td>
      )}
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <VendorExportPills order={order} />
      </td>
      <td className="px-3 py-2.5">
        <PaymentPill status={order.payment_status} />
      </td>
      <td className="px-3 py-2.5">
        {ownerMember ? (
          // Avatar only (no name) — the hover card and click modal on
          // AvatarWithProfile provide name/role/status on demand.
          <AvatarWithProfile member={ownerMember} size="sm" />
        ) : ownerName ? (
          // Fallback when the team_members row hasn\'t loaded yet (or
          // the user was deleted). Show the raw username so we don\'t
          // hide ownership info entirely.
          <span
            title={`Owned by ${ownerName}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-medium border border-[rgba(86,100,72,0.28)] bg-[rgba(86,100,72,0.20)] text-[#8fbe70]"
          >
            {ownerName.slice(0, 2).toUpperCase()}
          </span>
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
  order: Order; stage: string | null;
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
          <span className="font-mono text-[9px] text-cream/45">{displayOrderNumber(order)}</span>
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

/**
 * Confirm Delivery, gated on a signed delivery receipt.
 *
 *   idle        the normal Confirm Delivery button
 *   no-receipt  the gate failed: attach one, or override
 *   reason      overriding; the reason field must be non-empty
 *
 * Its own component rather than inline JSX because it needs state, and the
 * renderer it replaces is a plain function rather than a component.
 *
 * The server enforces all of this independently -- see the delivery proof
 * gate in app/api/orders/[id]/route.ts. This exists so the failure is
 * actionable in one click instead of an error toast with no remedy.
 */
function ConfirmDeliveryActions({ order, mobile, onOpenModal }: {
  order: Order;
  mobile?: boolean;
  onOpenModal?: (order: Order, reason?: "needs-attachment") => void;
}) {
  const { moveStage } = useStore();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"idle" | "no-receipt" | "reason">("idle");
  const [reason, setReason] = useState("");

  const PILL = "px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all";

  async function attempt(overrideReason?: string) {
    setBusy(true);
    try {
      // Skip the client check when overriding -- we already know there is no
      // receipt, and the server will demand the reason regardless.
      if (!overrideReason) {
        const gate = await checkDeliveryProofGate(order.id);
        if (!gate.ok) {
          if (gate.reason === "network") {
            showToast(gate.message, { kind: "error" });
            return;
          }
          setStep("no-receipt");
          return;
        }
      }
      const res = await moveStage(
        order.id, "Delivered", undefined, undefined, undefined, overrideReason,
      );
      if (!res.ok) {
        showToast(res.error ?? "Could not mark delivered", { kind: "error" });
        return;
      }
      setStep("idle");
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  if (step === "reason") {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for overriding"
          maxLength={300}
          autoFocus
          className="px-2.5 py-1 rounded-full text-[11px] bg-white/6 border border-cream/20 text-cream placeholder:text-cream/35 w-48"
          style={{ fontSize: "16px" }}
        />
        <button
          onClick={() => attempt(reason.trim())}
          disabled={busy || reason.trim().length === 0}
          title="Recorded in this order's activity against your name"
          className={`${PILL} bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {busy ? "..." : "Save"}
        </button>
        <button
          onClick={() => { setStep("idle"); setReason(""); }}
          className={`${PILL} bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8`}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (step === "no-receipt") {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "#e89090" }}>
          No receipt
        </span>
        <button
          onClick={() => { setStep("idle"); onOpenModal?.(order); }}
          title="Open the order and use the Receipt button in Attachments"
          className={`${PILL} bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30`}
        >
          {mobile ? "Attach" : "Attach receipt"}
        </button>
        <button
          onClick={() => setStep("reason")}
          title="Mark delivered without a receipt. Requires a reason, recorded in the order activity."
          className={`${PILL} bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8`}
        >
          Override
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => attempt()}
        disabled={busy}
        className={`${PILL} bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30`}
      >
        {busy ? "..." : (mobile ? "Confirm" : "Confirm Delivery")}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
        className={`${PILL} bg-white/4 border border-cream/15 text-cream/65 hover:bg-white/8 hover:text-cream/85`}
        title="Open order to change delivery date"
      >
        {mobile ? "Date" : "Change date"}
      </button>
    </div>
  );
}


/**
 * Who owns this row, resolved through the PROJECT for a Shopify group.
 *
 * ⚠ The claim moved up on 2026-08-25: one owner per purchase, so a designer who
 * has finished the cabinets is not blocked while somebody sits on the hardware.
 * `orders.claimed_by` is null on every project-linked row now -- reading it
 * directly showed the whole board as unclaimed.
 *
 * A free function rather than part of useRowActions because three different
 * contexts need it and only one of them is a component with the hook:
 * StatusLabel and the avatar block are plain renderers.
 *
 * Custom jobs and warranty claims have no project and still own themselves.
 */
function ownerOf(order: Order, projects: Record<string, Project>): string | null {
  return order.project_id
    ? (projects[order.project_id]?.claimed_by ?? null)
    : (order.claimed_by ?? null);
}

function useRowActions(order: Order) {
  const { data: session } = useSession();
  const { claimOrder: rawClaimOrder, moveStage, archiveOrder, unarchiveOrder, team, projects } = useStore();
  const { showToast } = useToast();
  // We use session.user.id (team_members.id, the IMMUTABLE surrogate key)
  // for ownership comparisons — it survives both display-name and
  // username changes. claimed_by / entered_by store team_members.id
  // values after the v18 migration.
  const sessUser = session?.user as { id?: string; name?: string; username?: string } | undefined;
  const currentUserId = sessUser?.id ?? null;
  const [busy, setBusy] = useState(false);
  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }
  // Wrap claimOrder so any conflict from the server (already_claimed,
  // not_owner, network_error) surfaces as a toast. The store already
  // reconciles local state to the server\'s view, so the UI updates
  // automatically; the toast is just for user awareness.
  async function claimOrder(id: string, claimedBy: string | null) {
    const result = await rawClaimOrder(id, claimedBy);
    if (!result.ok) {
      if (result.reason === "already_claimed" && result.claimedBy) {
        // result.claimedBy is now a team_members.id
        const claimer = team.find((m) => m.id === result.claimedBy);
        const displayName = claimer?.name ?? result.claimedBy;
        showToast(`Already claimed by ${displayName}`, { kind: "warn" });
      } else if (result.reason === "not_owner") {
        showToast("You can\'t release someone else\'s claim", { kind: "warn" });
      } else if (result.reason === "network_error") {
        showToast("Network error — claim not saved", { kind: "error" });
      } else {
        showToast("Claim failed", { kind: "error" });
      }
    }
    return result;
  }
  const claimedBy = ownerOf(order, projects);

  /**
   * ⚠ CLAIMING IS NOT DONE FROM THESE TABLES.
   *
   * A purchase is claimed from /projects or the work queue. A Claim button on a
   * cabinet row would quietly take the samples and hardware with it, which is a
   * surprise however it is labelled.
   *
   * Refuses LOUDLY rather than silently: a call getting this far means a
   * control was rendered that should not have been, and a silent no-op would
   * hide that from whoever has to fix it.
   */
  async function claimIfStandalone(id: string, target: string | null) {
    if (order.project_id) {
      showToast("Claim this from the project — one owner covers every order in it.", { kind: "warn" });
      return { ok: false, claimedBy, reason: "project_owned" as const };
    }
    return claimOrder(id, target);
  }

  return {
    session, currentUserId, claimedBy,
    claimOrder: claimIfStandalone,
    moveStage, archiveOrder, unarchiveOrder, busy, withBusy, orderId: order.id,
  };
}

function ClaimedByPill({ claimedBy }: { claimedBy: string }) {
  const { team, projects } = useStore();
  // claimedBy is now a team_members.id. Defensive fallback also tries
  // matching by username in case any pre-migration string slipped through.
  const member = team.find((m) => m.id === claimedBy || m.username === claimedBy);
  if (member) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-cream/55">
        <AvatarWithProfile member={member} size="xs" />
        <span>Claimed by {member.name}</span>
      </span>
    );
  }
  // Fallback when the team row isn\'t loaded yet (or member deleted)
  return <span className="text-[10px] text-cream/55">Claimed by {claimedBy}</span>;
}

function StatusLabel({ order, stage, claimedBy }: {
  order: Order; stage: string | null;
  /** Resolved by the caller -- through the PROJECT for a Shopify group. */
  claimedBy: string | null;
}) {
  // On an all-stages table the page has no single stage, so the row speaks
  // for itself. UpdateStatusActions already guards this case by returning
  // null -- its comment notes that branching on the table's stage "broke
  // twice" -- but this renderer never got the same treatment.
  stage = stage ?? order.stage;
  if (stage === "Archived") {
    return <span className="text-[10px] text-cream/55 italic">archived</span>;
  }

  if (stage === "New") {
    if (claimedBy) {
      return <ClaimedByPill claimedBy={claimedBy} />;
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
    if (claimedBy) {
      return <ClaimedByPill claimedBy={claimedBy} />;
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

/**
 * The action column for a custom order in the part of its flow that diverges
 * from the standard one.
 *
 * The next stage comes from nextStageFor, which reads the row's own flow, so
 * this can never offer a move outside it -- which is exactly how a custom
 * order ended up in the warranty pipeline.
 */
function CustomFlowActions({ order, mobile = false }: { order: Order; mobile?: boolean }) {
  const { currentUserId, claimedBy, claimOrder, moveStage, busy, withBusy } = useRowActions(order);
  const next = nextStageFor(order);
  const isClaimedByMe = !!currentUserId && claimedBy === currentUserId;
  const isClaimedByOther = !!claimedBy && !isClaimedByMe;

  // Claiming works the same on every flow: it stops two people entering the
  // same order, which has nothing to do with which stages exist.
  if (isClaimedByOther) {
    return <span className="text-[10px] text-cream/30 italic">—</span>;
  }
  if (!claimedBy) {
    return (
      <button
        onClick={() => withBusy(() => claimOrder(order.id, currentUserId))}
        disabled={busy || !currentUserId}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
      >
        {busy ? "..." : "Claim"}
      </button>
    );
  }
  if (!next) {
    return <span className="text-[10px] text-cream/30 italic">—</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => withBusy(() => moveStage(order.id, next as Stage, currentUserId ?? undefined))}
        disabled={busy}
        title={`Move to ${next}`}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
      >
        {busy ? "..." : (mobile ? next : `${next} →`)}
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

function UpdateStatusActions({
  order, stage, mobile = false, onOpenModal,
}: {
  order: Order; stage: string | null; mobile?: boolean;
  onOpenModal?: (o: Order, reason?: "needs-attachment") => void;
}) {
  const { currentUserId, claimedBy, claimOrder, moveStage, archiveOrder, busy, withBusy } = useRowActions(order);

  // ── Flow guard ──────────────────────────────────────────────────────
  // `stage` describes the TABLE, not this row. Branching on it blindly
  // broke twice:
  //
  //   · an "All" tab passes one stage while the rows are in many
  //   · "In review" exists in BOTH the warranty and custom flows, so a
  //     custom order was offered the warranty action and moved to
  //     "Parts ordered" -- a stage its flow does not contain
  //
  // Only branch when the prop genuinely describes this row.
  const rowFlow = STAGE_ORDER_BY_TYPE[order.type] ?? ORDER_STAGE_ORDER;
  // A null stage means an all-stages table. The guard's own note says an
  // "All" tab is one of the two cases that broke it, and returning null here
  // keeps that behaviour: no actions offered when the column cannot know
  // which action fits.
  if (stage === null || order.stage !== stage || !rowFlow.includes(stage)) return null;

  // Custom orders share the TAIL of the standard flow (In production ->
  // At cross dock -> Delivered) and those branches below are correct for
  // them. The first three stages are not: New advances to "In review" not
  // "Entered", "In review" advances to "Ordered" not "Parts ordered", and
  // "Ordered" has no branch at all.
  if (order.type === "custom"
      && (stage === "New" || stage === "In review" || stage === "Ordered")) {
    return <CustomFlowActions order={order} mobile={mobile} />;
  }

  async function markEntered() {
    const result = await (async () => {
      const gate = await checkAttachmentGate(order.id);
      if (!gate.ok) {
        onOpenModal?.(order, "needs-attachment");
        return;
      }
      await moveStage(order.id, "Entered", currentUserId ?? undefined);
    })();
    return result;
  }

  // ── New ─────────────────────────────────────────────────────────────
  if (stage === "New") {
    const isClaimedByMe = !!currentUserId && claimedBy === currentUserId;
    const isClaimedByOther = !!claimedBy && !isClaimedByMe;

    if (isClaimedByOther) {
      // No action available — claimed by someone else
      return <span className="text-[10px] text-cream/30 italic">—</span>;
    }
    if (isClaimedByMe) {
      return (
        <div className="flex items-center gap-1.5">
          {order.source === "Shopify" && order.type === "order" ? (
            <OrderEntryActions order={order} mobile={mobile} onOpenModal={onOpenModal} />
          ) : (
            <button
              onClick={() => withBusy(markEntered)}
              disabled={busy}
              className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"
              title={
                order.type === "sample"
                  ? "Samples need no acknowledgment"
                  : "Requires an attached PDF"
              }
            >
              {busy ? "..." : (mobile ? "Enter" : "Mark Entered")}
            </button>
          )}
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
        onClick={() => withBusy(() => claimOrder(order.id, currentUserId))}
        disabled={busy || !currentUserId}
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
      const displayName = order.name;
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
      return <ConfirmDeliveryActions order={order} mobile={mobile} onOpenModal={onOpenModal} />;
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
  if (stage === "New claim" && order.type === "warranty") {
    const isClaimedByMe = !!currentUserId && claimedBy === currentUserId;
    const isClaimedByOther = !!claimedBy && !isClaimedByMe;
    if (isClaimedByOther) {
      return <span className="text-[10px] text-cream/30 italic">—</span>;
    }
    if (isClaimedByMe) {
      return (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => withBusy(() => moveStage(order.id, "In review" as Stage, currentUserId ?? undefined))}
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
        onClick={() => withBusy(() => claimOrder(order.id, currentUserId))}
        disabled={busy || !currentUserId}
        className="px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
      >
        {busy ? "..." : "Claim"}
      </button>
    );
  }
  if (stage === "In review" && order.type === "warranty") {
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
  if (stage === "Parts ordered" && order.type === "warranty") {
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
  if (stage === "Shipped" && order.type === "warranty") {
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
  if (stage === "Resolved" && order.type === "warranty") {
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
  order: Order; stage: string | null; mobile?: boolean;
  /** Called when a gate fails so the user can fix it in the modal. */
  onOpenModal?: (o: Order, reason?: "needs-attachment") => void;
}) {
  const { unarchiveOrder, claimedBy, busy, withBusy } = useRowActions(order);

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
        <StatusLabel order={order} stage={stage} claimedBy={claimedBy} />
        <UpdateStatusActions order={order} stage={stage} mobile onOpenModal={onOpenModal} />
      </div>
    );
  }

  // Desktop renders only the label here; the actions live in their own
  // column rendered by OrderRow.
  return <StatusLabel order={order} stage={stage} claimedBy={claimedBy} />;
}
