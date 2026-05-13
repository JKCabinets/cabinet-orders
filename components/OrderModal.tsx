"use client";

import { useState, useEffect, useRef } from "react";
import { X, Clock, ChevronRight, Archive, RotateCcw, Trash2, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useSession } from "next-auth/react";
import {
  Order, Stage, ORDER_STAGES, WARRANTY_STAGES,
  AVATAR_COLOR_STYLES,
} from "@/lib/data";
import { useStore } from "@/lib/store";
import { checkAttachmentGate } from "@/lib/stageGates";
import { AttachmentsPanel, type AttachmentsPanelHandle } from "./AttachmentsPanel";
import { OrderDetails } from "./OrderDetails";
import { DamageReportPanel } from "./DamageReportPanel";

interface OrderModalProps {
  order: Order;
  tab: "orders" | "warranty";
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
  /**
   * Optional reason explaining why the modal was opened. When set to
   * "needs-attachment", the modal shows a prominent banner at the top and
   * auto-opens the file picker so the user can attach the required PDF.
   */
  initialReason?: "needs-attachment";
}

const STAGE_COLOR: Record<string, string> = {
  "New":              "#e05555",
  "Entered":          "#d4922a",
  "In production":    "#c8b84a",
  "At cross dock":    "#4a8fd4",
  "Delivered":        "#4caf7a",
  "New claim":        "#e05555",
  "In review":        "#d4922a",
  "Parts ordered":    "#c8b84a",
  "Shipped": "#4a8fd4",
  "Resolved":         "#4caf7a",
};

const PANEL: React.CSSProperties = {
  // Brand: signature frosted sage glass — matches the sidebar's sage tone
  // exactly so the modal feels like the same material as the chrome.
  // Keeping a slightly heavier shadow than the sidebar since the modal is
  // a larger floating surface over a darkened overlay.
  background: "rgba(87, 98, 87, 0.28)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: "0.5px solid rgba(145, 165, 151, 0.30)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55)",
};

const SECTION_BORDER: React.CSSProperties = {
  borderBottom: "0.5px solid rgba(255,255,255,0.10)",
};

const LABEL = "text-[10px] uppercase tracking-[0.16em] text-cream/50 mb-1.5";

const ADMIN_CODE = "4951";

