import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { prefetchVendorMaps, resolveVendors, type ResolvableItem } from "@/lib/vendorLookup";
import {
  summariseAcks, allVendorsGreen, ACK_SELECT, type AckRow, type AckOrderSnapshot,
} from "@/lib/acknowledgments";
import type { RequirementEnrichment } from "@/lib/requirements";
import type { SkuItem } from "@/lib/skuDecoder";

/**
 * POST /api/orders/enrichment — the joined facts a row's requirements need,
 * for many rows at once.
 *
 * ⚠ THIS EXISTS BECAUSE TWO ATTENTION REASONS HAVE NEVER APPEARED ON A SCREEN.
 * `acknowledgment missing` and `receipt missing` were built, documented, and
 * unreachable: they need `order_acknowledgments` and `order_attachments`,
 * neither of which is on the row, so `attentionFor` took them through an
 * optional `enrich` argument that no caller passed. Nobody passed it because
 * the only way to answer was a per-row query, and a work queue would have made
 * four to five per row.
 *
 * ⚠ FIVE QUERIES, REGARDLESS OF HOW MANY ORDERS ARE ASKED FOR:
 *
 *     orders                  the rows themselves
 *     shopify_products × 2    prefetchVendorMaps — variant ids, then base SKUs
 *     order_acknowledgments   every ack for every id, newest first
 *     order_attachments       ids and kinds only
 *
 * ⚠ AND NOT ONE RULE IS REIMPLEMENTED HERE. The four-layer vendor chain is
 * `resolveVendors`; the green-and-not-stale verdict is `allVendorsGreen`. Both
 * are the same functions the per-order path and the server gate call. A second
 * copy of either would mean the queue and the gate disagreeing about whether
 * an order can advance -- and the queue is the one people would believe.
 */

/**
 * ⚠ BOUNDED. The queue pages, so a caller asking about thousands of rows at
 * once is a bug or an attack, and either way it should be refused rather than
 * turned into an unbounded `in` list.
 */
const MAX_IDS = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 120, 60_000, "orders:enrichment");
  if (limited) return limited;

  let body: { ids?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.map((v) => String(v)).filter(Boolean)))
    : [];

  if (ids.length === 0) return NextResponse.json({ data: {} });
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Too many ids: ${ids.length}. Maximum is ${MAX_IDS}.` },
      { status: 422 },
    );
  }

  // ── 1. The rows ──────────────────────────────────────────────────────────
  //
  // ⚠ name AND ship_to ARE HERE FOR THE FINGERPRINT, not for display. A green
  // acknowledgment is stale when the customer name, the ship-to or the lines
  // have changed since it was recorded, so judging staleness needs all three.
  // Dropping them would make every ack read as fresh — the exact failure the
  // fingerprint was added to prevent.
  const { data: orderRows, error: orderErr } = await supabase
    .from("orders")
    .select("id, type, stage, vendor, sku_items, name, ship_to")
    .in("id", ids);

  if (orderErr) {
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  const orders = orderRows ?? [];

  // ── 2 & 3. Vendor maps, once, across every line of every order ───────────
  const allItems: ResolvableItem[] = [];
  for (const o of orders) {
    const items: SkuItem[] = Array.isArray(o.sku_items) ? o.sku_items : [];
    for (const i of items) if (i?.sku) allItems.push(i as ResolvableItem);
  }
  const vendorMaps = await prefetchVendorMaps(allItems);

  // ── 4. Acknowledgments ───────────────────────────────────────────────────
  //
  // ⚠ ORDERED NEWEST-FIRST ACROSS THE WHOLE SET, then grouped. summariseAcks
  // takes the first row it sees per vendor, so the ordering is what makes
  // "latest" mean latest. Grouping preserves it because the rows arrive sorted
  // and are appended in order.
  const { data: ackRows } = await supabase
    .from("order_acknowledgments")
    .select(`order_id, ${ACK_SELECT}`)
    .in("order_id", ids)
    .order("uploaded_at", { ascending: false });

  const acksByOrder = new Map<string, AckRow[]>();
  for (const r of (ackRows ?? []) as Array<AckRow & { order_id: string }>) {
    const list = acksByOrder.get(r.order_id) ?? [];
    list.push(r);
    acksByOrder.set(r.order_id, list);
  }

  // ── 5. Attachments ───────────────────────────────────────────────────────
  //
  // Ids and kinds only. Nothing here needs a filename, and a public-facing
  // mistake in this route is cheaper when the data was never fetched.
  const { data: attachmentRows } = await supabase
    .from("order_attachments")
    .select("order_id, kind")
    .in("order_id", ids);

  const anyAttachment = new Set<string>();
  const proofOfDelivery = new Set<string>();
  for (const a of (attachmentRows ?? []) as Array<{ order_id: string; kind: string }>) {
    anyAttachment.add(a.order_id);
    if (a.kind === "proof_of_delivery") proofOfDelivery.add(a.order_id);
  }

  // ── Per order, using the shared rules ────────────────────────────────────
  const data: Record<string, RequirementEnrichment> = {};

  for (const o of orders) {
    const id = o.id as string;
    const items: SkuItem[] = Array.isArray(o.sku_items) ? o.sku_items : [];

    const { uniqueVendors } = resolveVendors(
      items as ResolvableItem[], o.vendor as string | null, vendorMaps,
    );

    const snapshot: AckOrderSnapshot = {
      name: (o.name as string | null) ?? null,
      ship_to: (o.ship_to as string | null) ?? null,
      sku_items: items,
    };

    const ackByVendor = summariseAcks(
      acksByOrder.get(id) ?? [], uniqueVendors, snapshot,
    );

    data[id] = {
      ackGreen: allVendorsGreen(uniqueVendors, ackByVendor),
      hasAttachment: anyAttachment.has(id),
      hasProofOfDelivery: proofOfDelivery.has(id),
    };
  }

  // ⚠ AN ID THAT MATCHED NO ROW IS SIMPLY ABSENT from `data`, and that is
  // deliberate. `requirements.ts` reads a missing enrichment as UNKNOWN rather
  // than unmet, so a row that could not be loaded shows no reason at all
  // instead of claiming its acknowledgment is missing.
  return NextResponse.json({ data });
}
