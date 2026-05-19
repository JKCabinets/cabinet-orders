/**
 * Server-only stage helpers: PIN env reading + constant-time compare.
 *
 * For pure stage-flow logic (validation, backward detection, date clearing),
 * see `lib/stageLogic.ts` — that module is isomorphic and safe to import
 * from client code. This file pulls in Node's `crypto`, so it must only
 * be imported from server-side route handlers.
 *
 * We also re-export the pure helpers here so existing server code can keep
 * `import { ... } from "@/lib/stageGuards"` without churn.
 */

import crypto from "crypto";

export {
  ORDER_STAGE_ORDER,
  WARRANTY_STAGE_ORDER,
  ALLOWED_STAGES,
  stageIndex,
  isBackwardsMove,
  fieldsToClearOnBackwardMove,
  describeFieldsCleared,
} from "@/lib/stageLogic";
export type { StageFlow } from "@/lib/stageLogic";

/** Admin PIN for backwards moves. Reads from env first; falls back to the
 * legacy hardcoded value so existing deployments keep working until
 * ADMIN_BACKWARD_PIN is configured. Constant-time compared on every check. */
export const ADMIN_PIN: string =
  process.env.ADMIN_BACKWARD_PIN || "4951";

/** Constant-time string equality. Returns false on length mismatch (no throw). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify the provided PIN against ADMIN_PIN using a constant-time compare.
 * Returns true on match, false otherwise.
 */
export function verifyAdminPin(provided: unknown): boolean {
  const pin = typeof provided === "string" ? provided : "";
  return timingSafeStringEqual(pin, ADMIN_PIN);
}
