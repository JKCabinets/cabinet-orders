import type { SkuModification } from "@/lib/data";

/**
 * Parse a Waypoint line's Avis modification properties into attaching sub-SKUs.
 *
 * Three property shapes exist (matched loosely for the "_"/no-"_" variants):
 *   - Wall:        _Modifications = "Reduce Depth"|"Increase Depth"|"None"
 *                  + _Modified Reduced Depth (reduce) / _Modified Depth (increase)  -> RD-<n> / ID-<n>
 *   - Base/Vanity/Tall reduce: _Reduce Depth = "Yes" + _Select Depth               -> RD-<n>
 *   - Toe kick:    _Recessed Toe Kick = "Yes" + _Recessed Toe Kick Options          -> RTKL/RTKR/RTKB
 *
 * The TYPE code (RD/ID/RTKx) comes from the sku_mappings table (modMap, name->code);
 * the numeric depth is read from the companion property and appended here. A line
 * can carry more than one modification.
 *
 * Non-fatal issues are reported, never thrown:
 *   - `unmapped`:     a modification label with no code yet (flag unmapped_value)
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
  const get = (re: RegExp) => (props.find(p => re.test(p.name))?.value ?? "").trim();
  const subs: SkuModification[] = [];
  const unmapped: string[] = [];
  const missingValue: string[] = [];

  // A depth modification: TYPE code + a numeric depth (RD-4, ID-13).
  const addDepth = (modName: string, num: string) => {
    const code = modMap[modName];
    if (!code) { unmapped.push(modName); return; }
    if (num) {
      subs.push({ sku: `${code}-${num}`, label: `${modName} to ${num}${INCH}` });
    } else {
      subs.push({ sku: code, label: modName });
      missingValue.push(modName);
    }
  };

  // 1) Wall cabinets: _Modifications selector + companion depth.
  const modSel = get(/^_?Modifications$/i);
  if (modSel && modSel.toLowerCase() !== "none") {
    const num = firstNonEmpty(get(/^_?Modified Reduced Depth$/i), get(/^_?Modified Depth$/i));
    addDepth(modSel, num);
  }

  // 2) Base / Vanity / Tall: _Reduce Depth toggle + _Select Depth.
  if (get(/^_?Reduce Depth$/i).toLowerCase() === "yes") {
    addDepth("Reduce Depth", get(/^_?Select Depth$/i));
  }

  // 3) Toe kick: _Recessed Toe Kick toggle + _Recessed Toe Kick Options.
  if (get(/^_?Recessed Toe Kick$/i).toLowerCase() === "yes") {
    const opt = get(/^_?Recessed Toe Kick Options$/i);
    const code = opt ? modMap[opt] : "";
    if (!code) unmapped.push(opt || "Recessed Toe Kick");
    else subs.push({ sku: code, label: opt });
  }

  return { subs, unmapped, missingValue };
}
