import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Atomic claim/release of a customer claim SUBMISSION (2026-10-06).
 *
 * POST   /api/claim-submissions/[id]/claim   -> claim it
 * DELETE /api/claim-submissions/[id]/claim   -> release your own claim
 *
 * ⚠ THE SAME RULE AS AN ORDER (Garrett, 2026-10-06): once claimed, it is that
 * person's -- one person answers the customer, one person promotes it. Built
 * exactly like /api/orders/[id]/claim: both delegate to SQL functions
 * (claim_submission, release_submission) that lock the row, so the first
 * writer wins; releasing is the owner's alone; nobody claims over somebody
 * else, admins included. Promoting claims it too -- see begin_promotion().
 *
 * Success:  { ok: true, claimed_by }
 * Conflict: { ok: false, claimed_by, reason, message }
 *   409 already_claimed | not_owner | promoting | closed;  404 not_found
 */

type ClaimResult = { ok: boolean; claimed_by: string | null; reason: string | null };

const MESSAGE: Record<string, string> = {
  already_claimed: "Someone else has claimed this submission. Ask them to release it.",
  not_owner: "Only the person who claimed this submission can release it.",
  promoting: "This submission is being promoted right now.",
  closed: "This submission has already been promoted or set aside.",
  not_found: "No such submission.",
};

function statusFor(reason: string | null): number {
  if (reason === "not_found") return 404;
  if (reason === "already_claimed" || reason === "not_owner" || reason === "promoting" || reason === "closed") return 409;
  return 500;
}

async function act(
  fn: "claim_submission" | "release_submission",
  req: NextRequest,
  params: Promise<{ id: string }>,
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // As the order claim route: a claim/release storm is no worse than an edit storm.
  const limited = await rateLimitOr429(req, 30, 60_000, "claim-submissions:claim");
  if (limited) return limited;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid submission id" }, { status: 422 });
  }

  const { data, error } = await supabase.rpc(fn, { p_id: id, p_user: auth.session.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The functions return a TABLE; supabase-js gives an array of rows.
  const row = (Array.isArray(data) ? data[0] : data) as ClaimResult | undefined;
  if (!row) return NextResponse.json({ error: "Empty result" }, { status: 500 });

  if (!row.ok) {
    return NextResponse.json(
      { ok: false, claimed_by: row.claimed_by, reason: row.reason, message: MESSAGE[row.reason ?? ""] ?? "Not possible." },
      { status: statusFor(row.reason) },
    );
  }
  return NextResponse.json({ ok: true, claimed_by: row.claimed_by });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return act("claim_submission", req, params);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return act("release_submission", req, params);
}
