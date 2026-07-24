import { supabase } from "@/lib/supabase";
import { refreshSkuMaps } from "@/lib/skuDecoder";
import {
  extractCatalogValues,
  planSync,
  driftFromPlan,
  driftKey,
  type AvisSetRaw,
  type ExistingMapping,
  type ExistingProvenance,
  type SyncPlan,
} from "@/lib/avisSync";

/**
 * runAvisSync — the Avis catalog sync as a single callable job.
 *
 * Lives here rather than in a route so the admin button and the nightly cron
 * run EXACTLY the same code. Two copies of a reconciliation this fiddly would
 * drift apart, and the failure would be silent.
 *
 * Guarantees, whatever calls it:
 *   - sku_code is never written. Codes are a human decision.
 *   - Nothing is ever deleted. Orphans are reported.
 *   - An empty catalog aborts rather than being read as "everything is gone".
 */

const BASE = "https://public-api.avisplus.io/api/public/v1";

export interface RunAvisSyncResult {
  ok: boolean;
  dry_run: boolean;
  error?: string;
  /** Suggested HTTP status when ok === false. */
  status?: number;
  option_sets_seen: number;
  counts: SyncPlan["counts"];
  creates: SyncPlan["creates"];
  renames: SyncPlan["renames"];
  orphans: SyncPlan["orphans"];
  drift_logged: number;
  drift_resolved: number;
  cache_refreshed?: boolean;
}

const EMPTY_COUNTS: SyncPlan["counts"] = {
  catalog_values: 0,
  creates: 0,
  renames: 0,
  new_links: 0,
  orphans: 0,
};

function fail(error: string, status: number, dry_run: boolean): RunAvisSyncResult {
  return {
    ok: false,
    dry_run,
    error,
    status,
    option_sets_seen: 0,
    counts: EMPTY_COUNTS,
    creates: [],
    renames: [],
    orphans: [],
    drift_logged: 0,
    drift_resolved: 0,
  };
}

