import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

/**
 * Ingestion health — does the OMS have the orders Shopify has?
 *
 * WHY THIS IS A RECONCILIATION AND NOT A HEARTBEAT
 *   The first version of this check asked "do the webhook subscriptions
 *   exist?" That was the wrong question, and it was wrong in both directions:
 *
 *     · On 2026-08-20 it reported GREEN while ingestion was completely dead.
 *       The subscriptions it could see were app-created ones whose deliveries
 *       were being rejected on HMAC; the subscription that actually worked was
 *       admin-created and invisible to the GraphQL query.
 *
 *     · Once those app-created subscriptions are removed it would report RED
 *       forever, while ingestion was perfectly healthy.
 *
 *   Existence is a proxy for delivery, and it demonstrated that it can be
 *   wrong either way. So this asks the only question that matters: Shopify is
 *   the source of truth for what orders exist -- do we have them?
 *
 * WHAT IT CATCHES
 *   A deleted or repointed webhook, a secret mismatch, a handler returning
 *   500, a Shopify delivery outage. All of them end with an order in Shopify
 *   and no row here, whatever the cause.
 *
 * WHY IT DOES NOT CRY WOLF BEFORE LAUNCH
 *   It only alarms on orders Shopify SAYS exist. No orders means nothing to
 *   miss and a quiet check -- unlike a "has anything arrived in N hours"
 *   threshold, which would fire constantly on a store with no traffic.
 *
 * THE GRACE WINDOW
 *   Orders newer than WEBHOOK_RECONCILE_GRACE_MINUTES (default 15) are
 *   ignored: a delivery in flight, or a Shopify retry still pending, is not a
 *   failure. Only an order old enough that it SHOULD have landed counts.
 *
 * SUBSCRIPTIONS ARE REPORTED, NOT JUDGED
 *   The topic list is still included for diagnosis, because it is useful when
 *   something IS wrong. It no longer decides the outcome.
 */

const API_VERSION = "2026-04";

/** How many recent Shopify orders to reconcile. */
const SAMPLE_SIZE = 10;

interface ShopifyOrder {
  gid: string;
  numericId: string;
  name: string;
  createdAt: string;
}

async function graphql(domain: string, token: string, query: string): Promise<unknown> {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function recentShopifyOrders(domain: string, token: string): Promise<ShopifyOrder[]> {
  const q = `query {
    orders(first: ${SAMPLE_SIZE}, sortKey: CREATED_AT, reverse: true) {
      edges { node { id name createdAt } }
    }
  }`;
  const body = await graphql(domain, token, q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = (body as any)?.data?.orders?.edges ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return edges.map((e: any) => {
    const gid = String(e?.node?.id ?? "");
    return {
      gid,
      // gid://shopify/Order/8541444178220 -> 8541444178220, which is what
      // orders.shopify_id stores.
      numericId: gid.split("/").pop() ?? "",
      name: String(e?.node?.name ?? ""),
      createdAt: String(e?.node?.createdAt ?? ""),
    };
  }).filter((o: ShopifyOrder) => o.numericId);
}

async function subscriptionTopics(domain: string, token: string): Promise<string[]> {
  const q = `query {
    webhookSubscriptions(first: 100) { edges { node { topic } } }
  }`;
  const body = await graphql(domain, token, q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = (body as any)?.data?.webhookSubscriptions?.edges ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return edges.map((e: any) => String(e?.node?.topic ?? "")).sort();
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const problems: string[] = [];
  const detail: Record<string, unknown> = {};

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json(
      { ok: false, problems: ["SHOPIFY_STORE_DOMAIN is unset or not a *.myshopify.com host"] },
      { status: 500 },
    );
  }

  let token: string;
  try {
    token = await getShopifyToken();
  } catch (err) {
    // Not being able to ASK is not the same as everything being fine.
    return NextResponse.json(
      { ok: false, problems: [`Could not authenticate with Shopify: ${String(err)}`] },
      { status: 500 },
    );
  }

  // ── Informational: which subscriptions the APP owns ──────────────────
  // Admin-created subscriptions do NOT appear here. That is exactly why this
  // list no longer decides the outcome -- on 2026-08-20 the app owned five
  // failing subscriptions while a sixth, invisible one did all the work.
  try {
    detail.app_owned_topics = await subscriptionTopics(domain, token);
  } catch (err) {
    detail.app_owned_topics = `unavailable: ${String(err)}`;
  }

  // ── The actual check ─────────────────────────────────────────────────
  let orders: ShopifyOrder[];
  try {
    orders = await recentShopifyOrders(domain, token);
  } catch (err) {
    return NextResponse.json(
      { ok: false, problems: [`Could not read recent orders from Shopify: ${String(err)}`], ...detail },
      { status: 500 },
    );
  }

  detail.shopify_orders_checked = orders.length;
  if (orders.length === 0) {
    // A store with no orders has nothing to miss. Quiet, correctly.
    return NextResponse.json({ ok: true, note: "no orders in Shopify to reconcile", ...detail });
  }

  const graceMin = Number(process.env.WEBHOOK_RECONCILE_GRACE_MINUTES ?? "15");
  const grace = Number.isFinite(graceMin) && graceMin > 0 ? graceMin : 15;
  const cutoff = Date.now() - grace * 60 * 1000;
  detail.grace_minutes = grace;

  // An order still inside the grace window may simply be in flight, or
  // awaiting a Shopify retry. Not a failure yet.
  const settled = orders.filter(o => {
    const t = Date.parse(o.createdAt);
    return Number.isFinite(t) && t < cutoff;
  });
  detail.settled_orders_checked = settled.length;
  if (settled.length === 0) {
    return NextResponse.json({ ok: true, note: "all recent orders still inside the grace window", ...detail });
  }

  // Reconcile against PROJECTS, not orders.
  //
  // A Shopify checkout is one project with one `orders` row per product
  // category. Matching on orders.shopify_id works only because ingest
  // denormalises that value onto the FIRST group -- a crutch that exists to
  // keep this check working, and that stops being true the moment the
  // column is dropped from orders. The project is where the Shopify order
  // actually lives.
  const { data: rows, error } = await supabase
    .from("projects")
    .select("shopify_id")
    .in("shopify_id", settled.map(o => o.numericId));

  if (error) {
    return NextResponse.json(
      { ok: false, problems: [`Could not read orders from the database: ${error.message}`], ...detail },
      { status: 500 },
    );
  }

  const have = new Set((rows ?? []).map(r => String(r.shopify_id)));
  const missing = settled.filter(o => !have.has(o.numericId));

  detail.newest_shopify_order = settled[0]?.name;
  detail.missing_count = missing.length;

  if (missing.length > 0) {
    detail.missing = missing.map(o => ({ name: o.name, id: o.numericId, created_at: o.createdAt }));
    problems.push(
      `${missing.length} order(s) exist in Shopify but have no project in the OMS: `
      + `${missing.map(o => o.name).join(", ")}. Ingestion is not working. `
      + `Check: docker logs <container> | grep shopify-webhook`
    );
  }

  if (problems.length > 0) {
    // 500 so run-cron.sh's `curl -f` fails and it pings <url>/fail.
    console.warn("[webhook-health]", JSON.stringify({ ok: false, problems, ...detail }));
    return NextResponse.json({ ok: false, problems, ...detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...detail });
}
