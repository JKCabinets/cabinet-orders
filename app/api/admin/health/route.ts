import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";

/**
 * System health — read from healthchecks.io.
 *
 * Every scheduled job pings a check after it runs (see ~/cron-jobs/run-cron.sh
 * on the box). healthchecks.io knows when each check last reported and whether
 * it is late. This surfaces that where somebody will see it.
 *
 * ⚠ WHY THIS PANEL EXISTS. On 2026-08-20 three ping URLs were pasted from a
 * client that wraps links in angle brackets. Every ping returned HTTP 400, and
 * the caller discarded the result. The jobs ran fine, cron logged rc=0, and the
 * dead-man's switch was dead for SIX DAYS -- the only visible symptom was a
 * timestamp on a dashboard nobody had reason to open. That dashboard is now
 * here.
 *
 * ⚠ IT LISTS EVERY CHECK THE KEY CAN SEE, not a hardcoded set. Naming two
 * checks in code would mean a cron added next month is invisible -- which is
 * exactly the failure above, wearing a different hat.
 *
 * A read-only API key is enough: this never pings, pauses or creates anything.
 */

export interface HealthCheck {
  name: string;
  /** healthchecks.io's own vocabulary: up | down | grace | paused | new. */
  status: string;
  /** ISO timestamp of the last ping, or null if it has never reported. */
  last_ping: string | null;
  /** Human schedule -- a cron expression or a period in seconds. */
  schedule: string | null;
}

interface HcCheck {
  name?: string;
  status?: string;
  last_ping?: string | null;
  schedule?: string | null;
  timeout?: number | null;
  grace?: number | null;
}

/** "0 8 * * *" stays as it is; a raw period becomes something readable. */
function describeSchedule(c: HcCheck): string | null {
  if (c.schedule) return c.schedule;
  if (typeof c.timeout === "number") {
    const h = Math.round(c.timeout / 3600);
    if (h >= 24 && h % 24 === 0) return `every ${h / 24}d`;
    if (h >= 1) return `every ${h}h`;
    return `every ${Math.round(c.timeout / 60)}m`;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "admin:health");
  if (limited) return limited;

  const key = process.env.HEALTHCHECKS_API_KEY;
  if (!key) {
    // ⚠ SAYS SO RATHER THAN SHOWING GREEN. A panel reporting health it never
    // checked is worse than an empty one, and this is the one place that has
    // to stay trustworthy.
    //
    // Note the variable must be in BOTH .env.kamal AND the `secret:` list in
    // config/deploy.yml -- one without the other reaches nothing, and Kamal
    // does not warn. config/deploy.yml carries that warning at line 105.
    return NextResponse.json({ configured: false, checks: [] });
  }

  try {
    const res = await fetch("https://healthchecks.io/api/v3/checks/", {
      headers: { "X-Api-Key": key },
      // Their API is fast; a slow reply must not hold the dashboard open.
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          configured: true,
          error: `healthchecks.io returned ${res.status}`,
          checks: [],
        },
        // 200 on purpose: the DASHBOARD is fine, the upstream is not, and the
        // panel renders the message. A 500 here would look like our own bug.
        { status: 200 },
      );
    }

    const body = await res.json() as { checks?: HcCheck[] };
    const checks: HealthCheck[] = (body.checks ?? []).map((c) => ({
      name: c.name ?? "(unnamed)",
      status: c.status ?? "new",
      last_ping: c.last_ping ?? null,
      schedule: describeSchedule(c),
    }));

    // Anything not "up" first -- the panel is read at a glance, and the thing
    // worth seeing is what is wrong.
    const rank = (s: string) =>
      s === "down" ? 0 : s === "grace" ? 1 : s === "paused" ? 2 : s === "new" ? 3 : 4;
    checks.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));

    return NextResponse.json({ configured: true, checks });
  } catch (err) {
    // Timeout, DNS, TLS. Report it rather than throwing: a monitoring outage
    // is not an application outage, and conflating them trains people to
    // ignore both.
    return NextResponse.json(
      { configured: true, error: `Could not reach healthchecks.io (${String(err)})`, checks: [] },
      { status: 200 },
    );
  }
}
