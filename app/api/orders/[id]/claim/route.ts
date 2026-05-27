import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Atomic claim/release of an order.
 *
 * POST   /api/orders/[id]/claim   → attempt to claim
 * DELETE /api/orders/[id]/claim   → release your own claim
 *
 * Both delegate to the SQL functions claim_order() / release_order()
 * defined in v16_order_claims.sql so concurrent claim attempts are
 * race-safe (first writer wins).
 *
 * Response shape on success:
 *   { ok: true, claimed_by: string | null }
 *
 * Response shape on conflict:
 *   { ok: false, claimed_by: string | null, reason: "already_claimed" | "not_owner" | "not_found" | "wrong_stage" }
 *   HTTP 409 for already_claimed / not_owner, 404 for not_found, 400 for wrong_stage.
 *
 * The PATCH /api/orders/[id] endpoint still accepts claimed_by writes
 * (used by the stage-change auto-unclaim path) but new claim UI calls
 * this endpoint instead.
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
  if (reason === "wrong_stage")     return 400;
  return 500;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Match PATCH rate limits — claim/release storm shouldn't be much
  // worse than a regular edit storm.
  const limited = await rateLimitOr429(req, 30, 60_000, "orders:claim");
  if (limited) return limited;

  const { id } = await params;
  const user = auth.session.user.id;  // team_members.id (immutable)

  const { data, error } = await supabase.rpc("claim_order", {
    p_order_id: id,
    p_user: user,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // RPC returns a TABLE; supabase-js gives us an array of rows.
  const row = (Array.isArray(data) ? data[0] : data) as ClaimResult | undefined;
  if (!row) {
    return NextResponse.json({ error: "Empty result" }, { status: 500 });
  }

  if (!row.ok) {
    return NextResponse.json(
      { ok: false, claimed_by: row.claimed_by, reason: row.reason },
      { status: statusFor(row.reason) },
    );
  }

  return NextResponse.json({ ok: true, claimed_by: row.claimed_by });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = await rateLimitOr429(req, 30, 60_000, "orders:claim");
  if (limited) return limited;

  const { id } = await params;
  const user = auth.session.user.id;  // team_members.id (immutable)

  const { data, error } = await supabase.rpc("release_order", {
    p_order_id: id,
    p_user: user,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (Array.isArray(data) ? data[0] : data) as ClaimResult | undefined;
  if (!row) {
    return NextResponse.json({ error: "Empty result" }, { status: 500 });
  }

  if (!row.ok) {
    return NextResponse.json(
      { ok: false, claimed_by: row.claimed_by, reason: row.reason },
      { status: statusFor(row.reason) },
    );
  }

  return NextResponse.json({ ok: true, claimed_by: row.claimed_by });
}
