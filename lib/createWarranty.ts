import { supabase } from "@/lib/supabase";
import { cleanInput } from "@/lib/auth";
import { warrantyParentKey, warrantyIdFor, nextWarrantySeq } from "@/lib/warrantyId";

/**
 * Creating a warranty claim. THE ONLY implementation.
 *
 * Two callers: a person logging a claim by hand through POST /api/orders, and
 * a person promoting a public submission through
 * POST /api/claim-submissions/[id]/promote. They differ in where the facts
 * come from and in nothing else, so they share this rather than each building
 * an insert -- which is how the three id generators happened.
 *
 * ⚠ EVERY CLAIM HAS A PARENT. `about_order_id` is required, not optional.
 *   Its own declaration in lib/data.ts says it points at the GROUP rather than
 *   the project "because the 48-hour window in Terms 12.3 runs from a
 *   delivery, and deliveries are per group". A claim with no parent has no
 *   delivery to measure from, so the window that decides whether it is valid
 *   cannot be computed at all. Before this, the manual path collected no
 *   parent and every hand-logged claim was unlinked.
 */

export interface CreateWarrantyInput {
  /** The GROUP this claim is about, e.g. SHO-1048-CAB. Required. */
  aboutOrderId: string;
  name: string;
  detail?: string;
  notes?: string;
  internalNotes?: string;
  sku?: string;
  member?: string;
  createdBy: string;
  /** Self-reported and unverified — whatever was typed into the claim form. */
  claimantName?: string | null;
  claimantEmail?: string | null;
  /**
   * When the CUSTOMER reported it, not when this row was made. Carried from
   * claim_submissions.received_at on promotion; null for a claim logged by
   * hand, where the two are the same moment and the SLA rules fall back to
   * created_at.
   */
  reportedAt?: string | null;
  source?: string;
  /** Line for the activity log. The row must say how it came to exist. */
  activityText: string;
}

export type CreateWarrantyResult =
  | { ok: true; order: Record<string, unknown> }
  | { ok: false; status: number; error: string; message?: string };

/** Bounded, because a runaway retry against a unique index is a busy loop. */
const MAX_SEQ_ATTEMPTS = 5;

export async function createWarranty(
  input: CreateWarrantyInput,
): Promise<CreateWarrantyResult> {
  const aboutOrderId = String(input.aboutOrderId ?? "").trim();
  if (!aboutOrderId) {
    return {
      ok: false, status: 422, error: "about_order_id_required",
      message: "A warranty claim must say which order group it is about.",
    };
  }

  // ── The parent must exist, and must not itself be a claim ────────────────
  //
  // Without this a claim could be logged against any string, producing a row
  // whose about_order_id points at nothing -- invisible until somebody tried
  // to compute the reporting window from a delivery that does not exist.
  const { data: parent, error: parentErr } = await supabase
    .from("orders")
    .select("id, type, project_id, name, customer_email, customer_phone, ship_to")
    .eq("id", aboutOrderId)
    .maybeSingle();

  if (parentErr) {
    return { ok: false, status: 500, error: parentErr.message };
  }
  if (!parent) {
    return {
      ok: false, status: 404, error: "about_order_not_found",
      message: `No order group with id "${aboutOrderId}".`,
    };
  }
  if (parent.type === "warranty") {
    return {
      ok: false, status: 422, error: "about_order_is_a_claim",
      message: "A claim cannot be about another claim.",
    };
  }

  const parentKey = warrantyParentKey(parent);
  if (!parentKey) {
    return {
      ok: false, status: 422, error: "unusable_parent_id",
      message: `Cannot build a claim reference from "${aboutOrderId}".`,
    };
  }

  // ── Existing claims sharing this id space ────────────────────────────────
  //
  // ⚠ MATCHED ON THE ID PATTERN, NOT ON about_order_id, AND THE DIFFERENCE IS
  // NOT COSMETIC. parentKey resolves through the PROJECT, so SHO-1048-CAB and
  // SHO-1048-SMP both produce "1048" and share one sequence. Counting by group
  // would give a claim on the cabinets and a claim on the samples the same
  // number, and only the conflict retry below would catch it -- an error path
  // doing the work of normal operation, which is how it stops being noticed
  // when it eventually fails.
  //
  // Safe as a LIKE: parentKey passed PARENT_KEY_RE above, which permits only
  // A-Z, 0-9 and hyphen, so neither % nor _ can reach the pattern.
  //
  // Legacy WRN-4791 rows are excluded by the pattern and would be ignored by
  // nextWarrantySeq anyway -- they carry no sequence to continue from.
  const { data: existing, error: existingErr } = await supabase
    .from("orders")
    .select("id")
    .eq("type", "warranty")
    .like("id", `WRN-${parentKey}-%`);

  if (existingErr) {
    return { ok: false, status: 500, error: existingErr.message };
  }

  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  let seq = nextWarrantySeq((existing ?? []).map((r) => r.id as string));

  // ── Insert, retrying on a duplicate key ──────────────────────────────────
  //
  // ⚠ TWO PEOPLE PROMOTING AT ONCE IS THE CASE THIS EXISTS FOR. The read above
  // and the insert below are not one transaction, so both can compute the same
  // sequence. Postgres refuses the second with 23505 and we take the next
  // number rather than showing somebody a raw constraint error. Rare, and it
  // costs four lines to make impossible instead of unlikely.
  for (let attempt = 0; attempt < MAX_SEQ_ATTEMPTS; attempt++) {
    const id = warrantyIdFor(parentKey, seq);

    const row = {
      id,
      type: "warranty",
      // ⚠ EXPLICIT. The column default is 'New', which is not a stage in the
      // warranty flow -- a claim landing there would sit on a stage its own
      // pipeline does not contain and no transition would move it.
      stage: "New claim",
      name: cleanInput(input.name),
      source: input.source ?? "Manual",
      detail: cleanInput(input.detail ?? ""),
      member: input.member ?? "AX",
      date: today,
      sku: cleanInput(input.sku ?? ""),
      notes: cleanInput(input.notes ?? ""),
      internal_notes: cleanInput(input.internalNotes ?? ""),
      archived: false,
      about_order_id: aboutOrderId,
      claimant_name: input.claimantName ? cleanInput(input.claimantName) : null,
      claimant_email: input.claimantEmail ? cleanInput(input.claimantEmail) : null,
      reported_at: input.reportedAt ?? null,
      created_by: input.createdBy,
      // Carried from the parent so the claim is workable without a join. The
      // customer OF RECORD is still the parent's; claimant_* is what the
      // person filling in the form said, and a mismatch is worth seeing.
      customer_email: parent.customer_email ?? "",
      customer_phone: parent.customer_phone ?? "",
      ship_to: parent.ship_to ?? "",
      // ⚠ NO project_id. A claim is ABOUT a purchase, not part of one, and
      // orders_total_price_standalone_only depends on that staying true.
    };

    const { data: inserted, error } = await supabase
      .from("orders").insert(row).select().single();

    if (!error) {
      await supabase.from("order_activity").insert({
        order_id: id, text: input.activityText, time: today,
      });
      return { ok: true, order: { ...inserted, activity: [{ text: input.activityText, time: today }] } };
    }

    // 23505 = unique_violation. Anything else is a real failure.
    if (error.code !== "23505") {
      return { ok: false, status: 500, error: error.message };
    }
    seq += 1;
  }

  return {
    ok: false, status: 409, error: "could_not_allocate_claim_id",
    message: `Gave up after ${MAX_SEQ_ATTEMPTS} attempts on ${parentKey}.`,
  };
}
