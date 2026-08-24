"use client";

import { useState, useRef, useEffect } from "react";
import { Archive, Loader2, X, AlertCircle, Trash2 } from "lucide-react";
import { Order, displayOrderNumber } from "@/lib/data";
import { useStore } from "@/lib/store";
import { useSession } from "next-auth/react";

/**
 * Bulk actions — a CLEANUP tool.
 *
 * ⚠ THE MOVE-TO DROPDOWN WAS REMOVED 2026-08-24, with the preflight call, the
 * PIN dialog, the per-row checks breakdown and the MoveToDropdown component.
 * Bulk stage moves did not fit how the business runs, and the server route had
 * drifted from the single-order PATCH in five ways -- no delivery-proof gate,
 * no payment hold, half an attachment gate, `claimed_by` wiped on every forward
 * move, and `entered_by` written as the wrong kind of value. See the header of
 * app/api/orders/bulk/route.ts.
 *
 * Stage moves happen one order at a time, where those gates apply.
 */

interface BulkActionBarProps {
  /** The rows carry their own `type`; no tab prop is needed or wanted. */
  selectedOrders: Order[];
  onClear: () => void;
  onDone: () => void;
}

interface ConfirmState {
  kind: "archive" | "delete";
}

export function BulkActionBar({ selectedOrders, onClear, onDone }: BulkActionBarProps) {
  const { bulkAction } = useStore();
  const { data: session } = useSession();
  const [confirming, setConfirming] = useState<ConfirmState | null>(null);
  const [working, setWorking] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState("");
  const confirmInputRef = useRef<HTMLInputElement>(null);

  const count = selectedOrders.length;
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  // Delete is CUSTOM ROWS ONLY, and the server refuses anything else. Checking
  // here as well means the button is simply absent rather than offering an
  // action that will fail per row -- but the server check is the real one.
  const allCustom = count > 0 && selectedOrders.every(o => o.type === "custom");
  const canDelete = isAdmin && allCustom;

  useEffect(() => {
    if (confirming?.kind === "delete") {
      requestAnimationFrame(() => confirmInputRef.current?.focus());
    }
  }, [confirming?.kind]);

  if (count === 0) return null;

  async function execute() {
    if (!confirming) return;
    // Deleting is irreversible and takes the files with it, so it asks for the
    // word rather than a click. The archive path has no such friction because
    // it is reversible.
    if (confirming.kind === "delete" && confirmWord.trim().toUpperCase() !== "DELETE") return;

    setWorking(true);
    setResultMsg(null);

    const res = await bulkAction(
      selectedOrders.map(o => o.id),
      confirming.kind === "delete"
        ? { type: "delete" }
        : { type: "archive", archived: true },
    );

    setWorking(false);

    if (!res) {
      setResultMsg("⚠ Network error — please refresh");
      setConfirming(null);
      return;
    }

    const verb = confirming.kind === "delete" ? "Deleted" : "Archived";
    setConfirming(null);
    setConfirmWord("");

    if (res.failed > 0) {
      setResultMsg(`${verb} ${res.succeeded} · ${res.failed} skipped (see card details)`);
    } else if (res.succeeded === 0) {
      setResultMsg(`No orders were modified`);
    } else {
      setResultMsg(`✓ ${verb} ${res.succeeded} order${res.succeeded === 1 ? "" : "s"}`);
      setTimeout(() => { setResultMsg(null); onDone(); }, 1800);
    }
  }

  const isDelete = confirming?.kind === "delete";

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

        {/* Archive */}
        <button
          onClick={() => setConfirming({ kind: "archive" })}
          disabled={working}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all disabled:opacity-50 bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10"
          title="Archive all selected orders"
        >
          <Archive className="w-3 h-3" />
          Archive
        </button>

        {/* Delete — admin only, custom rows only */}
        {canDelete && (
          <button
            onClick={() => { setConfirmWord(""); setConfirming({ kind: "delete" }); }}
            disabled={working}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all disabled:opacity-50"
            style={{
              background: "rgba(224,85,85,0.15)",
              border: "0.5px solid rgba(224,85,85,0.45)",
              color: "#e08585",
            }}
            title="Permanently delete the selected custom jobs and their files"
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        )}

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
              {isDelete
                ? `Delete ${count} custom job${count === 1 ? "" : "s"}?`
                : `Archive ${count} order${count === 1 ? "" : "s"}?`}
            </h2>

            <p className="text-xs mb-3" style={{ color: "rgba(232,227,218,0.65)" }}>
              {isDelete ? (
                <>This cannot be undone. The jobs, their activity history and
                  their uploaded files are removed permanently.</>
              ) : (
                <>Selected orders will be moved to the archive. You can restore them later.</>
              )}
            </p>

            {isDelete && (
              <div
                className="rounded-lg p-2.5 mb-3 flex items-start gap-2"
                style={{
                  background: "rgba(224,85,85,0.10)",
                  border: "0.5px solid rgba(224,85,85,0.35)",
                }}
              >
                <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" style={{ color: "#e08585" }} />
                <span className="text-[11px]" style={{ color: "rgba(232,170,170,0.95)" }}>
                  Files are deleted from storage as well as the record. A job whose
                  project has no other work left removes that project too.
                </span>
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
              {selectedOrders.slice(0, 8).map(o => (
                <div key={o.id} className="truncate flex items-center gap-1.5">
                  <span style={{ color: "rgba(232,227,218,0.55)" }}>
                    {displayOrderNumber(o)} — {o.name}
                  </span>
                </div>
              ))}
              {selectedOrders.length > 8 && (
                <div className="italic">…and {selectedOrders.length - 8} more</div>
              )}
            </div>

            {isDelete && (
              <div className="mb-4">
                <p className="text-[11px] mb-1.5 uppercase tracking-widest" style={{ color: "rgba(224,85,85,0.85)" }}>
                  Type DELETE to confirm
                </p>
                <input
                  ref={confirmInputRef}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmWord}
                  onChange={(e) => setConfirmWord(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && confirmWord.trim().toUpperCase() === "DELETE") execute();
                  }}
                  placeholder="DELETE"
                  className="w-full px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "0.5px solid rgba(255,255,255,0.18)",
                    color: "#f0ece4",
                    fontSize: "16px",
                  }}
                />
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
                disabled={working || (isDelete && confirmWord.trim().toUpperCase() !== "DELETE")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                style={isDelete ? {
                  background: "rgba(224,85,85,0.20)",
                  border: "0.5px solid rgba(224,85,85,0.75)",
                  color: "#e89090",
                } : {
                  background: "rgba(86,100,72,0.30)",
                  border: "0.5px solid rgba(86,100,72,0.85)",
                  color: "#a8dd80",
                }}
              >
                {working && <Loader2 className="w-3 h-3 animate-spin" />}
                {isDelete ? `Delete ${count}` : `Archive ${count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
