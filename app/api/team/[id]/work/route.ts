import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/team/[id]/work — what a member holds that is still OPEN (2026-10-19):
 * the delete dialog's list. A purchase, a custom job, a warranty claim, a
 * customer submission; finished work is not listed. Admins only, as deleting is.
 * member_open_work() in migrations/2026-10-19-member-claims.sql decides "open".
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const { data, error } = await supabase.rpc("member_open_work", { p_member: id });
  if (error) {
    return NextResponse.json(
      { error: "work_unavailable", message: "Could not read this member's open work. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ data: data ?? [] });
}
