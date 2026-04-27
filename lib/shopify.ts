/** Get a Shopify Admin API token — works with both shpat_ tokens and Client ID/Secret */
export async function getShopifyToken(): Promise<string> {
  const adminToken = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (adminToken) return adminToken;

  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify token error: ${res.status} ${text}`);
  return JSON.parse(text).access_token;
}
