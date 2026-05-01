"use client";

import { useState, useRef } from "react";
import { Order, AVATAR_COLOR_STYLES } from "@/lib/data";
import { useStore } from "@/lib/store";
import { formatDateWithYear, parseOrderDate } from "@/lib/dateUtils";
import { useSession } from "next-auth/react";

interface OrderCardProps { order: Order; onClick: () => void; style?: React.CSSProperties; }

const STAGE_BORDER: Record<string, string> = {
  "New": "#e05555", "Entered": "#d4922a", "In production": "#c8b84a",
  "At cross dock": "#4a8fd4", "Delivered": "#4caf7a",
  "New claim": "#e05555", "In review": "#d4922a", "Parts ordered": "#c8b84a",
  "Shipped": "#4a8fd4", "Resolved": "#4caf7a",
};

function getOrderAgeDays(dateStr: string): number | null {
  const ms = parseOrderDate(dateStr);
  if (ms === null) return null;
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
}

export function OrderCard({ order, onClick, style }: OrderCardProps) {
  const { team, claimOrder, moveStage } = useStore();
  const { data: session } = useSession();
  const [claimError, setClaimError] = useState(false);
  const [completing, setCompleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageBorder = STAGE_BORDER[order.stage] ?? "rgba(255,255,255,0.15)";
  const member = team.find((m) => m.initials === order.member);
  const memberStyle = member ? AVATAR_COLOR_STYLES[member.avatarColor]
    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
  const memberName = member?.name ?? order.member;
  const displayDate = formatDateWithYear(order.date);

  // ── Age indicator ────────────────────────────────────────────────────────
  const isNewStage = order.stage === "New";
  const ageDays = isNewStage ? getOrderAgeDays(order.date) : null;
  const isOverdue = ageDays !== null && ageDays > 5;

  // ── Entered-by: stored directly on the order ─────────────────────────────
  const enteredBy = order.entered_by ?? null;

  // ── Claim logic ──────────────────────────────────────────────────────────
  const currentUserName = session?.user?.name ?? null;
  const claimedBy = order.claimed_by ?? null;
  const isClaimedByMe = !!currentUserName && claimedBy === currentUserName;
  const isClaimedByOther = !!claimedBy && !isClaimedByMe;

  async function handleClaim(e: React.MouseEvent) {
    e.stopPropagation();
    setClaimError(false);
    let ok = false;
    if (isClaimedByMe) {
      ok = await claimOrder(order.id, null);
    } else if (!claimedBy) {
      ok = await claimOrder(order.id, currentUserName);
    }
    if (!ok) {
      setClaimError(true);
      setTimeout(() => setClaimError(false), 4000);
    }
  }

  function handleExport(e: React.MouseEvent) {
    e.stopPropagation();
    window.open(`/api/orders/${order.id}/export`, "_blank", "noopener");
  }

  function handleCompleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompleting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("orderId", order.id);
      await fetch("/api/orders/attachments", { method: "POST", body: fd });
      await moveStage(order.id, "Entered", currentUserName ?? undefined);
    } finally {
      setCompleting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div
      className="w-full rounded-xl transition-all duration-150 animate-card-in"
      style={{
        ...style,
        background: isClaimedByOther ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.15)",
        border: isOverdue ? "0.5px solid rgba(255,160,60,0.45)" : "0.5px solid rgba(255,255,255,0.15)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.10), 0 4px 16px rgba(0,0,0,0.28)",
        borderTopColor: isOverdue ? "#e08030" : stageBorder,
        borderTopWidth: "2px",
      }}
    >
      {/* ── Main clickable area ─────────────────────────────────────────── */}
      <button
        onClick={onClick}
        className="w-full text-left p-2 cursor-pointer hover:-translate-y-0.5 transition-transform duration-150 rounded-xl"
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
          {isOverdue && (
            <span
              className="text-[8px] font-bold px-1 py-px rounded flex-shrink-0"
              style={{ background: "rgba(224,128,48,0.20)", color: "#f5a045", border: "0.5px solid rgba(224,128,48,0.45)" }}
              title={`This order has been in New for ${ageDays} days without being entered`}
            >
              ⚠ {ageDays}d old
            </span>
          )}
          <span className="text-[9px] text-[rgba(232,227,218,0.45)]">{displayDate}</span>
        </div>
        {/* Entered-by badge — shown once order has moved past New */}
        {enteredBy && (
          <div className="mt-1.5 flex items-center gap-1">
            <span
              className="text-[9px] px-1.5 py-px rounded-md font-medium truncate"
              style={{
                background: "rgba(212,146,42,0.13)",
                color: "rgba(212,180,100,0.90)",
                border: "0.5px solid rgba(212,146,42,0.30)",
              }}
              title={`Entered by ${enteredBy}`}
            >
              ✓ Entered by {enteredBy}
            </span>
          </div>
        )}
      </button>

      {/* ── Claim + Export strip — only in New stage ────────────────────── */}
      {isNewStage && (
        <div className="px-2 pb-2 pt-0" onClick={(e) => e.stopPropagation()}>
          {claimError && (
            <div className="mb-1.5 rounded-md px-2 py-1 text-[10px]"
              style={{ background: "rgba(220,60,60,0.15)", color: "#f08080", border: "0.5px solid rgba(220,60,60,0.30)" }}>
              ⚠ Couldn&apos;t save — make sure supabase-schema-v4.sql has been run
            </div>
          )}
          {isClaimedByMe ? (
            /* Claimed by me — show green pill + release + export */
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <div
                  className="flex-1 flex items-center gap-1 rounded-md px-2 py-1"
                  style={{ background: "rgba(76,175,122,0.14)", border: "0.5px solid rgba(76,175,122,0.35)" }}
                >
                  <span className="text-[9px]">✓</span>
                  <span className="text-[10px] font-semibold" style={{ color: "#6dd6a0" }}>
                    Claimed by you
                  </span>
                </div>
                <button
                  onClick={handleClaim}
                  className="text-[9px] px-1.5 py-1 rounded-md transition-colors"
                  style={{ background: "rgba(255,255,255,0.07)", color: "rgba(232,227,218,0.45)", border: "0.5px solid rgba(255,255,255,0.12)" }}
                  title="Release claim"
                >
                  ✕
                </button>
              </div>

              {/* Split: Export + Complete Order */}
              <div className="flex gap-1">
                {/* Export half */}
                <button
                  onClick={handleExport}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-all duration-150"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "0.5px solid rgba(255,255,255,0.18)",
                    color: "rgba(232,227,218,0.75)",
                  }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.background = "rgba(255,255,255,0.14)"; el.style.color = "#e8e3da"; }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.background = "rgba(255,255,255,0.08)"; el.style.color = "rgba(232,227,218,0.75)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span className="text-[10px] font-semibold tracking-wide">Export Order</span>
                </button>

                {/* Complete Order half */}
                <button
                  onClick={handleCompleteClick}
                  disabled={completing}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-all duration-150"
                  style={{
                    background: completing ? "rgba(76,175,122,0.10)" : "rgba(76,175,122,0.14)",
                    border: "0.5px solid rgba(76,175,122,0.35)",
                    color: completing ? "rgba(109,214,160,0.50)" : "#6dd6a0",
                    cursor: completing ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => { if (!completing) { const el = e.currentTarget as HTMLButtonElement; el.style.background = "rgba(76,175,122,0.24)"; } }}
                  onMouseLeave={(e) => { if (!completing) { const el = e.currentTarget as HTMLButtonElement; el.style.background = "rgba(76,175,122,0.14)"; } }}
                >
                  {completing ? (
                    <span className="text-[10px] font-semibold tracking-wide">Moving…</span>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                      <span className="text-[10px] font-semibold tracking-wide">Complete Order</span>
                    </>
                  )}
                </button>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelected}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : isClaimedByOther ? (
            /* Claimed by someone else */
            <div
              className="flex items-center gap-1 rounded-md px-2 py-1"
              style={{ background: "rgba(74,111,143,0.14)", border: "0.5px solid rgba(74,111,143,0.30)" }}
            >
              <span className="text-[9px]">🔒</span>
              <span className="text-[10px]" style={{ color: "rgba(110,170,230,0.80)" }}>
                {claimedBy} is entering this
              </span>
            </div>
          ) : (
            /* Unclaimed */
            <button
              onClick={handleClaim}
              className="w-full text-left rounded-md px-2 py-1 transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(232,227,218,0.50)" }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.background = "rgba(255,255,255,0.10)";
                el.style.color = "rgba(232,227,218,0.80)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.background = "rgba(255,255,255,0.05)";
                el.style.color = "rgba(232,227,218,0.50)";
              }}
            >
              <span className="text-[10px] font-medium">＋ Claim order</span>
            </button>
          )}
        </div>
      )}
    </div>
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
