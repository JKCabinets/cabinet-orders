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

/** The file's standing, from the panel's cached status: null when it is history. */
export function useAckFileState(orderId: string, attachmentId: number): "in_use" | "out_of_date" | "didnt_match" | null {
  const status = useAckStatus(orderId, true);
  const latest = Object.values(status.ackByVendor).find((a) => a?.attachment_id === attachmentId);
  if (!latest) return null;
  return latest.verdict === "green" ? (latest.stale ? "out_of_date" : "in_use") : "didnt_match";
}

/**
 * Said in a delete's confirm when the file is the one IN USE (2026-10-28):
 * deleting it removes only the file. The verdict lives in the submission's row
 * -- the panel, the Next Action band and the Entered gate read that -- so the
 * order stands exactly as it was.
 */
export function AckInUseNote({ orderId, attachmentId }: { orderId: string; attachmentId: number }) {
  if (useAckFileState(orderId, attachmentId) !== "in_use") return null;
  return (
    <span className="text-[10px] text-cream/55 mr-1" title="The verdict stays with the submission; the Entered gate does not depend on the file.">
      In use: the verdict stays, only the file goes.
    </span>
  );
}

export function AckFileMark({ orderId, attachmentId }: { orderId: string; attachmentId: number }) {
  const state = useAckFileState(orderId, attachmentId);
  if (!state) return null;
  if (state === "in_use") {
    return (
      <span title="The acknowledgment this order is using" className={PILL}
        style={{ color: "#a9cf8f", background: "rgba(143,190,112,0.14)", borderColor: "rgba(143,190,112,0.40)" }}>
        <Check className="w-2.5 h-2.5" /> In use
      </span>
    );
  }
  if (state === "out_of_date") {
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
