import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import type { SkuItem } from "@/lib/skuDecoder";
import type { ReconcileResult } from "@/lib/reconcile";

/**
 * GET /api/orders/[id]/vendors
 *
 * Returns the list of distinct vendors for the SKU items on this order, plus
 * a flag indicating whether any SKUs are unmapped. The UI uses this to decide
 * whether to render one export button or N export buttons.
 *
 * Also returns the latest acknowledgment-reconciliation result per vendor
 * (newest upload wins; full history stays in order_acknowledgments). The order
 * row uses the verdict for its per-vendor check/X; the modal uses the full
 * result for the discrepancy breakdown. Vendors with no ack yet map to null.
 *
 * Response shape:
 *   {
 *     vendors: string[],
 *     hasUnassigned: boolean,
 *     totalSkus: number,
 *     vendorBySku: Record<string,string>,
 *     ackByVendor: Record<string, AckSummary | null>   // AckSummary = { verdict, uploaded_at, result }
 *   }
 */

type AckSummary = { verdict: "green" | "red"; uploaded_at: string; result: ReconcileResult };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data: order, error } = await supabase
    .from("orders")
    .select("vendor, sku_items")
    .eq("id", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const lookup = await lookupVendorsForSkus(skuItems, order.vendor);

  // Latest acknowledgment per vendor (full history kept; newest row wins).
  const { data: acks } = await supabase
    .from("order_acknowledgments")
    .select("vendor, verdict, uploaded_at, result_json")
    .eq("order_id", id)
    .order("uploaded_at", { ascending: false });

  const ackByVendor: Record<string, AckSummary | null> = {};
  for (const v of lookup.uniqueVendors) ackByVendor[v] = null;
  const ackRows = (acks ?? []) as Array<{
    vendor: string;
    verdict: "green" | "red";
    uploaded_at: string;
    result_json: ReconcileResult;
  }>;
  for (const a of ackRows) {
    // rows are newest-first, so the first seen per vendor is the latest
    if (!ackByVendor[a.vendor]) {
      ackByVendor[a.vendor] = { verdict: a.verdict, uploaded_at: a.uploaded_at, result: a.result_json };
    }
  }

  return NextResponse.json({
    vendors: lookup.uniqueVendors,
    hasUnassigned: lookup.hasUnassigned,
    totalSkus: skuItems.length,
    vendorBySku: Object.fromEntries(lookup.vendorBySku),
    ackByVendor,
  });
}