export function OrderModal({ order, tab, onClose, onStageChange, initialReason }: OrderModalProps) {
  const { moveStage, updateNotes, updateInternalNotes, archiveOrder, unarchiveOrder, deleteOrder, orders, warranties, team } = useStore();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name ?? undefined;
  const [notes, setNotes] = useState(order.notes);
  const [notesChanged, setNotesChanged] = useState(false);
  const [internalNotes, setInternalNotes] = useState(order.internal_notes ?? "");
  const [internalNotesChanged, setInternalNotesChanged] = useState(false);
  const [enteredGateError, setEnteredGateError] = useState(false);
  const [checkingAttachments, setCheckingAttachments] = useState(false);
  // Admin PIN for backwards moves
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<AttachmentsPanelHandle>(null);
  const attachmentsAnchorRef = useRef<HTMLDivElement>(null);

  // When the modal opens because of a missing-attachment gate, show a
  // banner and auto-jump to the attachment area. The banner stays visible
  // until the user uploads a file (the attachment panel re-renders, the
  // gate would now pass) or they dismiss it manually.
  const [showGateBanner, setShowGateBanner] = useState(
    initialReason === "needs-attachment",
  );

  useEffect(() => {
    if (initialReason !== "needs-attachment") return;
    // Wait one frame so refs are mounted, then scroll to the attachment
    // section and pop the OS file picker. Slight delay on the click so
    // the scroll animation has a chance to land before the picker steals
    // focus.
    requestAnimationFrame(() => {
      attachmentsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => attachmentsRef.current?.openFilePicker(), 350);
    });
  }, [initialReason]);

  const liveOrder =
    (tab === "orders" ? orders : warranties).find((o) => o.id === order.id) ?? order;
  const stages = tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES;
  const stageIdx = (stages as string[]).indexOf(liveOrder.stage);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingStage) { setPendingStage(null); setAdminPin(""); setPinError(false); }
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pendingStage]);

  useEffect(() => {
    setNotes(liveOrder.notes);
    setNotesChanged(false);
  }, [liveOrder.notes]);

  useEffect(() => {
    setInternalNotes(liveOrder.internal_notes ?? "");
    setInternalNotesChanged(false);
  }, [liveOrder.internal_notes]);

  // When PIN prompt appears: blur whatever has focus, then claim it
  useEffect(() => {
    if (pendingStage) {
      (document.activeElement as HTMLElement | null)?.blur();
      requestAnimationFrame(() => pinInputRef.current?.focus());
    }
  }, [pendingStage]);

  async function handleMoveStage(stage: Stage) {
    const targetIdx = (stages as string[]).indexOf(stage);
    const isBackwards = targetIdx < stageIdx;

    // Gate 1: backwards move requires admin PIN
    if (isBackwards) {
      (document.activeElement as HTMLElement | null)?.blur();
      setPendingStage(stage);
      setAdminPin("");
      setPinError(false);
      return;
    }

    await doMoveStage(stage);
  }

  async function doMoveStage(stage: Stage) {
    // Gate 2: moving to "Entered" requires at least one attachment
    if (stage === "Entered" && liveOrder.stage === "New") {
      setCheckingAttachments(true);
      setEnteredGateError(false);
      const result = await checkAttachmentGate(liveOrder.id);
      setCheckingAttachments(false);
      if (!result.ok) {
        setEnteredGateError(true);
        return;
      }
    }
    setEnteredGateError(false);
    moveStage(liveOrder.id, stage, currentUserName);
    onStageChange(stage);
  }

  function handlePinSubmit() {
    if (adminPin === ADMIN_CODE && pendingStage) {
      const stage = pendingStage;
      setPendingStage(null);
      setAdminPin("");
      setPinError(false);
      doMoveStage(stage);
    } else {
      setPinError(true);
      setAdminPin("");
      setTimeout(() => setPinError(false), 2000);
    }
  }

  function handleSaveNotes() {
    updateNotes(liveOrder.id, notes);
    setNotesChanged(false);
  }

  function handleSaveInternalNotes() {
    updateInternalNotes(liveOrder.id, internalNotes);
    setInternalNotesChanged(false);
  }

  function handleDelete() {
    deleteOrder(liveOrder.id);
    onClose();
  }

  function handleArchive() {
    if (liveOrder.archived) {
      unarchiveOrder(liveOrder.id);
    } else {
      archiveOrder(liveOrder.id);
      onClose();
    }
  }

  const isCompleted = liveOrder.stage === "Delivered" || liveOrder.stage === "Resolved";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-stretch justify-center animate-fade-in p-4 md:p-8"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-[1100px] h-full flex flex-col animate-slide-in overflow-hidden rounded-panel"
        style={PANEL}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 flex-shrink-0" style={SECTION_BORDER}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-cream/45 mb-1.5 font-mono">{liveOrder.id}</p>
            <h2 className="font-display text-[26px] text-cream leading-tight">{liveOrder.name}</h2>
            {/* Detail line (SKU description list) intentionally hidden — it's
                noisy and the SKU table below is the source of truth. */}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
            {isCompleted && (
              <button
                onClick={handleArchive}
                title={liveOrder.archived ? "Restore" : "Archive"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/8 border border-white/15 text-cream/70 hover:bg-white/12 hover:text-cream"
              >
                {liveOrder.archived ? <><RotateCcw className="w-3 h-3" /> Restore</> : <><Archive className="w-3 h-3" /> Archive</>}
              </button>
            )}
            {liveOrder.source === "Manual" && (
              <button
                onClick={handleDelete}
                title="Delete order"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] transition-all hover:text-red-400"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "0.5px solid rgba(255,255,255,0.18)",
                  color: "rgba(232,227,218,0.45)",
                }}
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-all hover:text-[#e8e3da]"
              style={{ color: "rgba(232,227,218,0.60)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Gate banner — shown when the modal opens because of a missing
              attachment. Prominent, terracotta accent, with a CTA that
              re-triggers the file picker. */}
          {showGateBanner && (
            <div
              className="m-5 mb-0 rounded-brand p-4 flex items-start gap-3 animate-slide-in"
              style={{
                background: "rgba(184,130,106,0.16)",
                border: "0.5px solid rgba(184,130,106,0.50)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
              }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: "rgba(184,130,106,0.25)", border: "0.5px solid rgba(184,130,106,0.45)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d9a888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-[18px] text-cream leading-tight mb-1">
                  Attach an <em className="italic-storm">acknowledgment</em> first
                </p>
                <p className="text-[12px] text-cream/65 leading-snug mb-3">
                  Before this order can be marked Entered, upload the manufacturer&apos;s
                  acknowledgment PDF (or any confirming document). The file picker
                  should open automatically — if not, use the button below.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => attachmentsRef.current?.openFilePicker()}
                    className="px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-medium transition-all bg-terracotta/25 border border-terracotta/55 text-terracotta hover:bg-terracotta/35"
                  >
                    Choose file…
                  </button>
                  <button
                    onClick={() => setShowGateBanner(false)}
                    className="px-3 py-1.5 rounded-full text-[11px] uppercase tracking-wider font-medium transition-all text-cream/55 hover:text-cream/85"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowGateBanner(false)}
                className="p-1 rounded-md hover:bg-white/8 transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5 text-cream/55" />
              </button>
            </div>
          )}

          {/* Pipeline stage */}
          <div className="p-5" style={SECTION_BORDER}>
            <p className={LABEL}>Pipeline stage</p>
            <div className="flex flex-col gap-1">
              {stages.map((s, i) => {
                const isActive = liveOrder.stage === s;
                const isPast = stageIdx > i;
                const isBackwards = i < stageIdx && !isActive;
                const color = STAGE_COLOR[s] ?? "#566448";
                const isEnteredGate = s === "Entered" && liveOrder.stage === "New";
                return (
                  <button
                    key={s}
                    onClick={() => handleMoveStage(s as Stage)}
                    disabled={checkingAttachments}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left hover:brightness-110 disabled:opacity-60"
                    style={
                      isActive
                        ? {
                            background: `${color}18`,
                            border: `0.5px solid ${color}55`,
                            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.20)`,
                            color: color,
                          }
                        : {
                            background: "transparent",
                            border: "0.5px solid transparent",
                            color: isPast
                              ? "rgba(232,227,218,0.45)"
                              : "rgba(232,227,218,0.70)",
                          }
                    }
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        background: isActive ? color : isPast ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.18)",
                      }}
                    />
                    <span className="flex-1">{s}</span>
                    {isActive && !checkingAttachments && <ChevronRight className="w-3 h-3 opacity-60" />}
                    {isActive && checkingAttachments && <Loader2 className="w-3 h-3 opacity-60 animate-spin" />}
                    {isEnteredGate && !isActive && (
                      <span className="text-[9px] px-1.5 py-px rounded flex-shrink-0"
                        style={{ background: "rgba(212,146,42,0.15)", color: "#d4922a", border: "0.5px solid rgba(212,146,42,0.35)" }}>
                        PDF req.
                      </span>
                    )}
                    {isBackwards && (
                      <span className="text-[9px] px-1.5 py-px rounded flex-shrink-0"
                        style={{ background: "rgba(224,85,85,0.12)", color: "rgba(224,120,120,0.80)", border: "0.5px solid rgba(224,85,85,0.25)" }}>
                        🔒 admin
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* PIN prompt for backwards moves */}
            {pendingStage && (
              <div className="mt-3 rounded-lg px-3 py-3"
                style={{ background: "rgba(224,85,85,0.10)", border: "0.5px solid rgba(224,85,85,0.35)" }}>
                <p className="text-xs font-semibold mb-0.5" style={{ color: "#e07070" }}>
                  🔒 Admin code required
                </p>
                <p className="text-[11px] mb-2.5" style={{ color: "rgba(232,227,218,0.55)" }}>
                  Moving back to &ldquo;{pendingStage}&rdquo; requires an admin code.
                </p>
                <div className="flex gap-2">
                  <input
                    ref={pinInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="order-modal-pin-no-autofill"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    maxLength={4}
                    value={adminPin}
                    onChange={(e) => { setAdminPin(e.target.value.replace(/\D/g, "")); setPinError(false); }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") handlePinSubmit(); }}
                    placeholder="••••"
                    className="flex-1 rounded-md px-3 py-1.5 text-sm text-center tracking-[0.4em] font-mono transition-colors"
                    style={{
                      background: pinError ? "rgba(224,85,85,0.18)" : "rgba(255,255,255,0.08)",
                      border: pinError ? "0.5px solid rgba(224,85,85,0.60)" : "0.5px solid rgba(255,255,255,0.18)",
                      color: "#e8e3da",
                      outline: "none",
                      WebkitTextSecurity: "disc",
                      textSecurity: "disc",
                    } as React.CSSProperties}
                  />
                  <button
                    onClick={handlePinSubmit}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
                    style={{
                      background: "rgba(224,85,85,0.20)",
                      border: "0.5px solid rgba(224,85,85,0.45)",
                      color: "#e07070",
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => { setPendingStage(null); setAdminPin(""); setPinError(false); }}
                    className="px-3 py-1.5 rounded-md text-xs transition-all"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "0.5px solid rgba(255,255,255,0.12)",
                      color: "rgba(232,227,218,0.45)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {pinError && (
                  <p className="text-[10px] mt-1.5" style={{ color: "#e07070" }}>Incorrect code. Try again.</p>
                )}
              </div>
            )}

            {/* Attachment gate error */}
            {enteredGateError && (
              <div className="mt-3 rounded-lg px-3 py-2.5"
                style={{ background: "rgba(212,146,42,0.12)", border: "0.5px solid rgba(212,146,42,0.40)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "#d4922a" }}>
                  📎 Acknowledgment required
                </p>
                <p className="text-[11px]" style={{ color: "rgba(232,227,218,0.65)" }}>
                  Upload the manufacturer&apos;s acknowledgment PDF in the Attachments section below before moving to Entered.
                </p>
              </div>
            )}
          </div>

          {/* Details grid */}
          <div className="p-5 space-y-4" style={SECTION_BORDER}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className={LABEL}>Source</p>
                <span
                  className="text-xs px-2 py-0.5 rounded font-medium"
                  style={
                    liveOrder.source === "Shopify"
                      ? { background: "rgba(86,100,72,0.20)", color: "#8fbe70", border: "0.5px solid rgba(86,100,72,0.28)" }
                      : liveOrder.source === "Manual"
                      ? { background: "rgba(145,165,151,0.20)", color: "rgba(180,210,190,0.95)", border: "0.5px solid rgba(145,165,151,0.50)" }
                      : { background: "rgba(74,111,143,0.15)", color: "rgba(74,143,212,0.85)", border: "0.5px solid rgba(74,111,143,0.35)" }
                  }
                >
                  {liveOrder.source === "Manual" ? "Custom Quote" : liveOrder.source}
                </span>
              </div>
              <div>
                <p className={LABEL}>SKU</p>
                <p className="text-xs font-mono text-[rgba(232,227,218,0.55)]">{liveOrder.sku || "—"}</p>
              </div>
              <div>
                <p className={LABEL}>Team member</p>
                {(() => {
                  // Same logic as the table: prefer claimed_by → entered_by →
                  // explicit member field. Empty when nobody owns it.
                  const ownerName = liveOrder.claimed_by ?? liveOrder.entered_by ?? null;
                  const ownerMember = ownerName
                    ? team.find(m => m.name === ownerName)
                    : (liveOrder.member ? team.find(m => m.initials === liveOrder.member) : null);
                  if (!ownerName && !ownerMember) {
                    return (
                      <p className="text-xs text-cream/35 italic">unclaimed</p>
                    );
                  }
                  const initials = ownerMember?.initials ?? (ownerName ? ownerName.slice(0, 2).toUpperCase() : "");
                  const displayName = ownerMember?.name ?? ownerName ?? "";
                  const style = ownerMember
                    ? AVATAR_COLOR_STYLES[ownerMember.avatarColor]
                    : { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
                  return (
                    <div className="flex items-center gap-2">
                      <div
                        style={{ ...style, borderWidth: 1, borderStyle: "solid" }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold"
                      >
                        {initials}
                      </div>
                      <span className="text-xs text-cream/65">{displayName}</span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <p className={LABEL}>Date</p>
                <p className="text-xs text-[rgba(232,227,218,0.55)]">{liveOrder.date}</p>
              </div>
            </div>

            {/* Production & Delivery Dates — shown above notes when dates exist */}
            {liveOrder.type === "order" && (liveOrder.production_start_date || liveOrder.production_est_finish_date || liveOrder.scheduled_delivery_date) && (
              <div className="grid grid-cols-3 gap-2 mb-1">
                {liveOrder.production_start_date && (
                  <div className="rounded-md px-2 py-1.5" style={{ background: "rgba(200,184,74,0.08)", border: "0.5px solid rgba(200,184,74,0.25)" }}>
                    <p className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(232,227,218,0.35)" }}>Prod. Start</p>
                    <p className="text-[10px] font-semibold" style={{ color: "rgba(200,184,74,0.90)" }}>{liveOrder.production_start_date}</p>
                  </div>
                )}
                {liveOrder.production_est_finish_date && (
                  <div className="rounded-md px-2 py-1.5" style={{ background: "rgba(200,184,74,0.08)", border: "0.5px solid rgba(200,184,74,0.25)" }}>
                    <p className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(232,227,218,0.35)" }}>Est. Finish</p>
                    <p className="text-[10px] font-semibold" style={{ color: "rgba(200,184,74,0.90)" }}>{liveOrder.production_est_finish_date}</p>
                  </div>
                )}
                {liveOrder.scheduled_delivery_date && (
                  <div className="rounded-md px-2 py-1.5" style={{ background: "rgba(74,143,212,0.08)", border: "0.5px solid rgba(74,143,212,0.25)" }}>
                    <p className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(232,227,218,0.35)" }}>Delivery Date</p>
                    <p className="text-[10px] font-semibold" style={{ color: "rgba(110,170,230,0.90)" }}>{liveOrder.scheduled_delivery_date}</p>
                  </div>
                )}
              </div>
            )}

            {/* Customer-facing notes — Quote orders get structured display, others get plain textarea */}
            {liveOrder.source === "Manual" && liveOrder.notes?.includes("QUOTE REQUEST") ? (
              <QuoteInfoPanel notes={liveOrder.notes} />
            ) : (
              <div>
                <p className={LABEL}>Customer Notes</p>
                <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setNotesChanged(true); }}
                  placeholder="Add notes visible to the customer / written into the Shopify order…"
                  rows={6}
                  className="w-full rounded-lg p-2.5 text-xs resize-none transition-colors placeholder:text-[rgba(232,227,218,0.20)]"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "0.5px solid rgba(255,255,255,0.18)",
                    color: "rgba(232,227,218,0.75)",
                    fontSize: "16px",
                  }}
                />
                {notesChanged && (
                  <button
                    onClick={handleSaveNotes}
                    className="mt-1.5 text-[11px] transition-colors"
                    style={{ color: "#8fbe70" }}
                  >
                    Save notes →
                  </button>
                )}
              </div>
            )}

            {/* Internal notes — staff-only, never sent to Shopify, shown in red on export PDF */}
            <div className="mt-3">
              <div className="flex items-center gap-1.5 mb-1">
                <p className={`${LABEL} mb-0`} style={{ color: "rgba(224,85,85,0.65)" }}>
                  Internal Notes
                </p>
                <span
                  className="text-[8px] uppercase tracking-widest px-1 py-px rounded"
                  style={{
                    background: "rgba(224,85,85,0.12)",
                    color: "rgba(224,85,85,0.85)",
                    border: "0.5px solid rgba(224,85,85,0.3)",
                  }}
                >
                  staff only
                </span>
              </div>
              <textarea
                value={internalNotes}
                onChange={(e) => { setInternalNotes(e.target.value); setInternalNotesChanged(true); }}
                placeholder="Visible to staff and on the export PDF. Never sent to Shopify or the customer."
                rows={4}
                className="w-full rounded-lg p-2.5 text-xs resize-none transition-colors placeholder:text-[rgba(232,227,218,0.20)]"
                style={{
                  background: "rgba(224,85,85,0.04)",
                  border: "0.5px dashed rgba(224,85,85,0.3)",
                  color: "rgba(232,227,218,0.85)",
                  fontSize: "16px",
                }}
              />
              {internalNotesChanged && (
                <button
                  onClick={handleSaveInternalNotes}
                  className="mt-1.5 text-[11px] transition-colors"
                  style={{ color: "#8fbe70" }}
                >
                  Save internal notes →
                </button>
              )}
            </div>
          </div>

          {/* Order details */}
          {liveOrder.type === "order" && (
            <OrderDetails
              orderId={liveOrder.id}
              doorStyle={liveOrder.door_style ?? ""}
              color={liveOrder.color ?? ""}
              skuItems={liveOrder.sku_items ?? []}
              productionStartDate={liveOrder.production_start_date}
              productionEstFinishDate={liveOrder.production_est_finish_date}
              scheduledDeliveryDate={liveOrder.scheduled_delivery_date}
              readOnly={liveOrder.source === "Shopify"}
            />
          )}

          {/* Damage reports */}
          {liveOrder.type === "warranty" && (
            <DamageReportPanel
              orderId={liveOrder.id}
              orderSkus={liveOrder.sku_items?.map((i) => i.sku) ?? (liveOrder.sku ? [liveOrder.sku] : [])}
            />
          )}

          {/* Attachments */}
          <div ref={attachmentsAnchorRef}>
            <AttachmentsPanel ref={attachmentsRef} orderId={liveOrder.id} />
          </div>

          {/* Activity */}
          <div className="p-5">
            <p className={LABEL}>Activity</p>
            <div className="flex flex-col gap-3">
              {[...liveOrder.activity].reverse().map((a, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                    <Clock className="w-3 h-3 text-[rgba(232,227,218,0.45)]" />
                    {i < liveOrder.activity.length - 1 && (
                      <div className="w-px flex-1 min-h-[12px]" style={{ background: "rgba(255,255,255,0.20)" }} />
                    )}
                  </div>
                  <div className="pb-1">
                    <p className="text-xs text-[rgba(232,227,218,0.55)]">{a.text}</p>
                    <p className="text-[10px] text-[rgba(232,227,218,0.45)] mt-0.5">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteInfoPanel({ notes }: { notes: string }) {
  function extract(label: string): string {
    const regex = new RegExp(`^${label}:\\s*(.+)`, "im");
    const match = notes.match(regex);
    return match ? match[1].trim() : "";
  }

  const customerName = extract("Customer");
  const phone    = extract("Phone");
  const email    = extract("Email");
  const address  = extract("Address");
  const city     = extract("City");
  const state    = extract("State");
  const zip      = extract("Zip");
  const budget   = extract("Budget");
  const door     = extract("Door Style");
  const color    = extract("Color");
  const notesTxt = extract("Notes");
  const attach   = extract("📎 Attachment");

  const ROW = "flex flex-col gap-0.5";
  const LBL = "text-[9px] uppercase tracking-widest font-semibold" as const;
  const VAL = "text-sm" as const;

  return (
    <div className="space-y-4">
      {/* Contact info */}
      <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
        <p className="text-[9px] uppercase tracking-widest font-semibold mb-3" style={{ color: "rgba(232,227,218,0.40)" }}>Contact</p>
        <div className="grid grid-cols-2 gap-3">
          {customerName && <div className={ROW + " col-span-2"}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Name</span><span className={VAL} style={{ color: "rgba(232,227,218,0.95)", fontWeight: 500 }}>{customerName}</span></div>}
          {phone && <div className={ROW}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Phone</span><span className={VAL} style={{ color: "rgba(232,227,218,0.85)" }}>{phone}</span></div>}
          {email && <div className={ROW}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Email</span><span className={VAL} style={{ color: "rgba(232,227,218,0.85)", wordBreak: "break-all" }}>{email}</span></div>}
          {address && <div className={ROW + " col-span-2"}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Address</span><span className={VAL} style={{ color: "rgba(232,227,218,0.85)" }}>{address}</span></div>}
          {(city || state || zip) && (
            <div className={ROW + " col-span-2"}>
              <span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>City / State / Zip</span>
              <span className={VAL} style={{ color: "rgba(232,227,218,0.85)" }}>{[city, state, zip].filter(Boolean).join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quote selections */}
      {(budget || door || color) && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
          <p className="text-[9px] uppercase tracking-widest font-semibold mb-3" style={{ color: "rgba(232,227,218,0.40)" }}>Selections</p>
          <div className="space-y-2.5">
            {budget && <div className={ROW}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Budget</span><span className={VAL} style={{ color: "#8fbe70" }}>{budget}</span></div>}
            {door && <div className={ROW}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Door Style</span><span className={VAL} style={{ color: "rgba(232,227,218,0.85)" }}>{door}</span></div>}
            {color && <div className={ROW}><span className={LBL} style={{ color: "rgba(232,227,218,0.35)" }}>Color</span><span className={VAL} style={{ color: "rgba(232,227,218,0.85)" }}>{color}</span></div>}
          </div>
        </div>
      )}

      {/* Customer notes */}
      {notesTxt && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
          <p className="text-[9px] uppercase tracking-widest font-semibold mb-2" style={{ color: "rgba(232,227,218,0.40)" }}>Customer Notes</p>
          <p className="text-sm" style={{ color: "rgba(232,227,218,0.75)", lineHeight: "1.5" }}>{notesTxt}</p>
        </div>
      )}

      {/* Attachment link */}
      {attach && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
          <p className="text-[9px] uppercase tracking-widest font-semibold mb-2" style={{ color: "rgba(232,227,218,0.40)" }}>Attachment</p>
          <a href={attach} target="_blank" rel="noopener noreferrer" className="text-sm underline" style={{ color: "rgba(110,170,230,0.90)" }}>View uploaded file</a>
        </div>
      )}
    </div>
  );
}
