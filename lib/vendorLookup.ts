/**
 * Build a map from full-form SKU → vendor name for a set of SKU items, using a
 * single round-trip to `shopify_products` instead of one query per SKU.
 *
 * SKU format: {baseProduct}-{doorCode}-{colorCode}. The vendor is stored
 * against the base variant SKU (e.g. "W930"), so we strip the door/color
 * codes before looking up.
 *
 * Returns Map keys for the FULL SKU as given, so callers can do
 * `vendorMap.get(item.sku)` directly. Values are vendor names or undefined.
 */

import { supabase } from "@/lib/supabase";
import type { SkuItem } from "@/lib/skuDecoder";

const UNKNOWN_VENDOR = "__UNASSIGNED__";

export interface VendorLookupResult {
  vendorBySku: Map<string, string>;
  uniqueVendors: string[];
  hasUnassigned: boolean;
}

/** Strip the trailing "-{doorCode}-{colorCode}" from a full SKU to get the base. */
function baseSku(fullSku: string): string {
  const parts = fullSku.split("-");
  return parts.length >= 3 ? parts.slice(0, parts.length - 2).join("-") : fullSku;
}

export async function lookupVendorsForSkus(
  skuItems: SkuItem[],
  fallbackOrderVendor?: string | null
): Promise<VendorLookupResult> {
  const vendorBySku = new Map<string, string>();

  // If the order itself has a vendor set (manual orders), apply it to every
  // SKU that doesn't get a more specific match from shopify_products.
  const fallback = (fallbackOrderVendor ?? "").trim();

  // Collect the distinct base SKUs we need to look up
  const baseToFullList = new Map<string, string[]>();
  for (const item of skuItems) {
    if (!item.sku) continue;
    const base = baseSku(item.sku);
    if (!base) continue;
    const list = baseToFullList.get(base) ?? [];
    list.push(item.sku);
    baseToFullList.set(base, list);
  }

  const baseSkus = Array.from(baseToFullList.keys());
  if (baseSkus.length > 0) {
    const { data: products } = await supabase
      .from("shopify_products")
      .select("sku, vendor")
      .in("sku", baseSkus);

    for (const product of products ?? []) {
      const v = String(product.vendor ?? "").trim();
      if (!v) continue;
      const fulls = baseToFullList.get(String(product.sku)) ?? [];
      for (const full of fulls) vendorBySku.set(full, v);
    }
  }

  // Fill in fallback for any SKU that didn't get a match. If no fallback either,
  // leave it absent — caller treats absent as "unassigned".
  if (fallback) {
    for (const item of skuItems) {
      if (item.sku && !vendorBySku.has(item.sku)) {
        vendorBySku.set(item.sku, fallback);
      }
    }
  }

  // Compute unique vendors (sorted) and whether any SKUs ended up unassigned
  const uniqueSet = new Set<string>();
  let hasUnassigned = false;
  for (const item of skuItems) {
    if (!item.sku) continue;
    const v = vendorBySku.get(item.sku);
    if (v) uniqueSet.add(v);
    else hasUnassigned = true;
  }

  return {
    vendorBySku,
    uniqueVendors: Array.from(uniqueSet).sort((a, b) => a.localeCompare(b)),
    hasUnassigned,
  };
}

export { UNKNOWN_VENDOR };
