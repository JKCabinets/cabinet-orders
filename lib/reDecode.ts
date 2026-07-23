import { decodeSku, buildSkuFromAvisNamesDetailed, modificationMap } from "@/lib/skuDecoder";
import type { SkuItem, ReviewReason } from "@/lib/data";

/**
 * Re-decode stored sku_items against the CURRENT mapping cache (Step 4d).
 *
 * The caller MUST `await ensureSkuMaps()` and reject on `skuMapsUnavailable()`
 * before calling this — re-decoding with no maps would wrongly re-flag every
 * line as decoder_unavailable.
 *
 * Operates on STORED lines (final sku + persisted door/color), NOT raw Shopify
 * lines — so it reuses the decode/build PRIMITIVES (decodeSku,
 * buildSkuFromAvisNamesDetailed) rather than forking buildOrder's logic:
 *   1. If the stored SKU decodes, fill door/color and clear the flag.
 *   2. Else, if the line kept Avis names (an unmapped Waypoint base), try to
 *      rebuild the composite now that a code may exist; on success, update the
 *      SKU + fill decoded door/color + clear; on failure, keep unmapped_value.
 *   3. Else (placeholder / bare base with no names), leave the line untouched.
 *
 * Fills-forward only: never blanks a good value. sku_mismatch is not
 * re-detectable from stored data, so a corrected line that now decodes clears
 * its live flag (the permanent order_activity note remains as the record).
 */

export interface ReDecodeResult {
  items: SkuItem[];
  changed: boolean;
  resolvedCount: number; // previously-flagged lines whose flag cleared
  flaggedCount: number;  // lines still flagged afterwards
}

function clearFlag(item: SkuItem): SkuItem {
  const next = { ...item };
  delete next.needs_review;
  delete next.review_reason;
  return next;
}

function setFlag(item: SkuItem, reason: ReviewReason): SkuItem {
  return { ...item, needs_review: true, review_reason: reason };
}

function sameItem(a: SkuItem, b: SkuItem): boolean {
  return (
    a.sku === b.sku &&
    (a.door_style ?? "") === (b.door_style ?? "") &&
    (a.color ?? "") === (b.color ?? "") &&
    !!a.needs_review === !!b.needs_review &&
    (a.review_reason ?? "") === (b.review_reason ?? "")
  );
}

/**
 * Which of a line's stored modification sub-SKUs no longer resolve?
 *
 * A sub-SKU is the TYPE code plus an optional value ("RD-13", "RTKB"), so it
 * is still valid while its type code is present in the current map. Comparing
 * against the map's VALUES (not its names) means this keeps working whatever
 * the Avis label is called.
 */
function unmappedMods(item: SkuItem): string[] {
  const mods = item.modifications ?? [];
  if (mods.length === 0) return [];
  const codes = Object.values(modificationMap()).filter(Boolean);
  return mods
    .filter(m => !codes.some(c => m.sku === c || m.sku.startsWith(c + "-")))
    .map(m => m.label || m.sku);
}

/**
 * Clear a line's flag only if its modifications also still resolve — a line
 * whose SKU decodes can still be un-buildable because a mod lost its code.
 */
function settle(item: SkuItem, modIssues: string[]): SkuItem {
  return modIssues.length > 0 ? setFlag(item, "unmapped_value") : clearFlag(item);
}

export function reDecodeItems(items: SkuItem[]): ReDecodeResult {
  let resolvedCount = 0;
  let changed = false;

  const out = items.map(item => {
    const wasFlagged = !!item.needs_review;
    const modIssues = unmappedMods(item);

    // 1) Stored SKU decodes as-is.
    const decoded = item.sku ? decodeSku(item.sku) : null;
    if (decoded && (decoded.doorStyle || decoded.color)) {
      const next = settle({
        ...item,
        door_style: decoded.doorStyle || item.door_style || "",
        color: decoded.color || item.color || "",
      }, modIssues);
      if (wasFlagged && !next.needs_review) resolvedCount++;
      if (!sameItem(item, next)) changed = true;
      return next;
    }

    // 2) Doesn't decode, but the line kept Avis names — try to rebuild.
    if (item.door_style && item.color) {
      const built = buildSkuFromAvisNamesDetailed(item.sku, item.door_style, item.color);
      if (built.sku) {
        const d2 = decodeSku(built.sku);
        const next = settle({
          ...item,
          sku: built.sku,
          door_style: d2?.doorStyle || item.door_style,
          color: d2?.color || item.color,
        }, modIssues);
        if (wasFlagged && !next.needs_review) resolvedCount++;
        changed = true; // sku changed at minimum
        return next;
      }
      // Names present but still uncoded — keep it flagged unmapped_value.
      const next = setFlag(item, "unmapped_value");
      if (!sameItem(item, next)) changed = true;
      return next;
    }

    // 3) Nothing to decode from stored data — but a mod may still have lost
    //    its code, which is worth flagging on its own.
    if (modIssues.length > 0) {
      const next = setFlag(item, "unmapped_value");
      if (!sameItem(item, next)) changed = true;
      return next;
    }
    return item;
  });

  const flaggedCount = out.filter(i => i.needs_review).length;
  return { items: out, changed, resolvedCount, flaggedCount };
}
