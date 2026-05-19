import { NextRequest, NextResponse } from "next/server";
import { requireAuth, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ALLOWED_STATUSES = new Set(["open", "in_review", "parts_ordered", "repair_scheduled", "resolved", "closed"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    updates.status = body.status;
  }
  if (body.resolution !== undefined) {
    // Sanitize so this can be safely rendered in the export route later.
    updates.resolution = cleanInput(body.resolution as string);
  }
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length === 1) { // only updated_at
    return NextResponse.json({ error: "No valid fields to update" }, { status: 422 });
  }

  const { error } = await supabase.from("damage_reports").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
