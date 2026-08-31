"use client";

import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { describeLineIssue } from "@/lib/reconcile";
import { Upload, Loader2, Check, X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ReconcileResult } from "@/lib/reconcile";
import { useToast } from "./Toast";
import { useAckStatus, invalidateAck } from "@/lib/ackStatus";
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
}

const FIELD_LABEL: Record<string, string> = { name: "Name", address: "Shipping address" };


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
 * When all vendors are green it offers Entry Complete (advance to Entered);
 * when any are red it offers Manual Push Order behind a confirm that lists the
 * discrepancies. Exposes openFilePicker() so the row's Submit can pop the file
 * dialog on open. Only Waypoint reconciliation exists today.
 */
export const AcknowledgmentPanel = forwardRef<AcknowledgmentPanelHandle, AcknowledgmentPanelProps>(
  function AcknowledgmentPanel({ orderId, orderName, eligible, onAdvanceOverride }, ref) {
    const { showToast } = useToast();
    const status = useAckStatus(orderId, eligible);
    const [uploadingVendor, setUploadingVendor] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
              const isOpen = !!expanded[v];
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
                  </div>

                  {ack?.verdict === "red" && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpanded((p) => ({ ...p, [v]: !p[v] }))}
                        className="flex items-center gap-1 text-[11px] text-cream/60 hover:text-cream/90 transition-colors"
                      >
                        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        {isOpen ? "Hide details" : "View details"}
                      </button>

                      {isOpen && (
                        <div className="mt-2 flex flex-col gap-1.5 pl-1">
                          {ack.result.fields.filter((f) => !f.matched).map((f) => (
                            <div key={f.field} className="flex items-start gap-2 text-[11px]">
                              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "#e89090" }} />
                              <p className="text-cream/75">
                                <span className="text-cream/90">{FIELD_LABEL[f.field] ?? f.field}</span>
                                {" — order: "}
                                <span className="text-cream/90">{f.order_value || "—"}</span>
                                {" · acknowledgment: "}
                                <span style={{ color: "#e89090" }}>{f.ack_value || "—"}</span>
                              </p>
                            </div>
                          ))}
                          {ack.result.lines.filter((l) => l.status !== "match").map((l) => (
                            <div key={l.composite_sku} className="flex items-start gap-2 text-[11px]">
                              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "#e89090" }} />
                              <p className="text-cream/75">
                                <span className="font-mono text-cream/90">{l.composite_sku}</span>
                                {" — "}
                                <span style={{ color: "#e89090" }}>{describeLineIssue(l)}</span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ⚠ "Entry Complete" MOVED to the modal's next-action slot on
                2026-08-27, as "Move to Entered". It sat here beside an ENTERED
                button in the panel above it -- one transition, two controls, and
                the working one was the further from where anyone was looking.

                Manual Push stays: an override belongs next to the discrepancy
                breakdown it is overriding, which is only rendered here. */}
            {/* ⚠ anyStale IS HERE ON PURPOSE. Gated on anyRed alone, a stale
                green rendered NEITHER button -- allGreen false, anyRed false --
                leaving a blocked order with no override and no explanation. */}
            {!status.allGreen && (status.anyRed || status.anyStale) && (
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
