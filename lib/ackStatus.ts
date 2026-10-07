"use client";

import { useEffect, useState } from "react";
import type { ReconcileResult } from "@/lib/reconcile";

export type AckSummary = {
  verdict: "green" | "red";
  uploaded_at: string;
  result: ReconcileResult;
  /** The order changed after this verdict was reached. A stale green is not a green. */
  stale?: boolean;
};

export type AckStatus = {
  loading: boolean;
  vendors: string[];
  ackByVendor: Record<string, AckSummary | null>;
  /** order has at least one Waypoint-family vendor (the only reconcilable kind today) */
  hasWaypoint: boolean;
  /** at least one vendor has an ack of any verdict */
  hasAck: boolean;
  /** every vendor on the order has a latest green, NON-STALE ack (vendors.length > 0) */
  allGreen: boolean;
  /** at least one vendor's latest ack is red */
  anyRed: boolean;
  /** at least one vendor's latest ack was matched against lines that have since changed */
  anyStale: boolean;
};

const EMPTY: AckStatus = {
  loading: true, vendors: [], ackByVendor: {},
  hasWaypoint: false, hasAck: false, allGreen: false, anyRed: false, anyStale: false,
};

// Module-level cache + per-order subscriber sets. Both the table row
// (VendorExportPills, OrderEntryActions) and the modal (AcknowledgmentPanel)
// read the same cached status for an order, so a single /vendors fetch backs
// all of them and invalidateAck() refreshes every mounted view at once.
const cache = new Map<string, AckStatus>();
// ⚠ EVERY REQUEST TAKES A TICKET, AND ONLY THE NEWEST MAY WRITE (2026-10-07).
// invalidateAck used to start a second fetch without stopping the first, and
// the first still wrote when it landed -- AFTER the second, if the network
// said so -- so the verdict from before an upload could replace the one after
// it. Proven against the real module 2026-09-30: green on screen, then red.
// Its `finally` also deleted the second fetch's in-flight marker. The same fix
// as lib/attachments: the ticket a request set off with must still be the
// newest when it answers, or the answer is dropped.
const latestTicket = new Map<string, number>();
const inflight = new Map<string, number>();          // orderId -> the ticket being fetched
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
    // ⚠ A STALE GREEN DOES NOT COUNT. The verdict was about lines that have
    // since changed, so it cannot stand in for a confirmation of the order as
    // it is now.
    allGreen: vendors.length > 0 && acks.every((a) => a?.verdict === "green" && !a?.stale),
    anyRed: acks.some((a) => a?.verdict === "red"),
    anyStale: acks.some((a) => !!a?.stale),
  };
}

async function fetchInto(orderId: string, ticket: number): Promise<void> {
  let next: AckStatus;
  try {
    const res = await fetch("/api/orders/" + encodeURIComponent(orderId) + "/vendors");
    if (!res.ok) {
      next = { ...EMPTY, loading: false };
    } else {
      const data = await res.json();
      const vendors: string[] = Array.isArray(data.vendors) ? data.vendors : [];
      const ackByVendor = (data.ackByVendor ?? {}) as Record<string, AckSummary | null>;
      next = computeStatus(vendors, ackByVendor);
    }
  } catch {
    next = { ...EMPTY, loading: false };
  }
  // A newer request was set off after this one: its answer is the one to show.
  if (latestTicket.get(orderId) !== ticket) return;
  if (inflight.get(orderId) === ticket) inflight.delete(orderId);
  cache.set(orderId, next);
  notify(orderId);
}

/** Start a request that supersedes every earlier one for this order. */
function start(orderId: string): void {
  const ticket = (latestTicket.get(orderId) ?? 0) + 1;
  latestTicket.set(orderId, ticket);
  inflight.set(orderId, ticket);
  void fetchInto(orderId, ticket);
}

function ensure(orderId: string): void {
  if (cache.has(orderId) || inflight.has(orderId)) return;
  start(orderId);
}

/**
 * Drop the cached status for an order and refetch, notifying every mounted
 * view. Call after an upload or a stage move so the row and modal both reflect
 * the new verdict.
 */
export function invalidateAck(orderId: string): void {
  cache.delete(orderId);
  start(orderId);
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
