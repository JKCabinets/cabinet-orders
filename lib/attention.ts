import type { Order, OrderType } from "@/lib/data";
import { paymentHoldActive, paymentHoldLabel, STAGE_LIST_BY_TYPE } from "@/lib/data";
import { slaRuleFor, slaTier, slaAgeHours, hoursInStage, formatStageAge } from "@/lib/sla";
import { requirementsFor, type RequirementEnrichment } from "@/lib/requirements";

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

/**
 * Per-order facts that cannot be read off the row.
 *
 * ⚠ THE SAME SHAPE `POST /api/orders/enrichment` RETURNS, and the same shape
 * lib/requirements.ts consumes. It used to be `{ ackMissing, receiptMissing }`
 * -- inverted booleans, one per reason -- which would have made the caller
 * invert the endpoint's answer. That inversion is not safe: `!ackGreen` is NOT
 * "acknowledgment missing" for an order that has an attachment, because the
 * server gate passes on EITHER, and the queue would have sent somebody to
 * redo work already done.
 */
export type AttentionEnrichment = RequirementEnrichment;

/**
 * Which requirements produce a queue reason, and what it says.
 *
 * ⚠ ONE REASON PER GATE, NOT ONE PER MECHANISM. The New gate passes on a green
 * acknowledgment OR any attachment, so "no acknowledgment and no attachment"
 * is the single true condition for every vendor. Splitting it by vendor would
 * put a fourth encoding of "is this Waypoint" into every filter, badge and
 * queue that reads these reasons -- after hasWaypoint, linesForAckVendor and
 * the upload route's constant.
 *
 * The REMEDY is what varies: upload the .xlsx for Waypoint, attach the
 * acknowledgment for HCI and J&K. That is display text on one reason.
 */
const ENRICHED_REASONS: Record<string, { kind: AttentionKind; label: string }> = {
  ack_or_attachment: {
    kind: "ack_missing",
    label: "Cannot leave New — no acknowledgment and no attachment",
  },
  proof_of_delivery: {
    kind: "receipt_missing",
    label: "Signed delivery receipt missing",
  },
};

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
  //
  // ⚠ ASKED OF lib/requirements, NOT DECIDED HERE. The same table the server
  // gate and sla.ts read, so a queue cannot claim an order is blocked when the
  // gate would let it through.
  //
  // ⚠ `unmet` ONLY. A requirement whose enrichment was never fetched reports
  // `unknown`, and unknown produces NO reason. A queue saying "acknowledgment
  // missing" because nobody looked is worse than one saying nothing: it sends
  // somebody to redo finished work, on every row at once.
  for (const req of requirementsFor(order)) {
    if (req.source !== "enrich") continue;
    const mapped = ENRICHED_REASONS[req.id];
    if (!mapped) continue;
    if (req.state(order, enrich) !== "unmet") continue;
    reasons.push({
      kind: mapped.kind,
      severity: "high",
      label: mapped.label,
      // What to do about it. Varies by vendor where the reason does not.
      detail: req.remedy,
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
  //
  // ⚠ STANDALONE ROWS ONLY -- custom jobs and warranty claims, which have no
  // project. A Shopify group's owner lives on its PROJECT since 2026-08-25, so
  // `order.claimed_by` is always null on one and asking here would report every
  // cabinet and sample row as unclaimed forever. attentionForProject() asks it
  // once per purchase instead.
  //
  // Only at the FIRST stage of the flow. Past that somebody has evidently
  // worked it, and an unclaimed row mid-pipeline is a claim that was released,
  // not work nobody has picked up.
  if (!order.project_id && !order.claimed_by && isFirstStage(order)) {
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


/**
 * Why a PROJECT needs someone.
 *
 * ⚠ THE CLAIM LIVES ON THE PROJECT NOW, so "unclaimed" is asked once per
 * purchase rather than once per group. Before this, a checkout nobody owned
 * produced an unclaimed reason on its cabinet group AND its sample group --
 * two queue entries for one problem, which is how a queue stops being trusted.
 *
 * Everything else rolls up: a project wants you if any of its groups does. The
 * group reasons are returned as-is, because "Delivery date required" is still
 * about a specific order even when the purchase is what you claim.
 */
export function attentionForProject(
  project: { id: string; claimed_by?: string | null; archived?: boolean },
  groups: Order[],
  now: number = Date.now(),
  /**
   * ⚠ ADDED 2026-09-08, AND ITS ABSENCE WAS A REAL GAP. This function used to
   * call `attentionFor(g, undefined, now)` with `undefined` HARDCODED, so a
   * caller could fetch enrichment, pass it everywhere it was accepted, and
   * still see nothing on any screen that renders through a project. That looks
   * identical to the feature not working.
   *
   * A function rather than a value, because a project has many groups and each
   * needs its own. Matches attentionCounts, which already took this shape.
   */
  enrich?: (order: Order) => AttentionEnrichment | undefined,
): AttentionReason[] {
  if (project.archived) return [];

  const reasons: AttentionReason[] = [];

  // Unclaimed, asked ONCE. Measured from the oldest group still at its first
  // stage: that is the thing that has been waiting for somebody.
  if (!project.claimed_by) {
    const waiting = groups
      .filter((g) => !g.archived && isFirstStage(g))
      .map((g) => hoursInStage(g, now))
      .filter((h): h is number => h !== null);
    const oldest = waiting.length > 0 ? Math.max(...waiting) : null;
    if (oldest !== null && oldest >= UNCLAIMED_AFTER_HOURS) {
      reasons.push({
        kind: "unclaimed",
        severity: "medium",
        label: "Unclaimed",
        detail: `${formatStageAge(oldest)} unclaimed`,
      });
    }
  }

  for (const g of groups) reasons.push(...attentionFor(g, enrich?.(g), now));
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
