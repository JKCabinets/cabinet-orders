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
export async function latestAckByVendor(
  orderId: string,
  vendors: string[],
  /** Required to judge staleness; omit only where the answer is not gated on. */
  order?: AckOrderSnapshot | null,
): Promise<Record<string, AckSummary | null>> {
  const ackByVendor: Record<string, AckSummary | null> = {};
  for (const v of vendors) ackByVendor[v] = null;

  const { data } = await supabase
    .from("order_acknowledgments")
    .select("vendor, verdict, uploaded_at, result_json, lines_fingerprint")
    .eq("order_id", orderId)
    .order("uploaded_at", { ascending: false });

  const rows = (data ?? []) as Array<{
    vendor: string;
    verdict: "green" | "red";
    uploaded_at: string;
    result_json: ReconcileResult;
    lines_fingerprint: string | null;
  }>;
  for (const r of rows) {
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
  // ⚠ A STALE GREEN IS NOT A GREEN. It confirmed a set of lines that has since
  // changed, so it is evidence about an order that no longer exists. Blocking
  // is the point: the designer entered THESE lines into the manufacturer's
  // system and the acknowledgment matched THEM.
  return vendors.every(
    (v) => ackByVendor[v]?.verdict === "green" && !ackByVendor[v]?.stale,
  );
}
