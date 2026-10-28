import { supabase } from "@/lib/supabase";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import { isWaypointVendor } from "@/lib/vendorFamily";
import { ackIsStale } from "@/lib/ackFingerprint";
import type { SkuItem } from "@/lib/skuDecoder";
import { doorStyleMap, colorMapAll } from "@/lib/skuDecoder";
import type { ReconcileResult } from "@/lib/reconcile";

/** The order fields a fingerprint is computed over. */
export type AckOrderSnapshot = {
  name: string | null;
  ship_to: string | null;
  /** Required (2026-10-07): the fingerprint covers the phone now -- see ackIsStale. */
  customer_phone: string | null;
  sku_items: SkuItem[];
};

export type AckSummary = {
  verdict: "green" | "red";
  uploaded_at: string;
  result: ReconcileResult;
  /**
   * ⚠ The verdict was about a set of lines that has since changed. A stale
   * green is NOT a green: it confirmed an order that no longer exists. False
   * when there is no basis to judge -- see ackIsStale.
   */
  stale: boolean;
  /**
   * Names for the door-style and colour codes in this acknowledgment and the
   * order (2026-10-07), from the server's mapping tables, so the screen can say
   * "Painted Harbor" rather than only "PH". Empty when the maps are not loaded.
   */
  names?: { door: Record<string, string>; color: Record<string, string> };
  /**
   * The submission's KEPT FILE (2026-10-28): what the Files tabs mark "In use"
   * on the vendor's latest submission. Null when it has none, or it was deleted.
   */
  attachment_id: number | null;
};

/** Door-style and colour names for the codes in these SKUs (read from the end: colour last). */
function codeNames(skus: string[]): { door: Record<string, string>; color: Record<string, string> } {
  const doors = doorStyleMap(), colors = colorMapAll();
  const names = { door: {} as Record<string, string>, color: {} as Record<string, string> };
  for (const s of skus) {
    const p = String(s ?? "").split("-");
    if (p.length < 3) continue;
    const door = p[p.length - 2], color = p[p.length - 1];
    if (doors[door]) names.door[door] = doors[door];
    if (colors[color]) names.color[color] = colors[color];
  }
  return names;
}

/**
 * Latest acknowledgment per vendor for an order (newest row per vendor wins;
 * full history is preserved in order_acknowledgments). Scoped to the supplied
 * vendor list — vendors with no ack map to null. Shared by the /vendors
 * endpoint (for display) and the PATCH gate (for the all-green check) so the
 * two can't drift.
 */
/** One row of order_acknowledgments, as the queries below select it. */
export type AckRow = {
  vendor: string;
  verdict: "green" | "red";
  uploaded_at: string;
  result_json: ReconcileResult;
  lines_fingerprint: string | null;
  /** Absent before 2026-10-28's migration; null once its file is deleted. */
  attachment_id?: number | null;
};

/** The select list, in one place, so the batch query cannot drift from this one. */
export const ACK_SELECT =
  "vendor, verdict, uploaded_at, result_json, lines_fingerprint, attachment_id";

/**
 * Newest acknowledgment per vendor, with staleness judged. NO I/O.
 *
 * ⚠ `rowsNewestFirst` MUST BE ORDERED, uploaded_at descending. The loop takes
 * the first row it sees per vendor and ignores the rest, so an unordered input
 * silently picks an arbitrary acknowledgment — and "arbitrary" would usually
 * be right, which is what would make it hard to notice.
 */
export function summariseAcks(
  rowsNewestFirst: AckRow[],
  vendors: string[],
  order?: AckOrderSnapshot | null,
): Record<string, AckSummary | null> {
  const ackByVendor: Record<string, AckSummary | null> = {};
  for (const v of vendors) ackByVendor[v] = null;

  for (const r of rowsNewestFirst) {
    // rows are newest-first; only fill a vendor we care about, once
    if (r.vendor in ackByVendor && !ackByVendor[r.vendor]) {
      ackByVendor[r.vendor] = {
        verdict: r.verdict,
        uploaded_at: r.uploaded_at,
        result: r.result_json,
        attachment_id: r.attachment_id ?? null,
        names: codeNames([
          ...(r.result_json?.lines ?? []).map((l) => l.composite_sku),
          ...(Array.isArray(order?.sku_items) ? order!.sku_items.map((i) => i.sku) : []),
        ]),
        // ⚠ Without `order` there is nothing to compare against, so nothing is
        // stale. Callers that gate on this MUST pass it; callers that only
        // display can omit it and get today's behaviour.
        stale: order ? ackIsStale(r.lines_fingerprint, r.vendor, {
          name: order.name, ship_to: order.ship_to, customer_phone: order.customer_phone,
          sku_items: Array.isArray(order.sku_items) ? order.sku_items : [],
        }) : false,
      };
    }
  }
  return ackByVendor;
}

