/**
 * Backorder aggregation helpers.
 *
 * The dashboard and the dedicated /backorders page both need to answer "what
 * SKUs are backordered, on which orders, and which are overdue against the
 * vendor's commitment". This module does the rollup once so both surfaces
 * agree on the numbers.
 *
 * Pure functions, no I/O — feed it `orders` from the store and it returns
 * the aggregate views.
 */

import type { Order } from "@/lib/data";
import { arizonaToday } from "@/lib/dates";

export interface BackorderedSkuRollup {
  /** The full SKU as recorded on the order line items. */
  sku: string;
  /** A representative description (first one we see). */
  description?: string;
  /** Total quantity across all affected orders. */
  totalQuantity: number;
  /** Number of distinct orders that have this SKU backordered. */
  orderCount: number;
  /** The orders affected — sorted by oldest order date first. */
  orders: Order[];
  /** Soonest expected_ready_date across the affected orders (or null if none set). */
  soonestExpected: string | null;
  /** Latest expected_ready_date (worst case). */
  latestExpected: string | null;
  /** True if any commitment is in the past (vendor missed). */
  hasOverdueCommitment: boolean;
  /** True if any affected order has no expected_ready_date set at all. */
  hasUndatedCommitment: boolean;
}

export interface BackorderSummary {
  /** Distinct backordered SKUs (one row per SKU, regardless of order count). */
  distinctSkus: number;
  /** Distinct affected orders. */
  affectedOrders: number;
  /** Distinct backordered SKUs that have at least one overdue commitment. */
  overdueSkus: number;
  /** Distinct backordered SKUs with at least one affected order whose date is unset. */
  undatedSkus: number;
  /** The single rollup with the highest order count — "the SKU you should call about first". */
  topImpact: BackorderedSkuRollup | null;
}

/**
 * Build the per-SKU rollup. Only active (non-archived) orders count.
 * Same backordered SKU across multiple orders collapses to one row.
 *
 * `todayIso` is overridable for tests; defaults to Arizona's date
 * (`arizonaToday`) — the business's day, not UTC's, which is already
 * tomorrow from 5 p.m. Arizona (item 8, 2026-11-10).
 */
export function rollupBackorders(
  orders: Order[],
  todayIso?: string,
): BackorderedSkuRollup[] {
  const today = todayIso ?? arizonaToday();

  // Map: SKU → accumulator
  const acc = new Map<string, {
    sku: string;
    description?: string;
    totalQuantity: number;
    orders: Order[];
    expectedDates: string[]; // for soonest/latest
    hasOverdueCommitment: boolean;
    hasUndatedCommitment: boolean;
  }>();

  for (const o of orders) {
    if (o.archived) continue;
    for (const item of o.sku_items ?? []) {
      if (!item.backordered) continue;
      const key = item.sku || "(no sku)";
      let row = acc.get(key);
      if (!row) {
        row = {
          sku: key,
          description: item.description,
          totalQuantity: 0,
          orders: [],
          expectedDates: [],
          hasOverdueCommitment: false,
          hasUndatedCommitment: false,
        };
        acc.set(key, row);
      }
      row.totalQuantity += item.quantity ?? 0;
      // Only count each order once per SKU even if the SKU appears on
      // multiple lines of the same order (rare but possible).
      if (!row.orders.find(x => x.id === o.id)) row.orders.push(o);
      if (item.expected_ready_date) {
        row.expectedDates.push(item.expected_ready_date);
        if (item.expected_ready_date < today) row.hasOverdueCommitment = true;
      } else {
        row.hasUndatedCommitment = true;
      }
      // Prefer a non-empty description if we didn't have one yet
      if (!row.description && item.description) row.description = item.description;
    }
  }

  // Materialize rollups, sort orders within each, then sort rollups by impact
  const rollups: BackorderedSkuRollup[] = Array.from(acc.values()).map(row => {
    const sorted = [...row.orders].sort((a, b) => {
      // Oldest first — that's the most-waiting order
      const ta = Date.parse(a.date) || 0;
      const tb = Date.parse(b.date) || 0;
      return ta - tb;
    });
    return {
      sku: row.sku,
      description: row.description,
      totalQuantity: row.totalQuantity,
      orderCount: row.orders.length,
      orders: sorted,
      soonestExpected: row.expectedDates.length
        ? row.expectedDates.reduce((a, b) => (a < b ? a : b))
        : null,
      latestExpected: row.expectedDates.length
        ? row.expectedDates.reduce((a, b) => (a > b ? a : b))
        : null,
      hasOverdueCommitment: row.hasOverdueCommitment,
      hasUndatedCommitment: row.hasUndatedCommitment,
    };
  });

  // Sort by impact: most-affected orders first, then overdue commitments,
  // then undated commitments, then alphabetical SKU
  rollups.sort((a, b) => {
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    if (a.hasOverdueCommitment !== b.hasOverdueCommitment) {
      return a.hasOverdueCommitment ? -1 : 1;
    }
    if (a.hasUndatedCommitment !== b.hasUndatedCommitment) {
      return a.hasUndatedCommitment ? -1 : 1;
    }
    return a.sku.localeCompare(b.sku);
  });

  return rollups;
}

/** Headline numbers for the dashboard card. */
export function summarizeBackorders(rollups: BackorderedSkuRollup[]): BackorderSummary {
  const affectedOrderIds = new Set<string>();
  let overdueSkus = 0;
  let undatedSkus = 0;
  for (const r of rollups) {
    for (const o of r.orders) affectedOrderIds.add(o.id);
    if (r.hasOverdueCommitment) overdueSkus++;
    if (r.hasUndatedCommitment) undatedSkus++;
  }
  return {
    distinctSkus: rollups.length,
    affectedOrders: affectedOrderIds.size,
    overdueSkus,
    undatedSkus,
    topImpact: rollups.length > 0 ? rollups[0] : null,
  };
}

// flattenBackorderedLines (one row per backordered line) was deleted
// 2026-11-10: it had no caller, and it carried the UTC "today" item 8 fixed.
