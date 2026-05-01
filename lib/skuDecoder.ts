/**
 * skuDecoder.ts
 *
 * Decodes the door-style and color segments from a SKU built by the
 * Shopify SKU Variation Builder.
 *
 * SKU format:  {baseProduct}-{doorCode}-{colorCode}
 * Example:     W930-410F-PL
 *              W930     = base product
 *              410F     = door style code  → "Shaker"
 *              PL       = color code       → "Painted Linen"
 */

// ── Door Style codes → human-readable name ────────────────────────────────
export const DOOR_STYLE_MAP: Record<string, string> = {
  "570F": "Arizona",
  "460F": "Gilbert",
  "410F": "Shaker",
  "530S": "Slab",
  "580F": "Slim Shaker",
  "470F": "Vista",
  "BUTT": "Butt",
};

// ── Color / Finish codes → human-readable name ────────────────────────────
export const COLOR_MAP: Record<string, string> = {
  "ML": "Maple Latte",
  "MR": "Maple Rye",
  "MS": "Maple Slate",
  "PB": "Painted Black",
  "PL": "Painted Linen",
  "PN": "Painted Navy",
  "PO": "Painted Oat",
  "PS": "Painted Sage",
  "PV": "Painted Vanilla",
};

export interface DecodedSku {
  baseSku: string;
  doorCode: string;
  colorCode: string;
  doorStyle: string;
  color: string;
  label: string;
}

/**
 * Decode a full SKU string into its component parts.
 * e.g. "W930-410F-PL" → { baseSku: "W930", doorStyle: "Shaker", color: "Painted Linen", ... }
 */
export function decodeSku(sku: string): DecodedSku | null {
  if (!sku) return null;
  const parts = sku.split("-");
  if (parts.length < 2) return null;

  const colorCode = parts[parts.length - 1];
  const doorCode  = parts[parts.length - 2];
  const baseSku   = parts.slice(0, parts.length - 2).join("-");

  const doorStyle = DOOR_STYLE_MAP[doorCode] ?? doorCode;
  const color     = COLOR_MAP[colorCode]     ?? colorCode;
  const label     = `${doorStyle} - ${color}`;

  return { baseSku, doorCode, colorCode, doorStyle, color, label };
}

export interface SkuItem {
  sku: string;
  quantity: number;
  description?: string;
}

export interface SkuGroup {
  label: string;
  doorStyle: string;
  color: string;
  items: SkuItem[];
}

/**
 * Group sku_items by their decoded door style + color combination.
 */
export function groupSkuItemsByStyle(skuItems: SkuItem[]): SkuGroup[] {
  const groupMap = new Map<string, SkuGroup>();

  for (const item of skuItems) {
    const decoded   = decodeSku(item.sku);
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
