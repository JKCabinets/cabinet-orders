/**
 * skuDecoder.ts
 *
 * Decodes the door-style and color segments from a SKU, and builds full SKUs
 * from Avis option names (Waypoint only).
 *
 * Two SKU shapes are supported:
 *   Waypoint   {base}-{doorCode}-{colorCode}   e.g. W930-580F-PL  (door + color)
 *   HCI / J&K  {base}-{colorCode}              e.g. B09FHD-MSL    (color only)
 *
 * Waypoint door/color come from Avis line-item properties; HCI/J&K color comes
 * from a native Shopify variant, with the code appended by the storefront SKU
 * bridge. The shapes are told apart by the code tables, not by segment count.
 */

// ── Waypoint — Door Style: code -> human-readable name ───────────────────
export const DOOR_STYLE_MAP: Record<string, string> = {
  "570F": "Arizona",
  "460F": "Gilbert",
  "410F": "Shaker",
  "530S": "Slab",
  "580F": "Slim Shaker",
  "470F": "Vista",
  "BUTT": "Butt",
};

// ── Waypoint — Door Style: Avis option name -> SKU code (reverse) ────────
export const DOOR_STYLE_NAME_TO_CODE: Record<string, string> = {
  "Arizona":    "570F",
  "Gilbert":    "460F",
  "Shaker":     "410F",
  "Slab":       "530S",
  "Slim Shaker":"580F",
  "Vista":      "470F",
  "Butt":       "BUTT",
};

// ── Waypoint — Color: code -> human-readable name ────────────────────────
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

// ── Waypoint — Color: Avis option name -> SKU code (reverse) ─────────────
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

// ── HCI — Color: code -> name (native-variant colors; no door segment) ───
//    Keep these in sync with the HCI overlay's attachingSku codes.
export const HCI_COLOR_MAP: Record<string, string> = {
  "WHS": "White Shaker",
  "GRS": "Gray Shaker",
  "MSL": "Modern Slate",
  "SIB": "Signature Blue",
  "ONB": "Onyx Black",
  "WHN": "Nano White",
  "GRN": "Nano Green",
};

// ── J&K — Color: code -> name (native-variant colors; no door segment) ───
//    Forward-looking: confirm against the J&K overlay codes once that store
//    is live. No J&K orders flow until then.
export const JK_COLOR_MAP: Record<string, string> = {
  "S1":  "Java Coffee",
  "H9":  "Pearl Glaze",
  "E1":  "Dove",
  "E2":  "Charcoal Gray",
  "K10": "Mocha Glazed",
  "S5":  "Castle Grey",
  "S8":  "White",
};

// ── All color codes in one lookup (used to recognise the trailing segment) ─
//    Codes do not collide across vendors, so a flat merge is unambiguous.
export const COLOR_MAP_ALL: Record<string, string> = {
  ...COLOR_MAP,
  ...HCI_COLOR_MAP,
  ...JK_COLOR_MAP,
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
 *
 * Tries the 3-part Waypoint shape first (base-DOOR-COLOR), then the 2-part
 * HCI/J&K shape (base-COLOR). Returns null if the trailing segment is not a
 * known color code in any vendor's table.
 */
export function decodeSku(sku: string): DecodedSku | null {
  if (!sku) return null;
  const parts = sku.split("-");
  if (parts.length < 2) return null;

  const last = parts[parts.length - 1];
  const prev = parts.length >= 3 ? parts[parts.length - 2] : "";

  // 3-part (Waypoint): base - DOOR - COLOR
  if (parts.length >= 3 && DOOR_STYLE_MAP[prev] && COLOR_MAP_ALL[last]) {
    const doorStyle = DOOR_STYLE_MAP[prev];
    const color     = COLOR_MAP_ALL[last];
    return {
      baseSku:   parts.slice(0, parts.length - 2).join("-"),
      doorCode:  prev,
      colorCode: last,
      doorStyle,
      color,
      label: `${doorStyle} - ${color}`,
    };
  }

  // 2-part (HCI / J&K): base - COLOR  (color is a native variant, no door code)
  if (COLOR_MAP_ALL[last]) {
    const color = COLOR_MAP_ALL[last];
    return {
      baseSku:   parts.slice(0, parts.length - 1).join("-"),
      doorCode:  "",
      colorCode: last,
      doorStyle: "",
      color,
      label: color,
    };
  }

  return null;
}

/**
 * Build a full SKU from a base SKU and Avis option names (Waypoint).
 * e.g. buildSkuFromAvisNames("W930", "Slim Shaker", "Painted Linen") -> "W930-580F-PL"
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
 * For color-only (HCI/J&K) SKUs the door style is blank, so the group label
 * uses the color alone rather than "Unknown Style - <color>".
 */
export function groupSkuItemsByStyle(skuItems: SkuItem[]): SkuGroup[] {
  const groupMap = new Map<string, SkuGroup>();

  for (const item of skuItems) {
    const decoded = decodeSku(item.sku);

    const doorStyle = decoded?.doorStyle || item.door_style || "";
    const color     = decoded?.color     || item.color      || "";
    const label     = doorStyle && color
      ? `${doorStyle} - ${color}`
      : (color || doorStyle || "Unknown");

    if (!groupMap.has(label)) {
      groupMap.set(label, { label, doorStyle, color, items: [] });
    }
    groupMap.get(label)!.items.push(item);
  }

  return Array.from(groupMap.values());
}
