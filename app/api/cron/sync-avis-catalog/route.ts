import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { postTeamsCard } from "@/lib/teamsCard";
import { supabase } from "@/lib/supabase";
import { runAvisSync } from "@/lib/runAvisSync";

/**
 * GET /api/cron/sync-avis-catalog          — applies (this is the point)
 * GET /api/cron/sync-avis-catalog?dry=1    — reports only, writes nothing
 *
 * Nightly Avis catalog sync. Applying is deliberate: a colour added to Avis
 * ahead of a launch should have its blank mapping row waiting the next morning,
 * without anyone remembering to press a button. Orders then decode correctly
 * from the first one, instead of accumulating flagged lines to repair.
 *
 * What makes that safe is what the job cannot do: it never writes a sku_code,
 * never deletes, refuses an empty catalog, and only renames on unambiguous
 * evidence. See lib/runAvisSync.
 *
 * ALARMS — a notification that arrives every morning stops being read, so a
 * clean run says nothing at all. Teams is posted only when:
 *   - the run failed, or Avis was unreachable
 *   - a mapping was orphaned or renamed (something happened to data we rely on)
 *   - new values arrived needing codes
 *   - the previous successful run was more than 48h ago (the cron had stopped)
 *
 * Auth: Bearer CRON_SECRET, same as the other cron endpoints.
 */

const STALE_AFTER_HOURS = 48;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  // How long since the last SUCCESSFUL run? A cron that silently stops cannot
  // report on itself, but it can say so the moment it comes back.
  let hoursSinceLastOk: number | null = null;
  const { data: lastOk } = await supabase
    .from("sku_mapping_sync_runs")
    .select("ran_at")
    .eq("ok", true)
    .order("ran_at", { ascending: false })
    .limit(1);
  if (lastOk && lastOk.length > 0) {
    const t = new Date(lastOk[0].ran_at as string).getTime();
    if (isFinite(t)) hoursSinceLastOk = (Date.now() - t) / 36e5;
  }
  const wasStale = hoursSinceLastOk !== null && hoursSinceLastOk > STALE_AFTER_HOURS;

  const result = await runAvisSync({ apply: !dry, ranBy: "cron" });

  const nNew = result.creates.length;
  const nRenamed = result.renames.length;
  const nOrphan = result.orphans.length;
  const notable = !result.ok || nOrphan > 0 || nRenamed > 0 || nNew > 0 || wasStale;

  let notified: string = "not needed";
  if (notable) {
    const headline = !result.ok
      ? "Avis sync failed"
      : nOrphan > 0
        ? `${nOrphan} mapping${nOrphan === 1 ? "" : "s"} no longer offered by Avis`
        : nNew > 0
          ? `${nNew} new Avis value${nNew === 1 ? "" : "s"} need${nNew === 1 ? "s" : ""} a SKU code`
          : nRenamed > 0
            ? `${nRenamed} value${nRenamed === 1 ? "" : "s"} renamed in Avis`
            : "Avis sync recovered";

    const facts: Array<{ title: string; value: string }> = [];
    if (result.ok) {
      facts.push({ title: "New values", value: String(nNew) });
      facts.push({ title: "Renamed", value: String(nRenamed) });
      facts.push({ title: "No longer in Avis", value: String(nOrphan) });
      if (dry) facts.push({ title: "Mode", value: "dry run — nothing written" });
    } else {
      facts.push({ title: "Error", value: (result.error ?? "unknown").slice(0, 300) });
    }
    if (wasStale && hoursSinceLastOk !== null) {
      facts.push({
        title: "Gap since last success",
        value: `${Math.round(hoursSinceLastOk)}h — the nightly sync had stopped running`,
      });
    }

    const detailLines = [
      ...result.creates.map((c) => `• new: ${c.avis_name} (${c.from})`),
      ...result.renames.map((r) => `• renamed: ${r.from_name} → ${r.to_name}`),
      ...result.orphans.map(
        (o) => `• gone from Avis: ${o.avis_name}${o.sku_code ? ` (code ${o.sku_code})` : ""}`,
      ),
    ].slice(0, 20);

    const card = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "JK Cabinets — Avis catalog sync",
          weight: "Bolder",
          size: "Large",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: headline,
          color: result.ok && nOrphan === 0 ? "Warning" : "Attention",
          weight: "Bolder",
          spacing: "Medium",
          wrap: true,
        },
        { type: "FactSet", facts },
        ...(detailLines.length > 0
          ? [{ type: "TextBlock", text: detailLines.join("\n\n"), wrap: true, spacing: "Medium" }]
          : []),
      ],
      actions: [
        {
          type: "Action.OpenUrl",
          title: "Open SKU mappings",
          url: process.env.NEXTAUTH_URL
            ? `${process.env.NEXTAUTH_URL}/admin/mappings`
            : "https://www.ordersjkcabinets2you.com/admin/mappings",
        },
      ],
    };

    const posted = await postTeamsCard(card);
    notified = posted.ok ? "sent" : `not sent (${posted.reason})`;
  }

  // A failed sync returns 500 so run-cron.sh records a non-zero rc in its log.
  return NextResponse.json(
    {
      ok: result.ok,
      dry_run: result.dry_run,
      error: result.error,
      counts: result.counts,
      creates: result.creates,
      renames: result.renames,
      orphans: result.orphans,
      drift_logged: result.drift_logged,
      drift_resolved: result.drift_resolved,
      hours_since_last_success: hoursSinceLastOk === null ? null : Math.round(hoursSinceLastOk),
      notified,
    },
    { status: result.ok ? 200 : 500 },
  );
}
