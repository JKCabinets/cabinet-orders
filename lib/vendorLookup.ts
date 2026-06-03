/**
 * Resolve each order line item to its manufacturer (vendor), using a layered,
 * fail-safe chain so a single bad/ambiguous signal can never silently mislabel.
 *
 * Resolution order, per line item:
 *   1. variant_id  — the Shopify variant id captured at order ingest. This is
 *      globally unique and is the primary key of `shopify_products` (id), so it
 *      is collision-proof: two different vendors can share a base SKU (e.g.
 *      "B24"), but never a variant_id. THIS IS THE AUTHORITATIVE PATH.
 *   2. vendor family by SKU shape — if no variant_id match (e.g. orders ingested
 *      before variant_id capture, or a re-created variant not yet re-synced),
 *      classify by the decoded SKU shape. Waypoint = 3-part w/ door code;
 *      HCI / J&K = 2-part, told apart by color-code table (never overlap).
 *   3. base SKU lookup — last resort: query shopify_products by base SKU. This
 *      is the legacy behavior; kept so nothing regresses, but it is the one
 *      that can be ambiguous on a shared base, hence it's last.
 *   4. order-level fallback vendor — for manual orders with a vendor set.
 *
 * Returns Map keys for the FULL SKU as given, so callers can do
 * `vendorMap.get(item.sku)` directly. Values are vendor names or undefined.
 */

import { supabase } from "@/lib/supabase";
import { decodeSku, DOOR_STYLE_MAP, HCI_COLOR_MAP, JK_COLOR_MAP } from "@/lib/skuDecoder";

const UNKNOWN_VENDOR = "__UNASSIGNED__";

// Canonical vendor name strings, exactly as stored in shopify_products.vendor.
// NOTE: this is a SECONDARY source of vendor names (Shopify is primary). It is
// only consulted in the family-fallback path. If a vendor is ever renamed in
// Shopify, update these to match — but the primary variant_id path does not
// depend on this map.
const VENDOR_WAYPOINT = "Waypoint Cabinetry";
const VENDOR_HCI = "HCI Cabinetry";
const VENDOR_JK = "J&K Cabinetry";

/**
 * A line item we can resolve. We read variant_id defensively (optional) so this
 * works regardless of which SkuItem type the caller passes (the stored data.ts
 * shape carries variant_id; the decoder shape may not).
 */
export interface ResolvableItem {
  sku: string;
  variant_id?: string | null;
}

export interface VendorLookupResult {
  vendorBySku: Map<string, string>;
  uniqueVendors: string[];
  hasUnassigned: boolean;
}

/** Base variant SKU from a full composite, regardless of shape. */
function baseSku(fullSku: string): string {
  return decodeSku(fullSku)?.baseSku || fullSku;
}

/**
 * Classify a SKU to a canonical vendor name by its shape alone (no DB).
 * Returns null if the shape doesn't clearly indicate a vendor.
 *   Waypoint : 3-part, middle segment is a known door code
 *   HCI      : trailing color code in HCI_COLOR_MAP
 *   J&K      : trailing color code in JK_COLOR_MAP
 * HCI and J&K color codes never overlap (confirmed), so this is unambiguous.
 */
function vendorFamilyFromSku(fullSku: string): string | null {
  const parts = fullSku.split("-");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const prev = parts.length >= 3 ? parts[parts.length - 2] : "";

  // Waypoint: a real door code in the door position
  if (parts.length >= 3 && DOOR_STYLE_MAP[prev]) return VENDOR_WAYPOINT;

  // HCI vs J&K by trailing color code (disjoint sets)
  if (HCI_COLOR_MAP[last]) return VENDOR_HCI;
  if (JK_COLOR_MAP[last]) return VENDOR_JK;

  return null;
}

export async function lookupVendorsForSkus(
  skuItems: ResolvableItem[],
  fallbackOrderVendor?: string | null
): Promise<VendorLookupResult> {
  const vendorBySku = new Map<string, string>();
  const fallback = (fallbackOrderVendor ?? "").trim();

  // ── Layer 1: variant_id (authoritative, collision-proof) ──────────────────
  // Map each distinct variant_id to the full SKUs that carry it, then resolve
  // all of them in one query against shopify_products.id.
  const variantToFulls = new Map<string, string[]>();
  for (const item of skuItems) {
    if (!item.sku) continue;
    const vid = String(item.variant_id ?? "").trim();
    if (!vid) continue;
    const list = variantToFulls.get(vid) ?? [];
    list.push(item.sku);
    variantToFulls.set(vid, list);
  }

  const variantIds = Array.from(variantToFulls.keys());
  if (variantIds.length > 0) {
    const { data: products } = await supabase
      .from("shopify_products")
      .select("id, vendor")
      .in("id", variantIds);
    for (const product of products ?? []) {
      const v = String(product.vendor ?? "").trim();
      if (!v) continue;
      const fulls = variantToFulls.get(String(product.id)) ?? [];
      for (const full of fulls) vendorBySku.set(full, v);
    }
  }

  // ── Layer 2: vendor family by SKU shape (for anything still unresolved) ───
  for (const item of skuItems) {
    if (!item.sku || vendorBySku.has(item.sku)) continue;
    const fam = vendorFamilyFromSku(item.sku);
    if (fam) vendorBySku.set(item.sku, fam);
  }

  // ── Layer 3: base SKU lookup (legacy; ambiguous on shared bases, so last) ─
  const stillUnresolved = skuItems.filter(i => i.sku && !vendorBySku.has(i.sku));
  if (stillUnresolved.length > 0) {
    const baseToFulls = new Map<string, string[]>();
    for (const item of stillUnresolved) {
      const base = baseSku(item.sku);
      if (!base) continue;
      const list = baseToFulls.get(base) ?? [];
      list.push(item.sku);
      baseToFulls.set(base, list);
    }
    const baseSkus = Array.from(baseToFulls.keys());
    if (baseSkus.length > 0) {
      const { data: products } = await supabase
        .from("shopify_products")
        .select("sku, vendor")
        .in("sku", baseSkus);
      for (const product of products ?? []) {
        const v = String(product.vendor ?? "").trim();
        if (!v) continue;
        const fulls = baseToFulls.get(String(product.sku)) ?? [];
        for (const full of fulls) {
          if (!vendorBySku.has(full)) vendorBySku.set(full, v);
        }
      }
    }
  }

  // ── Layer 4: order-level fallback vendor (manual orders) ──────────────────
  if (fallback) {
    for (const item of skuItems) {
      if (item.sku && !vendorBySku.has(item.sku)) {
        vendorBySku.set(item.sku, fallback);
      }
    }
  }

  // Unique vendors + unassigned flag
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
