"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { Order } from "@/lib/data";
import { useStore } from "@/lib/store";

/**
 * Closing a warranty claim (Garrett, 2026-10-13): Approved or Denied, never
 * deleted. Replaces Archive and Delete on a claim; see
 * app/api/orders/[id]/close.
 */

/** "Closed · Approved" / "Closed · Denied", with the reason when asked. */
export function ClaimOutcomePill({ order, withReason = false }: { order: Pick<Order, "claim_outcome" | "closed_reason" | "closed_by">; withReason?: boolean }) {
  if (!order.claim_outcome) return null;
  const denied = order.claim_outcome === "denied";
  const style = denied
    ? { color: "#e89090", background: "rgba(201,112,112,0.12)", border: "0.5px solid rgba(201,112,112,0.45)" }
    : { color: "#9cc9a0", background: "rgba(120,170,125,0.12)", border: "0.5px solid rgba(120,170,125,0.45)" };
  return (
    <span className="inline-flex flex-col gap-0.5 align-middle">
      <span className="inline-flex items-center gap-1 ml-2 px-2 py-px rounded-full text-[9px] uppercase tracking-wider font-medium" style={style}
        title={[order.closed_by ? `Closed by ${order.closed_by}` : "", order.closed_reason ?? ""].filter(Boolean).join(": ")}>
        {denied ? <XCircle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
        Closed {"\u00b7"} {denied ? "Denied" : "Approved"}
      </span>
      {withReason && order.closed_reason && (
        <span className="ml-2 text-[10px] text-cream/55 italic max-w-[28rem] truncate">{order.closed_reason}</span>
      )}
    </span>
  );
}

/** The button and its dialog. Calls onClosed after a successful close. */
export function ClaimCloseButton({ order, onClosed }: { order: Order; onClosed: () => void }) {
  const { closeClaim } = useStore();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReason = outcome === "denied" && !reason.trim();

  async function submit() {
    if (!outcome || needsReason) return;
    setBusy(true); setError(null);
    const r = await closeClaim(order.id, outcome, reason.trim());
    setBusy(false);
    if (!r.ok) { setError(r.message ?? r.error ?? "Could not close the claim."); return; }
    setOpen(false);
    onClosed();
  }

  const pill = (value: "approved" | "denied", label: string) => (
    <button type="button" onClick={() => setOutcome(value)}
      className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all"
      style={outcome === value
        ? (value === "denied"
          ? { background: "rgba(201,112,112,0.22)", border: "0.5px solid rgba(201,112,112,0.7)", color: "#f0b0b0" }
          : { background: "rgba(120,170,125,0.22)", border: "0.5px solid rgba(120,170,125,0.7)", color: "#b8e0bc" })
        : { background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.18)", color: "rgba(232,227,218,0.75)" }}>
      {label}
    </button>
  );

  return (
    <>
      <button onClick={() => { setOpen(true); setOutcome(null); setReason(""); setError(null); }}
        title="Close this claim as approved or denied"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/8 border border-white/15 text-cream/70 hover:bg-white/12 hover:text-cream">
        Close claim
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onClick={() => !busy && setOpen(false)}>
          <div className="w-[26rem] max-w-[92vw] rounded-brand p-5" onClick={(e) => e.stopPropagation()}
            style={{ background: "#2e3a40", border: "0.5px solid rgba(255,255,255,0.15)" }}>
            <p className="text-[13px] text-cream/90 mb-1">Close claim {order.id}</p>
            <p className="text-[11px] text-cream/55 mb-3">It moves to the archive with its details and notes. Restoring it reopens it.</p>
            <div className="flex gap-2 mb-3">{pill("approved", "Approved")}{pill("denied", "Denied")}</div>
            {outcome === "denied" && (
              <p className="flex items-start gap-1.5 text-[11px] mb-2" style={{ color: "#e8b866" }}>
                <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                Denying removes the claim&apos;s photos and files for good. Its details, notes and this reason are kept.
              </p>
            )}
            {outcome && (
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000}
                placeholder={outcome === "denied" ? "Why it is denied (required)" : "A note (optional)"}
                className="w-full rounded-lg px-3 py-2 text-[12px] text-cream/90 bg-white/5 border border-white/15 focus:outline-none focus:border-cream/30 mb-3" />
            )}
            {error && <p className="text-[11px] mb-2" style={{ color: "#e89090" }}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider text-cream/60 hover:text-cream">Cancel</button>
              <button onClick={() => { void submit(); }} disabled={!outcome || needsReason || busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider bg-white/10 border border-white/20 text-cream/90 hover:bg-white/15 disabled:opacity-40">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                {outcome === "denied" ? "Close as Denied" : outcome === "approved" ? "Close as Approved" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
