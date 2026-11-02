/**
 * Marking cabinet lines fulfilled in Shopify (2026-10-29, feature 9 phase 1),
 * so Shopify sends its shipping confirmation. SERVER ONLY.
 *
 * Three steps, kept apart so the middle one -- which lines -- is pure and
 * proven on its own:
 *   readFulfilmentOrders  what Shopify holds for the order, line by line
 *   planFulfilment        which of Shopify's lines are these OMS lines
 *   createFulfilment      ask Shopify to fulfil exactly those, notifying
 *
 * ⚠ SHOPIFY FULFILS A WHOLE FULFILMENT ORDER WHEN ITS LINE LIST IS EMPTY
 * (FulfillmentInput.lineItemsByFulfillmentOrder: "if the fulfillment order line
 * items are left blank then all the fulfillment order line items ... will be
 * fulfilled"). HCI and J&K share one fulfilment order ("HCI & J&K Shipping"),
 * and backordered lines sit on the same one as their vendor's: an empty list
 * would ship the other vendor and the held-back lines with it. A pair is never
 * built without its lines, and createFulfilment refuses one.
 *
 * ⚠ notifyCustomer DEFAULTS TO FALSE. It is sent true, or no email goes out --
 * which is the whole of feature 9.
 */
import { shopifyGraphql } from "./shopify";
import { lineItemIdOf } from "./lineFields";
import type { SkuItem } from "./data";

/** One of Shopify's fulfilment-order lines, flattened. */
export interface FoLine {
  foId: string;
  foStatus: string;
  /** Whether Shopify will take a fulfilment for this fulfilment order now. */
  fulfillable: boolean;
  foLineId: string;
  remaining: number;
  /** Shopify's line item id, in lib/lineFields' one form. */
  lineItemId: string | null;
  vendor: string;
  variantId: string | null;
  sku: string;
}

const digits = (gid: unknown) => {
  const m = /(\d+)$/.exec(String(gid ?? ""));
  return m ? m[1] : null;
};

/** The order's fulfilment orders, every line. THROWS on anything but a full answer. */
export async function readFulfilmentOrders(shopifyOrderId: string): Promise<FoLine[]> {
  const data = await shopifyGraphql<{ order: null | { fulfillmentOrders: { nodes: unknown[] } } }>(
    `query FulfilmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 50) {
          nodes {
            id status
            supportedActions { action }
            lineItems(first: 250) {
              nodes { id remainingQuantity lineItem { id vendor sku variant { id } } }
            }
          }
        }
      }
    }`,
    { id: `gid://shopify/Order/${shopifyOrderId}` },
  );
  if (!data.order) throw new Error(`Shopify has no order ${shopifyOrderId}`);
  const out: FoLine[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const fo of data.order.fulfillmentOrders.nodes as any[]) {
    const actions: string[] = (fo?.supportedActions ?? []).map((a: { action?: string }) => String(a?.action ?? ""));
    const fulfillable = actions.includes("CREATE_FULFILLMENT");
    for (const li of fo?.lineItems?.nodes ?? []) {
      out.push({
        foId: String(fo.id), foStatus: String(fo.status ?? ""), fulfillable,
        foLineId: String(li.id), remaining: Number(li.remainingQuantity) || 0,
        lineItemId: lineItemIdOf(li?.lineItem?.id),
        vendor: String(li?.lineItem?.vendor ?? "").trim(),
        variantId: digits(li?.lineItem?.variant?.id),
        sku: String(li?.lineItem?.sku ?? ""),
      });
    }
  }
  return out;
}

/** One OMS line to fulfil now, and the vendor's other lines (to judge ambiguity). */
export interface PlanLine { index: number; key: string | null; line: SkuItem }

/** What the record keeps per fulfilled line. */
export interface RecordLine { key: string | null; line_item_id: string | null; variant_id: string | null; sku: string; quantity: number }

export type Plan =
  | { ok: true; pairs: { fulfillmentOrderId: string; fulfillmentOrderLineItems: { id: string; quantity: number }[] }[];
      /** Every line of the unit, with what Shopify holds for it. */
      lines: RecordLine[];
      /** Lines Shopify already shows fulfilled (someone did it in Shopify). */
      alreadyInShopify: RecordLine[] }
  | { ok: false; kind: "ambiguous" | "missing" | "not_fulfillable"; reason: string };

/**
 * Which of Shopify's lines are these OMS lines (ruling 5, 2026-10-29):
 * by line id; by variant id ONLY when that is unambiguous among the vendor's
 * unfulfilled lines -- one OMS line and one Shopify line of the vendor on that
 * variant; else nothing, and why. Whole lines: Shopify's remaining quantity.
 *
 * @param unit       the lines to fulfil now
 * @param vendorOpen every not-yet-shipped OMS line of the same vendor (unit included)
 */
