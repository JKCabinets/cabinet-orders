"use client";

/**
 * The style-group suggestions, fetched once per page and shared (2026-10-28,
 * step 4b). See app/api/sku-options. A failed load is not cached: the next
 * panel to mount asks again.
 */
import { useEffect, useState } from "react";

export type SkuOptions = {
  manufacturers: string[];
  byVendor: Record<string, { door_styles: string[]; colors: string[] }>;
};

let cache: SkuOptions | null = null;
let inflight: Promise<SkuOptions | null> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<SkuOptions | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch("/api/sku-options");
      if (!res.ok) return null;
      const b = await res.json() as Partial<SkuOptions>;
      cache = { manufacturers: Array.isArray(b.manufacturers) ? b.manufacturers : [], byVendor: b.byVendor ?? {} };
      listeners.forEach((fn) => fn());
      return cache;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSkuOptions(enabled = true): SkuOptions | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    if (!cache) void load();
    return () => { listeners.delete(fn); };
  }, [enabled]);
  return cache;
}

/**
 * Door styles and colours to suggest for what a style group's manufacturer
 * says: that vendor's, matched loosely ("waypoint" finds "Waypoint Cabinetry");
 * no match, every vendor's -- so typing still suggests something.
 */
export function optionsFor(o: SkuOptions | null, manufacturer: string): { door_styles: string[]; colors: string[] } {
  if (!o) return { door_styles: [], colors: [] };
  const m = manufacturer.trim().toLowerCase();
  const vendors = Object.keys(o.byVendor);
  const key = m ? (vendors.find((v) => v.toLowerCase() === m) ?? vendors.find((v) => v.toLowerCase().startsWith(m) || m.startsWith(v.toLowerCase().split(" ")[0]))) : undefined;
  if (key) return o.byVendor[key];
  const all = (k: "door_styles" | "colors") => Array.from(new Set(vendors.flatMap((v) => o.byVendor[v][k]))).sort();
  return { door_styles: all("door_styles"), colors: all("colors") };
}
