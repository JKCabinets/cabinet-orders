import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import { latestAckByVendor } from "@/lib/acknowledgments";
import type { SkuItem } from "@/lib/skuDecoder";

/**
 * GET /api/orders/[id]/vendors
 *
 * Returns the list of distinct vendors for the SKU items on this order, plus
 * a flag indicating whether any SKUs are unmapped, and the latest
 * acknowledgment-reconciliation result per vendor (newest upload wins; full
 * history stays in order_acknowledgments). The order row uses the verdict for
 * its per-vendor check/X; the modal uses the full result for the discrepancy
 * breakdown. Vendors with no ack yet map to null.
 *
 * The per-vendor ack lookup is shared with the PATCH stage gate via
 * lib/acknowledgments so the two can't disagree about "all green".
 *
 * Response shape:
 *   {
 *     vendors: string[],
 *     hasUnassigned: boolean,
 *     totalSkus: number,
 *     vendorBySku: Record<string,string>,
 *     ackByVendor: Record<string, AckSummary | null>
 *   }
 */
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
  const ackByVendor = await latestAckByVendor(id, lookup.uniqueVendors);

  return NextResponse.json({
    vendors: lookup.uniqueVendors,
    hasUnassigned: lookup.hasUnassigned,
    totalSkus: skuItems.length,
    vendorBySku: Object.fromEntries(lookup.vendorBySku),
    ackByVendor,
  });
}
