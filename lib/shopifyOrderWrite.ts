import { isValidShopifyDomain, shopifyGraphql } from "@/lib/shopify";

/**
 * ONE guarded write to a Shopify order -- its Additional details, its note and
 * its stage tag -- for BOTH order writers (2026-11-04, item 5 part 1;
 * SESSION-HANDOFF-2026-11-03.md §6.3): lib/shopifyStageSync (production-complete)
 * and the order route's syncToShopify.
 *
 * ⚠ WHY. Each read the order's attributes over REST and PUT the whole list back
 * -- and a FAILED read left the list empty, so the PUT carried only that save's
 * attributes and Shopify replaced the rest: the customer's consent (the
 * chargeback evidence) and each line's dates. The tags were guarded; the
 * attributes were not. Both used REST 2024-01, a retired version, too.
 *
 *   1. READ the order's attributes and tags. ⚠ IF THE READ FAILS, NOTHING IS
 *      WRITTEN -- not the attributes, not the note, not the tags -- and the
 *      error says so. A stale Shopify copy beats an erased one.
 *   2. The attributes MERGED -- the list read, `set`'s keys set, `remove`'s
 *      removed -- and written with orderUpdate, with `note` when given.
 *      orderUpdate replaces the whole list as the PUT did, so the read stays.
 *      Its userErrors refuse.
 *   3. The stage tag, when `stage` is given, as mergeTags did: every stage name
 *      not spelled as the stage, and any "JK Order" spelled otherwise, removed;
 *      then "JK Order" and the stage added. No other tag is touched.
 */
export const STAGE_TAGS = ["New", "Entered", "In production", "At cross dock", "Delivered"];

export interface OrderWrite {
  /** Attributes to set, by key. */
  set?: Record<string, string>;
  /** Attribute keys to remove. */
  remove?: string[];
  /** The order's note, replaced, when given. */
  note?: string;
  /** The OMS stage, for the stage tag, when given. */
  stage?: string;
}
export type OrderWriteResult = { ok: true } | { ok: false; error: string };

const READ = `query OrderDetails($id: ID!) { order(id: $id) { id customAttributes { key value } tags } }`;
const UPDATE = `mutation OrderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`;
const TAGS_REMOVE = `mutation TagsRemove($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;
const TAGS_ADD = `mutation TagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;

type UserErrors = { userErrors?: { message?: string }[] } | null | undefined;
const refused = (r: UserErrors): string | null =>
  !r ? "no answer to the change" : (r.userErrors ?? []).length ? (r.userErrors ?? []).map((e) => e?.message ?? "refused").join("; ") : null;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function writeOrderToShopify(shopifyId: string, w: OrderWrite): Promise<OrderWriteResult> {
  // Defense against SSRF via a misconfigured env, and against an injected id.
  if (!isValidShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN)) return { ok: false, error: "Invalid Shopify domain" };
  if (!/^\d+$/.test(String(shopifyId ?? ""))) return { ok: false, error: "Invalid Shopify order id" };
  const id = `gid://shopify/Order/${shopifyId}`;

  // 1. The read. Nothing below runs without it.
  let order: { customAttributes: { key: string; value: string | null }[]; tags: string[] } | null;
  try {
    order = (await shopifyGraphql<{ order: typeof order }>(READ, { id })).order;
  } catch (e) {
    return { ok: false, error: `Could not read the order in Shopify, so nothing was written: ${msg(e)}` };
  }
  if (!order) return { ok: false, error: "The order is not in Shopify, so nothing was written" };

  // 2. The attributes, merged, and the note.
  const attrs = new Map((order.customAttributes ?? []).map((a) => [a.key, a.value ?? ""]));
  for (const [k, v] of Object.entries(w.set ?? {})) attrs.set(k, v);
  for (const k of w.remove ?? []) attrs.delete(k);
  const input: Record<string, unknown> = { id, customAttributes: [...attrs].map(([key, value]) => ({ key, value })) };
  if (w.note !== undefined) input.note = w.note;
  try {
    const no = refused((await shopifyGraphql<{ orderUpdate: UserErrors }>(UPDATE, { input })).orderUpdate);
    if (no) return { ok: false, error: `Shopify refused the update: ${no}` };
  } catch (e) {
    return { ok: false, error: `Shopify: ${msg(e)}` };
  }

  // 3. The stage tag.
  if (w.stage !== undefined) {
    const stageNames = new Set(STAGE_TAGS.map((s) => s.toLowerCase()));
    const stale = (order.tags ?? []).filter((t) => {
      const l = t.trim().toLowerCase();
      return (stageNames.has(l) && t.trim() !== w.stage) || (l === "jk order" && t.trim() !== "JK Order");
    });
    try {
      if (stale.length > 0) {
        const no = refused((await shopifyGraphql<{ tagsRemove: UserErrors }>(TAGS_REMOVE, { id, tags: stale })).tagsRemove);
        if (no) return { ok: false, error: `The details were written; the old stage tag was not removed: ${no}` };
      }
      const no = refused((await shopifyGraphql<{ tagsAdd: UserErrors }>(TAGS_ADD, { id, tags: ["JK Order", w.stage] })).tagsAdd);
      if (no) return { ok: false, error: `The details were written; the stage tag was not added: ${no}` };
    } catch (e) {
      return { ok: false, error: `The details were written; the stage tag was not moved: ${msg(e)}` };
    }
  }
  return { ok: true };
}
