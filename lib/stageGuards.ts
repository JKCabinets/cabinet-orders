import crypto from "crypto";

/**
 * Shared stage validation + admin-PIN gating used by every API route that
 * mutates an order's stage. Previously, only the bulk route (`/api/orders/bulk`)
 * enforced the backward-PIN check — single-order PATCH happily accepted any
 * stage value from any authenticated user, so the modal's PIN dialog was
 * advisory only. This module centralizes the rules so both routes agree.
 *
 * Stage orderings mirror ORDER_STAGES / WARRANTY_STAGES from lib/data.ts.
 */

export const ORDER_STAGE_ORDER = [
  "New", "Entered", "In production", "At cross dock", "Delivered",
] as const;

export const WARRANTY_STAGE_ORDER = [
  "New claim", "In review", "Parts ordered", "Shipped", "Resolved",
] as const;

export const ALLOWED_STAGES: ReadonlySet<string> = new Set<string>([
  ...ORDER_STAGE_ORDER,
  ...WARRANTY_STAGE_ORDER,
]);

/** Admin PIN for backwards moves. Reads from env first; falls back to the
 * legacy hardcoded value so existing deployments keep working until
 * ADMIN_BACKWARD_PIN is configured. Constant-time compared on every check. */
export const ADMIN_PIN: string =
  process.env.ADMIN_BACKWARD_PIN || "4951";

export type StageFlow = "order" | "warranty" | "unknown";

export function stageIndex(stage: string): { idx: number; flow: StageFlow } {
  const orderIdx = (ORDER_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (orderIdx >= 0) return { idx: orderIdx, flow: "order" };
  const warrantyIdx = (WARRANTY_STAGE_ORDER as readonly string[]).indexOf(stage);
  if (warrantyIdx >= 0) return { idx: warrantyIdx, flow: "warranty" };
  return { idx: -1, flow: "unknown" };
}

/** Constant-time string equality. Returns false on length mismatch (no throw). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Decide whether moving from `currentStage` to `targetStage` is a backwards
 * transition (lower index within the same flow). Cross-flow moves (order ↔
 * warranty) are treated as NOT backwards — the caller should reject those
 * separately if they're disallowed.
 */
export function isBackwardsMove(currentStage: string, targetStage: string): boolean {
  const current = stageIndex(currentStage);
  const target = stageIndex(targetStage);
  if (current.flow === "unknown" || target.flow === "unknown") return false;
  if (current.flow !== target.flow) return false;
  return target.idx < current.idx;
}

/**
 * Verify the provided PIN against ADMIN_PIN using a constant-time compare.
 * Returns true on match, false otherwise.
 */
export function verifyAdminPin(provided: unknown): boolean {
  const pin = typeof provided === "string" ? provided : "";
  return timingSafeStringEqual(pin, ADMIN_PIN);
}
