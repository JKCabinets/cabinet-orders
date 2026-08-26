import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { slaTier, slaRuleFor, slaAgeHours, formatStageAge } from "@/lib/sla";
import { ORDER_TYPES, type Order, type OrderType } from "@/lib/data";

/**
 * Weekday morning digest, posted to Teams.
 *
 * WHAT CHANGED, AND WHY IT HAD TO
 *   This route was the LAST consumer of SLA_TARGETS and daysInStage, and it
 *   carried three defects that were invisible only because TEAMS_WEBHOOK_URL
 *   has been empty since the Kamal cutover:
 *
 *   1. It used the pre-Alternate-Orders SLA API against a hardcoded list of
 *      four standard-flow stages.
 *
 *   2. Its SELECT omitted stage_entered_at, so daysInStage always fell through
 *      to parsing the `date` display string -- every "overdue" figure it has
 *      ever produced was ORDER AGE, not stage age. It also lacked the
 *      production and delivery columns the clockRuns gates need, so it could
 *      not have applied the real rules even if it had tried.
 *
 *   3. `neq("type", "warranty")` was written when that meant "standard orders
 *      only". It now INCLUDES samples and customs, mixing them into per-stage
 *      rollups keyed on standard-flow stage names.
 *
 *   It now uses the same slaTier / slaRuleFor / slaAgeHours the dashboard and
 *   /sla use. One definition of overdue, everywhere.
 *
 * WHY BY TYPE AND NOT BY STAGE
 *   Four flows have nineteen stages between them. A per-stage FactSet would be
 *   a wall nobody reads -- and a digest people skim past is worse than none,
 *   because its existence implies someone is watching.
 *
 *   One line per order type matches the SlaHealthByType table people already
 *   see in the app, so there is nothing to translate between the two.
 *
 * IT SENDS EVEN WHEN THERE IS NOTHING WRONG
 *   An all-clear line. A digest that only arrives with bad news is
 *   indistinguishable from a digest that has silently stopped working.
 */

/**
 * ⚠ DERIVED FROM ORDER_TYPES, NOT HARDCODED.
 *
 * This was a literal list of four. `hardware` was added on 2026-08-25 and the
 * list was not, so hardware rows were loaded, filtered out of every category
 * row, and STILL COUNTED in `totalActive` -- a digest whose headline number did
 * not match the sum of its own rows, with nothing to error about.
 *
 * The comment a few lines above already records this happening once:
 * `neq("type", "warranty")` meant "standard orders only" until samples and
 * customs quietly joined it. Twice is a pattern, so the list now comes from the
 * same place everything else does.
 *
 * LABELS is a Record over OrderType, so a sixth type is a COMPILE ERROR here
 * rather than a silently missing row. Same technique as TYPE_COPY in
 * OrdersHubClient.
 */
const TYPE_LABELS: Record<OrderType, string> = {
  order:    "Cabinet orders",
  hardware: "Hardware orders",
  sample:   "Sample orders",
  custom:   "Custom jobs",
  warranty: "Warranty claims",
};

const CATEGORIES = ORDER_TYPES.map((key) => ({ key, label: TYPE_LABELS[key] }));

/**
 * Every column the SLA rules read. Getting this list wrong is how the old
 * version silently reported order age: a missing column does not error, it
 * just makes the rule fall through to a weaker fallback.
 *
 *   stage_entered_at                                    the stage clock
 *   created_at / date                                   New measures from here
 *   reported_at                                         warranty New claim
 *   production_start_date, production_est_finish_date   In production clockRuns
 *   delivery_date, scheduled_delivery_date              At cross dock clockRuns
 */
const SELECT_COLUMNS = [
  "id", "name", "type", "stage", "date", "archived",
  "created_at", "reported_at", "stage_entered_at",
  "production_start_date", "production_est_finish_date",
  "delivery_date", "scheduled_delivery_date",
].join(", ");

