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
  | { ok: false; reason: "network"; message: string };

/**
 * Returns ok=true if the order has at least one attachment, else ok=false
 * with reason="no-attachments". Used to gate New→Entered transitions.
 */
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
