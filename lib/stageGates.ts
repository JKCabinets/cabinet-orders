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
    // ⚠ ONE RULE, ASKED OF THE SERVER (2026-11-02, feature 10): every cabinet
    // line its own receipt (lib/deliveryProof), through the enrichment -- the
    // same answer the PATCH route's Delivered gate gives. This counted the
    // order's receipts itself, so one J&K receipt passed a three-line order.
    const res = await fetch("/api/orders/enrichment", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [order.id] }),
    });
    if (!res.ok) {
      return { ok: false, reason: "network", message: "Could not verify the delivery receipts" };
    }
    const data = await res.json();
    const e = (data.data ?? {})[order.id] as { hasProofOfDelivery?: boolean; proofLines?: Record<string, boolean> } | undefined;
    if (!e?.hasProofOfDelivery) {
      const waiting = Object.entries(e?.proofLines ?? {}).filter(([, ok]) => !ok).map(([v]) => v);
      return {
        ok: false,
        reason: "no-delivery-proof",
        message: waiting.length > 1 || (waiting.length === 1 && Object.keys(e?.proofLines ?? {}).length > 1)
          ? `Attach the signed delivery receipt for ${waiting.join(", ")}.`
          : "Attach the signed delivery receipt.",
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
    // ⚠ EVERY CABINET LINE ITS OWN ACKNOWLEDGMENT (2026-11-02, feature 10): no
    // "any file" stand-in, and no fallback to one for an answer that lacks it.
    const e = (data.data ?? {})[orderId] as { ackRequirementMet?: boolean; ackLines?: Record<string, string> } | undefined;
    if (!e?.ackRequirementMet) {
      const waiting = Object.entries(e?.ackLines ?? {}).filter(([, s]) => s !== "met").map(([v]) => v);
      return {
        ok: false,
        reason: "no-attachments",
        message: waiting.length
          ? `Before Entered, every cabinet line needs its acknowledgment: ${waiting.join(", ")}.`
          : "Before Entered, every cabinet line needs its acknowledgment.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network", message: "Could not verify the acknowledgment" };
  }
}
