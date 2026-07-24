/**
 * avisSync.ts — pure logic for the Avis catalog sync (Step 5b).
 *
 * No I/O: the route fetches from Avis and loads the DB, then calls these. That
 * keeps the reconciliation rules testable against a real catalog dump.
 *
 * Two steps:
 *   extractCatalogValues() — Avis option sets -> the values we actually map
 *   planSync()             — those values + current DB state -> a change plan
 *
 * The plan is data, not action. The route can show it (dry run) or apply it.
 */

export interface AvisValueRaw {
  value_id?: string;
  value?: string;
}
export interface AvisOptionRaw {
  key?: string;
  label_cart?: string;
  option_name?: string;
  type?: string;
  /** The live API returns option_values; our debug dump returns values. */
  option_values?: AvisValueRaw[];
  values?: AvisValueRaw[];
}
export interface AvisSetRaw {
  _id?: string;
  option_set_name?: string;
  status?: boolean;
  options?: AvisOptionRaw[];
}

export type MappingKind = "door_style" | "color" | "modification";

/** Waypoint is the only vendor whose options come from Avis. */
export const AVIS_VENDOR = "Waypoint Cabinetry";

/**
 * Which options carry mappable values, by their cart label.
 *
 * These deliberately mirror the property-name patterns the ingest parser
 * matches on (lib/modifications.ts + buildOrder's getPropLike), because the
 * cart label IS the order property name. Matching by pattern rather than
 * listing option sets means a new "Tall Cabinet Mods" set is picked up with no
 * code change, as long as its option is labelled the same way.
 *
 * Everything else is excluded by omission: the trim/sample colour pickers
 * ("Color", "Color Sample Blocks (Select Up to 4)"), layout containers
 * ("Step by step"), and the depth sliders ("Modified Depth", "Modified Reduced
 * Depth", "Select Depth") whose value is a number rather than a name.
 */
const KIND_RULES: Array<{ re: RegExp; kind: MappingKind }> = [
  { re: /^Door\s*Style(\s*\d+)?$/i, kind: "door_style" },
  { re: /^Color\s*Selection(\s*\d+)?$/i, kind: "color" },
  { re: /^(?:[A-Za-z]+\s+)?Modifications$/i, kind: "modification" },
  { re: /^Recessed\s*Toe\s*Kick\s*Options$/i, kind: "modification" },
];

export function kindForLabel(label: string): MappingKind | null {
  const l = (label ?? "").trim();
  if (!l) return null;
  for (const r of KIND_RULES) if (r.re.test(l)) return r.kind;
  return null;
}

export interface CatalogValue {
  vendor: string;
  kind: MappingKind;
  name: string;
  value_id: string;
  option_key: string;
  option_set_id: string;
  option_set_name: string;
  option_label_cart: string;
}

/** Slider/number options carry a placeholder value rather than a real name. */
const PLACEHOLDER = /^option_\d+$/i;

export function extractCatalogValues(sets: AvisSetRaw[]): CatalogValue[] {
  const out: CatalogValue[] = [];
  for (const s of sets ?? []) {
    for (const o of s.options ?? []) {
      const label = (o.label_cart ?? "").trim();
      const kind = kindForLabel(label);
      if (!kind) continue;
      const values = o.option_values ?? o.values ?? [];
      for (const v of values) {
        const name = (v.value ?? "").trim();
        const value_id = (v.value_id ?? "").trim();
        if (!name || !value_id || PLACEHOLDER.test(name)) continue;
        out.push({
          vendor: AVIS_VENDOR,
          kind,
          name,
          value_id,
          option_key: (o.key ?? "").trim(),
          option_set_id: (s._id ?? "").trim(),
          option_set_name: (s.option_set_name ?? "").trim(),
          option_label_cart: label,
        });
      }
    }
  }
  return out;
}

/* ── Reconciliation ─────────────────────────────────────────────────────── */

export interface ExistingMapping {
  id: string;
  vendor: string;
  kind: string;
  avis_name: string;
  sku_code: string | null;
  source: string;
  active: boolean;
}
export interface ExistingProvenance {
  value_id: string;
  mapping_id: string;
  avis_value_name: string;
}

export interface PlannedCreate {
  vendor: string;
  kind: MappingKind;
  avis_name: string;
  /** The Avis values that will point at the new mapping. */
  value_ids: string[];
  from: string; // human note: which set/option it came from
}
export interface PlannedRename {
  mapping_id: string;
  from_name: string;
  to_name: string;
  sku_code: string | null; // carried across — the point of tracking value_id
  value_id: string;
}
export interface PlannedLink {
  value_id: string;
  /** Resolved to a mapping id when it already exists; else by name for creates. */
  mapping_id: string | null;
  vendor: string;
  kind: MappingKind;
  avis_name: string;
  option_set_id: string;
  option_set_name: string;
  option_key: string;
  option_label_cart: string;
  is_new_link: boolean;
}
export interface PlannedOrphan {
  mapping_id: string;
  vendor: string;
  kind: string;
  avis_name: string;
  sku_code: string | null;
}

export interface SyncPlan {
  creates: PlannedCreate[];
  renames: PlannedRename[];
  links: PlannedLink[];
  orphans: PlannedOrphan[];
  seen_value_ids: string[];
  counts: {
    catalog_values: number;
    creates: number;
    renames: number;
    new_links: number;
    orphans: number;
  };
}

