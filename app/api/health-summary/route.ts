import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";

/**
 * System health, rolled up — for ANY signed-in user.
 *
 * ⚠ WHY THIS IS SEPARATE FROM /api/admin/health.
 *
 * The dashboard shows everyone whether the system is working. The full check
 * list — names like `jk-orphan-mapping`, schedules, ping times — is admin
 * detail, and `/api/admin/*` is guarded by path. A non-admin fetching the admin
 * route got a 403, which the panel rendered as "Not configured": a permissions
 * failure reported as a configuration failure, in the one panel whose whole
 * purpose is not to confuse those.
 *
 * ⚠ A CONVENIENCE LAYER OVER EMAIL, NEVER A REPLACEMENT. Recorded in
 * SESSION-HANDOFF §2.2 and worth repeating here: the dead-man's switch works
 * because it is OFF-BOX. If the box is down, so is the OMS, and this panel
 * shows nothing at all. healthchecks.io emailing on failure is the alarm; this
 * is a window onto it.
 *
 * ⚠ THE ROLLUP HAPPENS ON THE SERVER, deliberately. Sending every check and
 * hiding the names in the component would mean a non-admin's browser HAS the
 * list — hiding it in the UI is not access control, the same reasoning as the
 * claim buttons and the stage rail. This returns three statuses and a count.
 * Nothing identifying a check leaves the server.
 */

/**
 * ⚠ ONE REAL CHECK PER JOB. See OPERATIONS-2026-08-20.md §6.
 *
 * The account carried eleven until 2026-10-20, when Garrett deleted the seven
 * STRAYS -- leftovers from an earlier setup, each with a 365-day period so they
 * reported "up" forever whatever happened (OPERATIONS §12). Six remain, and
 * every one is in a group below.
 *
 * The first version of this panel grouped all eleven. The dashboard then read
 * "Catalog sync · Healthy · 5 checks" when FOUR OF THOSE FIVE could not
 * report anything else. That is green-because-nobody-asked wearing the costume
 * of five checks agreeing -- precisely the failure this panel exists to catch,
 * and it took reading the operations doc to see it.
 */
const HEALTH_GROUPS: { key: string; label: string; detail: string; checks: string[] }[] = [
  {
    key: "ingest",
    label: "Shopify ingest",
    detail: "Orders arriving from the storefront",
    checks: ["jk-webhook-health"],
  },
  {
    key: "catalog",
    label: "Catalog sync",
    detail: "Waypoint option catalogue",
    checks: ["sync-avis-catalog"],
  },
  {
    key: "jobs",
    label: "Scheduled jobs",
    detail: "Production advance and the team digest",
    checks: ["production-complete", "teams-digest"],
  },
  {
    // 2026-10-05: the retry job that sends website claims on to Help Scout.
    // It fails only when a claim has been stuck for about an hour.
    key: "helpscout",
    label: "Claims to Help Scout",
    detail: "Website claims reaching the Help Scout inbox",
    checks: ["helpscout-sync"],
  },
  {
    // 2026-10-20 (Garrett): its own row. The weekly check-registry-token.sh
    // warns 14 days before the GHCR token deploys depend on expires -- a
    // classic GitHub personal access token for GitHub's container registry, in
    // .env.kamal (OPERATIONS §5). A failing token stops no order -- it stops
    // fixes from shipping -- so it is named, not folded into "Scheduled jobs".
    // Until now it sat under "Other checks", never grouped. (This said "Docker
    // Hub" for a day; the registry is GHCR. Corrected 2026-10-21.)
    key: "deploys",
    label: "Deploys",
    detail: "GitHub registry token for deploys",
    checks: ["registry-token"],
  },
];

// (2026-10-20) The ignore list is gone: it named the seven stray checks so they
// would not crowd "Other checks", and Garrett has deleted them. Anything not
// grouped above now lands in "Other checks", as a genuinely new check should.

/** down beats grace beats new/paused beats up — the worst wins. */
function worst(statuses: string[]): string {
  const rank = (s: string) =>
    s === "down" ? 0 : s === "grace" ? 1 : s === "new" ? 2 : s === "paused" ? 3 : 4;
  return statuses.slice().sort((a, b) => rank(a) - rank(b))[0] ?? "up";
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  // ⚠ GENEROUS ON PURPOSE. checkRateLimit buckets by `${bucket}:${ip}`, NOT by
  // user -- so everyone in one office shares a single allowance. This fires on
  // every dashboard load, and a colleague refreshing must not be able to 429
  // somebody else's health panel into reading "Not configured".
  //
  // The IP-keyed bucket is a wider problem than this route: it applies to every
  // rate-limited endpoint in the app, and one person's activity can lock out a
  // colleague behind the same NAT. Recorded here rather than fixed here.
  const limited = await rateLimitOr429(req, 240, 60_000, "health:summary");
  if (limited) return limited;

  const key = process.env.HEALTHCHECKS_API_KEY;
  if (!key) return NextResponse.json({ configured: false, groups: [] });

  try {
    const res = await fetch("https://healthchecks.io/api/v3/checks/", {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({
        configured: true,
        error: `Monitor returned ${res.status}`,
        groups: [],
      });
    }

    const body = await res.json() as { checks?: { name?: string; status?: string }[] };
    const all = body.checks ?? [];
    const byName = new Map(all.map((c) => [c.name ?? "", c.status ?? "new"]));

    const claimed = new Set<string>();
    const groups = HEALTH_GROUPS.map((g) => {
      const found = g.checks
        .map((n) => { claimed.add(n); return byName.get(n); })
        .filter((s): s is string => !!s);
      return found.length === 0 ? null : {
        key: g.key,
        label: g.label,
        detail: g.detail,
        status: worst(found),
        count: found.length,
      };
    }).filter((g): g is NonNullable<typeof g> => g !== null);

    // ⚠ Anything the groups do not name. Reported as a COUNT with a status --
    // never a name, since that is the detail this endpoint exists to withhold.
    // Without it a check added next month would be silently unmonitored on
    // this panel, which is the failure the panel was built for.
    const orphans = all.filter((c) => {
      const n = c.name ?? "";
      return !claimed.has(n);
    });
    if (orphans.length > 0) {
      groups.push({
        key: "other",
        label: "Other checks",
        detail: "Not yet grouped",
        status: worst(orphans.map((o) => o.status ?? "new")),
        count: orphans.length,
      });
    }

    // ⚠ `total` COUNTS WHAT IS MONITORED. With the strays deleted
    // (2026-10-20) that is every check on the account; it read eleven-minus-
    // seven while seven stood there reporting nothing.
    return NextResponse.json({
      configured: true,
      groups,
      total: all.length,
    });
  } catch (err) {
    // A monitoring outage is not an application outage. Saying so keeps people
    // from learning to ignore both.
    return NextResponse.json({
      configured: true,
      error: "Could not reach the monitor",
      groups: [],
      detail: String(err),
    });
  }
}