interface TypeSummary {
  label: string;
  active: number;
  onTrack: number;
  overSoft: number;
  overHard: number;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    // Not configured. Return success so the cron does not retry, and so the
    // healthchecks ping still fires -- a job that is deliberately idle is not
    // a job that has failed.
    return NextResponse.json({ ok: true, skipped: "TEAMS_WEBHOOK_URL not set" });
  }

  // ── Load every active order, of every type ────────────────────────────
  const { data: rows, error } = await supabase
    .from("orders")
    .select(SELECT_COLUMNS)
    .eq("archived", false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const orders = (rows ?? []) as unknown as Order[];

  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  // ── Per-type rollups ──────────────────────────────────────────────────
  // Only rows whose clock is RUNNING are counted. A stage with no rule, or a
  // stage whose clockRuns has stopped because the awaited dates exist, is
  // neither on track nor overdue -- it is not being measured.
  const summaries: TypeSummary[] = CATEGORIES.map(cat => {
    const rowsOfType = orders.filter(o => (o.type ?? "order") === cat.key);
    let onTrack = 0, overSoft = 0, overHard = 0;
    for (const o of rowsOfType) {
      const rule = slaRuleFor(o);
      if (!rule) continue;
      if (rule.clockRuns && !rule.clockRuns(o)) continue;
      const tier = slaTier(o, now);
      if (tier === "hard") overHard++;
      else if (tier === "soft") overSoft++;
      else onTrack++;
    }
    return { label: cat.label, active: rowsOfType.length, onTrack, overSoft, overHard };
  });

  // ── The single worst offender, named ──────────────────────────────────
  // One order somebody can act on beats a table of counts.
  let worst: { order: Order; hours: number } | null = null;
  for (const o of orders) {
    if (slaTier(o, now) === "ok") continue;
    const rule = slaRuleFor(o);
    if (!rule) continue;
    const h = slaAgeHours(o, rule, now);
    if (h === null) continue;
    if (!worst || h > worst.hours) worst = { order: o, hours: h };
  }

  // ⚠ COUNTED FROM THE CATEGORY ROWS, not from the raw list.
  //
  // `orders.length` counted every row including types no category matched, so
  // the headline disagreed with the table beneath it whenever a type was
  // missing from CATEGORIES. Deriving it from the rows makes that impossible:
  // if a type is unrepresented the total drops too, which is visible, rather
  // than the total staying right and the rows quietly under-reporting.
  const totalActive = summaries.reduce((n, c) => n + c.active, 0);

  // A row whose type matches no category is a bug, not a silent omission.
  const uncategorised = orders.filter(
    (o) => !CATEGORIES.some((c) => c.key === (o.type ?? "order")));
  if (uncategorised.length > 0) {
    console.error(`[teams-digest] ${uncategorised.length} row(s) of an `
      + `unrecognised type: ${[...new Set(uncategorised.map(o => o.type))].join(", ")}`);
  }
  const totalPastSla = summaries.reduce((s, c) => s + c.overSoft + c.overHard, 0);
  const totalHard = summaries.reduce((s, c) => s + c.overHard, 0);
  const newSinceYesterday = orders.filter(o => {
    const t = new Date(String(o.created_at ?? "")).getTime();
    return isFinite(t) && t >= yesterday;
  }).length;

  // ── Build the Adaptive Card ───────────────────────────────────────────
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    timeZone: "America/Phoenix",
  });

  const headlineText = totalPastSla > 0
    ? `${totalPastSla} order${totalPastSla === 1 ? "" : "s"} past their SLA target`
    : "Everything on track";

  const base = (process.env.NEXTAUTH_URL ?? "https://www.ordersjkcabinets2you.com")
    .replace(/\/+$/, "");

  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock", text: "JK Cabinets — Morning briefing",
      weight: "Bolder", size: "Large", wrap: true,
    },
    { type: "TextBlock", text: todayLabel, isSubtle: true, spacing: "None", wrap: true },
    {
      type: "TextBlock", text: headlineText,
      color: totalHard > 0 ? "Attention" : totalPastSla > 0 ? "Warning" : "Good",
      weight: "Bolder", spacing: "Medium", wrap: true,
    },
  ];

  if (worst) {
    const rule = slaRuleFor(worst.order);
    const suffix = rule?.measureFrom === "created" || rule?.measureFrom === "reported"
      ? "old" : "in stage";
    body.push({
      type: "TextBlock",
      text: `Oldest: **${worst.order.id}** — ${formatStageAge(worst.hours)} ${suffix}, in ${worst.order.stage}`,
      wrap: true, spacing: "Small",
    });
  }

  body.push({
    type: "FactSet",
    spacing: "Medium",
    facts: [
      { title: "Active orders", value: String(totalActive) },
      { title: "New since yesterday", value: String(newSinceYesterday) },
      { title: "Past SLA", value: String(totalPastSla) },
    ],
  });

  body.push({
    type: "TextBlock", text: "By order type",
    weight: "Bolder", spacing: "Medium", wrap: true,
  });

  body.push({
    type: "FactSet",
    facts: summaries.map(s => ({
      title: s.label,
      value: s.active === 0
        ? "none active"
        : s.overHard + s.overSoft > 0
          ? `${s.active} active · ${[
              s.overHard > 0 ? `${s.overHard} past 48h` : null,
              s.overSoft > 0 ? `${s.overSoft} past 24h` : null,
            ].filter(Boolean).join(" · ")}`
          : `${s.active} active · on track`,
    })),
  });

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: [
      // /sla, not /dashboard: the digest exists to pull people into the detail,
      // and that is where the per-stage breakdown and the claimable list live.
      { type: "Action.OpenUrl", title: "Open the SLA page", url: `${base}/sla` },
    ],
  };

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };

  // ── SSRF guard on the webhook host ────────────────────────────────────
  // Only Microsoft hosts, so a misconfigured env var cannot make this POST at
  // an internal address. Covers both the legacy O365 connector format and the
  // current Power Automate one.
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return NextResponse.json({ error: "Invalid TEAMS_WEBHOOK_URL" }, { status: 500 });
  }
  const allowedHostSuffixes = [
    ".logic.azure.com",
    ".webhook.office.com",
    ".azure-apim.net",
    ".api.powerplatform.com",
  ];
  if (!allowedHostSuffixes.some(suffix => parsed.host.endsWith(suffix))) {
    return NextResponse.json(
      { error: "TEAMS_WEBHOOK_URL host not allowed", host: parsed.host },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({
        error: "Teams webhook rejected the payload",
        status: res.status,
        body: text.slice(0, 500),
      }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({
      error: "Failed to reach Teams webhook",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    posted: true,
    summary: {
      totalActive,
      newSinceYesterday,
      totalPastSla,
      worst: worst ? { id: worst.order.id, hours: Math.round(worst.hours) } : null,
      byType: summaries,
    },
  });
}
