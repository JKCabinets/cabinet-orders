"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Order } from "@/lib/data";
import type { AttentionEnrichment } from "@/lib/attention";

/**
 * The joined facts a screen's rows need, fetched once.
 *
 * ⚠ THIS IS THE MISSING CALLER. `attentionFor` has taken an `enrich` argument
 * since it was written, and nothing ever passed one -- so
 * `acknowledgment missing` and `receipt missing` were built, documented, and
 * unreachable. Not because the reasons were wrong, but because answering them
 * meant a query per row and nobody was going to make a work queue do that.
 *
 * `POST /api/orders/enrichment` answers for many rows in five queries. This
 * hook is the piece that calls it.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * ⚠ NO LOADING STATE IS EXPOSED, AND THAT IS THE DESIGN. A row whose
 * enrichment has not arrived reports UNKNOWN, and unknown produces no reason.
 * So a screen renders immediately with its row-only reasons and gains the two
 * join-backed ones a moment later. The alternative -- blocking the queue on a
 * fetch -- would make the whole board wait for a fact that concerns a handful
 * of rows.
 *
 * ⚠ IT NEVER REPORTS A REASON IT IS NOT SURE OF. On a failed fetch the map
 * stays empty, every row reads unknown, and the screen shows exactly what it
 * showed before this existed. A queue that invents work during an outage is
 * worse than one that misses some.
 */

/** Matches MAX_IDS in the route. Asking for more is refused there. */
const MAX_IDS = 300;

export function useOrderEnrichment(
  orders: Order[],
): (order: Order) => AttentionEnrichment | undefined {
  const [map, setMap] = useState<Record<string, AttentionEnrichment>>({});

  /**
   * ⚠ THE KEY IS THE SORTED ID LIST, NOT THE ARRAY IDENTITY. `allOrders` is a
   * new array on every store update -- a stage move, a realtime message, a
   * claim -- and keying on it would refetch on each one, which for a busy
   * board is a request per keystroke elsewhere in the app.
   *
   * Only the rows that CAN have a join-backed requirement are asked about.
   * Today that is cabinet groups: samples and hardware carry neither an
   * acknowledgment nor a delivery receipt, so including them would be a longer
   * `in` list for guaranteed-empty answers.
   */
  const key = useMemo(() => {
    return orders
      .filter((o) => !o.archived && o.type === "order")
      .map((o) => o.id)
      .sort()
      .slice(0, MAX_IDS)
      .join(",");
  }, [orders]);

  // Survives across renders so a stale response cannot overwrite a fresh one.
  const latest = useRef(0);

  useEffect(() => {
    if (!key) { setMap({}); return; }
    const ids = key.split(",");
    const ticket = ++latest.current;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/orders/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) return;
        const json = await res.json();
        // ⚠ Two guards, not one. `cancelled` covers unmount; the ticket covers
        // an earlier request landing AFTER a later one, which is what happens
        // when the board changes twice while the first fetch is in flight.
        if (cancelled || ticket !== latest.current) return;
        setMap(json.data ?? {});
      } catch {
        // Silent on purpose. See the header: no enrichment means no reasons,
        // never wrong ones, and a console error per board refresh during an
        // outage is noise on top of an outage.
      }
    })();

    return () => { cancelled = true; };
  }, [key]);

  return useMemo(() => (order: Order) => map[order.id], [map]);
}
