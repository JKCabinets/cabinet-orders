"use client";

import { Download, Check, X, AlertTriangle } from "lucide-react";
import type { Order } from "@/lib/data";
import { useAckStatus } from "@/lib/ackStatus";

/**
 * Per-vendor PDF export pills for an order, each paired with a reconciliation
 * status icon (green check / red X) once an acknowledgment has been submitted
 * for that vendor. Reads the shared ack-status cache (one /vendors fetch per
 * order backs the row and the modal). Renders nothing until the order is
 * claimed (or past New) and at least one vendor resolves.
 *
 * When an order has moved past New while its latest ack is still red, it also
 * shows a small "Manually pushed" badge — a derived flag (no schema change)
 * so management can see a discrepancy was overridden, all the way through the
 * pipeline. Used in both the table row and the modal header.
 */
export function VendorExportPills({ order }: { order: Order }) {
  const eligible = order.stage !== "New" || !!order.claimed_by;
  const status = useAckStatus(order.id, eligible);
  const manuallyPushed = order.stage !== "New" && status.anyRed;
  const needsReview = !!order.needs_review;

  // Render when there are vendor pills OR a needs-review flag. The
  // needs-review badge must show even on New/unclaimed orders, where the
  // vendor pills are still gated.
  if (!needsReview && (!eligible || status.vendors.length === 0)) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {status.vendors.map((v) => {
        const label = v.replace(/\s+Cabinetry$/i, "");
        const verdict = status.ackByVendor[v]?.verdict ?? null;
        return (
          <span key={v} className="inline-flex items-center gap-1">
            <a
              href={"/api/orders/" + encodeURIComponent(order.id) + "/export?vendor=" + encodeURIComponent(v)}
              target="_blank"
              rel="noopener noreferrer"
              title={"Export the " + v + " order PDF"}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/85 hover:bg-white/8"
            >
              <Download className="w-3 h-3" />
              {label} PDF
            </a>
            {verdict === "green" && (
              <Check className="w-3.5 h-3.5" style={{ color: "#8fbe70" }} aria-label={label + " acknowledgment matched"} />
            )}
            {verdict === "red" && (
              <X className="w-3.5 h-3.5" style={{ color: "#e89090" }} aria-label={label + " acknowledgment has discrepancies"} />
            )}
          </span>
        );
      })}

      {manuallyPushed && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-medium bg-[rgba(201,112,112,0.14)] border border-[rgba(201,112,112,0.45)] text-[#e89090]"
          title="Entered with unresolved acknowledgment discrepancies"
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          Manually pushed
        </span>
      )}

      {needsReview && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-medium bg-[rgba(224,168,72,0.14)] border border-[rgba(224,168,72,0.45)] text-[#e8b866]"
          title="One or more lines need review — open the order for details"
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          Needs review
        </span>
      )}
    </div>
  );
}
