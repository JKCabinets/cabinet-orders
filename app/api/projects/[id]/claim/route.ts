import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Atomic claim/release of a PROJECT.
 *
 * POST   /api/projects/[id]/claim   → attempt to claim
 * DELETE /api/projects/[id]/claim   → release (your own, or any if admin)
 *
 * ⚠ ONE OWNER PER PURCHASE. A Shopify checkout is one project with one `orders`
 * row per product category, and those rows used to be claimed separately -- so
 * a designer who had finished the cabinets could not close the purchase while
 * somebody else sat on the hardware. The claim moved up on 2026-08-25.
 *
 * `orders.claimed_by` remains in use for STANDALONE rows only: custom jobs and
 * warranty claims, which have no project to hold the claim.
 *
 * Both verbs delegate to claim_project() / release_project(), which lock the
 * row with FOR UPDATE so concurrent attempts serialise -- first writer wins,
 * and the loser is told who holds it. Mirrors claim_order() deliberately: a
 * second, unguarded way to write an ownership column is how
 * PATCH /api/orders/[id] ended up overwriting claims silently.
 *
 * Success:  { ok: true, claimed_by: string | null }
 * Conflict: { ok: false, claimed_by, reason: "already_claimed" | "not_owner" | "not_found" }
 */

type ClaimResult = {
  ok: boolean;
  claimed_by: string | null;
  reason: string | null;
};

function statusFor(reason: string | null): number {
  if (reason === "already_claimed") return 409;
  if (reason === "not_owner")       return 409;
  if (reason === "not_found")       return 404;
  return 500;
}

async function respond(
  rpc: "claim_project" | "release_project",
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(rpc, args);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = (Array.isArray(data) ? data[0] : data) as ClaimResult | undefined;
  if (!row) return NextResponse.json({ error: "Empty result" }, { status: 500 });

  if (!row.ok) {
    return NextResponse.json(
      { ok: false, claimed_by: row.claimed_by, reason: row.reason },
      { status: statusFor(row.reason) },
    );
  }
  return NextResponse.json({ ok: true, claimed_by: row.claimed_by });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "projects:claim");
  if (limited) return limited;

  const { id } = await params;
  return respond("claim_project", {
    p_project_id: id,
    p_user: auth.session.user.id,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "projects:claim");
  if (limited) return limited;

  const { id } = await params;

  // ⚠ THE ADMIN FLAG IS DECIDED HERE, from the session -- never from the body.
  // release_project() trusts it, so a client that could name its own role could
  // release anyone's project. The function is service-role only for the same
  // reason.
  const isAdmin = auth.session.user.role === "admin";

  return respond("release_project", {
    p_project_id: id,
    p_user: auth.session.user.id,
    p_is_admin: isAdmin,
  });
}
