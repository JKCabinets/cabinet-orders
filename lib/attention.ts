import type { Order, OrderType } from "@/lib/data";
import { paymentHoldActive, paymentHoldLabel, STAGE_LIST_BY_TYPE } from "@/lib/data";
import { slaRuleFor, slaTier, slaAgeHours, hoursInStage, formatStageAge } from "@/lib/sla";

/**
 * WHY a row needs someone — one derivation, read by everything.
 *
 * The dashboard, the work queues and any future digest all answer the same
 * question: what requires a person to do something? Written twice, they drift,
 * and the drift is silent because both sides still return a number. That is the
 * bug class this codebase keeps hitting — four instances in six days of one
 * rule enforced in two places with a clause missing from the second.
 *
 * So the counts on the dashboard and the rows in a queue come from THIS
 * function, not from two filters that happen to agree today.
 *
 * ⚠ ROW-ONLY BY DEFAULT. Every predicate below reads the order row and nothing
 * else, so this is pure and works anywhere the store is available. Two reasons
 * a person would recognise — a missing manufacturer acknowledgment, a missing
 * signed receipt — live in `order_acknowledgments` and `order_attachments` and
 * cannot be derived from the row. Callers that have that data pass it in via
 * `enrich`; callers that do not simply get fewer reasons rather than wrong
 * ones. The alternative was a second implementation for the enriched case,
 * which is the thing this file exists to prevent.
 */

/** Hours before the hard SLA threshold at which a row reads as "due soon". */
export const DUE_SOON_HOURS = 6;

/**
 * How long an unclaimed row sits before it counts as needing attention.
 *
 * Matches the soft SLA tier deliberately. An order nobody has picked up is not
 * a problem in its first hour -- it is a problem once it has been sitting as
 * long as the SLA says a stage should take.
 */
export const UNCLAIMED_AFTER_HOURS = 24;

export type AttentionKind =
  | "sla_breached"
  | "sla_due_soon"
  | "blocked_missing_data"
  | "unclaimed"
  | "payment_hold"
  | "ack_missing"
  | "receipt_missing";

export interface AttentionReason {
  kind: AttentionKind;
  /** `high` demands action now; `medium` is a warning. Drives colour only. */
  severity: "high" | "medium";
  /** The reason, phrased as the thing that is wrong. Leads the queue row. */
  label: string;
  /** Supporting figure — "13d overdue", "4d unclaimed". */
  detail?: string;
}

/** Per-order facts that cannot be read off the row. Optional. */
export interface AttentionEnrichment {
  /** New → Entered is gated on this, for cabinet flows only. */
  ackMissing?: boolean;
  /** At cross dock → Delivered is gated on a signed proof_of_delivery. */
  receiptMissing?: boolean;
}

/** Is this the first stage of the row's own flow? */
function isFirstStage(order: Order): boolean {
  const flow = STAGE_LIST_BY_TYPE[order.type as OrderType] as readonly string[] | undefined;
  return !!flow && flow.length > 0 && flow[0] === order.stage;
}

/**
 * Every reason this row wants a person, most urgent first.
 *
 * An empty array means the row is fine. A row can have several reasons at once
 * -- blocked on missing data for 60 hours is both blocked AND breached -- and
 * the dashboard counts rows per reason, so the cards overlap on purpose.
 */
