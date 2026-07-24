import type { SkuModification } from "@/lib/data";

/**
 * Parse a Waypoint line's Avis modification properties into attaching sub-SKUs.
 *
 * Avis emits modifications in more than one shape, so this is deliberately
 * shape-agnostic. It gathers the SELECTED modification names from every source
 * and then resolves each to a sub-SKU via the sku_mappings table (modMap):
 *
 *   - List property (any category prefix): "_Modifications" (wall),
 *     "_Base Modifications", "_Tall Modifications", "_Vanity Modifications" ...
 *     Value is a comma-separated list, e.g. "Reduce Depth, Recessed Toe Kick".
 *   - Explicit toggles used by some configs: "_Reduce Depth: Yes",
 *     "_Increase Depth: Yes", "_Recessed Toe Kick: Yes".
 *
 * Companion values (read where relevant):
 *   - Reduce Depth  -> "_Modified Reduced Depth" or "_Select Depth"   (RD-<n>)
 *   - Increase Depth-> "_Modified Depth" or "_Select Depth"           (ID-<n>)
 *   - Recessed Toe Kick -> "_Recessed Toe Kick Options" value         (RTKL/R/B)
 *
 * Non-fatal issues are reported, never thrown:
 *   - `unmapped`:     a modification/option with no code yet (flag unmapped_value)
 *   - `missingValue`: a depth mod selected with no number (attach code alone; flag)
 */

export interface ParsedMods {
  subs: SkuModification[];
  unmapped: string[];
  missingValue: string[];
}

const INCH = '"';

function firstNonEmpty(...vals: string[]): string {
  for (const v of vals) if (v && v.trim()) return v.trim();
  return "";
}

export function parseModifications(
  props: Array<{ name: string; value: string }>,
  modMap: Record<string, string>,
): ParsedMods {
  // Avis label_cart becomes the property name, so whitespace typed into the
  // option ("Modifications ") rides into the order. Trim names before
  // matching so that can never silently drop a line's modifications.
  const cleaned = props.map(p => ({ name: (p.name ?? "").trim(), value: p.value ?? "" }));
  const get = (re: RegExp) => (cleaned.find(p => re.test(p.name))?.value ?? "").trim();
  const subs: SkuModification[] = [];
  const unmapped: string[] = [];
  const missingValue: string[] = [];

  // ── 1) Gather selected modification names from all sources ────────────────
  const selected: string[] = [];

  // Any "…Modifications" list property (comma-separated). Category prefix
  // (Base/Wall/Tall/Vanity) optional; leading underscore optional.
  const LIST_RE = /^_?(?:[A-Za-z]+\s+)?Modifications$/i;
  for (const p of cleaned) {
    if (LIST_RE.test(p.name)) {
      for (const part of (p.value ?? "").split(",")) {
        const name = part.trim();
        if (name && name.toLowerCase() !== "none") selected.push(name);
      }
    }
  }
  // Explicit toggles (some base/tall configs).
  if (get(/^_?Reduce Depth$/i).toLowerCase() === "yes") selected.push("Reduce Depth");
  if (get(/^_?Increase Depth$/i).toLowerCase() === "yes") selected.push("Increase Depth");
  if (get(/^_?Recessed Toe Kick$/i).toLowerCase() === "yes") selected.push("Recessed Toe Kick");

  // De-dupe case-insensitively (a mod may appear via both a list and a toggle).
  const seen = new Set<string>();
  const uniqueSelected = selected.filter(n => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // ── 2) Resolve each selected modification to a sub-SKU ────────────────────
  const addDepth = (label: string, num: string) => {
    const code = modMap[label];
    if (!code) { unmapped.push(label); return; }
    if (num) subs.push({ sku: `${code}-${num}`, label: `${label} to ${num}${INCH}` });
    else { subs.push({ sku: code, label }); missingValue.push(label); }
  };

  for (const modName of uniqueSelected) {
    const lower = modName.toLowerCase();
    if (lower === "reduce depth") {
      addDepth("Reduce Depth", firstNonEmpty(get(/^_?Modified Reduced Depth$/i), get(/^_?Select Depth$/i)));
    } else if (lower === "increase depth") {
      addDepth("Increase Depth", firstNonEmpty(get(/^_?Modified Depth$/i), get(/^_?Select Depth$/i)));
    } else if (lower.startsWith("recessed toe kick")) {
      // Generic "Recessed Toe Kick" resolves via its Options property to the
      // specific Left/Right/Both; an already-specific name maps directly.
      const opt = modMap[modName] ? modName : get(/^_?Recessed Toe Kick Options$/i);
      const code = opt ? modMap[opt] : "";
      if (!code) unmapped.push(opt || modName);
      else subs.push({ sku: code, label: opt });
    } else {
      const code = modMap[modName];
      if (!code) unmapped.push(modName);
      else subs.push({ sku: code, label: modName });
    }
  }

  return { subs, unmapped, missingValue };
}
