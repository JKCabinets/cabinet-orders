import { WorkClient } from "./WorkClient";
import type { AttentionKind } from "@/lib/attention";

/**
 * /work — the queue of purchases that need somebody.
 *
 * ⚠ TWO SCOPES ONLY. "Team" and "All" were removed on 2026-08-25: Team
 * answered a question this page is not for, and All duplicated the Projects
 * page. An old ?scope=team or ?scope=all link lands on My work rather than
 * 404ing — a stale bookmark should degrade, not break.
 *
 * `?reason=` preselects a filter chip. The dashboard tiles link in this way,
 * which is what makes them a launchpad rather than a report: clicking Blocked
 * shows the blocked rows, not the whole queue with a number to re-find.
 */

const REASONS: readonly AttentionKind[] = [
  "sla_breached", "sla_due_soon", "blocked_missing_data",
  "unclaimed", "payment_hold", "ack_missing", "receipt_missing",
];

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; reason?: string }>;
}) {
  const { scope, reason } = await searchParams;
  const initialScope = scope === "unclaimed" ? "unclaimed" : "mine";
  // Whitelisted rather than cast: an unrecognised reason shows everything,
  // which is the honest fallback for a link somebody typed or a chip that has
  // since been renamed.
  const initialReason = REASONS.find((r) => r === reason) ?? null;
  return <WorkClient initialScope={initialScope} initialReason={initialReason} />;
}
