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
 * ⚠ FOUR REAL CHECKS, ONE PER CRON JOB. See OPERATIONS-2026-08-20.md §6.
 *
 * The account carries eleven. The other seven are STRAY -- leftovers from an
 * earlier setup, listed for deletion in OPERATIONS §12, each with a 365-day
 * period so they report "up" forever whatever happens.
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
];

/**
 * ⚠ NAMED, NOT MERELY UNGROUPED.
 *
 * These are the seven strays. Leaving them out of HEALTH_GROUPS would drop
 * them into "Other checks" below -- where a GENUINELY NEW check also lands.
 * Then the one signal that matters (somebody added a cron and nobody mapped
 * it) would be buried under seven that mean nothing.
 *
 * Deleting them from healthchecks.io is on the operations list; until that
 * happens they are ignored here BY NAME, so the day one is deleted or a
 * twelfth appears, this list stops matching and the difference shows up.
 */
const IGNORED_CHECKS: readonly string[] = [
  "jk-sync-failure", "jk-orphan-mapping", "jk-option-rename",
  "jk-new-option-values", "jk-stale-sync", "jk-storefront",
  "jk-orders-overdue",
];

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
      return !claimed.has(n) && !IGNORED_CHECKS.includes(n);
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

    // ⚠ `total` COUNTS WHAT IS MONITORED, not what the account holds. Eleven
    // checks exist; four of them watch anything. Reporting eleven would tell a
    // reader the system is more observed than it is.
    const monitored = all.length - IGNORED_CHECKS.filter(
      (n) => byName.has(n)).length;
    return NextResponse.json({
      configured: true,
      groups,
      total: monitored,
      ignored: all.length - monitored,
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
