/**
 * skuDecoder.ts
 *
 * Decodes the door-style and color segments from a SKU built by the
 * Shopify SKU Variation Builder, and builds full SKUs from Avis option names.
 *
 * SKU format:  {baseProduct}-{doorCode}-{colorCode}
 * Example:     W930-410F-PL → { baseSku: "W930", doorStyle: "Shaker", color: "Painted Linen" }
 */

// ── Door Style: code → human-readable name ────────────────────────────────
export const DOOR_STYLE_MAP: Record<string, string> = {
  "570F": "Arizona",
  "460F": "Gilbert",
  "410F": "Shaker",
  "530S": "Slab",
  "580F": "Slim Shaker",
  "470F": "Vista",
  "BUTT": "Butt",
};

// ── Door Style: Avis option name → SKU code (reverse lookup) ─────────────
export const DOOR_STYLE_NAME_TO_CODE: Record<string, string> = {
  "Arizona":    "570F",
  "Gilbert":    "460F",
  "Shaker":     "410F",
  "Slab":       "530S",
  "Slim Shaker":"580F",
  "Vista":      "470F",
  "Butt":       "BUTT",
};

// ── Color: code → human-readable name ────────────────────────────────────
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

// ── Color: Avis option name → SKU code (reverse lookup) ──────────────────
export const COLOR_NAME_TO_CODE: Record<string, string> = {
  "Maple Latte":   "ML",
  "Maple Rye":     "MR",
  "Maple Slate":   "MS",
  "Painted Black": "PB",
  "Painted Linen": "PL",
  "Painted Navy":  "PN",
  "Painted Oat":   "PO",
  "Painted Sage":  "PS",
  "Painted Vanilla":"PV",
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
 * Returns null if the SKU has fewer than 3 segments or codes are unrecognised.
 */
export function decodeSku(sku: string): DecodedSku | null {
  if (!sku) return null;
  const parts = sku.split("-");
  if (parts.length < 3) return null;

  const colorCode = parts[parts.length - 1];
  const doorCode  = parts[parts.length - 2];
  const baseSku   = parts.slice(0, parts.length - 2).join("-");

  if (!DOOR_STYLE_MAP[doorCode] && !COLOR_MAP[colorCode]) return null;

  const doorStyle = DOOR_STYLE_MAP[doorCode] ?? doorCode;
  const color     = COLOR_MAP[colorCode]     ?? colorCode;
  const label     = `${doorStyle} - ${color}`;

  return { baseSku, doorCode, colorCode, doorStyle, color, label };
}

/**
 * Build a full SKU from a base SKU and Avis option names.
 * e.g. buildSkuFromAvisNames("W930", "Slim Shaker", "Painted Linen") → "W930-580F-PL"
 * Returns null if either name can't be mapped to a code.
 */
export function buildSkuFromAvisNames(
  baseSku: string,
  doorStyleName: string,
  colorName: string
): string | null {
  const doorCode  = DOOR_STYLE_NAME_TO_CODE[doorStyleName];
  const colorCode = COLOR_NAME_TO_CODE[colorName];
  if (!doorCode || !colorCode) return null;
  return `${baseSku}-${doorCode}-${colorCode}`;
}

export interface SkuItem {
  sku: string;
  quantity: number;
  description?: string;
  door_style?: string;
  color?: string;
}

export interface SkuGroup {
  label: string;
  doorStyle: string;
  color: string;
  items: SkuItem[];
}

/**
 * Group sku_items by their decoded door style + color combination.
 * Falls back to Avis door_style/color properties when SKU can't be decoded.
 */
export function groupSkuItemsByStyle(skuItems: SkuItem[]): SkuGroup[] {
  const groupMap = new Map<string, SkuGroup>();

  for (const item of skuItems) {
    const decoded = decodeSku(item.sku);

    const doorStyle = decoded?.doorStyle || item.door_style || "Unknown Style";
    const color     = decoded?.color     || item.color      || "";
    const label     = color ? `${doorStyle} - ${color}` : doorStyle;

    if (!groupMap.has(label)) {
      groupMap.set(label, { label, doorStyle, color, items: [] });
    }
    groupMap.get(label)!.items.push(item);
  }

  return Array.from(groupMap.values());
}
