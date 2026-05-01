/**
 * skuDecoder.ts
 *
 * Decodes the door-style and color segments from a SKU built by the
 * Shopify SKU Variation Builder.
 *
 * SKU format:  {baseProduct}-{doorCode}-{colorCode}
 * Example:     W930-410F-PL
 *              W930     = base product (Wall Cabinet 9" wide, 30" tall)
 *              410F     = door style code  → "Shaker"
 *              PL       = color code       → "Painted Linen"
 *
 * Add / edit entries in the maps below to match your Avis option mappings.
 * Keys must exactly match the codes your SKU Builder writes (case-sensitive).
 */

// ── Door Style codes → human-readable name ────────────────────────────────
export const DOOR_STYLE_MAP: Record<string, string> = {
  "410F": "Shaker",
  "411F": "Shaker Square",
  "420F": "Raised Panel",
  "430F": "Slab",
  "440F": "Beaded",
  "450F": "Arch",
  "460F": "Cathedral",
  "470F": "Recessed",
  "480F": "Craftsman",
  "490F": "Flat Panel",
  "500F": "Open Frame",
  "510F": "Inset",
  "520F": "Partial Overlay",
  "530S": "Arizona",
  "540F": "Milan",
  "550F": "Roma",
  "560F": "Newport",
  "570F": "Dover",
  "580F": "Bristol",
  "590F": "Essex",
  "600F": "Concord",
  "BUTT": "Butt",
  // Add more as needed
};

// ── Color / Finish codes → human-readable name ────────────────────────────
export const COLOR_MAP: Record<string, string> = {
  "PL":  "Painted Linen",
  "PW":  "Painted White",
  "PO":  "Painted Off-White",
  "PG":  "Painted Gray",
  "PB":  "Painted Black",
  "PN":  "Painted Navy",
  "PS":  "Painted Sage",
  "PBL": "Painted Blue",
  "PV":  "Painted Vintage",
  "NM":  "Natural Maple",
  "NO":  "Natural Oak",
  "NC":  "Natural Cherry",
  "NW":  "Natural Walnut",
  "NH":  "Natural Hickory",
  "NB":  "Natural Birch",
  "SM":  "Stained Mocha",
  "SE":  "Stained Espresso",
  "SC":  "Stained Chestnut",
  "SA":  "Stained Amber",
  "SG":  "Stained Grey",
  "TW":  "Thermofoil White",
  "TG":  "Thermofoil Gray",
  // Add more as needed
};

export interface DecodedSku {
  baseSku: string;       // e.g. "W930"
  doorCode: string;      // e.g. "410F"
  colorCode: string;     // e.g. "PL"
  doorStyle: string;     // e.g. "Shaker"
  color: string;         // e.g. "Painted Linen"
  /** "Shaker - Painted Linen" or falls back to raw codes */
  label: string;
}

/**
 * Decode a full SKU string into its component parts.
 *
 * Works with 3-segment SKUs (base-door-color) or 2-segment (base-door).
 * Returns null if the SKU has fewer than 2 segments.
 */
export function decodeSku(sku: string): DecodedSku | null {
  if (!sku) return null;
  const parts = sku.split("-");
  if (parts.length < 2) return null;

  // Base SKU is everything before the last two segments
  // e.g. "W930-410F-PL"    → base="W930",  door="410F", color="PL"
  // e.g. "WDC2430-410F-PL" → base="WDC2430", door="410F", color="PL"
  // e.g. "W930-BUTT-570F-PO" → base="W930", door="BUTT-570F", color="PO"
  //
  // Heuristic: color is always the LAST segment, door is second-to-last.
  // Everything before that is the base.
  const colorCode = parts[parts.length - 1];
  const doorCode  = parts[parts.length - 2];
  const baseSku   = parts.slice(0, parts.length - 2).join("-");

  const doorStyle = DOOR_STYLE_MAP[doorCode] ?? doorCode;
  const color     = COLOR_MAP[colorCode]     ?? colorCode;
  const label     = `${doorStyle} - ${color}`;

  return { baseSku, doorCode, colorCode, doorStyle, color, label };
}

/**
 * Given a list of sku_items from the DB, group them by their decoded
 * door style + color combination and return the groups in order.
 */
export interface SkuItem {
  sku: string;
  quantity: number;
  description?: string;
}

export interface SkuGroup {
  label: string;       // "Shaker - Painted Linen"
  doorStyle: string;
  color: string;
  items: SkuItem[];
}

export function groupSkuItemsByStyle(skuItems: SkuItem[]): SkuGroup[] {
  const groupMap = new Map<string, SkuGroup>();

  for (const item of skuItems) {
    const decoded = decodeSku(item.sku);
    const label     = decoded?.label     ?? "Unknown Style";
    const doorStyle = decoded?.doorStyle ?? "";
    const color     = decoded?.color     ?? "";

    if (!groupMap.has(label)) {
      groupMap.set(label, { label, doorStyle, color, items: [] });
    }
    groupMap.get(label)!.items.push(item);
  }

  return Array.from(groupMap.values());
}
