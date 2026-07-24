import type { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * Constant-time Bearer check for cron endpoints. Fails CLOSED when CRON_SECRET
 * is unset, so a missing env var cannot open the endpoint.
 *
 * Matches the inline check in the existing cron routes (teams-digest,
 * production-complete, delivery-complete). Those still carry their own copies;
 * this is the intended home for all of them.
 */
export function verifyCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
