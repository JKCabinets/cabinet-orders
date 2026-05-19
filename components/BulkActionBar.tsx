"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Archive, ChevronDown, Loader2, X, AlertCircle } from "lucide-react";
import { Order, ORDER_STAGES, WARRANTY_STAGES, Stage } from "@/lib/data";
import { useStore } from "@/lib/store";
import { decodeHtmlEntities } from "@/lib/htmlEntities";

interface BulkActionBarProps {
  selectedOrders: Order[];
  tab: "orders" | "warranty";
  onClear: () => void;
  onDone: () => void;
}

const STAGE_COLOR: Record<string, string> = {
  "New": "#c97070", "Entered": "#d4922a", "In production": "#c8b84a",
  "At cross dock": "#5a8db8", "Delivered": "#8fbe70",
  "New claim": "#c97070", "In review": "#d4922a", "Parts ordered": "#c8b84a",
  "Shipped": "#5a8db8", "Resolved": "#8fbe70",
};

// Map a server-returned `reason` code to a user-friendly label.
function reasonLabel(reason: string | undefined): string {
  if (!reason) return "will move";
  if (reason === "needs_attachment") return "needs attachment first";
  if (reason === "no_change") return "already in target stage";
  if (reason === "not_found") return "not found";
  return reason;
}

interface PreflightCheck {
  id: string;
  will_pass: boolean;
  reason?: string;
}

interface ConfirmState {
  kind: "move" | "archive";
  stage?: Stage;          // present when kind === "move"
  checks?: PreflightCheck[];
  requiresPin: boolean;
}