/**
 * True only if EVERY vendor has a latest GREEN acknowledgment that is not
 * stale. NO I/O.
 *
 * ⚠ A STALE GREEN IS NOT A GREEN. It confirmed a set of lines that has since
 * changed, so it is evidence about an order that no longer exists.
 *
 * ⚠ NO VENDORS MEANS FALSE, not vacuously true. An order whose vendors do not
 * resolve has not been acknowledged by anybody; `[].every()` would say yes.
 */
export function allVendorsGreen(
  vendors: string[],
  ackByVendor: Record<string, AckSummary | null>,
): boolean {
  if (vendors.length === 0) return false;
  return vendors.every(
    (v) => ackByVendor[v]?.verdict === "green" && !ackByVendor[v]?.stale,
  );
}

/**
 * ⚠ "AN ACKNOWLEDGMENT OR AN ATTACHMENT", VENDOR BY VENDOR (2026-10-28,
 * Garrett, item 57): "Waypoint orders need a green acknowledgment; any file
 * counts only for HCI and J&K." Each vendor on the order is met on its own:
 *   Waypoint      a green acknowledgment, current with the order
 *   any other     a green acknowledgment, OR any file (kinds other than
 *                 `acknowledgment`) -- HCI and J&K have no parser to make one
 * An order mixing vendors needs both. One whose vendors cannot be resolved is
 * met by a file, as before. THE ONE RULE: the PATCH route's Entered gate, the
 * enrichment (and through it the Next Action checklist and the client gates)
 * all ask this.
 */
export function ackRequirementMet(
  vendors: string[],
  ackByVendor: Record<string, AckSummary | null>,
  hasFile: boolean,
): boolean {
  if (vendors.length === 0) return hasFile;
  return vendors.every((v) => {
    const green = ackByVendor[v]?.verdict === "green" && !ackByVendor[v]?.stale;
    return isWaypointVendor(v) ? green : green || hasFile;
  });
}

/**
 * One order's worth. Unchanged signature and unchanged behaviour — a fetch
 * followed by the pure summariser above, so every existing caller exercises
 * the same rule the batch path uses.
 */
export async function latestAckByVendor(
  orderId: string,
  vendors: string[],
  /** Required to judge staleness; omit only where the answer is not gated on. */
  order?: AckOrderSnapshot | null,
): Promise<Record<string, AckSummary | null>> {
  const { data } = await supabase
    .from("order_acknowledgments")
    .select(ACK_SELECT)
    .eq("order_id", orderId)
    .order("uploaded_at", { ascending: false });

  return summariseAcks((data ?? []) as AckRow[], vendors, order);
}

/**
 * True only if EVERY vendor on the order has a latest GREEN acknowledgment.
 * An order with a vendor that has no ack yet (e.g. an HCI vendor, which has no
 * parser yet) is therefore not all-green and won't auto-advance. Self-contained:
 * resolves the order's vendors and their latest acks. Returns false if the order
 * is missing or no vendors resolve.
 */
/** The order's vendors and each one's latest acknowledgment; null if the order is missing. */
async function orderVendorAcks(orderId: string): Promise<{ vendors: string[]; ackByVendor: Record<string, AckSummary | null> } | null> {
  const { data: order } = await supabase
    .from("orders")
    // ⚠ name and ship_to are here for the FINGERPRINT. reconcileAck gates on
    // them, so a change to either makes a green ack stale.
    .select("vendor, sku_items, name, ship_to, customer_phone")
    .eq("id", orderId)
    .single();
  if (!order) return null;

  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const lookup = await lookupVendorsForSkus(skuItems, order.vendor);
  const vendors = lookup.uniqueVendors;
  if (vendors.length === 0) return { vendors, ackByVendor: {} };
  return { vendors, ackByVendor: await latestAckByVendor(orderId, vendors, order) };
}

export async function orderAllVendorsGreen(orderId: string): Promise<boolean> {
  const got = await orderVendorAcks(orderId);
  if (!got) return false;
  // The verdict itself lives in allVendorsGreen, shared with the enrichment
  // endpoint. Blocking on a stale green is the point: the designer entered
  // THESE lines into the manufacturer's system and the acknowledgment matched
  // THEM.
  return allVendorsGreen(got.vendors, got.ackByVendor);
}

/** The Entered gate's question, for one order: see ackRequirementMet. */
export async function orderAckRequirementMet(orderId: string, hasFile: boolean): Promise<boolean> {
  const got = await orderVendorAcks(orderId);
  if (!got) return false;
  return ackRequirementMet(got.vendors, got.ackByVendor, hasFile);
}