export function planFulfilment(vendor: string, unit: PlanLine[], vendorOpen: PlanLine[], fo: FoLine[]): Plan {
  const mine = fo.filter((f) => f.vendor === vendor);
  const used = new Set<string>();
  const pairs = new Map<string, { id: string; quantity: number }[]>();
  const lines: RecordLine[] = [];
  const already: RecordLine[] = [];
  for (const u of unit) {
    const id = lineItemIdOf(u.line.line_item_id);
    let match: FoLine[];
    if (id) {
      match = mine.filter((f) => f.lineItemId === id);
    } else {
      const v = String(u.line.variant_id ?? "").trim();
      if (!v) return { ok: false, kind: "ambiguous", reason: `${u.line.sku || "A line"} has no Shopify line id or variant to find it by` };
      const omsSame = vendorOpen.filter((o) => !lineItemIdOf(o.line.line_item_id) && String(o.line.variant_id ?? "").trim() === v);
      const shopSame = mine.filter((f) => f.variantId === v && f.remaining > 0 && !used.has(f.foLineId));
      if (omsSame.length !== 1 || shopSame.length !== 1) {
        return { ok: false, kind: "ambiguous", reason: `${u.line.sku || "A line"} shares its variant with another ${vendor} line, and has no Shopify line id to tell them apart` };
      }
      match = shopSame;
    }
    // A Shopify line can sit on more than one fulfilment order (moved, split): all of it.
    if (match.length === 0) {
      return { ok: false, kind: "missing", reason: `${u.line.sku || "A line"} is not on the order in Shopify` };
    }
    const rec: RecordLine = {
      key: u.key, line_item_id: id ?? match[0].lineItemId, variant_id: String(u.line.variant_id ?? "") || match[0].variantId,
      sku: u.line.sku, quantity: match.reduce((n, f) => n + f.remaining, 0),
    };
    const open = match.filter((f) => f.remaining > 0);
    if (open.length === 0) { already.push({ ...rec, quantity: 0 }); lines.push({ ...rec, quantity: 0 }); continue; }
    for (const f of open) {
      if (!f.fulfillable) {
        return { ok: false, kind: "not_fulfillable", reason: `Shopify will not fulfil ${u.line.sku || "a line"} now (its fulfilment order is ${f.foStatus.toLowerCase() || "unavailable"})` };
      }
      used.add(f.foLineId);
      const list = pairs.get(f.foId) ?? [];
      list.push({ id: f.foLineId, quantity: f.remaining });
      pairs.set(f.foId, list);
    }
    lines.push(rec);
  }
  return {
    ok: true,
    pairs: [...pairs.entries()].map(([fulfillmentOrderId, items]) => ({ fulfillmentOrderId, fulfillmentOrderLineItems: items })),
    lines, alreadyInShopify: already,
  };
}

export type CreateResult =
  | { ok: true; fulfillmentId: string }
  | { ok: false; definite: true; reason: string }      // Shopify said no: nothing was made
  | { ok: false; definite: false; reason: string };    // no answer: it may have been made

/** Ask Shopify to fulfil exactly these lines, and email the customer. */
export async function createFulfilment(pairs: Extract<Plan, { ok: true }>["pairs"]): Promise<CreateResult> {
  if (pairs.length === 0 || pairs.some((p) => p.fulfillmentOrderLineItems.length === 0 || p.fulfillmentOrderLineItems.some((i) => !(i.quantity > 0)))) {
    // See the header: an empty list fulfils the WHOLE fulfilment order.
    return { ok: false, definite: true, reason: "refused to send a fulfilment without its lines" };
  }
  let data: { fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: { field?: string[]; message: string }[] } };
  try {
    data = await shopifyGraphql(
      `mutation Fulfil($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) {
          fulfillment { id status }
          userErrors { field message }
        }
      }`,
      { fulfillment: { lineItemsByFulfillmentOrder: pairs, notifyCustomer: true } },
    );
  } catch (e) {
    return { ok: false, definite: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const errs = data?.fulfillmentCreate?.userErrors ?? [];
  if (errs.length) return { ok: false, definite: true, reason: `Shopify: ${errs.map((x) => x.message).join("; ")}` };
  const id = data?.fulfillmentCreate?.fulfillment?.id;
  if (!id) return { ok: false, definite: false, reason: "Shopify answered with no fulfilment and no error" };
  return { ok: true, fulfillmentId: String(id) };
}
