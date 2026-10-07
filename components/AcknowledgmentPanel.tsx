"use client";

import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Upload, Loader2, Check, X, AlertTriangle } from "lucide-react";
import type { ReconcileResult } from "@/lib/reconcile";
import { useToast } from "./Toast";
import { useAckStatus, invalidateAck } from "@/lib/ackStatus";
import { invalidateEnrichment } from "@/lib/useOrderEnrichment";
import { buildDiscrepancyMessage } from "./OrderEntryActions";

export interface AcknowledgmentPanelHandle {
  openFilePicker: () => void;
}

interface AcknowledgmentPanelProps {
  orderId: string;
  orderName: string;
  /** Same gate the export pills use: claimed, or past New. */
  eligible: boolean;
  /**
   * ⚠ onAdvance REMOVED 2026-08-27. "Move to Entered" lives in the modal's
   * next-action slot now: a green acknowledgment is what makes the group
   * Entered, so the control belongs where the action is, and having it here too
   * put two controls for one transition on the same screen.
   */
  /** Advance to Entered overriding red discrepancies (manual push). */
  onAdvanceOverride?: () => void;
  /**
   * Show the acknowledgment and its discrepancies, offer nothing. Set for an
   * ARCHIVED row. It folds into `canAct` below rather than adding a second
   * gate, so submit, resubmit and Manual Push all follow one answer.
   *
   * Defaults to false, so every existing caller is unchanged.
   */
  readOnly?: boolean;
  /**
   * ⚠ The next-action panel already offers the upload for this stage. Set
   * where lib/requirements lists `ack_or_attachment` for the row -- New, on a
   * cabinet flow -- so Submit does not render twice on one screen. Past New
   * the requirement is gone and the Resubmit here is the ONLY way to refresh
   * a stale acknowledgment, so it stays. The picker itself is always here;
   * the panel's button opens it through openFilePicker().
   */
  uploadOfferedElsewhere?: boolean;
  /**
   * False when another member holds the claim and the viewer has not
   * unlocked the order. Every write this panel can make -- the per-vendor
   * upload and the Manual Push -- is refused by the server in that state
   * (409 `claimed_by_other`), so offering them produces a button that
   * fails on click.
   *
   * ⚠ THE RECONCILIATION STILL RENDERS. Vendor rows, statuses and
   * discrepancies are exactly what somebody who cannot act needs to see:
   * it is how they tell the owner rather than starting a second copy of
   * the work. Only the controls go.
   */
  canAct?: boolean;
  /** Whose claim it is, named where the buttons were. */
  lockedNote?: string;
  /**
   * Opens the order's Full Order tab, where each discrepancy is told on its own
   * line (Garrett, 2026-10-07). The panel no longer lists them itself.
   */
  onViewDiscrepancies?: () => void;
}

// FIELD_LABEL went with the breakdown (2026-10-07): Full Order shows the fields now.


function discrepancyCount(r: ReconcileResult): number {
  return r.fields.filter((f) => !f.matched).length + r.lines.filter((l) => l.status !== "match").length;
}

/**
 * Per-vendor acknowledgment reconciliation inside the order modal. Lists each
 * Waypoint-family vendor with its latest verdict (green check / red X), a
 * submit / resubmit control that uploads the vendor's .xlsx to the reconcile
 * endpoint, and — on red — an expandable breakdown of the exact field/line
 * mismatches. Reads the shared ack-status cache and refreshes it after each
 * upload so the table row updates in lockstep.
 *
 * When any vendor is red or stale it offers Manual Push Order behind a confirm
 * that lists the discrepancies. The advance itself lives in the modal's
 * next-action panel. Exposes openFilePicker() so the row's Submit and the
 * panel's Upload acknowledgment can pop the file dialog. Only Waypoint
 * reconciliation exists today.
 */
