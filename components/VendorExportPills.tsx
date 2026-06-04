"use client";

import { useEffect, useState } from "react";
import { Download, Check, X } from "lucide-react";
import type { Order } from "@/lib/data";

type AckVerdict = "green" | "red";

/**
 * Per-vendor PDF export pills for an order, each now paired with a
 * reconciliation status icon (green check / red X) when an acknowledgment has
 * been submitted for that vendor. Self-contained: fetches the order's distinct
 * vendors plus the latest ack verdict per vendor, and renders one pill per
 * vendor. Renders nothing until the order is claimed (or has moved past New)
 * and at least one vendor resolves.
 * Used in both the order table row and the order modal header.
 */
export function VendorExportPills({ order }: { order: Order }) {
  const eligible = order.stage !== "New" || !!order.claimed_by;
  const [vendors, setVendors] = useState<string[]>([]);
  const [ackByVendor, setAckByVendor] = useState<Record<string, AckVerdict | null>>({});

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/orders/" + encodeURIComponent(order.id) + "/vendors");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setVendors(Array.isArray(data.vendors) ? data.vendors : []);
        const verdicts: Record<string, AckVerdict | null> = {};
        const raw = data.ackByVendor ?? {};
        for (const v of Object.keys(raw)) verdicts[v] = raw[v]?.verdict ?? null;
        setAckByVendor(verdicts);
      } catch {
        /* silent — pills just won't render */
      }
    })();
    return () => { cancelled = true; };
  }, [order.id, eligible]);

  if (!eligible || vendors.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {vendors.map((v) => {
        const label = v.replace(/\s+Cabinetry$/i, "");
        const verdict = ackByVendor[v];
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
    </div>
  );
}
