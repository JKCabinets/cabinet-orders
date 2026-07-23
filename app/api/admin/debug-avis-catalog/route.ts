import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/admin/debug-avis-catalog     (TEMPORARY — delete after use)
 *
 * Dumps the shop's Avis (Aris Product Options) catalog so we can design the
 * sync against what is actually there: which option sets exist, what they are
 * called, and every option/value with its STABLE identifiers.
 *
 * Why this exists: the sync has to map option sets onto (vendor, kind) pairs —
 * e.g. "Waypoint Color Options" -> (Waypoint Cabinetry, color) — and that
 * mapping cannot be guessed. One read-only look first, design second.
 *
 * Requires AVIS_API_TOKEN in the environment. Per the Aris docs the token is
 * issued per shop by the ArisPlus team.
 *
 * Query params:
 *   ?raw=<option_set_id>   return that one set verbatim, no condensing
 *
 * Admin only, read-only, no writes anywhere.
 */

const BASE = "https://public-api.avisplus.io/api/public/v1";

interface AvisValue {
  value_id?: string;
  value?: string;
  isValueActive?: string; // boolean-like STRING: "TRUE" / "FALSE"
}
interface AvisOption {
  key?: string;
  option_id?: string;
  option_name?: string;
  label_cart?: string;
  label_product?: string;
  type?: string;
  option_values?: AvisValue[];
}
interface AvisOptionSet {
  _id?: string;
  option_set_name?: string;
  status?: boolean;
  type?: string;
  updated_at?: string;
  options?: AvisOption[];
}

async function avisGet(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body — surfaced below via the raw text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const token = process.env.AVIS_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "AVIS_API_TOKEN is not set. Add it to the Kamal env and redeploy. Per the Aris docs the token is issued per shop by the ArisPlus team.",
      },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);

  // Escape hatch: dump one set verbatim when the condensed view isn't enough.
  const raw = searchParams.get("raw");
  if (raw) {
    const r = await avisGet(`/option-sets/${encodeURIComponent(raw)}`, token);
    if (!r.ok) {
      return NextResponse.json(
        { error: `Avis ${r.status}`, body: r.text.slice(0, 800) },
        { status: 502 },
      );
    }
    return NextResponse.json(r.json);
  }

  // 1) Enumerate the option sets (paginated; limit maxes out at 100).
  const sets: AvisOptionSet[] = [];
  let page = 1;
  let pages = 1;
  do {
    const r = await avisGet(`/option-sets?page=${page}&limit=100`, token);
    if (!r.ok) {
      return NextResponse.json(
        { error: `Avis ${r.status} listing option sets`, body: r.text.slice(0, 800) },
        { status: 502 },
      );
    }
    const body = r.json as { data?: AvisOptionSet[]; pagination?: { pages?: number } };
    sets.push(...(body.data ?? []));
    pages = body.pagination?.pages ?? 1;
    page++;
  } while (page <= pages && page <= 10); // hard stop; rate limit is 60/min

  // 2) The list response may not populate options[], so fetch each set by id.
  //    Sequential on purpose — 60 requests/minute per shop.
  const detailed: Array<Record<string, unknown>> = [];
  for (const s of sets) {
    if (!s._id) continue;
    const r = await avisGet(`/option-sets/${encodeURIComponent(s._id)}`, token);
    const full = r.ok
      ? ((r.json as { data?: AvisOptionSet }).data ?? s)
      : s;

    detailed.push({
      _id: full._id,
      option_set_name: full.option_set_name,
      status: full.status,
      type: full.type,
      updated_at: full.updated_at,
      detail_fetch: r.ok ? "ok" : `failed ${r.status}`,
      options: (full.options ?? []).map((o) => ({
        key: o.key, // <- stable option identifier
        type: o.type,
        option_name: o.option_name, // admin-only name
        label_cart: o.label_cart, // <- becomes the line-item property name
        label_product: o.label_product,
        value_count: (o.option_values ?? []).length,
        values: (o.option_values ?? []).map((v) => ({
          value_id: v.value_id, // <- stable value identifier
          value: v.value, // <- the name we map to a SKU code
          active: v.isValueActive, // boolean-like string
        })),
      })),
    });
  }

  return NextResponse.json({
    set_count: detailed.length,
    sets: detailed,
  });
}
