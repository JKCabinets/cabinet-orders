import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import type { SkuItem } from "@/lib/skuDecoder";

/**
 * GET /api/orders/[id]/vendors
 *
 * Returns the list of distinct vendors for the SKU items on this order, plus
 * a flag indicating whether any SKUs are unmapped. The UI uses this to decide
 * whether to render one export button or N export buttons.
 *
 * Response shape:
 *   {
 *     vendors: string[],           // sorted unique vendor names
 *     hasUnassigned: boolean,      // true if any SKU has no vendor mapping
 *     totalSkus: number,           // total SKU items on the order
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

  return NextResponse.json({
    vendors: lookup.uniqueVendors,
    hasUnassigned: lookup.hasUnassigned,
    totalSkus: skuItems.length,
  });
}
