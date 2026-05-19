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

  // Fetch the current state BEFORE the update so we can audit-log any
  // privilege-affecting changes (role flips, deactivations). Without this
  // the audit trail only catches password changes — a demoted admin would
  // leave no record.
  const { data: beforeRow } = await supabase
    .from("team_members")
    .select("role, active, username")
    .eq("id", id)
    .single();

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

  // ── Audit log privilege-affecting changes ────────────────────────────
  // Done AFTER the UPDATE succeeds so we don't log changes that didn't
  // actually persist. Each event is best-effort — a failed audit insert
  // should not break the API response.
  if (beforeRow) {
    const targetUsername = beforeRow.username as string;
    const actor = auth.session.user.username;

    // Role change: admin ↔ member is a privilege boundary worth tracking.
    if (updates.role !== undefined && updates.role !== beforeRow.role) {
      try {
        await supabase.from("audit_log").insert({
          event: "role_changed",
          username: actor,
          details: {
            target_id: id,
            target_username: targetUsername,
            from: beforeRow.role,
            to: updates.role,
            changed_by: actor,
          },
        });
      } catch { /* non-critical */ }
    }

    // Active flag flips — deactivation is a soft-delete equivalent.
    if (updates.active !== undefined && updates.active !== beforeRow.active) {
      try {
        await supabase.from("audit_log").insert({
          event: updates.active ? "user_reactivated" : "user_deactivated",
          username: actor,
          details: {
            target_id: id,
            target_username: targetUsername,
            changed_by: actor,
          },
        });
      } catch { /* non-critical */ }
    }
  }

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

  // Capture target identity before deletion for the audit log.
  const { data: beforeRow } = await supabase
    .from("team_members")
    .select("username, role")
    .eq("id", id)
    .single();

  if (hard) {
    const { error } = await supabase.from("team_members").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("team_members").update({ active: false }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort audit entry. Hard delete is much more destructive than
  // soft delete and worth distinguishing in the log.
  if (beforeRow) {
    try {
      await supabase.from("audit_log").insert({
        event: hard ? "user_hard_deleted" : "user_deactivated",
        username: auth.session.user.username,
        details: {
          target_id: id,
          target_username: beforeRow.username,
          target_role: beforeRow.role,
          changed_by: auth.session.user.username,
        },
      });
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ ok: true });
}
