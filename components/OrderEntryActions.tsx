"use client";

import { useState } from "react";
import { Upload, Check, AlertTriangle } from "lucide-react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store";
import { useToast } from "./Toast";
import { useAckStatus, type AckSummary } from "@/lib/ackStatus";
import type { ReconcileResult } from "@/lib/reconcile";
import type { Order } from "@/lib/data";

function lineIssue(status: string, orderQty: number | null, ackQty: number | null): string {
  if (status === "qty_mismatch") return `ordered ${orderQty}, acknowledged ${ackQty}`;
  if (status === "missing_from_ack") return "missing from the acknowledgment";
  if (status === "extra_in_ack") return "on the acknowledgment, not on the order";
  return status;
}

/** Build the confirm-dialog text listing exactly what didn't match. */
export function buildDiscrepancyMessage(
  orderName: string,
  ackByVendor: Record<string, AckSummary | null>
): string {
  const lines: string[] = [];
  for (const [vendor, ack] of Object.entries(ackByVendor)) {
    if (!ack || ack.verdict !== "red") continue;
    const r: ReconcileResult = ack.result;
    for (const f of r.fields.filter((x) => !x.matched)) {
      lines.push(`• ${f.field === "name" ? "Name" : f.field === "address" ? "Shipping address" : f.field}: order "${f.order_value || "—"}" vs ack "${f.ack_value || "—"}"`);
    }
    for (const l of r.lines.filter((x) => x.status !== "match")) {
      lines.push(`• ${l.composite_sku} — ${lineIssue(l.status, l.order_qty, l.ack_qty)}`);
    }
  }
  return (
    `"${orderName}" has acknowledgment discrepancies:\n\n` +
    lines.join("\n") +
    `\n\nThis order will be marked Entered and flagged as manually pushed. Continue?`
  );
}

const PILL =
  "px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all border";

/**
 * Row actions for a claimed standard Shopify order in New: drives the
 * acknowledgment entry flow. No ack yet → Submit order (opens the modal, which
 * auto-opens the .xlsx picker). All green → Entry Complete (advances to
 * Entered). Any red → Manual Push Order (confirm dialog listing the
 * discrepancies, then advances with override). Custom/Manual orders never
 * render this — they keep the legacy Mark Entered button.
 */
export function OrderEntryActions({
  order,
  mobile = false,
  onOpenModal,
}: {
  order: Order;
  mobile?: boolean;
  onOpenModal?: (o: Order) => void;
}) {
  const { data: session } = useSession();
  const { moveStage } = useStore();
  const { showToast } = useToast();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? undefined;
  const status = useAckStatus(order.id, true);
  const [busy, setBusy] = useState(false);

  async function advance(override: boolean) {
    setBusy(true);
    try {
      const res = await moveStage(order.id, "Entered", currentUserId, undefined, override);
      if (!res.ok) {
        showToast(res.error ?? "Could not move order to Entered", { kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  function onEntryComplete() {
    void advance(false);
  }

  function onManualPush() {
    if (typeof window !== "undefined") {
      const msg = buildDiscrepancyMessage(order.name, status.ackByVendor);
      if (!window.confirm(msg)) return;
    }
    void advance(true);
  }

  if (status.loading) {
    return <span className="text-[10px] text-cream/40">…</span>;
  }

  if (status.allGreen) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onEntryComplete(); }}
        disabled={busy}
        className={`${PILL} bg-[rgba(143,190,112,0.18)] border-[rgba(143,190,112,0.5)] text-[#a0cc7a] hover:bg-[rgba(143,190,112,0.28)] disabled:opacity-50`}
        title="Acknowledgment matched — mark this order Entered"
      >
        <span className="inline-flex items-center gap-1">
          <Check className="w-3 h-3" /> {busy ? "…" : mobile ? "Complete" : "Entry Complete"}
        </span>
      </button>
    );
  }

  if (status.anyRed) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onManualPush(); }}
        disabled={busy}
        className={`${PILL} bg-[rgba(201,112,112,0.16)] border-[rgba(201,112,112,0.5)] text-[#e89090] hover:bg-[rgba(201,112,112,0.26)] disabled:opacity-50`}
        title="Acknowledgment has discrepancies — review before pushing"
      >
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {busy ? "…" : mobile ? "Push" : "Manual Push Order"}
        </span>
      </button>
    );
  }

  // No acknowledgment yet → Submit order (opens modal + picker)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpenModal?.(order); }}
      disabled={busy}
      className={`${PILL} bg-terracotta/20 border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-50`}
      title="Upload the manufacturer's .xlsx acknowledgment"
    >
      <span className="inline-flex items-center gap-1">
        <Upload className="w-3 h-3" /> {mobile ? "Submit" : "Submit order"}
      </span>
    </button>
  );
}