export function attentionFor(
  order: Order,
  enrich?: AttentionEnrichment,
  now: number = Date.now(),
): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  // Archived rows are out of play entirely. Nothing about them needs doing.
  if (order.archived) return reasons;

  const rule = slaRuleFor(order);
  const tier = slaTier(order, now);
  const age = rule ? slaAgeHours(order, rule, now) : hoursInStage(order, now);

  // ── Payment hold ────────────────────────────────────────────────────────
  // First because it BLOCKS forward movement outright. Everything else is a
  // reason to hurry; this is a reason you cannot proceed.
  if (paymentHoldActive(order)) {
    reasons.push({
      kind: "payment_hold",
      severity: "high",
      label: "Refund acknowledgment required",
      detail: paymentHoldLabel(order.payment_status),
    });
  }

  // ── Gates that need a join ──────────────────────────────────────────────
  if (enrich?.ackMissing) {
    reasons.push({
      kind: "ack_missing",
      severity: "high",
      label: "Manufacturer acknowledgment missing",
    });
  }
  if (enrich?.receiptMissing) {
    reasons.push({
      kind: "receipt_missing",
      severity: "high",
      label: "Signed delivery receipt missing",
    });
  }

  // ── SLA ─────────────────────────────────────────────────────────────────
  if (tier === "hard") {
    reasons.push({
      kind: "sla_breached",
      severity: "high",
      label: "Past SLA",
      detail: age !== null ? `${formatStageAge(age)} in stage` : undefined,
    });
  } else if (rule && age !== null) {
    // Due soon: the clock is RUNNING and the hard threshold is within reach.
    // `clockRuns` matters here -- a rule whose awaited data has arrived is not
    // counting, so it can never come due however long the row sits.
    const running = !rule.clockRuns || rule.clockRuns(order);
    const remaining = rule.hardHours - age;
    if (running && remaining > 0 && remaining <= DUE_SOON_HOURS) {
      reasons.push({
        kind: "sla_due_soon",
        severity: "medium",
        label: "Due soon",
        detail: `${Math.max(1, Math.round(remaining))}h to SLA`,
      });
    }
  }

  // ── Blocked on missing data ─────────────────────────────────────────────
  // `clockRuns` returning true means the data that would let this move is
  // ABSENT -- that is exactly what those rules measure. So "blocked" is not a
  // separate concept needing its own predicates; it is the same one, named for
  // what a person can do about it.
  if (rule?.clockRuns && rule.clockRuns(order)) {
    reasons.push({
      kind: "blocked_missing_data",
      severity: "high",
      label: rule.waitingFor ? `${capitalise(rule.waitingFor)} required` : "Missing data",
      detail: age !== null ? `${formatStageAge(age)} waiting` : undefined,
    });
  }

  // ── Unclaimed ───────────────────────────────────────────────────────────
  // Only at the FIRST stage of the flow. Past that somebody has evidently
  // worked it, and an unclaimed row mid-pipeline is a claim that was released,
  // not work nobody has picked up.
  if (!order.claimed_by && isFirstStage(order)) {
    const sinceCreated = hoursInStage(order, now);
    if (sinceCreated !== null && sinceCreated >= UNCLAIMED_AFTER_HOURS) {
      reasons.push({
        kind: "unclaimed",
        severity: "medium",
        label: "Unclaimed",
        detail: `${formatStageAge(sinceCreated)} unclaimed`,
      });
    }
  }

  return reasons;
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Does this row need anybody at all? */
export function needsAttention(order: Order, enrich?: AttentionEnrichment): boolean {
  return attentionFor(order, enrich).length > 0;
}

/** The reason to lead with: highest severity, then declaration order. */
export function primaryReason(
  order: Order,
  enrich?: AttentionEnrichment,
): AttentionReason | undefined {
  const all = attentionFor(order, enrich);
  return all.find((r) => r.severity === "high") ?? all[0];
}

export interface AttentionCounts {
  needsAttention: number;
  unclaimed: number;
  blocked: number;
  dueSoon: number;
  slaBreached: number;
}

/**
 * The dashboard's first row.
 *
 * ⚠ THE BUCKETS OVERLAP, deliberately. A row blocked on missing data for sixty
 * hours is counted in `blocked` AND `slaBreached` AND `needsAttention`. They
 * are not a partition of the work -- they are four different questions about
 * the same rows, and each card links to the queue filtered by ITS question.
 * Making them exclusive would mean a row vanishing from "Blocked" the moment it
 * also breached, which is when you most want to see it there.
 */
export function attentionCounts(
  orders: Order[],
  enrich?: (o: Order) => AttentionEnrichment | undefined,
): AttentionCounts {
  const counts: AttentionCounts = {
    needsAttention: 0, unclaimed: 0, blocked: 0, dueSoon: 0, slaBreached: 0,
  };
  for (const o of orders) {
    const reasons = attentionFor(o, enrich?.(o));
    if (reasons.length === 0) continue;
    counts.needsAttention++;
    for (const r of reasons) {
      if (r.kind === "unclaimed") counts.unclaimed++;
      else if (r.kind === "blocked_missing_data") counts.blocked++;
      else if (r.kind === "sla_due_soon") counts.dueSoon++;
      else if (r.kind === "sla_breached") counts.slaBreached++;
    }
  }
  return counts;
}
