"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, Loader2, Check, X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import type { ReconcileResult } from "@/lib/reconcile";
import { useToast } from "./Toast";

type AckSummary = { verdict: "green" | "red"; uploaded_at: string; result: ReconcileResult };
type VendorsResponse = { vendors: string[]; ackByVendor: Record<string, AckSummary | null> };

interface AcknowledgmentPanelProps {
  orderId: string;
  /** Same gate the export pills use: claimed, or past New. */
  eligible: boolean;
  /**
   * Called after an upload comes back green AND every vendor on the order now
   * has a green ack. The modal wires this to moveStage(order, "Entered") so a
   * fully-reconciled order auto-advances. No-op if the order isn't in New.
   */
  onAllVendorsGreen?: () => void;
}

const FIELD_LABEL: Record<string, string> = { name: "Name", address: "Shipping address" };

function lineIssue(status: string, orderQty: number | null, ackQty: number | null): string {
  if (status === "qty_mismatch") return `ordered ${orderQty}, acknowledged ${ackQty}`;
  if (status === "missing_from_ack") return "on the order, missing from the acknowledgment";
  if (status === "extra_in_ack") return "on the acknowledgment, not on the order";
  return status;
}

function discrepancyCount(r: ReconcileResult): number {
  return r.fields.filter((f) => !f.matched).length + r.lines.filter((l) => l.status !== "match").length;
}

function allGreen(data: VendorsResponse): boolean {
  return data.vendors.length > 0 && data.vendors.every((v) => data.ackByVendor[v]?.verdict === "green");
}

/**
 * Per-vendor acknowledgment reconciliation, shown in the order modal.
 *
 * Lists each Waypoint-family vendor on the order with its latest reconciliation
 * status (green = matched, red = discrepancies), a submit / resubmit control
 * that uploads the vendor's .xlsx acknowledgment to the reconcile endpoint, and
 * — on red — an expandable breakdown of exactly which fields and line items are
 * off. Only Waypoint reconciliation exists today, so non-Waypoint vendors are
 * not shown here yet. Self-contained: fetches its own status and refreshes
 * after each upload. When an upload turns the whole order green, it calls
 * onAllVendorsGreen so the modal can auto-advance to Entered.
 */
export function AcknowledgmentPanel({ orderId, eligible, onAllVendorsGreen }: AcknowledgmentPanelProps) {
  const { showToast } = useToast();
  const [vendors, setVendors] = useState<string[]>([]);
  const [ackByVendor, setAckByVendor] = useState<Record<string, AckSummary | null>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingVendor, setUploadingVendor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingVendorRef = useRef<string | null>(null);

  async function load(): Promise<VendorsResponse | null> {
    try {
      const res = await fetch("/api/orders/" + encodeURIComponent(orderId) + "/vendors");
      if (!res.ok) return null;
      const data = await res.json();
      const next: VendorsResponse = {
        vendors: Array.isArray(data.vendors) ? data.vendors : [],
        ackByVendor: (data.ackByVendor ?? {}) as Record<string, AckSummary | null>,
      };
      setVendors(next.vendors);
      setAckByVendor(next.ackByVendor);
      return next;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!eligible) { setLoading(false); return; }
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, eligible]);

  function triggerUpload(vendor: string) {
    pendingVendorRef.current = vendor;
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
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
      const fresh = await load(); // refresh to the new latest row
      if (verdict === "green" && fresh && allGreen(fresh)) {
        showToast("Acknowledgment matched — moving order to Entered", { kind: "success" });
        onAllVendorsGreen?.();
      } else if (verdict === "green") {
        showToast("Acknowledgment matched", { kind: "success" });
      } else {
        showToast("Acknowledgment has discrepancies — see details", { kind: "warn" });
      }
    } catch {
      showToast("Upload failed", { kind: "error" });
    } finally {
      setUploadingVendor(null);
    }
  }

  if (!eligible) return null;

  // Only Waypoint reconciliation exists today.
  const ackVendors = vendors.filter((v) => /waypoint/i.test(v));
  if (!loading && ackVendors.length === 0) return null;

  return (
    <div className="px-6 py-5 border-b border-white/10">
      <p className="text-[10px] uppercase tracking-[0.16em] text-cream/50 font-medium mb-3">
        Acknowledgments
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-[rgba(232,227,218,0.30)]" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ackVendors.map((v) => {
            const label = v.replace(/\s+Cabinetry$/i, "");
            const ack = ackByVendor[v] ?? null;
            const isUploading = uploadingVendor === v;
            const isOpen = !!expanded[v];
            const count = ack && ack.verdict === "red" ? discrepancyCount(ack.result) : 0;

            return (
              <div
                key={v}
                className="px-3 py-2.5 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {ack?.verdict === "green" && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#8fbe70" }} />}
                    {ack?.verdict === "red" && <X className="w-4 h-4 flex-shrink-0" style={{ color: "#e89090" }} />}
                    <div className="min-w-0">
                      <p className="text-xs text-cream/90 truncate">{label}</p>
                      <p className="text-[10px] text-cream/40">
                        {!ack
                          ? "No acknowledgment submitted yet"
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
                              <span style={{ color: "#e89090" }}>{lineIssue(l.status, l.order_qty, l.ack_qty)}</span>
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
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
