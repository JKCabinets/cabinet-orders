/**
 * GET /api/sku-options -- what a custom job's style groups SUGGEST (2026-10-28,
 * item 8 step 4b; Garrett: "dropdowns that also accept typing").
 *
 *   manufacturers   every vendor's name
 *   byVendor        each vendor's door style and colour NAMES
 *
 * Names only -- no codes, no roles -- for any signed-in member: the only route to
 * sku_mappings was /api/admin/mappings, admin-only, so a member would have had no
 * suggestions. Suggestions, not rules: the specs fields stay free text.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "sku-options:get");
  if (limited) return limited;

  const [vendorsRes, mapsRes] = await Promise.all([
    supabase.from("vendors").select("name").order("name", { ascending: true }),
    supabase.from("sku_mappings").select("vendor, kind, avis_name, sku_code"),
  ]);
  if (vendorsRes.error || mapsRes.error) {
    return NextResponse.json({ error: (vendorsRes.error ?? mapsRes.error)!.message }, { status: 500 });
  }

  const byVendor: Record<string, { door_styles: string[]; colors: string[] }> = {};
  for (const r of (mapsRes.data ?? []) as { vendor: string | null; kind: string | null; avis_name: string | null; sku_code: string | null }[]) {
    // A name seen but not yet coded is not a real choice yet.
    if (!r.sku_code || !r.avis_name || !r.vendor) continue;
    const name = r.avis_name.trim();
    if (!name) continue;
    const b = (byVendor[r.vendor] ??= { door_styles: [], colors: [] });
    if (r.kind === "door_style" && !b.door_styles.includes(name)) b.door_styles.push(name);
    if (r.kind === "color" && !b.colors.includes(name)) b.colors.push(name);
  }
  for (const b of Object.values(byVendor)) { b.door_styles.sort(); b.colors.sort(); }
  const manufacturers = Array.from(new Set(((vendorsRes.data ?? []) as { name: string | null }[])
    .map((v) => String(v.name ?? "").trim()).filter(Boolean)));

  return NextResponse.json({ manufacturers, byVendor }, { headers: { "Cache-Control": "private, max-age=300" } });
}
