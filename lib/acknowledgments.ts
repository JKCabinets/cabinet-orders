import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import { ackIsStale } from "@/lib/ackFingerprint";
import type { SkuItem } from "@/lib/skuDecoder";
import type { ReconcileResult } from "@/lib/reconcile";

/** The order fields a fingerprint is computed over. */
export type AckOrderSnapshot = {
  name: string | null;
  ship_to: string | null;
  sku_items: SkuItem[];
};

export type AckSummary = {
  verdict: "green" | "red";
  uploaded_at: string;
  result: ReconcileResult;
  /**
   * ⚠ The verdict was about a set of lines that has since changed. A stale
   * green is NOT a green: it confirmed an order that no longer exists. False
   * when there is no basis to judge -- see ackIsStale.
   */
  stale: boolean;
};

/**
 * Latest acknowledgment per vendor for an order (newest row per vendor wins;
 * full history is preserved in order_acknowledgments). Scoped to the supplied
 * vendor list — vendors with no ack map to null. Shared by the /vendors
 * endpoint (for display) and the PATCH gate (for the all-green check) so the
 * two can't drift.
 */
/** One row of order_acknowledgments, as the queries below select it. */
export type AckRow = {
  vendor: string;
  verdict: "green" | "red";
  uploaded_at: string;
  result_json: ReconcileResult;
  lines_fingerprint: string | null;
};

/** The select list, in one place, so the batch query cannot drift from this one. */
export const ACK_SELECT =
  "vendor, verdict, uploaded_at, result_json, lines_fingerprint";

/**
 * Newest acknowledgment per vendor, with staleness judged. NO I/O.
 *
 * ⚠ `rowsNewestFirst` MUST BE ORDERED, uploaded_at descending. The loop takes
 * the first row it sees per vendor and ignores the rest, so an unordered input
 * silently picks an arbitrary acknowledgment — and "arbitrary" would usually
 * be right, which is what would make it hard to notice.
 */
export function summariseAcks(
  rowsNewestFirst: AckRow[],
  vendors: string[],
  order?: AckOrderSnapshot | null,
): Record<string, AckSummary | null> {
  const ackByVendor: Record<string, AckSummary | null> = {};
  for (const v of vendors) ackByVendor[v] = null;

  for (const r of rowsNewestFirst) {
    // rows are newest-first; only fill a vendor we care about, once
    if (r.vendor in ackByVendor && !ackByVendor[r.vendor]) {
      ackByVendor[r.vendor] = {
        verdict: r.verdict,
        uploaded_at: r.uploaded_at,
        result: r.result_json,
        // ⚠ Without `order` there is nothing to compare against, so nothing is
        // stale. Callers that gate on this MUST pass it; callers that only
        // display can omit it and get today's behaviour.
        stale: order ? ackIsStale(r.lines_fingerprint, r.vendor, {
          name: order.name, ship_to: order.ship_to,
          sku_items: Array.isArray(order.sku_items) ? order.sku_items : [],
        }) : false,
      };
    }
  }
  return ackByVendor;
}

/**
 * True only if EVERY vendor has a latest GREEN acknowledgment that is not
 * stale. NO I/O.
 *
 * ⚠ A STALE GREEN IS NOT A GREEN. It confirmed a set of lines that has since
 * changed, so it is evidence about an order that no longer exists.
 *
 * ⚠ NO VENDORS MEANS FALSE, not vacuously true. An order whose vendors do not
 * resolve has not been acknowledged by anybody; `[].every()` would say yes.
 */
export function allVendorsGreen(
  vendors: string[],
  ackByVendor: Record<string, AckSummary | null>,
): boolean {
  if (vendors.length === 0) return false;
  return vendors.every(
    (v) => ackByVendor[v]?.verdict === "green" && !ackByVendor[v]?.stale,
  );
}

/**
 * One order's worth. Unchanged signature and unchanged behaviour — a fetch
 * followed by the pure summariser above, so every existing caller exercises
 * the same rule the batch path uses.
 */
export async function latestAckByVendor(
  orderId: string,
  vendors: string[],
  /** Required to judge staleness; omit only where the answer is not gated on. */
  order?: AckOrderSnapshot | null,
): Promise<Record<string, AckSummary | null>> {
  const { data } = await supabase
    .from("order_acknowledgments")
    .select(ACK_SELECT)
    .eq("order_id", orderId)
    .order("uploaded_at", { ascending: false });

  return summariseAcks((data ?? []) as AckRow[], vendors, order);
}

/**
 * True only if EVERY vendor on the order has a latest GREEN acknowledgment.
 * An order with a vendor that has no ack yet (e.g. an HCI vendor, which has no
 * parser yet) is therefore not all-green and won't auto-advance. Self-contained:
 * resolves the order's vendors and their latest acks. Returns false if the order
 * is missing or no vendors resolve.
 */
export async function orderAllVendorsGreen(orderId: string): Promise<boolean> {
  const { data: order } = await supabase
    .from("orders")
    // ⚠ name and ship_to are here for the FINGERPRINT. reconcileAck gates on
    // them, so a change to either makes a green ack stale.
    .select("vendor, sku_items, name, ship_to")
    .eq("id", orderId)
    .single();
  if (!order) return false;

  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const lookup = await lookupVendorsForSkus(skuItems, order.vendor);
  const vendors = lookup.uniqueVendors;
  if (vendors.length === 0) return false;

  const ackByVendor = await latestAckByVendor(orderId, vendors, order);
  // The verdict itself lives in allVendorsGreen, shared with the enrichment
  // endpoint. Blocking on a stale green is the point: the designer entered
  // THESE lines into the manufacturer's system and the acknowledgment matched
  // THEM.
  return allVendorsGreen(vendors, ackByVendor);
}
