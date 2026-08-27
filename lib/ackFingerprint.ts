import crypto from "crypto";
import { decodeSku, type SkuItem } from "@/lib/skuDecoder";
import { normName, normAddress, skuKey, type OrderLineItem } from "@/lib/reconcile";

/**
 * ackFingerprint — is a green acknowledgment still about THIS order?
 *
 * A green ack is evidence about a specific set of lines at a specific moment.
 * `orderAllVendorsGreen` asked only "is the latest verdict green", with nothing
 * tying that verdict to what was reconciled -- so a Shopify order edit or a
 * re-decode left the green ack standing and still advancing the order,
 * confirming lines that no longer exist.
 *
 * Same shape as a tracking number surviving a backward move: a row holding
 * evidence for a state it is no longer in.
 *
 * ⚠ A COMPARISON, NOT A MUTATION. The alternative was clearing the ack whenever
 * sku_items is written -- which fails twice over: the webhook rewrites that
 * column on EVERY orders/updated, usually to an identical value, so acks would
 * clear constantly; and it would depend on every future write path remembering
 * to call it. A fingerprint recomputed at the gate cannot be bypassed by a code
 * path nobody thought of.
 *
 * ⚠ IT COVERS EXACTLY WHAT THE VERDICT DEPENDS ON, no more and no less.
 * reconcileAck gates on three things and nothing else:
 *
 *   1. normName(order.name)                    vs the ack's ship_name
 *   2. normAddress(order.ship_to)              vs the ack's ship_address
 *   3. per skuKey(): summed quantity, and the modifications multiset
 *
 * Price is parsed for display and is NOT a gate, so it is not in here. Too wide
 * and orders go stale on edits that could not change the verdict; too narrow and
 * a real change slips past.
 *
 * ⚠ IT USES RECONCILE'S OWN NORMALISERS. Re-implementing them here is the
 * one-rule-two-implementations shape this codebase keeps paying for, and the
 * failure would be quiet and awful: a whitespace change in an address would
 * stale an ack that reconcileAck would still call green, blocking an order for
 * a difference the engine considers noise.
 */

/**
 * The lines a given vendor's acknowledgment covers.
 *
 * ⚠ ONE SELECTOR, TWO CALL SITES. The upload route reconciles a filtered subset
 * of the order's lines, and the gate must fingerprint that IDENTICAL subset. If
 * the two ever select differently -- by even one line -- every fingerprint
 * mismatches, every ack reads stale, and no cabinet order can advance. So both
 * call this, and neither filters for itself.
 *
 * Returns NULL, not [], for a vendor whose acknowledgments we cannot interpret.
 * An empty array is a valid line set and would hash to a real value; null means
 * "no basis to check", which the caller must treat as "do not block".
 *
 * ⚠ ONLY WAYPOINT HAS A PARSER TODAY. HCI and J&K use different acknowledgment
 * formats and are not implemented. When they are, they get an entry here and
 * their own line predicate -- the shape is already per vendor because their acks
 * cover only their own lines, exactly as Waypoint's does.
 */
export function linesForAckVendor(
  vendor: string,
  skuItems: SkuItem[],
): OrderLineItem[] | null {
  const v = (vendor ?? "").trim().toLowerCase();

  // Waypoint family. "Select Cabinetry" is the storefront alias; Shopify's
  // product vendor is "Waypoint Cabinetry" (verified 2026-08-27), but the alias
  // is accepted in case a line ever carries it.
  const isWaypoint =
    v === "waypoint cabinetry" || v === "waypoint" || v === "select cabinetry";
  if (!isWaypoint) return null;

  // ⚠ THE SAME PREDICATE THE UPLOAD ROUTE USED INLINE. Post-fix orders store the
  // full composite, whose 3-part door+color shape identifies the family
  // unambiguously -- decodeSku sets doorCode only for the Waypoint shape.
  return skuItems
    .filter((it) => !!decodeSku(it.sku)?.doorCode)
    .map((it) => ({
      sku: it.sku,
      quantity: Number(it.quantity) || 0,
      // SkuItem carries modification OBJECTS; reconcile compares their sub-SKU
      // strings. Flattened here so both sides fingerprint the same shape.
      modifications: (it.modifications ?? []).map((m) => m.sku),
    }));
}

/**
 * A stable hash of everything reconcileAck's verdict depends on.
 *
 * Canonicalised before hashing so that orderings which the engine treats as
 * equivalent hash equally: lines are keyed and sorted by skuKey, quantities are
 * summed per key, and modifications are upper-cased and sorted -- which is what
 * reconcileAck does before comparing them as a multiset.
 */
export function ackFingerprint(
  name: string,
  shipTo: string,
  lines: OrderLineItem[],
): string {
  const bySku = new Map<string, { qty: number; mods: string[] }>();
  for (const it of lines) {
    const k = skuKey(it.sku);
    if (!k) continue;
    const entry = bySku.get(k) ?? { qty: 0, mods: [] };
    entry.qty += Number(it.quantity) || 0;
    if (it.modifications?.length) entry.mods.push(...it.modifications);
    bySku.set(k, entry);
  }

  const canonical = JSON.stringify({
    n: normName(name),
    a: normAddress(shipTo),
    l: Array.from(bySku.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [
        k,
        v.qty,
        v.mods.map((m) => m.trim().toUpperCase()).sort(),
      ]),
  });

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Is a stored ack still about the order as it stands?
 *
 * ⚠ NULL MEANS VALID, DELIBERATELY. Rows written before fingerprinting existed
 * carry null, and treating that as stale would invalidate every historical
 * acknowledgment the moment this deploys -- turning a safeguard into an outage.
 * The same applies to a vendor with no selector: no basis to check is not
 * evidence of a problem.
 */
export function ackIsStale(
  storedFingerprint: string | null | undefined,
  vendor: string,
  order: { name: string | null; ship_to: string | null; sku_items: SkuItem[] },
): boolean {
  if (!storedFingerprint) return false;
  const lines = linesForAckVendor(vendor, order.sku_items);
  if (lines === null) return false;
  return (
    ackFingerprint(order.name ?? "", order.ship_to ?? "", lines) !==
    storedFingerprint
  );
}
