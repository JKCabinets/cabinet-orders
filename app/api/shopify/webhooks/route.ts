/**
 * Admin-only webhook management for the Shopify custom app (GraphQL Admin API).
 *
 * The order webhooks are registered via GraphQL webhookSubscriptionCreate (the
 * modern mechanism), so REST /webhooks.json does NOT list them. We use GraphQL
 * here for both listing and creating, to match how everything else was set up —
 * one management surface, no REST/GraphQL split.
 *
 * GET  — list current webhookSubscriptions: topic, delivery address, and the
 *        API version Shopify serializes each one's payloads in.
 * POST — register EVERY topic in TOPICS (all five) at ONE callback URL, so each
 *        reaches our handler and verifies with the same HMAC secret. (It said
 *        "register products/update" until 2026-11-05 -- item 67.) Idempotent:
 *        skips a topic already subscribed at that URL.
 *
 * ⚠ THROUGH lib/shopify's STRICT CALL (2026-11-05, item 5 part 4): its version,
 * and a refused answer -- HTTP 200 carrying `errors` -- fails instead of
 * reading as an empty list. Before, a refused list read as `count: 0`, and POST
 * then tried to create all five again. The address is `uri`; `callbackUrl` and
 * `endpoint` are deprecated (Shopify, 2026-10).
 *
 * ⚠ THE PAYLOAD VERSION IS NOT SET HERE: a subscription's apiVersion is
 * "inherited from the app that created the webhook subscription" -- the app's
 * Webhooks API version, in its settings in Shopify. GET shows it.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { isValidShopifyDomain, shopifyGraphql } from "@/lib/shopify";

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
  /** Where Shopify delivers: the subscription's `uri`. */
  callbackUrl: string | null;
  /** The API version Shopify serializes this subscription's payloads in. */
  apiVersion: string | null;
}

const LIST = `query WebhookSubscriptions {
  webhookSubscriptions(first: 100) { nodes { id topic uri apiVersion { handle } } }
}`;

const CREATE = `mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

type ListAnswer = { webhookSubscriptions?: { nodes?: { id?: unknown; topic?: unknown; uri?: unknown; apiVersion?: { handle?: unknown } | null }[] } | null };
type CreateAnswer = { webhookSubscriptionCreate?: { webhookSubscription?: { id?: unknown } | null; userErrors?: { message?: string }[] } | null };

/** Every subscription the app owns. THROWS on a refused or shapeless answer. */
async function listSubscriptions(): Promise<SubNode[]> {
  const data = await shopifyGraphql<ListAnswer>(LIST);
  const nodes = data.webhookSubscriptions?.nodes;
  if (!Array.isArray(nodes)) throw new Error("Shopify answered no subscription list");
  return nodes.map((n) => ({
    id: String(n?.id ?? ""),
    topic: String(n?.topic ?? ""),
    callbackUrl: typeof n?.uri === "string" ? n.uri : null,
    apiVersion: typeof n?.apiVersion?.handle === "string" ? n.apiVersion.handle : null,
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
    const subs = (await listSubscriptions())
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

  let subs: SubNode[];
  let callbackUrl: string;
  try {
    subs = await listSubscriptions();
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
      // Variables, not text: `topic` is the enum from TOPICS, the address is `uri`.
      const data = await shopifyGraphql<CreateAnswer>(CREATE, { topic, sub: { uri: callbackUrl, format: "JSON" } });
      const result = data.webhookSubscriptionCreate;
      const errs = result?.userErrors ?? [];
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
