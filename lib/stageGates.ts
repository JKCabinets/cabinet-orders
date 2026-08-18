/**
 * Client-side stage transition gates.
 *
 * These gates protect against accidental misuse from the UI. Server-side
 * enforcement also exists in /api/orders/[id] PATCH — the gates here exist
 * to fail fast and show a helpful message, but the server is the source of
 * truth.
 */

export type GateResult =
  | { ok: true }
  | { ok: false; reason: "no-attachments"; message: string }
  | { ok: false; reason: "no-delivery-proof"; message: string }
  | { ok: false; reason: "network"; message: string };

/**
 * Returns ok=true if the order has at least one attachment, else ok=false
 * with reason="no-attachments". Used to gate New→Entered transitions.
 */
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
 */
export async function checkDeliveryProofGate(orderId: string): Promise<GateResult> {
  try {
    const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(orderId)}`);
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

export async function checkAttachmentGate(orderId: string): Promise<GateResult> {
  try {
    const res = await fetch(`/api/orders/attachments?orderId=${encodeURIComponent(orderId)}`);
    if (!res.ok) {
      return { ok: false, reason: "network", message: "Could not verify attachments" };
    }
    const data = await res.json();
    const count = (data.data ?? []).length;
    if (count === 0) {
      return {
        ok: false,
        reason: "no-attachments",
        message: "Attach at least one file before marking this order as Entered",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "network", message: "Could not verify attachments" };
  }
}
