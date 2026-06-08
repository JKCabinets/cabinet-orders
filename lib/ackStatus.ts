"use client";

import { useEffect, useState } from "react";
import type { ReconcileResult } from "@/lib/reconcile";

export type AckSummary = { verdict: "green" | "red"; uploaded_at: string; result: ReconcileResult };

export type AckStatus = {
  loading: boolean;
  vendors: string[];
  ackByVendor: Record<string, AckSummary | null>;
  /** order has at least one Waypoint-family vendor (the only reconcilable kind today) */
  hasWaypoint: boolean;
  /** at least one vendor has an ack of any verdict */
  hasAck: boolean;
  /** every vendor on the order has a latest green ack (vendors.length > 0) */
  allGreen: boolean;
  /** at least one vendor's latest ack is red */
  anyRed: boolean;
};

const EMPTY: AckStatus = {
  loading: true, vendors: [], ackByVendor: {},
  hasWaypoint: false, hasAck: false, allGreen: false, anyRed: false,
};

// Module-level cache + per-order subscriber sets. Both the table row
// (VendorExportPills, OrderEntryActions) and the modal (AcknowledgmentPanel)
// read the same cached status for an order, so a single /vendors fetch backs
// all of them and invalidateAck() refreshes every mounted view at once.
const cache = new Map<string, AckStatus>();
const inflight = new Map<string, Promise<void>>();
const subscribers = new Map<string, Set<() => void>>();

function notify(orderId: string) {
  subscribers.get(orderId)?.forEach((fn) => fn());
}

function computeStatus(vendors: string[], ackByVendor: Record<string, AckSummary | null>): AckStatus {
  const acks = vendors.map((v) => ackByVendor[v]);
  return {
    loading: false,
    vendors,
    ackByVendor,
    hasWaypoint: vendors.some((v) => /waypoint/i.test(v)),
    hasAck: acks.some((a) => !!a),
    allGreen: vendors.length > 0 && acks.every((a) => a?.verdict === "green"),
    anyRed: acks.some((a) => a?.verdict === "red"),
  };
}

async function fetchInto(orderId: string): Promise<void> {
  try {
    const res = await fetch("/api/orders/" + encodeURIComponent(orderId) + "/vendors");
    if (!res.ok) {
      cache.set(orderId, { ...EMPTY, loading: false });
      return;
    }
    const data = await res.json();
    const vendors: string[] = Array.isArray(data.vendors) ? data.vendors : [];
    const ackByVendor = (data.ackByVendor ?? {}) as Record<string, AckSummary | null>;
    cache.set(orderId, computeStatus(vendors, ackByVendor));
  } catch {
    cache.set(orderId, { ...EMPTY, loading: false });
  } finally {
    notify(orderId);
  }
}

function ensure(orderId: string): void {
  if (cache.has(orderId) || inflight.has(orderId)) return;
  const p = fetchInto(orderId).finally(() => inflight.delete(orderId));
  inflight.set(orderId, p);
}

/**
 * Drop the cached status for an order and refetch, notifying every mounted
 * view. Call after an upload or a stage move so the row and modal both reflect
 * the new verdict.
 */
export function invalidateAck(orderId: string): void {
  cache.delete(orderId);
  inflight.delete(orderId);
  const p = fetchInto(orderId).finally(() => inflight.delete(orderId));
  inflight.set(orderId, p);
}

/**
 * Subscribe to an order's acknowledgment status. When `enabled` is false (e.g.
 * an unclaimed New order that can't be submitted yet) it returns the empty
 * status and performs no fetch.
 */
export function useAckStatus(orderId: string, enabled: boolean): AckStatus {
  const [, force] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const cb = () => force((n) => n + 1);
    let set = subscribers.get(orderId);
    if (!set) { set = new Set(); subscribers.set(orderId, set); }
    set.add(cb);
    ensure(orderId);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) subscribers.delete(orderId);
    };
  }, [orderId, enabled]);

  if (!enabled) return EMPTY;
  return cache.get(orderId) ?? EMPTY;
}

// ── Row → modal auto-picker handoff ─────────────────────────────────────────
// The table's Submit/Resubmit sets a one-shot flag, then opens the modal; the
// modal consumes it on open and pops the .xlsx picker. Keeps the typed
// onOpenModal "reason" out of the row→page→modal chain.
const ackPickerRequests = new Set<string>();
export function requestAckPicker(orderId: string): void {
  ackPickerRequests.add(orderId);
}
export function consumeAckPicker(orderId: string): boolean {
  if (ackPickerRequests.has(orderId)) {
    ackPickerRequests.delete(orderId);
    return true;
  }
  return false;
}
