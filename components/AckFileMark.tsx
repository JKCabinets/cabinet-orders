"use client";

/**
 * Which kept acknowledgment the order is USING (2026-10-28, Garrett): "mark the
 * one that's currently being used by the order with a green check and the other
 * file can be deleted at that point. This keeps a history while also giving the
 * option to clean up."
 *
 * The file in use is the one linked to its vendor's LATEST submission -- the
 * submission the Acknowledgments panel, the Next Action band and the Entered
 * gate all judge by. The same three signs as that panel, so the two agree:
 *   ✓ In use        matched, and current with the order
 *   ⚠ Out of date   matched, but the order has changed since
 *   ✕ Didn't match  the latest submission failed; the next one replaces it
 * Every other kept acknowledgment is history, unmarked, deletable like any file.
 *
 * Reads the SAME cached status as the panel (useAckStatus): no request of its own.
 */
import { Check, X, AlertTriangle } from "lucide-react";
import { useAckStatus } from "@/lib/ackStatus";

const PILL = "flex-shrink-0 inline-flex items-center gap-1 text-[8px] uppercase tracking-wider px-1.5 py-px rounded-full border";

export function AckFileMark({ orderId, attachmentId }: { orderId: string; attachmentId: number }) {
  const status = useAckStatus(orderId, true);
  const latest = Object.values(status.ackByVendor).find((a) => a?.attachment_id === attachmentId);
  if (!latest) return null;
  if (latest.verdict === "green" && !latest.stale) {
    return (
      <span title="The acknowledgment this order is using" className={PILL}
        style={{ color: "#a9cf8f", background: "rgba(143,190,112,0.14)", borderColor: "rgba(143,190,112,0.40)" }}>
        <Check className="w-2.5 h-2.5" /> In use
      </span>
    );
  }
  if (latest.verdict === "green") {
    return (
      <span title="It matched, but the order has changed since: submit a new one" className={PILL}
        style={{ color: "#e8b56a", background: "rgba(232,181,106,0.12)", borderColor: "rgba(232,181,106,0.40)" }}>
        <AlertTriangle className="w-2.5 h-2.5" /> Out of date
      </span>
    );
  }
  return (
    <span title="The latest submission, which did not match. The next submission replaces it." className={PILL}
      style={{ color: "#e89090", background: "rgba(232,144,144,0.12)", borderColor: "rgba(232,144,144,0.40)" }}>
      <X className="w-2.5 h-2.5" /> Didn&apos;t match
    </span>
  );
}
