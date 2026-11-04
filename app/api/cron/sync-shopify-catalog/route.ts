import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { runCatalogueSync } from "@/lib/shopifyCatalogue";

/**
 * GET /api/cron/sync-shopify-catalog -- the daily Shopify catalogue sync
 * (2026-11-04, item 5 part 2). Garrett: "I mainly want to make sure that the oms
 * is UpToDate without manual intervention" and "once a day at a quite hour is
 * best": 10:00 UTC, 3 AM Arizona (scripts/cron/crontab) -- after the Avis sync
 * (07:30) and production-complete (08:00), before cabinet-fulfilment (15:00),
 * whose vendor lookups read the catalogue.
 *
 * ⚠ THE SAME CODE AS THE ADMIN PAGE'S "Sync SKUs": lib/shopifyCatalogue's
 * runCatalogueSync -- every variant Shopify has, read whole over GraphQL before
 * anything is written; the rest marked removed (item 59); the colours judged
 * (item 60). It is what catches a product deleted in Shopify: no product
 * deletion webhook is subscribed.
 *
 * A failure answers its status (502 for Shopify, 500 for the database), so
 * run-cron.sh pings the check's /fail: healthchecks.io's `sync-shopify-catalog`
 * (both integrations), mapped in ~/cron-jobs/healthchecks.map on the box only;
 * the dashboard's "Catalog sync" row shows it (app/api/health-summary).
 *
 * Auth: Bearer CRON_SECRET, as the other cron endpoints.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runCatalogueSync();
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
