import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import type { SkuItem } from "@/lib/skuDecoder";
import type { ReconcileResult } from "@/lib/reconcile";

export type AckSummary = { verdict: "green" | "red"; uploaded_at: string; result: ReconcileResult };

/**
 * Latest acknowledgment per vendor for an order (newest row per vendor wins;
 * full history is preserved in order_acknowledgments). Scoped to the supplied
 * vendor list — vendors with no ack map to null. Shared by the /vendors
 * endpoint (for display) and the PATCH gate (for the all-green check) so the
 * two can't drift.
 */
export async function latestAckByVendor(
  orderId: string,
  vendors: string[]
): Promise<Record<string, AckSummary | null>> {
  const ackByVendor: Record<string, AckSummary | null> = {};
  for (const v of vendors) ackByVendor[v] = null;

  const { data } = await supabase
    .from("order_acknowledgments")
    .select("vendor, verdict, uploaded_at, result_json")
    .eq("order_id", orderId)
    .order("uploaded_at", { ascending: false });

  const rows = (data ?? []) as Array<{
    vendor: string;
    verdict: "green" | "red";
    uploaded_at: string;
    result_json: ReconcileResult;
  }>;
  for (const r of rows) {
    // rows are newest-first; only fill a vendor we care about, once
    if (r.vendor in ackByVendor && !ackByVendor[r.vendor]) {
      ackByVendor[r.vendor] = { verdict: r.verdict, uploaded_at: r.uploaded_at, result: r.result_json };
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
    .select("vendor, sku_items")
    .eq("id", orderId)
    .single();
  if (!order) return false;

  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const lookup = await lookupVendorsForSkus(skuItems, order.vendor);
  const vendors = lookup.uniqueVendors;
  if (vendors.length === 0) return false;

  const ackByVendor = await latestAckByVendor(orderId, vendors);
  return vendors.every((v) => ackByVendor[v]?.verdict === "green");
}
