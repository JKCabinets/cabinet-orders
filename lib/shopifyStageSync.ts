import { writeOrderToShopify } from "@/lib/shopifyOrderWrite";

/**
 * shopifyStageSync.ts — push an OMS stage onto the matching Shopify order.
 *
 * Extracted so production-complete and delivery-complete shared ONE
 * implementation. They had differed: production synced to Shopify, delivery
 * did not, so an order marked Delivered in the OMS still showed "At cross
 * dock" in Shopify forever. (delivery-complete is gone -- delivery is
 * confirmed by a person, 2b479e6 -- and production-complete is the caller.)
 *
 * ⚠ IT WRITES THE STAGE, NOT A FULFILMENT. Marking cabinet lines shipped in
 * Shopify, which is what sends the customer's shipping email, is the daily
 * cabinet-fulfilment run's (lib/shopifyFulfil, 2026-11-02).
 * ⚠ OVER GraphQL SINCE 2026-11-04 (item 5 part 1): lib/shopifyOrderWrite, shared
 * with the order route. It was REST 2024-01, a retired version.
 *
 * Writes the "Production Stage" attribute and merges the stage into the
 * order's tags. Both are merges, never replacements.
 *
 * Returns whether Shopify actually accepted the write, so callers can record
 * the truth rather than assuming success.
 */

/**
 * Writes "Production Stage" and moves the stage tag -- through
 * writeOrderToShopify (2026-11-04, item 5 part 1), which reads the order first
 * and writes NOTHING if it cannot. The REST 2024-01 read-and-PUT that erased an
 * order's Additional details on a failed read is gone, and mergeTags with it:
 * its rule lives on in the writer's tag step.
 *
 * Answers whether Shopify accepted the write; a refusal is logged.
 */
export async function syncStageToShopify(shopifyId: string, stage: string): Promise<boolean> {
  if (!shopifyId) return false;
  const r = await writeOrderToShopify(shopifyId, { set: { "Production Stage": stage }, stage });
  if (!r.ok) console.error(`[shopify] stage "${stage}" not written to order ${shopifyId}: ${r.error}`);
  return r.ok;
}
