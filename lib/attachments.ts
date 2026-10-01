"use client";

import { useEffect, useState } from "react";
import { invalidateEnrichment } from "@/lib/useOrderEnrichment";

/**
 * ONE list of an order's files, shared by every view that shows it (handoff
 * item 24, step 2; 2026-09-30).
 *
 * ⚠ WHY THIS EXISTS. AttachmentsPanel and the modal's Files tab each fetched
 * the list for themselves. An upload in one did not reach the other, and step 4
 * adds a third view -- the custom job's Files tab with a tab per room. Two views
 * of one list that can disagree are two lists.
 *
 * ⚠ THE SHAPE OF lib/ackStatus, WITH TWO THINGS IT DOES NOT DO.
 *
 *   1. EVERY REQUEST TAKES A TICKET, AND ONLY THE NEWEST MAY WRITE. invalidateAck
 *      starts a second fetch without stopping the first, and the first still
 *      writes when it lands -- after the second, if the network says so -- and
 *      its `finally` then deletes the second's in-flight marker. Proven against
 *      the real module 2026-09-30. Here an upload or a delete applies the
 *      server's answer and then starts a request with a NEW ticket, so a
 *      response that set off before the change can never land on top of it.
 *
 *   2. A VIEW MOUNTING REFETCHES. ackStatus keeps what it fetched until somebody
 *      invalidates it. order_attachments is not in the realtime publication, so
 *      a cache kept that way would never show a colleague's upload, not even on
 *      reopening the modal -- today each mount refetches, and that must survive.
 *      Views mounting together share one request.
 *
 * ⚠ NOT FOR GATES. lib/stageGates asks the server at the moment of a stage move
 * and should keep doing so: a gate that reads a cache can pass on a list that
 * is a second out of date. The server re-checks either way.
 *
 * The routes are unchanged: GET/POST /api/orders/attachments, GET/DELETE
 * /api/orders/attachments/[id].
 */

export type AttachmentKind = "general" | "proof_of_delivery" | "customer_upload";

/** A row of order_attachments, as GET /api/orders/attachments returns it. */
export interface Attachment {
  id: number;
  order_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  file_type: string;
  uploaded_by: string;
  /** Nullable in the table (default now()): render a missing one, never "Invalid Date". */
  created_at: string | null;
  /**
   * What the file IS, not its file type. The CHECK allows exactly these three.
   * "customer_upload" is written at ingest by the quote webhook (2026-09-28) and
   * never inferred later: "general" on an older row genuinely could be either.
   */
  kind: AttachmentKind;
  /** The room or style group it is filed under, on a custom job; null = the job. */
  spec_ref: string | null;
}

export interface AttachmentList {
  /** null until a load has succeeded once. */
  files: Attachment[] | null;
  loading: boolean;
  /** Why the latest load failed. Files from an earlier success are kept. */
  error: string | null;
}

const NOT_LOADED: AttachmentList = { files: null, loading: true, error: null };

const lists = new Map<string, AttachmentList>();
const latestTicket = new Map<string, number>();
const inFlight = new Map<string, number>();          // orderId -> the ticket being fetched
const listeners = new Map<string, Set<() => void>>();

function publish(orderId: string, next: AttachmentList): void {
  lists.set(orderId, next);
  listeners.get(orderId)?.forEach((fn) => fn());
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown>; } catch { return {}; }
}

/** The words to show for a refusal: the route's own message when it wrote one. */
function reasonOf(body: Record<string, unknown>, status: number, fallback: string): string {
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  return `${fallback} (${status})`;
}

