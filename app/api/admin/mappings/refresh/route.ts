import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  refreshSkuMaps,
  skuMapsUnavailable,
  doorStyleMap,
  colorMapAll,
  modificationMap,
} from "@/lib/skuDecoder";

/**
 * POST /api/admin/mappings/refresh   (Step 5)
 *
 * Re-read sku_mappings into the in-memory cache and report what loaded, so an
 * admin can confirm a change took rather than trusting a silent success.
 *
 * Note: the cache lives in the process that serves the request. On a single
 * container that is the whole app; behind multiple replicas the others pick the
 * change up on their own next load.
 *
 * Admin only.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    await refreshSkuMaps();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not reload the mappings" },
      { status: 503 },
    );
  }

  if (skuMapsUnavailable()) {
    return NextResponse.json(
      { error: "Mappings reloaded but the cache is still unavailable." },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    counts: {
      door_styles: Object.keys(doorStyleMap()).length,
      colors: Object.keys(colorMapAll()).length,
      modifications: Object.keys(modificationMap()).length,
    },
  });
}
