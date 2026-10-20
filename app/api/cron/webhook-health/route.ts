import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";
import { removeShopifyPurchase } from "@/lib/shopifyRemoval";

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
 *
 * ⚠ AND THE REVERSE (2026-10-19): DOES SHOPIFY STILL HAVE WHAT WE HOLD?
 *   The check above catches an order Shopify has and we lack. It could not see
 *   the opposite -- a purchase still here after Shopify deleted or cancelled
 *   it, its webhook lost -- because a poll of current orders never notices an
 *   absence: that is the SHO-1051 shape. Every project with a Shopify id is now
 *   asked about by id (`nodes`, 250 at a time). One that is GONE, or cancelled
 *   longer ago than the grace window, is removed exactly as the webhook would
 *   have removed it -- `removeShopifyPurchase`, one implementation -- and the
 *   check goes RED, naming it: a removal here means a webhook was missed
 *   (Garrett, 2026-10-19). Logged to `webhook_events` as `reconcile/deleted` or
 *   `reconcile/cancelled`.
 *
 *   ⚠ IT ACTS ONLY ON AN ANSWER THAT CHECKS OUT: HTTP 200, no `errors`, one
 *   node per id asked, every present node the id that was asked. Anything else
 *   removes nothing and goes red. A wrong store or token answers "gone" for
 *   everything, so:
 *
 *   ⚠ MORE THAN ONE GONE IN ONE RUN REMOVES NONE (Garrett, 2026-10-19). All are
 *   named and a person looks. A purchase a warranty claim refers to is never
 *   removed: it is KEPT, MARKED (projects.shopify_gone_at) and ARCHIVED, as the
 *   webhook does (Garrett, 2026-10-19), red only on the run that marks it -- a
 *   webhook was missed -- and skipped from then on, so it neither alarms every
 *   hour nor counts toward that one (SHO-1059 did both until then).
 */

const API_VERSION = "2026-04";

/** How many recent Shopify orders to reconcile. */
const SAMPLE_SIZE = 10;

/** Ids per `nodes` query: Shopify's limit. */
const NODES_BATCH = 250;

/** More purchases than this gone in one run, and none is removed (Garrett, 2026-10-19). */
const MAX_REMOVALS_PER_RUN = 1;

/** A page of projects read from the database. */
const PROJECT_PAGE = 1000;

interface GoneFromShopify {
  projectId: string;
  shopifyId: string;
  how: "deleted" | "cancelled";
  /** Shopify's order name, when it still has the order (a cancel). */
  name?: string;
}

interface ShopifyOrder {
  gid: string;
  numericId: string;
  name: string;
  createdAt: string;
  /** Set when the order was cancelled; the webhook then removed its project. */
  cancelledAt: string | null;
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
      edges { node { id name createdAt cancelledAt } }
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
      cancelledAt: e?.node?.cancelledAt ? String(e.node.cancelledAt) : null,
    };
  }).filter((o: ShopifyOrder) => o.numericId);
}

/** Every project with a Shopify id. Throws if the database cannot be read. */
async function heldPurchases(): Promise<{ id: string; shopify_id: string }[]> {
  const out: { id: string; shopify_id: string }[] = [];
  for (let from = 0; ; from += PROJECT_PAGE) {
    const { data, error } = await supabase
      .from("projects").select("id, shopify_id")
      .not("shopify_id", "is", null).is("shopify_gone_at", null).order("id").range(from, from + PROJECT_PAGE - 1);
    if (error) throw new Error(`could not read projects from the database: ${error.message}`);
    for (const r of data ?? []) out.push({ id: String(r.id), shopify_id: String(r.shopify_id) });
    if (!data || data.length < PROJECT_PAGE) return out;
  }
}

/**
 * Which held purchases Shopify no longer has, or has cancelled before `cutoff`.
 * THROWS on any answer that does not check out -- the caller then removes
 * nothing.
 */
