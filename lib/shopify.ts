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

/** The Admin API version the OMS's GraphQL calls use (as webhook-health). */
export const SHOPIFY_API_VERSION = "2026-04";

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