/** Start a load that supersedes every earlier one for this order. */
function load(orderId: string): void {
  const ticket = (latestTicket.get(orderId) ?? 0) + 1;
  latestTicket.set(orderId, ticket);
  inFlight.set(orderId, ticket);
  const now = lists.get(orderId);
  publish(orderId, { files: now?.files ?? null, loading: true, error: null });

  void (async () => {
    let next: AttachmentList;
    try {
      const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(orderId)}`);
      const body = await readJson(res);
      next = res.ok
        ? { files: Array.isArray(body.data) ? (body.data as Attachment[]) : [], loading: false, error: null }
        : { files: lists.get(orderId)?.files ?? null, loading: false, error: reasonOf(body, res.status, "Could not load the files") };
    } catch {
      next = { files: lists.get(orderId)?.files ?? null, loading: false, error: "Could not reach the server to load the files." };
    }
    // ⚠ ONLY THE NEWEST TICKET WRITES. Anything older set off before a change
    // this list has since seen.
    if (latestTicket.get(orderId) !== ticket) return;
    if (inFlight.get(orderId) === ticket) inFlight.delete(orderId);
    publish(orderId, next);
  })();
}

/** A view arrived: refetch, unless a request that is still the newest is already out. */
function arrive(orderId: string): void {
  const out = inFlight.get(orderId);
  if (out !== undefined && out === latestTicket.get(orderId)) return;
  load(orderId);
}

/** Apply a confirmed change now, then fetch -- with a ticket that outranks anything already out. */
function applyThenReload(orderId: string, change: (files: Attachment[]) => Attachment[]): void {
  const now = lists.get(orderId);
  if (now?.files) publish(orderId, { ...now, files: change(now.files) });
  load(orderId);
}

function subscribe(orderId: string, fn: () => void): () => void {
  let set = listeners.get(orderId);
  if (!set) { set = new Set(); listeners.set(orderId, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(orderId);
  };
}

/** One order's files. Every mounted caller sees the same list. */
export function useAttachments(orderId: string): AttachmentList {
  const [, force] = useState(0);
  useEffect(() => {
    const off = subscribe(orderId, () => force((n) => n + 1));
    arrive(orderId);
    return off;
  }, [orderId]);
  return lists.get(orderId) ?? NOT_LOADED;
}

/** Several orders' files -- a project's groups -- keyed by order id. */
export function useAttachmentsFor(orderIds: string[]): Record<string, AttachmentList> {
  const [, force] = useState(0);
  const key = orderIds.join(",");
  useEffect(() => {
    const ids = key.split(",").filter(Boolean);
    const offs = ids.map((id) => subscribe(id, () => force((n) => n + 1)));
    ids.forEach(arrive);
    return () => offs.forEach((off) => off());
  }, [key]);
  return Object.fromEntries(orderIds.map((id) => [id, lists.get(id) ?? NOT_LOADED]));
}

/** Refetch now, for every view of this order. */
export function refreshAttachments(orderId: string): void {
  load(orderId);
}

export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Upload one file. The list changes only when the server has accepted it, and
 * a refusal comes back in the route's own words -- the claim, the archive, the
 * file type, the size.
 */
export async function uploadAttachment(
  orderId: string, file: File, kind: "general" | "proof_of_delivery",
  /** A room or style group of a custom job to file it under; null is the job itself. */
  specRef: string | null = null,
): Promise<Outcome<Attachment>> {
  const form = new FormData();
  form.append("file", file);
  form.append("orderId", orderId);
  form.append("kind", kind);
  if (specRef) form.append("spec_ref", specRef);
  let res: Response;
  try {
    res = await fetch("/api/orders/attachments", { method: "POST", body: form });
  } catch {
    return { ok: false, message: `${file.name}: could not reach the server. It was not uploaded.` };
  }
  const body = await readJson(res);
  if (!res.ok || !body.data) {
    return { ok: false, message: `${file.name}: ${reasonOf(body, res.status, "upload refused")}` };
  }
  const row = body.data as Attachment;
  applyThenReload(orderId, (files) => [row, ...files.filter((f) => f.id !== row.id)]);
  // An attachment can satisfy the Entered gate and a receipt the Delivered gate.
  invalidateEnrichment();
  return { ok: true, value: row };
}

/**
 * Delete one file. ⚠ THE LIST CHANGES ONLY ON A 2xx. The panel this replaces
 * removed the file on any answer, so a refused delete -- somebody else's claim,
 * an archived row -- made the file vanish from the screen while it stayed on
 * the order. Proven 2026-09-30.
 */
export async function deleteAttachment(orderId: string, id: number): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(`/api/orders/attachments/${id}`, { method: "DELETE" });
  } catch {
    return { ok: false, message: "Could not reach the server. Nothing was deleted." };
  }
  const body = await readJson(res);
  if (!res.ok) return { ok: false, message: reasonOf(body, res.status, "Delete refused") };
  applyThenReload(orderId, (files) => files.filter((f) => f.id !== id));
  invalidateEnrichment(); // removing a receipt reopens the Delivered gate
  return { ok: true, value: undefined };
}

/** A short-lived signed URL for one file. */
export async function attachmentUrl(id: number): Promise<Outcome<string>> {
  let res: Response;
  try {
    res = await fetch(`/api/orders/attachments/${id}`);
  } catch {
    return { ok: false, message: "Could not reach the server to open the file." };
  }
  const body = await readJson(res);
  if (!res.ok || typeof body.url !== "string") {
    return { ok: false, message: reasonOf(body, res.status, "Could not open the file") };
  }
  return { ok: true, value: body.url };
}