const keyOf = (vendor: string, kind: string, name: string) =>
  `${vendor}\u0000${kind}\u0000${name.trim().toLowerCase()}`;

/**
 * Work out what would change, without changing anything.
 *
 * Rules:
 *  - A value whose name already has a mapping just links to it (this is how
 *    the first run back-fills provenance for rows created by hand).
 *  - A value we have seen before whose name changed, where the OLD name is no
 *    longer offered anywhere in the catalog, is a RENAME: the mapping keeps its
 *    sku_code. If the old name IS still offered — as happens when several Avis
 *    values share a name — a new mapping is created instead, because the old
 *    one is still in use.
 *  - A name with no mapping at all is created with NO code, so it surfaces on
 *    /admin/mappings as "needs a code".
 *  - A Waypoint mapping sourced from Avis whose name the catalog no longer
 *    offers is reported as an ORPHAN. Never auto-deleted: removal is a
 *    decision, and `source='manual'` rows are exempt entirely.
 */
export function planSync(
  values: CatalogValue[],
  mappings: ExistingMapping[],
  provenance: ExistingProvenance[],
): SyncPlan {
  const byKey = new Map<string, ExistingMapping>();
  const byId = new Map<string, ExistingMapping>();
  for (const m of mappings) {
    byKey.set(keyOf(m.vendor, m.kind, m.avis_name), m);
    byId.set(m.id, m);
  }
  const provByValue = new Map<string, ExistingProvenance>();
  for (const p of provenance) provByValue.set(p.value_id, p);

  // Every (vendor, kind, name) the catalog currently offers.
  const offered = new Set<string>();
  for (const v of values) offered.add(keyOf(v.vendor, v.kind, v.name));

  const creates = new Map<string, PlannedCreate>();
  const renames: PlannedRename[] = [];
  const links: PlannedLink[] = [];
  const seen_value_ids: string[] = [];
  const renamedIds = new Set<string>();

  for (const v of values) {
    const k = keyOf(v.vendor, v.kind, v.name);
    const prov = provByValue.get(v.value_id);
    if (prov) seen_value_ids.push(v.value_id);

    const existing = byKey.get(k);
    if (existing) {
      links.push({
        value_id: v.value_id,
        mapping_id: existing.id,
        vendor: v.vendor,
        kind: v.kind,
        avis_name: v.name,
        option_set_id: v.option_set_id,
        option_set_name: v.option_set_name,
        option_key: v.option_key,
        option_label_cart: v.option_label_cart,
        is_new_link: !prov,
      });
      continue;
    }

    // No mapping under this name. If this value used to point at one whose name
    // the catalog no longer offers, treat it as a rename and keep the code.
    const prev = prov ? byId.get(prov.mapping_id) : undefined;
    if (
      prev &&
      !renamedIds.has(prev.id) &&
      !offered.has(keyOf(prev.vendor, prev.kind, prev.avis_name))
    ) {
      renamedIds.add(prev.id);
      renames.push({
        mapping_id: prev.id,
        from_name: prev.avis_name,
        to_name: v.name,
        sku_code: prev.sku_code,
        value_id: v.value_id,
      });
      byKey.set(k, { ...prev, avis_name: v.name });
      links.push({
        value_id: v.value_id,
        mapping_id: prev.id,
        vendor: v.vendor,
        kind: v.kind,
        avis_name: v.name,
        option_set_id: v.option_set_id,
        option_set_name: v.option_set_name,
        option_key: v.option_key,
        option_label_cart: v.option_label_cart,
        is_new_link: !prov,
      });
      continue;
    }

    // Genuinely new value -> a blank mapping to be coded by an admin.
    const c = creates.get(k);
    if (c) {
      c.value_ids.push(v.value_id);
    } else {
      creates.set(k, {
        vendor: v.vendor,
        kind: v.kind,
        avis_name: v.name,
        value_ids: [v.value_id],
        from: `${v.option_set_name} / ${v.option_label_cart}`,
      });
    }
    links.push({
      value_id: v.value_id,
      mapping_id: null, // resolved after the create is written
      vendor: v.vendor,
      kind: v.kind,
      avis_name: v.name,
      option_set_id: v.option_set_id,
      option_set_name: v.option_set_name,
      option_key: v.option_key,
      option_label_cart: v.option_label_cart,
      is_new_link: true,
    });
  }

  // Orphans: Avis-sourced Waypoint mappings the catalog no longer offers.
  // Scoped to the Avis vendor so HCI / J&K rows are never touched.
  const orphans: PlannedOrphan[] = [];
  for (const m of mappings) {
    if (m.vendor !== AVIS_VENDOR) continue;
    if (m.source !== "avis") continue; // manual rows are deliberate
    if (renamedIds.has(m.id)) continue;
    if (offered.has(keyOf(m.vendor, m.kind, m.avis_name))) continue;
    orphans.push({
      mapping_id: m.id,
      vendor: m.vendor,
      kind: m.kind,
      avis_name: m.avis_name,
      sku_code: m.sku_code,
    });
  }

  const createList = Array.from(creates.values());
  return {
    creates: createList,
    renames,
    links,
    orphans,
    seen_value_ids,
    counts: {
      catalog_values: values.length,
      creates: createList.length,
      renames: renames.length,
      new_links: links.filter((l) => l.is_new_link).length,
      orphans: orphans.length,
    },
  };
}
