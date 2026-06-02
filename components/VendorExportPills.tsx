"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Order } from "@/lib/data";

/**
 * Per-vendor PDF export pills for an order. Self-contained: fetches the
 * order's distinct vendors and renders one pill per vendor, each linking to
 * the vendor-filtered export. Renders nothing until the order is claimed
 * (or has moved past New) and at least one vendor resolves.
 * Used in both the order table row and the order modal header.
 */
export function VendorExportPills({ order }: { order: Order }) {
  const eligible = order.stage !== "New" || !!order.claimed_by;
  const [vendors, setVendors] = useState<string[]>([]);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/orders/" + encodeURIComponent(order.id) + "/vendors");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setVendors(Array.isArray(data.vendors) ? data.vendors : []);
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
        return (
          <a
            key={v}
            href={"/api/orders/" + encodeURIComponent(order.id) + "/export?vendor=" + encodeURIComponent(v)}
            target="_blank"
            rel="noopener noreferrer"
            title={"Export the " + v + " order PDF"}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/85 hover:bg-white/8"
          >
            <Download className="w-3 h-3" />
            {label} PDF
          </a>
        );
      })}
    </div>
  );
}
