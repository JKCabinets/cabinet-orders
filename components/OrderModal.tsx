"use client";

import { useState, useEffect, useRef } from "react";
import { X, Clock, ChevronRight, Archive, RotateCcw, Trash2 } from "lucide-react";
import clsx from "clsx";
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

export function OrderModal({ order, tab, onClose, onStageChange }: OrderModalProps) {
  const { moveStage, updateNotes, archiveOrder, unarchiveOrder, deleteOrder, orders, warranties, team } = useStore();
  const [notes, setNotes] = useState(order.notes);
  const [notesChanged, setNotesChanged] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const liveOrder =
    (tab === "orders" ? orders : warranties).find((o) => o.id === order.id) ?? order;
  const stages = tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    setNotes(liveOrder.notes);
    setNotesChanged(false);
  }, [liveOrder.notes]);

  function handleMoveStage(stage: Stage) {
    moveStage(liveOrder.id, stage);
    onStageChange(stage);
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
  const stageIdx = (stages as string[]).indexOf(liveOrder.stage);

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
                const color = STAGE_COLOR[s] ?? "#566448";
                return (
                  <button
                    key={s}
                    onClick={() => handleMoveStage(s as Stage)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all duration-150 text-left hover:brightness-110"
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
                    {isActive && <ChevronRight className="w-3 h-3 opacity-60" />}
                  </button>
                );
              })}
            </div>
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

            {/* Notes */}
            <div>
              <p className={LABEL}>Notes</p>
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
          </div>

          {/* Order details */}
          {liveOrder.type === "order" && (
            <OrderDetails
              orderId={liveOrder.id}
              doorStyle={liveOrder.door_style ?? ""}
              color={liveOrder.color ?? ""}
              skuItems={liveOrder.sku_items ?? []}
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
