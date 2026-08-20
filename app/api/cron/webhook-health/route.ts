import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

/**
 * Ingestion heartbeat — is Shopify still able to reach us?
 *
 * WHY THIS EXISTS
 *   On 2026-08-19 Shopify held ZERO webhook subscriptions for this app. No
 *   order could have reached the OMS, and nothing anywhere would have said so.
 *   It was found only because a test order was placed by hand.
 *
 *   That is the same shape as the 64-day cron outage: a silent integration
 *   failure with nothing watching. The dead-man's switch covers the crons
 *   because a MISSING ping alarms. Nothing covered ingestion.
 *
 * HOW IT ALARMS
 *   run-cron.sh pings healthchecks.io on success and <url>/fail on any
 *   non-2xx. So this route returns 500 when something is wrong, and the alarm
 *   is someone else's problem — including the case where the box is down and
 *   no ping arrives at all.
 *
 * TWO INDEPENDENT QUESTIONS
 *   1. Do the subscriptions still exist, at the right callback URL? This is
 *      what actually broke.
 *   2. Has anything actually ARRIVED recently? A subscription can exist and
 *      still not deliver — a rotated secret, a Shopify incident, a callback
 *      that 500s every time.
 *
 *   The second is OPT-IN via WEBHOOK_MAX_QUIET_HOURS, because before launch
 *   almost nothing arrives and a threshold would fire constantly. An alarm
 *   people have learned to ignore is worse than no alarm. Set it once the
 *   real order rhythm is known.
 */

const API_VERSION = "2026-04";

/** The topic that matters. Without it, orders cannot reach the OMS at all. */
const REQUIRED_TOPIC = "ORDERS_CREATE";

interface SubNode {
  topic: string;
  callbackUrl: string | null;
}

async function listSubscriptions(domain: string, token: string): Promise<SubNode[]> {
  const query = `query {
    webhookSubscriptions(first: 100) {
      edges { node {
        topic
        endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
      } }
    }
  }`;
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 200)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = (JSON.parse(text) as any)?.data?.webhookSubscriptions?.edges ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return edges.map((e: any) => ({
    topic: String(e?.node?.topic ?? ""),
    callbackUrl: e?.node?.endpoint?.callbackUrl ?? null,
  }));
}

/** Where deliveries SHOULD land. Mirrors the admin registration route. */
function expectedCallbackUrl(): string | null {
  const explicit = (process.env.SHOPIFY_WEBHOOK_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;
  const base = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/api/shopify/webhook` : null;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const problems: string[] = [];
  const detail: Record<string, unknown> = {};

  // ── 1. Are the subscriptions still there? ────────────────────────────
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    problems.push("SHOPIFY_STORE_DOMAIN is unset or not a *.myshopify.com host");
  } else {
    try {
      const token = await getShopifyToken();
      const subs = await listSubscriptions(domain, token);
      detail.subscription_count = subs.length;
      detail.topics = subs.map(s => s.topic).sort();

      const orderSub = subs.find(s => s.topic === REQUIRED_TOPIC);
      if (!orderSub) {
        problems.push(
          `No ${REQUIRED_TOPIC} subscription — Shopify orders cannot reach the OMS. `
          + `POST /api/shopify/webhooks to re-register.`
        );
      } else {
        const expected = expectedCallbackUrl();
        detail.orders_create_callback = orderSub.callbackUrl;
        if (expected && orderSub.callbackUrl !== expected) {
          problems.push(
            `${REQUIRED_TOPIC} delivers to ${orderSub.callbackUrl}, expected ${expected}`
          );
        }
      }
    } catch (err) {
      // A Shopify API failure is itself worth alarming on: we cannot confirm
      // ingestion is working, which is not the same as confirming it is.
      problems.push(`Could not read webhook subscriptions: ${String(err)}`);
    }
  }

  // ── 2. Has anything actually arrived? (opt-in) ───────────────────────
  const raw = (process.env.WEBHOOK_MAX_QUIET_HOURS ?? "").trim();
  const maxQuiet = raw ? Number(raw) : NaN;
  if (Number.isFinite(maxQuiet) && maxQuiet > 0) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, created_at")
      .eq("source", "Shopify")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      problems.push(`Could not read the newest Shopify order: ${error.message}`);
    } else if (!data || data.length === 0) {
      detail.newest_shopify_order = null;
      problems.push(`No Shopify order has ever been ingested (threshold ${maxQuiet}h)`);
    } else {
      const hours = (Date.now() - Date.parse(String(data[0].created_at))) / (1000 * 60 * 60);
      detail.newest_shopify_order = data[0].id;
      detail.hours_since_last_order = Math.round(hours);
      if (hours > maxQuiet) {
        problems.push(
          `No Shopify order in ${Math.round(hours)}h (threshold ${maxQuiet}h). `
          + `The subscription exists, so check the webhook secret and the handler logs: `
          + `docker logs <container> | grep shopify-webhook`
        );
      }
    }
  } else {
    detail.staleness_check = "disabled — set WEBHOOK_MAX_QUIET_HOURS to enable";
  }

  if (problems.length > 0) {
    // 500 on purpose: run-cron.sh's `curl -f` fails, and it pings <url>/fail
    // so the alert fires immediately rather than after the grace period.
    console.warn("[webhook-health]", JSON.stringify({ ok: false, problems, ...detail }));
    return NextResponse.json({ ok: false, problems, ...detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...detail });
}
