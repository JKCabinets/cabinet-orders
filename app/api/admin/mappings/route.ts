import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { refreshSkuMaps } from "@/lib/skuDecoder";

/**
 * /api/admin/mappings   (Step 5)
 *
 * GET   — every sku_mappings row, for the admin mappings page.
 * PATCH — assign or clear ONE row's sku_code, then warm the cache so the new
 *         code takes effect immediately (no deploy, no restart).
 *
 * Deliberately narrow: `vendor`, `kind` and `avis_name` are NOT editable. They
 * are the identity the Avis sync matches on (UNIQUE(vendor, kind, avis_name)),
 * so editing them here would orphan the row on the next sync and silently break
 * decoding. This page exists to assign CODES to values Avis already gave us.
 *
 * Admin only. The page's role check is UX; this is the actual gate.
 */

const SELECT = "id, vendor, kind, avis_name, sku_code, source, role, active";

/** Codes are short, uppercase, alphanumeric (410F, PL, RD, RTKB, BUTT). */
const CODE_RE = /^[A-Z0-9-]{1,24}$/;

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabase
    .from("sku_mappings")
    .select(SELECT)
    .order("vendor", { ascending: true })
    .order("kind", { ascending: true })
    .order("avis_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { id?: unknown; sku_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Empty string clears the code (back to "needs a code"); anything else must
  // look like a code. Normalizing here keeps the table consistent no matter how
  // it was typed.
  const raw = typeof body.sku_code === "string" ? body.sku_code.trim().toUpperCase() : "";
  const sku_code: string | null = raw === "" ? null : raw;
  if (sku_code !== null && !CODE_RE.test(sku_code)) {
    return NextResponse.json(
      { error: "A code is 1–24 characters, letters/numbers/hyphen only (e.g. 410F, PL, RTKB)." },
      { status: 400 },
    );
  }

  // Whitelist the column: only sku_code is writable from this page.
  const { data, error } = await supabase
    .from("sku_mappings")
    .update({ sku_code })
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });

  // Warm the cache so the change is live for the next decode. Non-fatal: the
  // write already succeeded, and reporting failure here would wrongly suggest
  // it didn't.
  let cache_refreshed = true;
  try {
    await refreshSkuMaps();
  } catch {
    cache_refreshed = false;
  }

  return NextResponse.json({ ok: true, row: data, cache_refreshed });
}
