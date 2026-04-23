import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { validatePassword } from "@/lib/passwordPolicy";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name)                 updates.name         = sanitize(body.name as string);
  if (body.username)             updates.username     = sanitize(body.username as string).toLowerCase();
  if (body.initials)             updates.initials     = sanitize(body.initials as string).toUpperCase().slice(0, 2);
  if (body.role)                 updates.role         = body.role === "admin" ? "admin" : "member";
  if (body.avatarColor)          updates.avatar_color = body.avatarColor;
  if (body.avatar_color)         updates.avatar_color = body.avatar_color;
  if (body.active !== undefined) updates.active       = body.active;

  // Hash password with bcrypt before saving
  if (body.password) {
    const pwd = body.password as string;
    const pwdError = validatePassword(pwd);
    if (pwdError) return NextResponse.json({ error: pwdError }, { status: 422 });
    updates.password_hash = await bcrypt.hash(pwd, 12);
    // Reset failed attempts on password change
    updates.failed_attempts = 0;
    updates.locked_until = null;

    // Log password change
    try {
      await supabase.from("audit_log").insert({
        event: "password_changed",
        username: auth.session.user.username,
        details: { target_id: id, changed_by: auth.session.user.username },
      });
    } catch { /* non-critical */ }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 422 });
  }

  const { error } = await supabase.from("team_members").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { searchParams } = new URL(req.url);
  const hard = searchParams.get("hard") === "true";

  if (hard) {
    const { error } = await supabase.from("team_members").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("team_members").update({ active: false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
