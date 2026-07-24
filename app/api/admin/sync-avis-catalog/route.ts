import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { refreshSkuMaps } from "@/lib/skuDecoder";
import {
  extractCatalogValues,
  planSync,
  type AvisSetRaw,
  type ExistingMapping,
  type ExistingProvenance,
} from "@/lib/avisSync";

/**
 * POST /api/admin/sync-avis-catalog          (Step 5b)
 * POST /api/admin/sync-avis-catalog?apply=1
 *
 * Pull the Avis option catalog and reconcile it against sku_mappings:
 *   - values Avis offers that we have no mapping for  -> created with NO code,
 *     so they surface on /admin/mappings as "needs a code" BEFORE an order
 *     arrives carrying them
 *   - values whose name changed (same value_id, old name no longer offered)
 *     -> the mapping is renamed and KEEPS its sku_code
 *   - mappings Avis no longer offers -> reported as orphans, never deleted
 *
 * DRY RUN BY DEFAULT. Nothing is written unless ?apply=1. This is the first
 * thing that writes to the mapping table automatically, so seeing the plan
 * first is worth the extra click.
 *
 * sku_code is never written by this route. Codes are a human decision.
 *
 * Admin only.
 */

const BASE = "https://public-api.avisplus.io/api/public/v1";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const who = (auth as { session: { user: { username?: string; name?: string } } }).session.user;
  const ranBy = who.username ?? who.name ?? "admin";

  const apply = new URL(req.url).searchParams.get("apply") === "1";

  const token = process.env.AVIS_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "AVIS_API_TOKEN is not set on this server." },
      { status: 500 },
    );
  }

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
        return NextResponse.json(
          { error: `Avis ${res.status} while listing option sets`, body: body.slice(0, 400) },
          { status: 502 },
        );
      }
      const body = (await res.json()) as {
        data?: AvisSetRaw[];
        pagination?: { pages?: number };
      };
      sets.push(...(body.data ?? []));
      pages = body.pagination?.pages ?? 1;
      page++;
    } while (page <= pages && page <= 10);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach Avis: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const values = extractCatalogValues(sets);
  if (values.length === 0) {
    return NextResponse.json(
      {
        error:
          "The Avis catalog returned no mappable values. Refusing to continue — treating this as a fetch problem rather than 'delete everything'.",
        option_sets_seen: sets.length,
      },
      { status: 502 },
    );
  }

  // ── 2) Current state ─────────────────────────────────────────────────────
  const { data: mRows, error: mErr } = await supabase
    .from("sku_mappings")
    .select("id, vendor, kind, avis_name, sku_code, source, active");
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const { data: pRows, error: pErr } = await supabase
    .from("sku_mapping_avis_values")
    .select("value_id, mapping_id, avis_value_name");
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const plan = planSync(
    values,
    (mRows ?? []) as ExistingMapping[],
    (pRows ?? []) as ExistingProvenance[],
  );

  if (!apply) {
    return NextResponse.json({
      dry_run: true,
      option_sets_seen: sets.length,
      ...plan.counts,
      creates: plan.creates,
      renames: plan.renames,
      orphans: plan.orphans,
      message: "Nothing was written. Re-run with ?apply=1 to make these changes.",
    });
  }

  // ── 3) Apply ─────────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const idByName = new Map<string, string>();
  for (const m of (mRows ?? []) as ExistingMapping[]) {
    idByName.set(`${m.vendor}\u0000${m.kind}\u0000${m.avis_name.toLowerCase()}`, m.id);
  }

  try {
    // 3a. New mappings — no code, so they land as "needs a code".
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
        idByName.set(`${r.vendor}\u0000${r.kind}\u0000${String(r.avis_name).toLowerCase()}`, r.id);
      }
    }

    // 3b. Renames — the sku_code is deliberately left alone.
    for (const r of plan.renames) {
      const { error } = await supabase
        .from("sku_mappings")
        .update({ avis_name: r.to_name, updated_at: now, last_seen_at: now })
        .eq("id", r.mapping_id);
      if (error) throw new Error(`renaming ${r.from_name}: ${error.message}`);
      // No name-index update needed: planSync already resolved this value's
      // link to the existing mapping id.
    }

    // 3c. Provenance — one row per Avis value, upserted on value_id.
    const linkRows = plan.links.map((l) => ({
      mapping_id:
        l.mapping_id ??
        idByName.get(`${l.vendor}\u0000${l.kind}\u0000${l.avis_name.toLowerCase()}`) ??
        null,
      option_set_id: l.option_set_id,
      option_set_name: l.option_set_name,
      option_key: l.option_key,
      option_label_cart: l.option_label_cart,
      value_id: l.value_id,
      avis_value_name: l.avis_name,
      last_seen_at: now,
    })).filter((r) => r.mapping_id);

    if (linkRows.length > 0) {
      const { error } = await supabase
        .from("sku_mapping_avis_values")
        .upsert(linkRows, { onConflict: "value_id" });
      if (error) throw new Error(`writing provenance: ${error.message}`);
    }

    // 3d. Touch last_seen_at on every mapping the catalog still offers.
    const seenIds = Array.from(new Set(linkRows.map((r) => r.mapping_id as string)));
    if (seenIds.length > 0) {
      const { error } = await supabase
        .from("sku_mappings")
        .update({ last_seen_at: now })
        .in("id", seenIds);
      if (error) throw new Error(`touching last_seen_at: ${error.message}`);
    }

    // 3e. Record the run.
    await supabase.from("sku_mapping_sync_runs").insert({
      ran_by: ranBy,
      ok: true,
      created_count: plan.counts.creates,
      renamed_count: plan.counts.renames,
      seen_count: seenIds.length,
      orphan_count: plan.counts.orphans,
      details: { creates: plan.creates, renames: plan.renames, orphans: plan.orphans },
    });

    // 3f. Make the new rows live for decoding straight away.
    let cache_refreshed = true;
    try {
      await refreshSkuMaps();
    } catch {
      cache_refreshed = false;
    }

    return NextResponse.json({
      dry_run: false,
      option_sets_seen: sets.length,
      ...plan.counts,
      creates: plan.creates,
      renames: plan.renames,
      orphans: plan.orphans,
      cache_refreshed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("sku_mapping_sync_runs").insert({
      ran_by: ranBy,
      ok: false,
      error: msg,
      details: { counts: plan.counts },
    });
    return NextResponse.json({ error: `Sync failed: ${msg}` }, { status: 500 });
  }
}