export async function runAvisSync(opts: {
  apply: boolean;
  ranBy: string;
}): Promise<RunAvisSyncResult> {
  const { apply, ranBy } = opts;
  const dry_run = !apply;

  const token = process.env.AVIS_API_TOKEN;
  if (!token) return fail("AVIS_API_TOKEN is not set on this server.", 500, dry_run);

  // ── 1) Pull the catalog (paginated; the rate limit is 60/min) ────────────
  const sets: AvisSetRaw[] = [];
  try {
    let page = 1;
    let pages = 1;
    do {
      const res = await fetch(`${BASE}/option-sets?page=${page}&limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return fail(`Avis ${res.status} while listing option sets: ${body.slice(0, 200)}`, 502, dry_run);
      }
      const body = (await res.json()) as { data?: AvisSetRaw[]; pagination?: { pages?: number } };
      sets.push(...(body.data ?? []));
      pages = body.pagination?.pages ?? 1;
      page++;
    } while (page <= pages && page <= 10);
  } catch (e) {
    return fail(`Could not reach Avis: ${e instanceof Error ? e.message : String(e)}`, 502, dry_run);
  }

  const values = extractCatalogValues(sets);
  if (values.length === 0) {
    return fail(
      "The Avis catalog returned no mappable values. Refusing to continue — treating this as a fetch problem rather than 'everything was removed'.",
      502,
      dry_run,
    );
  }

  // ── 2) Current state ─────────────────────────────────────────────────────
  const { data: mRows, error: mErr } = await supabase
    .from("sku_mappings")
    .select("id, vendor, kind, avis_name, sku_code, source, active, code_required");
  if (mErr) return fail(mErr.message, 500, dry_run);

  const { data: pRows, error: pErr } = await supabase
    .from("sku_mapping_avis_values")
    .select("value_id, mapping_id, avis_value_name");
  if (pErr) return fail(pErr.message, 500, dry_run);

  const { data: dRows, error: dErr } = await supabase
    .from("sku_mapping_drift_log")
    .select("id, vendor, kind, avis_name, kind_of_drift")
    .eq("resolved", false);
  if (dErr) return fail(dErr.message, 500, dry_run);

  const plan = planSync(
    values,
    (mRows ?? []) as ExistingMapping[],
    (pRows ?? []) as ExistingProvenance[],
  );

  // ── 3) Drift: what is new, and what has since been put right ─────────────
  type OpenDrift = { id: string; vendor: string; kind: string; avis_name: string; kind_of_drift: string };
  const open = (dRows ?? []) as OpenDrift[];
  const openKeys = new Set(open.map((d) => driftKey(d.vendor, d.kind, d.avis_name, d.kind_of_drift)));

  // Log an open item once — a persistent orphan must not accumulate a row per night.
  const driftToWrite = driftFromPlan(plan).filter(
    (d) => d.resolved || !openKeys.has(driftKey(d.vendor, d.kind, d.avis_name, d.kind_of_drift)),
  );

  const nk = (vendor: string, kind: string, name: string) =>
    `${vendor}\u0000${kind}\u0000${name.trim().toLowerCase()}`;
  const offeredKeys = new Set(values.map((v) => nk(v.vendor, v.kind, v.name)));
  const settledKeys = new Set(
    ((mRows ?? []) as Array<ExistingMapping & { code_required?: boolean }>)
      .filter((m) => m.sku_code !== null || m.code_required === false)
      .map((m) => nk(m.vendor, m.kind, m.avis_name)),
  );
  const driftToResolve = open.filter((d) => {
    const k = nk(d.vendor, d.kind, d.avis_name);
    if (d.kind_of_drift === "orphaned") return offeredKeys.has(k);
    if (d.kind_of_drift === "new_value") return settledKeys.has(k);
    return false;
  });

  if (dry_run) {
    return {
      ok: true,
      dry_run: true,
      option_sets_seen: sets.length,
      counts: plan.counts,
      creates: plan.creates,
      renames: plan.renames,
      orphans: plan.orphans,
      drift_logged: driftToWrite.length,
      drift_resolved: driftToResolve.length,
    };
  }

  // ── 4) Apply ─────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const idByName = new Map<string, string>();
  for (const m of (mRows ?? []) as ExistingMapping[]) {
    idByName.set(nk(m.vendor, m.kind, m.avis_name), m.id);
  }

  try {
    if (plan.creates.length > 0) {
      const { data: inserted, error } = await supabase
        .from("sku_mappings")
        .insert(
          plan.creates.map((c) => ({
            vendor: c.vendor,
            kind: c.kind,
            avis_name: c.avis_name,
            sku_code: null,
            source: "avis",
            role: "build",
            active: true,
            last_seen_at: now,
          })),
        )
        .select("id, vendor, kind, avis_name");
      if (error) throw new Error(`creating mappings: ${error.message}`);
      for (const r of inserted ?? []) {
        idByName.set(nk(String(r.vendor), String(r.kind), String(r.avis_name)), r.id);
      }
    }

    for (const r of plan.renames) {
      const { error } = await supabase
        .from("sku_mappings")
        .update({ avis_name: r.to_name, updated_at: now, last_seen_at: now })
        .eq("id", r.mapping_id);
      if (error) throw new Error(`renaming ${r.from_name}: ${error.message}`);
    }

    const linkRows = plan.links
      .map((l) => ({
        mapping_id: l.mapping_id ?? idByName.get(nk(l.vendor, l.kind, l.avis_name)) ?? null,
        option_set_id: l.option_set_id,
        option_set_name: l.option_set_name,
        option_key: l.option_key,
        option_label_cart: l.option_label_cart,
        value_id: l.value_id,
        avis_value_name: l.avis_name,
        last_seen_at: now,
      }))
      .filter((r) => r.mapping_id);

    if (linkRows.length > 0) {
      const { error } = await supabase
        .from("sku_mapping_avis_values")
        .upsert(linkRows, { onConflict: "value_id" });
      if (error) throw new Error(`writing provenance: ${error.message}`);
    }

    const seenIds = Array.from(new Set(linkRows.map((r) => r.mapping_id as string)));
    if (seenIds.length > 0) {
      const { error } = await supabase
        .from("sku_mappings")
        .update({ last_seen_at: now })
        .in("id", seenIds);
      if (error) throw new Error(`touching last_seen_at: ${error.message}`);
    }

    if (driftToWrite.length > 0) {
      const { error } = await supabase.from("sku_mapping_drift_log").insert(
        driftToWrite.map((d) => ({
          vendor: d.vendor,
          kind: d.kind,
          avis_name: d.avis_name,
          kind_of_drift: d.kind_of_drift,
          detail: d.detail,
          resolved: d.resolved,
          resolved_at: d.resolved ? now : null,
        })),
      );
      if (error) throw new Error(`writing drift log: ${error.message}`);
    }
    if (driftToResolve.length > 0) {
      const { error } = await supabase
        .from("sku_mapping_drift_log")
        .update({ resolved: true, resolved_at: now })
        .in("id", driftToResolve.map((d) => d.id));
      if (error) throw new Error(`closing drift: ${error.message}`);
    }

    await supabase.from("sku_mapping_sync_runs").insert({
      ran_by: ranBy,
      ok: true,
      created_count: plan.counts.creates,
      renamed_count: plan.counts.renames,
      seen_count: seenIds.length,
      orphan_count: plan.counts.orphans,
      details: { creates: plan.creates, renames: plan.renames, orphans: plan.orphans },
    });

    let cache_refreshed = true;
    try {
      await refreshSkuMaps();
    } catch {
      cache_refreshed = false;
    }

    return {
      ok: true,
      dry_run: false,
      option_sets_seen: sets.length,
      counts: plan.counts,
      creates: plan.creates,
      renames: plan.renames,
      orphans: plan.orphans,
      drift_logged: driftToWrite.length,
      drift_resolved: driftToResolve.length,
      cache_refreshed,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sku_mapping_sync_runs").insert({
      ran_by: ranBy,
      ok: false,
      error: msg,
      details: { counts: plan.counts },
    });
    return fail(`Sync failed: ${msg}`, 500, false);
  }
}
