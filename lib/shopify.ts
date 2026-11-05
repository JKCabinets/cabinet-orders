/**
 * Get a Shopify Admin API token — works with both shpat_ tokens and Client
 * ID/Secret. Validates SHOPIFY_STORE_DOMAIN to prevent SSRF via misconfigured
 * env (CWE-918). Only *.myshopify.com hostnames are accepted.
 */
const MYSHOPIFY_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopifyDomain(domain: string | undefined): domain is string {
  return !!domain && MYSHOPIFY_RE.test(domain);
}

export async function getShopifyToken(): Promise<string> {
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (adminToken) return adminToken;

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) {
    throw new Error("Invalid SHOPIFY_STORE_DOMAIN");
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing Shopify client credentials");
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token error: ${res.status} ${text}`);
  return JSON.parse(text).access_token;
}

/**
 * ⚠ THE ONE ADMIN API VERSION (2026-11-05, item 5 part 4): every Shopify call
 * the OMS makes goes through shopifyGraphql below -- the webhooks route and
 * webhook-health had a call and a "2026-04" of their own until then.
 *
 * It does NOT decide the webhooks' PAYLOAD version: a subscription's apiVersion
 * is "inherited from the app that created the webhook subscription", and "you
 * can't specify it per subscription" (Shopify). That is the app's own setting
 * in Shopify; GET /api/shopify/webhooks shows it for each subscription.
 *
 * 2026-10 since part 4 (it was 2026-04): every one of the 13 operations the app
 * sends was validated against 2026-10's schema, read from Shopify, before the
 * move -- valid, nothing deprecated (item5p4-schema-check.js, 2026-11-05).
 */
export const SHOPIFY_API_VERSION = "2026-10";

/**
 * ⚠ ONE STRICT GraphQL CALL (2026-10-29, feature 9 phase 1). It answers
 * `data` or THROWS -- never a half-answer read as an answer:
 *   - a non-2xx, or no answer within `timeoutMs` (the run has 60 s in all);
 *   - a top-level `errors` array: Shopify answers a refused query (a missing
 *     scope, a bad field) with HTTP 200 AND `errors`, and reading `data?.x ?? []`
 *     from that answer is how "Shopify said nothing" becomes "nothing to do";
 *   - no `data` at all.
 * Mutations' `userErrors` are the caller's to read: they are an answer.
 */
export async function shopifyGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!isValidShopifyDomain(domain)) throw new Error("Invalid SHOPIFY_STORE_DOMAIN");
  const token = await getShopifyToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(ctl.signal.aborted ? `Shopify GraphQL: no answer in ${timeoutMs / 1000}s` : `Shopify GraphQL: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${text.slice(0, 300)}`);
  let body: { data?: T; errors?: { message?: string }[] };
  try { body = JSON.parse(text); } catch { throw new Error(`Shopify GraphQL: not JSON: ${text.slice(0, 200)}`); }
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e?.message ?? "error").join("; ").slice(0, 300)}`);
  }
  if (body.data === undefined || body.data === null) throw new Error("Shopify GraphQL: no data in the answer");
  return body.data;
}
