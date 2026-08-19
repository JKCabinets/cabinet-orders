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
  // Per-type stage validation. ALLOWED_STAGES is the union of every flow,
  // so route handlers that only check it will accept a warranty stage on a
  // custom order. These two are what a route needs to reject that.
  STAGE_ORDER_BY_TYPE,
  isStageAllowedForType,
  stageIndex,
  isBackwardsMove,
  fieldsToClearOnBackwardMove,
  describeFieldsCleared,
} from "@/lib/stageLogic";
export type { StageFlow } from "@/lib/stageLogic";

/** Admin PIN for backwards moves. Read from ADMIN_BACKWARD_PIN, with NO
 * fallback: if the env var is unset the PIN is the empty string, and because a
 * real PIN can never be empty (and verifyAdminPin length-checks), every
 * backward move is rejected. Fail closed — a missing secret blocks the
 * privileged action rather than reverting to a hardcoded value. Constant-time
 * compared on every check. */
export const ADMIN_PIN: string = process.env.ADMIN_BACKWARD_PIN ?? "";

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
