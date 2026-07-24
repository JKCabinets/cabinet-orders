import { getShopifyToken } from "@/lib/shopify";

/**
 * shopifyStageSync.ts — push an OMS stage onto the matching Shopify order.
 *
 * Extracted so production-complete and delivery-complete share ONE
 * implementation. They previously differed: production synced to Shopify,
 * delivery did not, so an order marked Delivered in the OMS still showed
 * "At cross dock" in Shopify forever. Two copies would have drifted the same
 * way again.
 *
 * Writes the "Production Stage" note attribute and merges the stage into the
 * order's tags. Both are merges, never replacements — see mergeTags.
 *
 * Returns whether Shopify actually accepted the write, so callers can record
 * the truth rather than assuming success.
 */

/**
 * The OMS stage names. Any of these already on the order is the PREVIOUS
 * stage tag and gets replaced, so stages do not pile up over an order's life.
 */
const STAGE_TAGS = ["New", "Entered", "In production", "At cross dock", "Delivered"];

/**
 * Merge our tags into whatever the order already carries.
 *
 * Shopify's PUT replaces the entire tag list, so anything omitted here is
 * destroyed — including the vendor tags the team relies on. Keep every tag we
 * do not own, drop the stale stage tag, and add the current one.
 */
export function mergeTags(existing: string, stage: string): string {
  const stageNames = new Set(STAGE_TAGS.map(s => s.toLowerCase()));
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of (existing ?? "").split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const l = t.toLowerCase();
    if (stageNames.has(l)) continue;   // previous stage — replaced below
    if (l === "jk order") continue;    // re-added below, in a fixed position
    if (seen.has(l)) continue;         // de-duplicate
    seen.add(l);
    kept.push(t);
  }
  return ["JK Order", stage, ...kept].join(", ");
}

export async function syncStageToShopify(shopifyId: string, stage: string): Promise<boolean> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyId) return false;

  // Defense against SSRF via misconfigured env / order corruption
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) return false;
  if (!/^\d+$/.test(shopifyId)) return false;

  let token: string;
  try { token = await getShopifyToken(); } catch { return false; }

  let currentAttributes: { name: string; value: string }[] = [];
  // null means we could NOT read the tags. In that case we leave them alone
  // rather than risk replacing a list we never saw.
  let currentTags: string | null = null;
  try {
    const getRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json?fields=note_attributes,tags`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (getRes.ok) {
      const j = await getRes.json();
      currentAttributes = j.order?.note_attributes ?? [];
      currentTags = typeof j.order?.tags === "string" ? j.order.tags : "";
    }
  } catch {}

  const attrMap = new Map(currentAttributes.map((a: { name: string; value: string }) => [a.name, a.value]));
  attrMap.set("Production Stage", stage);

  const orderPayload: Record<string, unknown> = {
    id: shopifyId,
    note_attributes: Array.from(attrMap.entries()).map(([name, value]) => ({ name, value })),
  };
  // Only touch tags when we actually read them.
  if (currentTags !== null) {
    orderPayload.tags = mergeTags(currentTags, stage);
  }

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ order: orderPayload }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