export function BulkActionBar({ selectedOrders, tab, onClear, onDone }: BulkActionBarProps) {
  const { bulkAction } = useStore();
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [working, setWorking] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const count = selectedOrders.length;

  // Auto-focus PIN field when the confirm dialog needs one
  useEffect(() => {
    if (confirming?.requiresPin) {
      requestAnimationFrame(() => pinInputRef.current?.focus());
    }
  }, [confirming?.requiresPin]);

  // Determine the common stage — null if mixed
  const commonStage = useMemo<Stage | null>(() => {
    if (count === 0) return null;
    const first = selectedOrders[0].stage;
    return selectedOrders.every(o => o.stage === first) ? first : null;
  }, [selectedOrders, count]);

  const stages = tab === "orders" ? ORDER_STAGES : WARRANTY_STAGES;

  // Hide entirely when nothing selected
  if (count === 0) return null;

  // ── Pre-flight: ask the server which orders would pass the gates ─────────
  async function preflightMove(stage: Stage) {
    setPreflighting(true);
    setResultMsg(null);
    try {
      const idsParam = selectedOrders.map(o => o.id).join(",");
      const res = await fetch(`/api/orders/bulk?ids=${encodeURIComponent(idsParam)}&stage=${encodeURIComponent(stage)}`);
      if (!res.ok) {
        setResultMsg("⚠ Couldn't preview — try again");
        return;
      }
      const data = await res.json() as { checks?: PreflightCheck[]; requires_pin?: boolean };
      setConfirming({
        kind: "move",
        stage,
        checks: data.checks ?? [],
        requiresPin: data.requires_pin ?? false,
      });
      setAdminPin("");
      setPinError(false);
    } catch {
      setResultMsg("⚠ Network error");
    } finally {
      setPreflighting(false);
    }
  }

  function openArchiveConfirm() {
    setConfirming({ kind: "archive", requiresPin: false });
    setAdminPin("");
    setPinError(false);
  }

  // ── Execute the action after confirm ─────────────────────────────────────
  async function execute() {
    if (!confirming) return;

    if (confirming.requiresPin && !adminPin) {
      setPinError(true);
      return;
    }

    setWorking(true);
    setResultMsg(null);

    let res;
    if (confirming.kind === "move" && confirming.stage) {
      res = await bulkAction(selectedOrders.map(o => o.id), {
        type: "move",
        stage: confirming.stage,
        adminPin: confirming.requiresPin ? adminPin : undefined,
      });
    } else {
      res = await bulkAction(selectedOrders.map(o => o.id), {
        type: "archive",
        archived: true,
      });
    }

    setWorking(false);

    if (!res) {
      setResultMsg("⚠ Network error — please refresh");
      setConfirming(null);
      return;
    }

    // Defensive: server says PIN is needed (e.g. user wiped it mid-flight)
    if (res.pinRequired) {
      setPinError(true);
      return;
    }

    setConfirming(null);

    const verb = confirming.kind === "move" ? "Moved" : "Archived";
    if (res.failed > 0) {
      setResultMsg(`${verb} ${res.succeeded} · ${res.failed} skipped (see card details)`);
    } else if (res.succeeded === 0) {
      setResultMsg(`No orders were modified`);
    } else {
      setResultMsg(`✓ ${verb} ${res.succeeded} order${res.succeeded === 1 ? "" : "s"}`);
      setTimeout(() => { setResultMsg(null); onDone(); }, 1800);
    }
  }

  // Pre-flight breakdown counts
  const willPass = confirming?.checks?.filter(c => c.will_pass).length ?? count;
  const willFail = confirming?.checks?.filter(c => !c.will_pass) ?? [];
  const reasonCounts: Record<string, number> = {};
  for (const c of willFail) {
    const label = reasonLabel(c.reason);
    reasonCounts[label] = (reasonCounts[label] ?? 0) + 1;
  }

  return (
    <>
      {/* Floating action bar — bottom center, above everything */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-panel px-4 py-3 flex items-center gap-2 animate-card-in"
        style={{
          // Sage glass to match the rest of the chrome
          background: "rgba(87, 98, 87, 0.32)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
          border: "0.5px solid rgba(145, 165, 151, 0.35)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 16px 48px rgba(0,0,0,0.50)",
          maxWidth: "calc(100vw - 24px)",
        }}
      >
        {/* Count */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{
          background: "rgba(184,130,106,0.20)",
          border: "0.5px solid rgba(184,130,106,0.45)",
        }}>
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#d9a888" }}>
            {count} selected
          </span>
        </div>

        {/* Stage indicator */}
        {commonStage ? (
          <span
            className="text-[9px] font-medium tracking-wider uppercase px-2 py-px rounded-full"
            style={{
              color: STAGE_COLOR[commonStage] ?? "#a0a09a",
              background: `${STAGE_COLOR[commonStage] ?? "#a0a09a"}20`,
              border: `0.5px solid ${STAGE_COLOR[commonStage] ?? "#a0a09a"}55`,
            }}
            title={`All ${count} selected orders are in "${commonStage}"`}
          >
            {commonStage}
          </span>
        ) : (
          <span
            className="text-[10px] px-2 py-px rounded-full uppercase tracking-wider"
            style={{
              color: "#e8b56a",
              background: "rgba(232,181,106,0.12)",
              border: "0.5px solid rgba(232,181,106,0.40)",
            }}
            title="Selected orders are in different stages — clear selection to pick one stage"
          >
            mixed stages
          </span>
        )}

        {/* Move-to dropdown */}
        <MoveToDropdown
          stages={stages}
          currentStage={commonStage}
          disabled={!commonStage || working || preflighting}
          loading={preflighting}
          onPick={preflightMove}
        />

        {/* Archive button */}
        <button
          onClick={openArchiveConfirm}
          disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all disabled:opacity-50 bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
          title="Archive all selected orders"
        >
          <Archive className="w-3 h-3" />
          Archive
        </button>

        {/* Clear */}
        <button
          onClick={onClear}
          disabled={working}
          className="p-1.5 rounded-full transition-colors hover:bg-white/10 disabled:opacity-50"
          title="Clear selection"
        >
          <X className="w-3.5 h-3.5 text-cream/55" />
        </button>

        {/* Inline result message */}
        {resultMsg && (
          <span className="text-[11px] pl-1" style={{ color: resultMsg.startsWith("✓") ? "#a0cc7a" : "#e8b56a" }}>
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
              {confirming.kind === "move"
                ? `Move orders to "${confirming.stage}"?`
                : `Archive ${count} order${count === 1 ? "" : "s"}?`}
            </h2>

            {/* Description */}
            <p className="text-xs mb-3" style={{ color: "rgba(232,227,218,0.65)" }}>
              {confirming.kind === "move" ? (
                <>From <strong>{commonStage}</strong> to <strong>{confirming.stage}</strong>. Stage changes sync to Shopify.</>
              ) : (
                <>Selected orders will be moved to the archive. You can restore them later.</>
              )}
            </p>

            {/* Pre-flight breakdown for moves */}
            {confirming.kind === "move" && confirming.checks && (
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: "#8fbe70" }} />
                  <span className="text-xs" style={{ color: "rgba(232,227,218,0.85)" }}>
                    <strong>{willPass}</strong> will move
                  </span>
                </div>
                {Object.entries(reasonCounts).map(([reason, n]) => (
                  <div key={reason} className="flex items-start gap-2">
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "#e08030" }} />
                    <span className="text-xs" style={{ color: "rgba(255,170,80,0.95)" }}>
                      <strong>{n}</strong> will be skipped — {reason}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Order preview */}
            <div
              className="rounded-lg p-2 mb-4 max-h-32 overflow-y-auto text-[11px] font-mono"
              style={{
                background: "rgba(0,0,0,0.20)",
                border: "0.5px solid rgba(255,255,255,0.12)",
                color: "rgba(232,227,218,0.55)",
              }}
            >
              {selectedOrders.slice(0, 8).map(o => {
                const check = confirming.checks?.find(c => c.id === o.id);
                const willFailThis = check && !check.will_pass;
                return (
                  <div key={o.id} className="truncate flex items-center gap-1.5">
                    {willFailThis && <span style={{ color: "#e08030" }}>⊗</span>}
                    {check?.will_pass && confirming.kind === "move" && <span style={{ color: "#8fbe70" }}>→</span>}
                    <span style={{ color: willFailThis ? "rgba(255,170,80,0.85)" : "rgba(232,227,218,0.55)" }}>
                      {o.id} — {decodeHtmlEntities(o.name)}
                    </span>
                  </div>
                );
              })}
              {selectedOrders.length > 8 && (
                <div className="italic">…and {selectedOrders.length - 8} more</div>
              )}
            </div>

            {/* PIN input for backwards moves */}
            {confirming.requiresPin && (
              <div className="mb-4">
                <p className="text-[11px] mb-1.5 uppercase tracking-widest" style={{ color: "rgba(224,85,85,0.85)" }}>
                  ⚠ Backwards move — Admin PIN required
                </p>
                <input
                  ref={pinInputRef}
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  name="bulk-action-pin-no-autofill"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  maxLength={6}
                  value={adminPin}
                  onChange={(e) => {
                    // Accept alphanumeric only — matches OrderModal's PIN input.
                    // Server compares as-is (case sensitive) against ADMIN_BACKWARD_PIN.
                    setAdminPin(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 6));
                    setPinError(false);
                  }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && adminPin) execute(); }}
                  placeholder="Enter admin PIN"
                  className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: pinError ? "rgba(224,85,85,0.18)" : "rgba(255,255,255,0.08)",
                    border: pinError ? "0.5px solid rgba(224,85,85,0.60)" : "0.5px solid rgba(255,255,255,0.18)",
                    color: "#f0ece4",
                    fontSize: "16px",
                    // CSS dot masking — visually masked without `type="password"`
                    // which triggers Chrome's autofill heuristics on the rest of
                    // the page.
                    WebkitTextSecurity: "disc",
                    textSecurity: "disc",
                  } as React.CSSProperties}
                />
                {pinError && (
                  <p className="text-[10px] mt-1" style={{ color: "rgba(224,85,85,0.85)" }}>
                    Incorrect PIN
                  </p>
                )}
              </div>
            )}

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
                onClick={execute}
                disabled={working || willPass === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                style={{
                  background: "rgba(86,100,72,0.30)",
                  border: "0.5px solid rgba(86,100,72,0.85)",
                  color: "#a8dd80",
                }}
              >
                {working && <Loader2 className="w-3 h-3 animate-spin" />}
                {confirming.kind === "move"
                  ? (willPass === count ? `Move ${count}` : `Move ${willPass} of ${count}`)
                  : `Archive ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MoveToDropdown({ stages, currentStage, disabled, loading, onPick }: {
  stages: readonly string[];
  currentStage: Stage | null;
  disabled: boolean;
  loading: boolean;
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
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Move to…"}
        {!loading && <ChevronDown className="w-3 h-3" />}
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
