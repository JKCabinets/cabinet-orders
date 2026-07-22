// SKU decoder — pure decode/build logic over the table-backed mapping cache.
//
// The door/color maps NO LONGER live here as hardcoded constants. They are
// loaded from the `sku_mappings` table via lib/skuMappings and exposed as
// synchronous getters over a warm in-memory cache. Async callers must
// `await ensureSkuMaps()` before decoding (see lib/skuMappings). Re-exported
// below so existing importers (vendorLookup, waypointAck) keep importing from
// "@/lib/skuDecoder".

import {
  doorStyleMap,
  doorStyleNameToCode,
  colorNameToCode,
  colorMapAll,
} from "@/lib/skuMappings";

// Re-export the mapping accessors + cache controls so consumers have one home.
export {
  ensureSkuMaps,
  refreshSkuMaps,
  skuMapsUnavailable,
  doorStyleMap,
  doorStyleNameToCode,
  colorMap,
  colorNameToCode,
  hciColorMap,
  jkColorMap,
  colorMapAll,
} from "@/lib/skuMappings";

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

  const doors = doorStyleMap();
  const colorsAll = colorMapAll();

  const last = parts[parts.length - 1];
  const prev = parts.length >= 3 ? parts[parts.length - 2] : "";

  // 3-part (Waypoint): base - DOOR - COLOR
  if (parts.length >= 3 && doors[prev] && colorsAll[last]) {
    const doorStyle = doors[prev];
    const color     = colorsAll[last];
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
  if (colorsAll[last]) {
    const color = colorsAll[last];
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

export interface AvisBuildResult {
  /** The composite SKU, or null if either name is not yet coded. */
  sku: string | null;
  /** The door-style name that had no code (null when the door mapped fine). */
  unmappedDoor: string | null;
  /** The color name that had no code (null when the color mapped fine). */
  unmappedColor: string | null;
}

/**
 * Build a full SKU from a base SKU and Avis option names (Waypoint),
 * reporting WHICH value (door and/or color) was unmapped when it can't.
 * Callers that only need the string can use buildSkuFromAvisNames below.
 */
export function buildSkuFromAvisNamesDetailed(
  baseSku: string,
  doorStyleName: string,
  colorName: string
): AvisBuildResult {
  const doorCode  = doorStyleNameToCode()[doorStyleName];
  const colorCode = colorNameToCode()[colorName];
  return {
    sku: doorCode && colorCode ? `${baseSku}-${doorCode}-${colorCode}` : null,
    unmappedDoor:  doorCode  ? null : (doorStyleName || null),
    unmappedColor: colorCode ? null : (colorName || null),
  };
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
  return buildSkuFromAvisNamesDetailed(baseSku, doorStyleName, colorName).sku;
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