async function goneFromShopify(
  domain: string, token: string, held: { id: string; shopify_id: string }[], cutoff: number,
): Promise<{ gone: GoneFromShopify[]; recentCancels: number; unusableIds: number }> {
  const gone: GoneFromShopify[] = [];
  let recentCancels = 0;
  const usable = held.filter(p => /^\d+$/.test(p.shopify_id));
  for (let i = 0; i < usable.length; i += NODES_BATCH) {
    const batch = usable.slice(i, i + NODES_BATCH);
    const asked = batch.map(p => `gid://shopify/Order/${p.shopify_id}`);
    const q = `query {
      nodes(ids: [${asked.map(id => JSON.stringify(id)).join(", ")}]) { ... on Order { id name cancelledAt } }
    }`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await graphql(domain, token, q)) as any;
    if (body?.errors) throw new Error(`Shopify answered with errors: ${JSON.stringify(body.errors).slice(0, 200)}`);
    const nodes = body?.data?.nodes;
    if (!Array.isArray(nodes) || nodes.length !== batch.length) {
      throw new Error(`Shopify answered ${Array.isArray(nodes) ? nodes.length : "no list"} for ${batch.length} ids asked`);
    }
    nodes.forEach((node, k) => {
      const p = batch[k];
      if (node === null) { gone.push({ projectId: p.id, shopifyId: p.shopify_id, how: "deleted" }); return; }
      if (node?.id !== asked[k]) throw new Error(`Shopify answered ${String(node?.id)} where ${asked[k]} was asked`);
      if (!node.cancelledAt) return;
      // A cancel still inside the grace window is the webhook's to remove.
      const t = Date.parse(String(node.cancelledAt));
      if (Number.isFinite(t) && t < cutoff) gone.push({ projectId: p.id, shopifyId: p.shopify_id, how: "cancelled", name: String(node.name ?? "") });
      else recentCancels++;
    });
  }
  return { gone, recentCancels, unusableIds: held.length - usable.length };
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

  const graceMin = Number(process.env.WEBHOOK_RECONCILE_GRACE_MINUTES ?? "15");
  const grace = Number.isFinite(graceMin) && graceMin > 0 ? graceMin : 15;
  const cutoff = Date.now() - grace * 60 * 1000;
  detail.grace_minutes = grace;

  detail.shopify_orders_checked = orders.length;
  // ⚠ THE EARLY "OK" RETURNS BELOW ARE NOTES NOW (2026-10-19): returning
  // there skipped the reverse check, and a store whose every order was deleted
  // is exactly when it matters.
  forward: {
  if (orders.length === 0) {
    // A store with no orders has nothing to miss. Quiet, correctly.
    detail.note = "no orders in Shopify to reconcile";
    break forward;
  }

  // An order still inside the grace window may simply be in flight, or
  // awaiting a Shopify retry. Not a failure yet.
  //
  // ⚠ A CANCELLED ORDER IS SKIPPED (2026-10-13). A Shopify cancel removes the
  // whole purchase from the OMS, project included -- and a cancelled order
  // still EXISTS in Shopify, so this read the cancel as lost ingestion and
  // failed the cron for as long as it stayed among the newest ten. No project
  // is the right state for one.
  const cancelled = orders.filter(o => o.cancelledAt);
  detail.cancelled_skipped = cancelled.length;
  const settled = orders.filter(o => {
    const t = Date.parse(o.createdAt);
    return Number.isFinite(t) && t < cutoff && !o.cancelledAt;
  });
  detail.settled_orders_checked = settled.length;
  if (settled.length === 0) {
    detail.note = "all recent orders still inside the grace window";
    break forward;
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
  } // forward

  // ── The reverse: does Shopify still have the purchases we hold? ──────
  try {
    const held = await heldPurchases();
    detail.oms_purchases_checked = held.length;
    const { gone, recentCancels, unusableIds } = await goneFromShopify(domain, token, held, cutoff);
    detail.recent_cancels_left_to_the_webhook = recentCancels;
    if (unusableIds > 0) detail.unusable_shopify_ids = unusableIds;
    detail.gone_from_shopify = gone.map(g => ({ project: g.projectId, how: g.how, ...(g.name ? { name: g.name } : {}) }));
    const named = gone.map(g => `${g.projectId} (${g.how})`).join(", ");

    if (gone.length > MAX_REMOVALS_PER_RUN) {
      problems.push(
        `${gone.length} purchases in the OMS look gone from Shopify: ${named}. More than `
        + `${MAX_REMOVALS_PER_RUN} at once, so NOTHING was removed -- check the store and token `
        + `first; a wrong one makes every order look gone.`
      );
    } else if (gone.length === 1) {
      const g = gone[0];
      const r = await removeShopifyPurchase(g.shopifyId, `reconcile/${g.how}`);
      if (r.outcome === "removed") {
        detail.reconciled_removed = { project: r.projectId, how: g.how, groups: r.groups };
        problems.push(
          `Removed ${r.projectId}: its Shopify order was ${g.how} and the webhook never removed it. `
          + `A webhook was missed. Check: docker logs <container> | grep shopify-webhook`
        );
      } else if (r.outcome === "kept") {
        detail.reconciled_kept = { project: r.projectId, how: g.how, claims: r.blockedBy };
        if (r.newly) problems.push(
          `${r.projectId} is ${g.how} in Shopify, but warranty claim(s) ${r.blockedBy.join(", ")} `
          + `refer to it, so it was KEPT, marked and archived. A webhook was missed. `
          + `Check: docker logs <container> | grep shopify-webhook`
        );
      } else if (r.outcome === "failed") {
        problems.push(
          `${g.projectId} is ${g.how} in Shopify; removing it failed at ${r.table}: ${r.message}. `
          + `It is tried again next hour.`
        );
      } else {
        detail.reconciled_note = `${g.projectId} was already gone -- the webhook got there first`;
      }
    }
  } catch (err) {
    problems.push(`Could not check the OMS's purchases against Shopify, so nothing was removed: ${String(err)}`);
  }

  if (problems.length > 0) {
    // 500 so run-cron.sh's `curl -f` fails and it pings <url>/fail.
    console.warn("[webhook-health]", JSON.stringify({ ok: false, problems, ...detail }));
    return NextResponse.json({ ok: false, problems, ...detail }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...detail });
}
