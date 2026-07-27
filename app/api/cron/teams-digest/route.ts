import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { SLA_TARGETS, daysInStage } from "@/lib/sla";
import type { Order, OrderStage } from "@/lib/data";

const STAGES: OrderStage[] = ["New", "Entered", "In production", "At cross dock"];

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    // Not configured yet — return success so the cron doesn't keep
    // retrying. Operator will set the env var once the Teams workflow
    // is ready.
    return NextResponse.json({ ok: true, skipped: "TEAMS_WEBHOOK_URL not set" });
  }

  // ── Load active orders ────────────────────────────────────────────
  const { data: rows, error } = await supabase
    .from("orders")
    .select("id, name, stage, date, created_at, archived, type")
    .eq("archived", false)
    .neq("type", "warranty"); // digest covers production orders only

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const orders = (rows ?? []) as unknown as (Order & { created_at: string })[];

  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  // ── Compute per-stage rollups ─────────────────────────────────────
  const perStage = STAGES.map(stage => {
    const inStage = orders.filter(o => o.stage === stage);
    const target = SLA_TARGETS[stage];
    const overdue = isFinite(target)
      ? inStage.filter(o => {
          const d = daysInStage(o, now);
          return d !== null && d > target;
        }).length
      : 0;
    return { stage, total: inStage.length, overdue, target };
  });

  const totalActive = orders.length;
  const newSinceYesterday = orders.filter(o => {
    const t = new Date(o.created_at).getTime();
    return isFinite(t) && t >= yesterday;
  }).length;
  const totalOverdue = perStage.reduce((sum, s) => sum + s.overdue, 0);

  // ── Build the Adaptive Card ───────────────────────────────────────
  // Power Automate "When a Teams webhook request is received" expects
  // an Adaptive Card payload wrapped in attachments. The schema below
  // is the v1.5 Adaptive Card format Teams renders natively.
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    timeZone: "America/Phoenix",
  });

  const headlineColor = totalOverdue > 0 ? "Attention" : "Good";
  const headlineText = totalOverdue > 0
    ? `${totalOverdue} order${totalOverdue === 1 ? "" : "s"} overdue`
    : "All stages on track";

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "JK Cabinets — Morning briefing",
        weight: "Bolder",
        size: "Large",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: todayLabel,
        isSubtle: true,
        spacing: "None",
        wrap: true,
      },
      {
        type: "TextBlock",
        text: headlineText,
        color: headlineColor,
        weight: "Bolder",
        spacing: "Medium",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: [
          { title: "Active orders", value: String(totalActive) },
          { title: "New since yesterday", value: String(newSinceYesterday) },
          { title: "Total overdue", value: String(totalOverdue) },
        ],
      },
      {
        type: "TextBlock",
        text: "By stage",
        weight: "Bolder",
        spacing: "Medium",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: perStage.map(s => ({
          title: s.stage,
          value: s.overdue > 0
            ? `${s.total} active · ${s.overdue} overdue (target ${s.target}d)`
            : `${s.total} active · on track`,
        })),
      },
    ],
    actions: [
      {
        type: "Action.OpenUrl",
        title: "Open dashboard",
        url: process.env.NEXTAUTH_URL
          ? `${process.env.NEXTAUTH_URL}/dashboard`
          : "https://www.ordersjkcabinets2you.com/dashboard",
      },
    ],
  };

  // Power Automate's "Post adaptive card in a chat or channel" action
  // accepts the card via the `attachments` array. Some flows use the
  // top-level `attachments` shape; others want the raw card. The
  // multi-attachment shape works for both Power Automate flows and
  // legacy Office 365 webhook connectors.
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

  // ── POST to the Teams webhook ─────────────────────────────────────
  // SSRF guard: only accept Microsoft hosts for the webhook URL. This
  // protects against the env var being misconfigured to point at an
  // internal address.
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return NextResponse.json({ error: "Invalid TEAMS_WEBHOOK_URL" }, { status: 500 });
  }
  const allowedHostSuffixes = [
    ".logic.azure.com",                         // Power Automate workflow URLs (older format)
    ".webhook.office.com",                      // Legacy O365 connector webhooks
    ".azure-apim.net",                          // Some Power Automate regional endpoints
    ".api.powerplatform.com",                   // New Power Platform workflow URLs (current format)
  ];
  const ok = allowedHostSuffixes.some(suffix => parsed.host.endsWith(suffix));
  if (!ok) {
    return NextResponse.json({
      error: "TEAMS_WEBHOOK_URL host not allowed",
      host: parsed.host,
    }, { status: 500 });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({
        error: "Teams webhook rejected the payload",
        status: res.status,
        body: body.slice(0, 500),
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
      totalOverdue,
      perStage,
    },
  });
}
