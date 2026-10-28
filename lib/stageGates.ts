/**
 * Client-side stage transition gates.
 *
 * These gates protect against accidental misuse from the UI. Server-side
 * enforcement also exists in /api/orders/[id] PATCH — the gates here exist
 * to fail fast and show a helpful message, but the server is the source of
 * truth.
 */

import type { Order } from "@/lib/data";
import { requirementsFor } from "@/lib/requirements";

export type GateResult =
  | { ok: true }
  | { ok: false; reason: "no-attachments"; message: string }
  | { ok: false; reason: "no-delivery-proof"; message: string }
  | { ok: false; reason: "network"; message: string };

/**
 * Returns ok=true if the order carries an attachment marked as a signed
 * delivery receipt (kind = 'proof_of_delivery'). Gates At cross dock ->
 * Delivered.
 *
 * Deliberately NOT a plain attachment count: by this stage every order
 * already has the acknowledgment PDFs from Entered, so counting would pass
 * immediately and enforce nothing.
 *
 * As with checkAttachmentGate, the server is the source of truth -- this
 * exists to fail fast and offer the override in the same click.
 *
 * ⚠ WHETHER A RECEIPT IS NEEDED AT ALL IS ASKED OF lib/requirements -- the
 * same line the PATCH route reads -- so this takes the ROW, not an id. Not
 * a type list: custom jobs are not governed by our Terms, so Terms 12.3 and
 * its signed proof of delivery do not reach them, and that is recorded once
 * on the custom block of the table rather than here and in the route.
 * Resolved against the row's CURRENT stage: `proof_of_delivery` lives at
 * At cross dock, and asking about the target would exempt everything.
 */
export async function checkDeliveryProofGate(
  order: Pick<Order, "id" | "type" | "stage">,
): Promise<GateResult> {
  if (!requirementsFor(order).some((r) => r.id === "proof_of_delivery")) {
    return { ok: true };
  }
  try {
    const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(order.id)}`);
    if (!res.ok) {
      return { ok: false, reason: "network", message: "Could not verify attachments" };
    }
    const data = await res.json();
    const hasReceipt = ((data.data ?? []) as { kind?: string }[])
      .some(a => a.kind === "proof_of_delivery");
    if (!hasReceipt) {
      return {
        ok: false,
        reason: "no-delivery-proof",
        message: "Attach the signed delivery receipt before marking this order Delivered",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network", message: "Could not verify attachments" };
  }
}

/**
 * The New -> Entered gate, as the server answers it (2026-10-28, item 57).
 *
 * ⚠ ONE RULE, ASKED OF THE SERVER. This counted the order's files -- every
 * kind, so a kept (even FAILED) acknowledgment passed it, and it knew nothing
 * of Waypoint needing a green one. Now it reads the enrichment's
 * ackRequirementMet: the same function the PATCH route's gate asks.
 */
export async function checkAttachmentGate(orderId: string): Promise<GateResult> {
  try {
    const res = await fetch("/api/orders/enrichment", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [orderId] }),
    });
    if (!res.ok) {
      return { ok: false, reason: "network", message: "Could not verify the acknowledgment" };
    }
    const data = await res.json();
    const e = (data.data ?? {})[orderId] as { ackRequirementMet?: boolean; ackGreen?: boolean; hasAttachment?: boolean } | undefined;
    const met = e?.ackRequirementMet ?? (Boolean(e?.ackGreen) || Boolean(e?.hasAttachment));
    if (!met) {
      return {
        ok: false,
        reason: "no-attachments",
        message: "Before Entered: a matching acknowledgment for Waypoint lines, and for HCI or J&K lines an acknowledgment or any file.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network", message: "Could not verify the acknowledgment" };
  }
}
