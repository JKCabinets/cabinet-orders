/**
 * Admin-only webhook management for the Shopify custom app (GraphQL Admin API).
 *
 * The order webhooks are registered via GraphQL webhookSubscriptionCreate (the
 * modern mechanism), so REST /webhooks.json does NOT list them. We use GraphQL
 * here for both listing and creating, to match how everything else was set up —
 * one management surface, no REST/GraphQL split.
 *
 * GET  — list current webhookSubscriptions (topic + callbackUrl).
 * POST — register products/update at the SAME callbackUrl the order webhooks
 *        use, so it reaches our handler and verifies with the same HMAC secret.
 *        Idempotent: skips if an equivalent subscription already exists.
 *
 * Uses the app's own getShopifyToken() (OAuth client-credentials), same as the
 * product sync route. Same SSRF guard on the domain.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

const API_VERSION = "2026-04";

/**
 * Every topic the handler in app/api/shopify/webhook/route.ts accepts.
 * Shopify GraphQL topics are UPPER_SNAKE: products/update -> PRODUCTS_UPDATE.
 *
 * ORDERS_DELETE delivers as "orders/delete" (singular). The handler accepts
 * both spellings, so this is safe either way.
 */
const TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "ORDERS_DELETE",
  "PRODUCTS_UPDATE",
] as const;

/**
 * Where Shopify should deliver. Resolution order:
 *
 *   1. SHOPIFY_WEBHOOK_CALLBACK_URL -- explicit override
 *   2. an existing subscription's URL -- never repoint what already works
 *   3. NEXTAUTH_URL + the handler path
 *
 * Throws rather than inventing one. NEXTAUTH_URL is the www host, which
 * matters: a non-www callback would redirect, and Shopify treats a redirect
 * as a delivery failure.
 */
function resolveCallbackUrl(subs: SubNode[]): string {
  const explicit = (process.env.SHOPIFY_WEBHOOK_CALLBACK_URL ?? "").trim();
  if (explicit) return explicit;

  const existing = subs.find(s => s.callbackUrl)?.callbackUrl;
  if (existing) return existing;

  const base = (process.env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "Cannot determine a callback URL: no existing subscription, and neither "
      + "SHOPIFY_WEBHOOK_CALLBACK_URL nor NEXTAUTH_URL is set."
    );
  }
  return `${base}/api/shopify/webhook`;
}

interface SubNode {
  id: string;
  topic: string;
  callbackUrl: string | null;
}

async function graphql(domain: string, token: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL error: ${res.status} ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function listSubscriptions(domain: string, token: string): Promise<SubNode[]> {
  const q = `query {
    webhookSubscriptions(first: 100) {
      edges { node {
        id
        topic
        endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
      } }
    }
  }`;
  const body = await graphql(domain, token, q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges = (body as any)?.data?.webhookSubscriptions?.edges ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return edges.map((e: any) => ({
    id: String(e?.node?.id ?? ""),
    topic: String(e?.node?.topic ?? ""),
    callbackUrl: e?.node?.endpoint?.callbackUrl ?? null,
  }));
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }
  try {
    const token = await getShopifyToken();
    const subs = (await listSubscriptions(domain, token))
      .sort((a, b) => a.topic.localeCompare(b.topic));
    return NextResponse.json({ count: subs.length, subscriptions: subs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

/**
 * Register every topic the handler accepts, at one callback URL.
 *
 * Idempotent per topic: a topic already subscribed at that URL is reported as
 * alreadyExists and left alone. One topic failing does not abort the rest --
 * a missing scope on one should not block the other four.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }

  let token: string;
  let subs: SubNode[];
  let callbackUrl: string;
  try {
    token = await getShopifyToken();
    subs = await listSubscriptions(domain, token);
    callbackUrl = resolveCallbackUrl(subs);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const created: Array<{ topic: string; id: string }> = [];
  const alreadyExists: Array<{ topic: string; id: string }> = [];
  const failed: Array<{ topic: string; error: string }> = [];

  for (const topic of TOPICS) {
    const already = subs.find(s => s.topic === topic && s.callbackUrl === callbackUrl);
    if (already) {
      alreadyExists.push({ topic, id: already.id });
      continue;
    }
    try {
      // `topic` is a GraphQL enum so it is unquoted, and comes only from the
      // TOPICS constant above. callbackUrl is a string and is JSON-encoded.
      const mutation = `mutation {
        webhookSubscriptionCreate(
          topic: ${topic},
          webhookSubscription: { callbackUrl: ${JSON.stringify(callbackUrl)}, format: JSON }
        ) {
          webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
          userErrors { field message }
        }
      }`;
      const body = await graphql(domain, token, mutation);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (body as any)?.data?.webhookSubscriptionCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errs: any[] = result?.userErrors ?? [];
      if (errs.length > 0) {
        failed.push({ topic, error: errs.map(e => e?.message ?? String(e)).join("; ") });
        continue;
      }
      created.push({ topic, id: String(result?.webhookSubscription?.id ?? "") });
    } catch (err) {
      failed.push({ topic, error: String(err) });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    callbackUrl,
    created,
    alreadyExists,
    failed,
  }, { status: failed.length === 0 ? 200 : 207 });
}
