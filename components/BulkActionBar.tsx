"use client";

import { useState, useMemo } from "react";
import { Archive, ChevronDown, Loader2, X } from "lucide-react";
import { Order, ORDER_STAGES, WARRANTY_STAGES, Stage } from "@/lib/data";
import { useStore } from "@/lib/store";

interface BulkActionBarProps {
  selectedOrders: Order[];
  tab: "orders" | "warranty";
  onClear: () => void;
  onDone: () => void;
}

const STAGE_COLOR: Record<string, string> = {
  "New": "#e05555", "Entered": "#d4922a", "In production": "#c8b84a",
  "At cross dock": "#4a8fd4", "Delivered": "#4caf7a",
  "New claim": "#e05555", "In review": "#d4922a", "Parts ordered": "#c8b84a",
  "Shipped": "#4a8fd4", "Resolved": "#4caf7a",
};

export function BulkActionBar({ selectedOrders, tab, onClear, onDone }: BulkActionBarProps) {
  const { bulkAction } = useStore();
  const [confirming, setConfirming] = useState<null | { kind: "move"; stage: Stage } | { kind: "archive" }>(null);
  const [working, setWorking] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const count = selectedOrders.length;

  // Determine the common stage — null if mixed
  const commonStage = useMemo<Stage | null>(() => {
    if (count === 0) return null;
    const first = selectedOrders[0].stage;
    return selectedOrders.every(o => o.stage === first) ? first : null;
  }, [selectedOrders, count]);

  const stages = tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES;

  // Hide entirely when nothing selected
  if (count === 0) return null;

  async function runMove(stage: Stage) {
    setWorking(true);
    setResultMsg(null);
    const res = await bulkAction(selectedOrders.map(o => o.id), { type: "move", stage });
    setWorking(false);
    setConfirming(null);

    if (!res) {
      setResultMsg("⚠ Network error — please refresh");
      return;
    }
    if (res.failed > 0) {
      setResultMsg(`Moved ${res.succeeded}, ${res.failed} failed (likely permission)`);
    } else {
      setResultMsg(`✓ Moved ${res.succeeded} order${res.succeeded === 1 ? "" : "s"}`);
      setTimeout(() => { setResultMsg(null); onDone(); }, 1500);
    }
  }

  async function runArchive() {
    setWorking(true);
    setResultMsg(null);
    const res = await bulkAction(selectedOrders.map(o => o.id), { type: "archive", archived: true });
    setWorking(false);
    setConfirming(null);

    if (!res) {
      setResultMsg("⚠ Network error — please refresh");
      return;
    }
    if (res.failed > 0) {
      setResultMsg(`Archived ${res.succeeded}, ${res.failed} failed (likely permission)`);
    } else {
      setResultMsg(`✓ Archived ${res.succeeded} order${res.succeeded === 1 ? "" : "s"}`);
      setTimeout(() => { setResultMsg(null); onDone(); }, 1500);
    }
  }

  return (
    <>
      {/* Floating action bar — bottom center, above everything */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-2xl px-3 py-2.5 flex items-center gap-2 animate-card-in"
        style={{
          background: "rgba(22,36,50,0.97)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border: "0.5px solid rgba(255,255,255,0.18)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), 0 16px 48px rgba(0,0,0,0.55)",
          maxWidth: "calc(100vw - 24px)",
        }}
      >
        {/* Count */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{
          background: "rgba(74,143,212,0.18)",
          border: "0.5px solid rgba(74,143,212,0.45)",
        }}>
          <span className="text-[11px] font-semibold" style={{ color: "#7ab5e8" }}>
            {count} selected
          </span>
        </div>

        {/* Stage indicator */}
        {commonStage ? (
          <span
            className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded"
            style={{
              color: STAGE_COLOR[commonStage] ?? "#888",
              background: `${STAGE_COLOR[commonStage] ?? "#888"}20`,
              border: `0.5px solid ${STAGE_COLOR[commonStage] ?? "#888"}55`,
            }}
            title={`All ${count} selected orders are in "${commonStage}"`}
          >
            {commonStage}
          </span>
        ) : (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              color: "rgba(255,170,80,0.95)",
              background: "rgba(255,170,80,0.10)",
              border: "0.5px solid rgba(255,170,80,0.40)",
            }}
            title="Selected orders are in different stages — clear selection to pick one stage"
          >
            ⚠ mixed stages
          </span>
        )}

        {/* Move-to dropdown */}
        <MoveToDropdown
          stages={stages}
          currentStage={commonStage}
          disabled={!commonStage || working}
          onPick={(stage) => setConfirming({ kind: "move", stage })}
        />

        {/* Archive button */}
        <button
          onClick={() => setConfirming({ kind: "archive" })}
          disabled={working}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-50"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "0.5px solid rgba(255,255,255,0.20)",
            color: "rgba(232,227,218,0.85)",
          }}
          title="Archive all selected orders"
        >
          <Archive className="w-3 h-3" />
          Archive
        </button>

        {/* Clear */}
        <button
          onClick={onClear}
          disabled={working}
          className="p-1 rounded-md transition-colors hover:bg-[rgba(255,255,255,0.10)] disabled:opacity-50"
          title="Clear selection"
        >
          <X className="w-3.5 h-3.5" style={{ color: "rgba(232,227,218,0.55)" }} />
        </button>

        {/* Inline result message */}
        {resultMsg && (
          <span className="text-[11px] pl-1" style={{ color: resultMsg.startsWith("✓") ? "#8fbe70" : "#e08030" }}>
            {resultMsg}
          </span>
        )}
      </div>

      {/* Confirm dialog */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => !working && setConfirming(null)}
        >
          <div
            className="rounded-2xl p-5 max-w-md w-full"
            style={{
              background: "rgba(22,36,50,0.97)",
              border: "0.5px solid rgba(255,255,255,0.18)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.20), 0 24px 64px rgba(0,0,0,0.65)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold mb-2" style={{ color: "#f0ece4" }}>
              {confirming.kind === "move" ? `Move ${count} order${count === 1 ? "" : "s"}?` : `Archive ${count} order${count === 1 ? "" : "s"}?`}
            </h2>
            <p className="text-xs mb-4" style={{ color: "rgba(232,227,218,0.65)" }}>
              {confirming.kind === "move"
                ? <>All {count} orders will move from <strong>{commonStage}</strong> to <strong>{confirming.stage}</strong>. Stage changes sync to Shopify.</>
                : <>All {count} selected orders will be moved to the archive. You can restore them later.</>}
            </p>

            {/* Order preview */}
            <div
              className="rounded-lg p-2 mb-4 max-h-32 overflow-y-auto text-[11px] font-mono"
              style={{
                background: "rgba(0,0,0,0.20)",
                border: "0.5px solid rgba(255,255,255,0.12)",
                color: "rgba(232,227,218,0.55)",
              }}
            >
              {selectedOrders.slice(0, 8).map(o => (
                <div key={o.id} className="truncate">
                  {o.id} — {o.name}
                </div>
              ))}
              {selectedOrders.length > 8 && (
                <div className="italic">…and {selectedOrders.length - 8} more</div>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(null)}
                disabled={working}
                className="px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "0.5px solid rgba(255,255,255,0.20)",
                  color: "rgba(232,227,218,0.85)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirming.kind === "move") runMove(confirming.stage);
                  else runArchive();
                }}
                disabled={working}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-70"
                style={{
                  background: "rgba(86,100,72,0.30)",
                  border: "0.5px solid rgba(86,100,72,0.85)",
                  color: "#a8dd80",
                }}
              >
                {working && <Loader2 className="w-3 h-3 animate-spin" />}
                {confirming.kind === "move" ? "Move" : "Archive"} {count}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MoveToDropdown({ stages, currentStage, disabled, onPick }: {
  stages: readonly string[];
  currentStage: Stage | null;
  disabled: boolean;
  onPick: (stage: Stage) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: disabled ? "rgba(255,255,255,0.04)" : "rgba(86,100,72,0.22)",
          border: `0.5px solid ${disabled ? "rgba(255,255,255,0.15)" : "rgba(86,100,72,0.75)"}`,
          color: disabled ? "rgba(232,227,218,0.40)" : "#a8dd80",
        }}
        title={disabled ? "Selected orders must all be in the same stage" : "Move to…"}
      >
        Move to…
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && !disabled && (
        <div
          className="absolute bottom-[calc(100%+4px)] left-0 z-50 rounded-xl overflow-hidden min-w-[140px]"
          style={{
            background: "rgba(22,36,50,0.99)",
            backdropFilter: "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            border: "0.5px solid rgba(255,255,255,0.18)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
          }}
        >
          {stages.map(s => {
            const isCurrent = s === currentStage;
            return (
              <button
                key={s}
                disabled={isCurrent}
                onClick={() => { onPick(s as Stage); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[11px] transition-colors hover:bg-[rgba(255,255,255,0.10)] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  color: isCurrent ? "rgba(232,227,218,0.40)" : "rgba(232,227,218,0.85)",
                  borderBottom: "0.5px solid rgba(255,255,255,0.10)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full inline-block mr-2" style={{
                  background: STAGE_COLOR[s] ?? "#888",
                }} />
                {s}{isCurrent && " (current)"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
