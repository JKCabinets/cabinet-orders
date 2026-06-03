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
// Shopify GraphQL topics are UPPER_SNAKE: products/update -> PRODUCTS_UPDATE
const TARGET_TOPIC = "PRODUCTS_UPDATE";

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

export async function POST() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    return NextResponse.json({ error: "Invalid SHOPIFY_STORE_DOMAIN" }, { status: 500 });
  }
  try {
    const token = await getShopifyToken();
    const subs = await listSubscriptions(domain, token);

    // Copy the callbackUrl from an existing ORDERS_* subscription so products/update
    // delivers to the exact same endpoint (and verifies with the same secret).
    const orderSub = subs.find(s => s.topic.startsWith("ORDERS_") && s.callbackUrl);
    if (!orderSub || !orderSub.callbackUrl) {
      return NextResponse.json(
        { error: "No existing ORDERS_* HTTP subscription found to copy the callbackUrl from. Refusing to guess.", seen: subs },
        { status: 409 }
      );
    }
    const callbackUrl = orderSub.callbackUrl;

    // Idempotent
    const already = subs.find(s => s.topic === TARGET_TOPIC && s.callbackUrl === callbackUrl);
    if (already) {
      return NextResponse.json({ ok: true, alreadyExists: true, id: already.id, topic: TARGET_TOPIC, callbackUrl });
    }

    const mutation = `mutation {
      webhookSubscriptionCreate(
        topic: ${TARGET_TOPIC},
        webhookSubscription: { callbackUrl: "${callbackUrl}", format: JSON }
      ) {
        webhookSubscription { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } }
        userErrors { field message }
      }
    }`;
    const body = await graphql(domain, token, mutation);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (body as any)?.data?.webhookSubscriptionCreate;
    const errs = result?.userErrors ?? [];
    if (errs.length > 0) {
      return NextResponse.json({ error: "Shopify userErrors", userErrors: errs }, { status: 502 });
    }
    const sub = result?.webhookSubscription;
    return NextResponse.json({
      ok: true,
      created: { id: sub?.id, topic: sub?.topic, callbackUrl: sub?.endpoint?.callbackUrl },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
