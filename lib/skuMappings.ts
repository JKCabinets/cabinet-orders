import { supabase } from "@/lib/supabase";

/**
 * Table-backed SKU mapping cache — the single source of truth for
 * door-style / color  name <-> code, loaded from the `sku_mappings` table.
 *
 * Replaces the hardcoded maps that used to live in lib/skuDecoder.ts. Each
 * mapping is ONE row (avis_name + sku_code); both directions (name->code for
 * building, code->name for display) are derived from the same row, so they
 * can't drift.
 *
 * Vendor-scoped on purpose: vendorLookup distinguishes HCI from J&K by their
 * SEPARATE color-code sets, so a merged map would break classification. The
 * one merged map is `colorMapAll` (all vendors' color code->name), used only
 * by decodeSku for display, where a global code->name lookup is correct.
 *
 * Loading is lazy + memoized and self-healing: a failed load clears the memo so
 * the next call retries (rather than caching a failure). The decode functions
 * are synchronous, so callers in async handlers must `await ensureSkuMaps()`
 * before decoding. If a decode somehow runs cold, the getters return empty and
 * `skuMapsUnavailable()` is true — the caller treats that as
 * `decoder_unavailable` (raw SKU + flag), never a crash and never stale data.
 */

const VENDOR_WAYPOINT = "Waypoint Cabinetry";
const VENDOR_HCI = "HCI Cabinetry";
const VENDOR_JK = "J&K Cabinetry";

export interface SkuMapsBundle {
  doorStyleMap: Record<string, string>;        // Waypoint door  code -> name
  doorStyleNameToCode: Record<string, string>; // Waypoint door  name -> code
  colorMap: Record<string, string>;            // Waypoint color code -> name
  colorNameToCode: Record<string, string>;     // Waypoint color name -> code
  hciColorMap: Record<string, string>;         // HCI color code -> name
  jkColorMap: Record<string, string>;          // J&K color code -> name
  colorMapAll: Record<string, string>;         // all vendors' color code -> name
  modificationMap: Record<string, string>;     // Waypoint modification name -> code
}

function emptyBundle(): SkuMapsBundle {
  return {
    doorStyleMap: {}, doorStyleNameToCode: {},
    colorMap: {}, colorNameToCode: {},
    hciColorMap: {}, jkColorMap: {}, colorMapAll: {},
    modificationMap: {},
  };
}

type Row = { vendor: string; kind: string; avis_name: string; sku_code: string | null };

let cache: SkuMapsBundle | null = null;
let loadPromise: Promise<void> | null = null;

async function load(): Promise<void> {
  const { data, error } = await supabase
    .from("sku_mappings")
    .select("vendor, kind, avis_name, sku_code");

  if (error) throw new Error(`sku_mappings load failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) throw new Error("sku_mappings returned no rows");

  const b = emptyBundle();
  for (const r of rows) {
    // A NULL sku_code = a name seen but not yet coded. It contributes nothing
    // to the maps (so a decode of that value cleanly fails -> unmapped_value).
    if (!r.sku_code) continue;
    const code = r.sku_code;
    const name = r.avis_name;

    if (r.vendor === VENDOR_WAYPOINT && r.kind === "door_style") {
      b.doorStyleMap[code] = name;
      b.doorStyleNameToCode[name] = code;
    } else if (r.vendor === VENDOR_WAYPOINT && r.kind === "color") {
      b.colorMap[code] = name;
      b.colorNameToCode[name] = code;
      b.colorMapAll[code] = name;
    } else if (r.vendor === VENDOR_HCI && r.kind === "color") {
      b.hciColorMap[code] = name;
      b.colorMapAll[code] = name;
    } else if (r.vendor === VENDOR_JK && r.kind === "color") {
      b.jkColorMap[code] = name;
      b.colorMapAll[code] = name;
    } else if (r.vendor === VENDOR_WAYPOINT && r.kind === "modification") {
      b.modificationMap[name] = code; // name -> code, for sub-SKU composition
    }
    // other (vendor, kind) combinations are ignored by design
  }

  cache = b; // only swapped in on full success; a throw above leaves the old cache intact
}

/** Load the cache once (memoized). Await this in async handlers before decoding. */
export async function ensureSkuMaps(): Promise<void> {
  if (cache) return;
  if (!loadPromise) {
    loadPromise = load().catch((e) => {
      loadPromise = null; // self-heal: next call retries instead of caching the failure
      throw e;
    });
  }
  await loadPromise;
}

/** Force a reload (admin "Refresh" button, or after a sync/edit). Keeps the old cache if the reload fails. */
export async function refreshSkuMaps(): Promise<void> {
  await load(); // throws on failure, leaving the previous cache in place
  loadPromise = null;
}

/** True when no maps are loaded — callers treat a decode in this state as decoder_unavailable. */
export function skuMapsUnavailable(): boolean {
  return cache === null;
}

const EMPTY: Record<string, string> = Object.freeze({});

export const doorStyleMap = () => cache?.doorStyleMap ?? EMPTY;
export const doorStyleNameToCode = () => cache?.doorStyleNameToCode ?? EMPTY;
export const colorMap = () => cache?.colorMap ?? EMPTY;
export const colorNameToCode = () => cache?.colorNameToCode ?? EMPTY;
export const hciColorMap = () => cache?.hciColorMap ?? EMPTY;
export const jkColorMap = () => cache?.jkColorMap ?? EMPTY;
export const colorMapAll = () => cache?.colorMapAll ?? EMPTY;
export const modificationMap = () => cache?.modificationMap ?? EMPTY;