export const AcknowledgmentPanel = forwardRef<AcknowledgmentPanelHandle, AcknowledgmentPanelProps>(
  function AcknowledgmentPanel({
    orderId, orderName, eligible, onAdvanceOverride,
    uploadOfferedElsewhere = false, canAct: canActProp = true, lockedNote,
    readOnly = false, onViewDiscrepancies,
  }, ref) {
    // ⚠ ONE GATE, NOT TWO. readOnly folds into canAct so submit, resubmit and
    // Manual Push all follow a single answer -- a second condition beside it is
    // how one of the three ends up still offered.
    const canAct = canActProp && !readOnly;
    const { showToast } = useToast();
    const status = useAckStatus(orderId, eligible);
    const [uploadingVendor, setUploadingVendor] = useState<string | null>(null);
    // No per-vendor "expanded" state since 2026-10-07: the breakdown moved to Full Order.
    const [pushing, setPushing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingVendorRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      openFilePicker: () => { pendingVendorRef.current = null; fileInputRef.current?.click(); },
    }));

    function triggerUpload(vendor: string) {
      pendingVendorRef.current = vendor;
      fileInputRef.current?.click();
    }

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) {
        showToast("Only .xlsx acknowledgment files are accepted", { kind: "error" });
        return;
      }
      const vendor = pendingVendorRef.current ?? "Waypoint Cabinetry";

      setUploadingVendor(vendor);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/orders/" + encodeURIComponent(orderId) + "/acknowledgment", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error ?? "Upload failed", { kind: "error" });
          return;
        }
        const verdict: string | undefined = data?.result?.verdict;
        invalidateAck(orderId); // refresh row + modal from the new latest row
        invalidateEnrichment(); // and the next-action checklist, which reads the batch endpoint
        showToast(
          verdict === "green" ? "Acknowledgment matched" : "Acknowledgment has discrepancies — see details",
          { kind: verdict === "green" ? "success" : "warn" }
        );
      } catch {
        showToast("Upload failed", { kind: "error" });
      } finally {
        setUploadingVendor(null);
      }
    }

    function handleManualPush() {
      if (typeof window !== "undefined") {
        const msg = buildDiscrepancyMessage(orderName, status.ackByVendor);
        if (!window.confirm(msg)) return;
      }
      setPushing(true);
      onAdvanceOverride?.();
    }

    if (!eligible) return null;

    const ackVendors = status.vendors.filter((v) => /waypoint/i.test(v));
    if (!status.loading && ackVendors.length === 0) return null;

    return (
      <div className="px-6 py-5 border-b border-white/10">
        <p className="text-[10px] uppercase tracking-[0.16em] text-cream/50 font-medium mb-3">
          Acknowledgments
        </p>

        {status.loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-[rgba(232,227,218,0.30)]" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {ackVendors.map((v) => {
              const label = v.replace(/\s+Cabinetry$/i, "");
              const ack = status.ackByVendor[v] ?? null;
              const isUploading = uploadingVendor === v;
              // (isOpen went with the breakdown, 2026-10-07.)
              const count = ack && ack.verdict === "red" ? discrepancyCount(ack.result) : 0;

              return (
                <div key={v} className="px-3 py-2.5 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* ⚠ THREE STATES, NOT TWO. A stale ack is neither
                          matched nor mismatched -- it was matched, against an
                          order that has since changed. Rendering it as a green
                          check while the gate silently refuses to advance is
                          the exact failure this codebase keeps producing. */}
                      {ack?.verdict === "green" && !ack.stale && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#8fbe70" }} />}
                      {ack?.verdict === "red" && <X className="w-4 h-4 flex-shrink-0" style={{ color: "#e89090" }} />}
                      {ack?.verdict === "green" && ack.stale && <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#e8b56a" }} />}
                      <div className="min-w-0">
                        <p className="text-xs text-cream/90 truncate">{label}</p>
                        <p className="text-[10px] text-cream/40">
                          {!ack
                            ? "No acknowledgment submitted yet"
                            : ack.stale
                            ? "Matched, but the order has changed since — resubmit"
                            : ack.verdict === "green"
                            ? "Matched"
                            : `${count} discrepanc${count === 1 ? "y" : "ies"}`}
                          {ack && (
                            <> · {new Date(ack.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Hidden where the next-action panel carries the same
                        control, except mid-upload: the spinner is the only
                        feedback that the panel's button did anything. */}
                    {canAct && (isUploading || !uploadOfferedElsewhere) && (
                    <button
                      onClick={() => triggerUpload(v)}
                      disabled={isUploading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cream/18 bg-white/4 text-[11px] uppercase tracking-wider text-cream/85 hover:bg-white/8 hover:border-terracotta/40 transition-all disabled:opacity-50 flex-shrink-0"
                    >
                      {isUploading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Checking…</>
                      ) : (
                        <><Upload className="w-3 h-3" /> {ack ? "Resubmit" : "Submit"}</>
                      )}
                    </button>
                    )}
                  </div>

                  {/* ⚠ A PILL TO THE FULL ORDER TAB, NOT A LIST (Garrett, 2026-10-07).
                      The breakdown that unfolded here now lives on the lines it
                      is about: Full Order marks each discrepancy on its own line,
                      as the vendor PDF does. The count above says how many. */}
                  {ack?.verdict === "red" && onViewDiscrepancies && (
                    <div className="mt-2">
                      <button
                        onClick={onViewDiscrepancies}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-[rgba(201,112,112,0.12)] border border-[rgba(201,112,112,0.45)] text-[#e89090] hover:bg-[rgba(201,112,112,0.20)]"
                      >
                        <AlertTriangle className="w-3 h-3" /> View discrepancies
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ⚠ "Entry Complete" MOVED to the modal's next-action slot on
                2026-08-27, as "Move to Entered". It sat here beside an ENTERED
                button in the panel above it -- one transition, two controls, and
                the working one was the further from where anyone was looking.

                Manual Push stays: an override belongs next to the discrepancies
                it overrides -- their count and the pill to them, here. */}
            {/* ⚠ anyStale IS HERE ON PURPOSE. Gated on anyRed alone, a stale
                green rendered NEITHER button -- allGreen false, anyRed false --
                leaving a blocked order with no override and no explanation. */}
            {/* ⚠ HIDDEN, NOT DISABLED. A greyed-out Manual Push beside a red
                discrepancy sends somebody hunting for why; naming the owner
                answers the question the button would have raised. */}
            {!canAct && (
              <p className="mt-1 text-[11px] text-cream/45 leading-snug">{lockedNote}</p>
            )}
            {canAct && !status.allGreen && (status.anyRed || status.anyStale) && (
              <button
                onClick={handleManualPush}
                disabled={pushing}
                className="mt-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[rgba(201,112,112,0.5)] bg-[rgba(201,112,112,0.16)] text-[#e89090] text-[11px] uppercase tracking-wider font-medium hover:bg-[rgba(201,112,112,0.26)] transition-all disabled:opacity-50"
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Manual Push Order
              </button>
            )}
          </div>
        )}

        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
      </div>
    );
  }
);
