/**
 * Admin-only webhook management for the Shopify custom app.
 *
 * GET  — list current webhook subscriptions (topic + address + api_version),
 *        so we can see exactly where the order webhooks deliver.
 * POST — register the products/update webhook, pointing at the SAME address the
 *        order webhooks use, so it reaches our webhook handler and verifies with
 *        the same HMAC secret. Idempotent: if a products/update subscription to
 *        that address already exists, it is left as-is.
 *
 * Uses the app's own getShopifyToken() (OAuth client-credentials), identical to
 * the product sync route — no static token assumptions, same SSRF guard.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getShopifyToken, isValidShopifyDomain } from "@/lib/shopify";

const API_VERSION = "2026-04";
const TARGET_TOPIC = "products/update";

interface ShopifyWebhook {
  id: number;
  topic: string;
  address: string;
  api_version?: string;
  format?: string;
}

async function listWebhooks(domain: string, token: string): Promise<ShopifyWebhook[]> {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/webhooks.json`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify webhooks list error: ${res.status} ${text}`);
  return (JSON.parse(text).webhooks ?? []) as ShopifyWebhook[];
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
    const webhooks = await listWebhooks(domain, token);
    // Return just the useful fields, sorted by topic.
    const summary = webhooks
      .map(w => ({ id: w.id, topic: w.topic, address: w.address, api_version: w.api_version }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
    return NextResponse.json({ count: summary.length, webhooks: summary });
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
    const existing = await listWebhooks(domain, token);

    // Derive the target address from an existing order webhook, so products/update
    // delivers to the exact same endpoint (and verifies with the same secret).
    const orderHook = existing.find(w => w.topic.startsWith("orders/"));
    if (!orderHook) {
      return NextResponse.json(
        { error: "No existing orders/* webhook found to copy the address from. Refusing to guess." },
        { status: 409 }
      );
    }
    const address = orderHook.address;

    // Idempotent: already registered to the same address?
    const already = existing.find(w => w.topic === TARGET_TOPIC && w.address === address);
    if (already) {
      return NextResponse.json({ ok: true, alreadyExists: true, id: already.id, topic: TARGET_TOPIC, address });
    }

    const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/webhooks.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ webhook: { topic: TARGET_TOPIC, address, format: "json" } }),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: `Shopify create error: ${res.status}`, body: text }, { status: 502 });
    }
    const created = JSON.parse(text).webhook;
    return NextResponse.json({ ok: true, created: { id: created.id, topic: created.topic, address: created.address } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
