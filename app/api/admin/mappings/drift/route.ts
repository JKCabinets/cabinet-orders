import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * /api/admin/mappings/drift        (Step 5c)
 *
 * GET        — open drift items (add ?all=1 to include resolved history).
 * PATCH      — { id, resolved } to close an item, or reopen it.
 *
 * Drift is written by the Avis catalog sync: values Avis has that we do not
 * (new_value), mappings Avis no longer offers (orphaned), and renames, which
 * are recorded already closed because the code carries across on its own.
 *
 * The sync closes items automatically once the world agrees again — an orphan
 * that reappears in Avis, or a new value that has since been given a code. This
 * endpoint is for the judgement calls: "we know Avis dropped it, we are keeping
 * the mapping."
 *
 * Admin only.
 */

const SELECT =
  "id, detected_at, vendor, kind, avis_name, kind_of_drift, detail, resolved, resolved_at";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const all = new URL(req.url).searchParams.get("all") === "1";

  let q = supabase.from("sku_mapping_drift_log").select(SELECT);
  if (!all) q = q.eq("resolved", false);

  const { data, error } = await q.order("detected_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { id?: unknown; resolved?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: "resolved must be true or false" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sku_mapping_drift_log")
    .update({
      resolved: body.resolved,
      resolved_at: body.resolved ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Drift item not found" }, { status: 404 });

  return NextResponse.json({ ok: true, item: data });
}
