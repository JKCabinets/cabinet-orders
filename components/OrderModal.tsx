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
import { AttachmentsPanel } from "./AttachmentsPanel";
import { OrderDetails } from "./OrderDetails";
import { DamageReportPanel } from "./DamageReportPanel";

interface OrderModalProps {
  order: Order;
  tab: "orders" | "warranty";
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
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
  background: "rgba(38,55,70,0.96)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  borderLeft: "0.5px solid rgba(255,255,255,0.18)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), -24px 0 80px rgba(0,0,0,0.4)",
};

const SECTION_BORDER: React.CSSProperties = {
  borderBottom: "0.5px solid rgba(255,255,255,0.20)",
};

const LABEL = "text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1";

const ADMIN_CODE = "4951";

export function OrderModal({ order, tab, onClose, onStageChange }: OrderModalProps) {
  const { moveStage, updateNotes, archiveOrder, unarchiveOrder, deleteOrder, orders, warranties, team } = useStore();
  const { data: session } = useSession();
  const currentUserName = session?.user?.name ?? undefined;
  const [notes, setNotes] = useState(order.notes);
  const [notesChanged, setNotesChanged] = useState(false);
  const [enteredGateError, setEnteredGateError] = useState(false);
  const [checkingAttachments, setCheckingAttachments] = useState(false);
  // Admin PIN for backwards moves
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

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
      try {
        const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(liveOrder.id)}`);
        const data = await res.json();
        const count = (data.data ?? []).length;
        if (count === 0) {
          setEnteredGateError(true);
          setCheckingAttachments(false);
          return;
        }
      } catch {
        setEnteredGateError(true);
        setCheckingAttachments(false);
        return;
      }
      setCheckingAttachments(false);
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

  function getMemberAvatarStyle(initials: string) {
    const member = team.find((m) => m.initials === initials);
    if (member) return AVATAR_COLOR_STYLES[member.avatarColor];
    return { backgroundColor: "rgba(86,100,72,0.20)", color: "#8fbe70", borderColor: "rgba(86,100,72,0.28)" };
  }

  const isCompleted = liveOrder.stage === "Delivered" || liveOrder.stage === "Resolved";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-end md:items-start justify-end animate-fade-in"
      style={{ background: "rgba(0,0,0,0.60)" }}
    >
      <div
        className="w-full md:w-[420px] h-[92vh] md:h-full flex flex-col animate-slide-in overflow-hidden rounded-t-2xl md:rounded-none"
        style={PANEL}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 flex-shrink-0" style={SECTION_BORDER}>
          <div>
            <p className="text-[11px] font-mono text-[rgba(232,227,218,0.50)] mb-1">{liveOrder.id}</p>
            <h2 className="text-base font-medium text-[#e8e3da]">{liveOrder.name}</h2>
            {liveOrder.detail && (
              <p className="text-xs text-[rgba(232,227,218,0.45)] mt-0.5">{liveOrder.detail}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-3">
            {isCompleted && (
              <button
                onClick={handleArchive}
                title={liveOrder.archived ? "Restore" : "Archive"}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] transition-all"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "0.5px solid rgba(255,255,255,0.18)",
                  color: "rgba(232,227,218,0.45)",
                }}
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
                    disabled={checkingAttachments || liveOrder.source === "Shopify"}
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
                    type="password"
                    inputMode="numeric"
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
                    }}
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
                      : { background: "rgba(74,111,143,0.15)", color: "rgba(74,143,212,0.85)", border: "0.5px solid rgba(74,111,143,0.35)" }
                  }
                >
                  {liveOrder.source}
                </span>
              </div>
              <div>
                <p className={LABEL}>SKU</p>
                <p className="text-xs font-mono text-[rgba(232,227,218,0.55)]">{liveOrder.sku || "—"}</p>
              </div>
              <div>
                <p className={LABEL}>Team member</p>
                <div
                  style={{ ...getMemberAvatarStyle(liveOrder.member), borderWidth: 1, borderStyle: "solid" }}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold"
                >
                  {liveOrder.member}
                </div>
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

            {/* Notes */}
            <div>
              <p className={LABEL}>Notes</p>
              {liveOrder.source === "Shopify" ? (
                <p className="text-xs rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.10)", color: "rgba(232,227,218,0.50)", minHeight: "60px" }}>
                  {notes || <span style={{ color: "rgba(232,227,218,0.20)" }}>No notes</span>}
                </p>
              ) : (
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setNotesChanged(true); }}
                placeholder="Add notes…"
                rows={3}
                className="w-full rounded-lg p-2.5 text-xs resize-none transition-colors placeholder:text-[rgba(232,227,218,0.20)]"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "0.5px solid rgba(255,255,255,0.18)",
                  color: "rgba(232,227,218,0.75)",
                  fontSize: "16px",
                }}
              />
              )}
              {notesChanged && liveOrder.source !== "Shopify" && (
                <button
                  onClick={handleSaveNotes}
                  className="mt-1.5 text-[11px] transition-colors"
                  style={{ color: "#8fbe70" }}
                >
                  Save notes →
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
          <AttachmentsPanel orderId={liveOrder.id} />

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
