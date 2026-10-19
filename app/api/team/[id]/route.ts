import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireSelfOrAdmin, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { activityDate } from "@/lib/data";

/** What retire_member_claims() did, for the audit log and the team page. */
type ClaimsOutcome = {
  moved: { kind: string; id: string; to: string }[];
  released: { kind: string; id: string }[];
  not_held: string[];
};

/**
 * ⚠ A MEMBER WHO LEAVES DOES NOT TAKE THEIR OPEN WORK WITH THEM (2026-10-19).
 * A claim is a lock only its holder may lift -- for a custom job, a warranty
 * claim or a submission not even an admin -- so a departed member's open work
 * stayed locked against everyone. Deactivating now releases it; deleting hands
 * each item to whoever the dialog chose and releases the rest (Garrett). Their
 * FINISHED work keeps them. One transaction in retire_member_claims()
 * (migrations/2026-10-19-member-claims.sql), run BEFORE the member changes: a
 * refusal changes nothing. One audit entry lists what moved and what was
 * released -- a submission has no trail of its own.
 */
async function retireClaims(
  id: string, actor: { name: string; username: string },
  event: "deactivated" | "removed", assign: Record<string, string>,
): Promise<ClaimsOutcome | NextResponse> {
  const { data, error } = await supabase.rpc("retire_member_claims", {
    p_member: id, p_by: actor.name, p_event: event, p_time: activityDate(), p_assign: assign,
  });
  if (error) {
    return NextResponse.json(
      { error: "claims_unavailable", message: "Could not hand on or release this member's work, so nothing was changed. Try again." },
      { status: 500 },
    );
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; submissions?: string[] } & Partial<ClaimsOutcome>;
  if (!r.ok) {
    if (r.reason === "promoting") {
      return NextResponse.json(
        { error: "promoting", message: `Their submission ${(r.submissions ?? []).join(", ")} is being promoted right now, so nothing was changed. Try again in a few minutes.` },
        { status: 409 },
      );
    }
    if (r.reason === "bad_assignee") {
      return NextResponse.json(
        { error: "bad_assignee", message: "Work can only go to an active member other than the one leaving. Nothing was changed." },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "claims_refused", message: "Their work could not be handed on, so nothing was changed." }, { status: 500 });
  }
  const out: ClaimsOutcome = { moved: r.moved ?? [], released: r.released ?? [], not_held: r.not_held ?? [] };
  if (out.moved.length || out.released.length || out.not_held.length) {
    try {
      await supabase.from("audit_log").insert({
        event: "member_claims_retired",
        username: actor.username,
        details: { target_id: id, because: event, ...out },
      });
    } catch { /* non-critical */ }
  }
  return out;
}
import bcrypt from "bcryptjs";
import { validatePassword } from "@/lib/passwordPolicy";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Use the self-or-admin helper here. Privilege-affecting fields
  // (role, password, active) still require admin — we enforce that
  // inline below by checking `auth.isAdmin` before applying those
  // updates. Profile fields (photo, phone, email, bio, OOO, etc.)
  // can be edited by the user themselves OR by an admin.
  const { id } = await params;
  const auth = await requireSelfOrAdmin(id);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Fetch the current state BEFORE the update so we can audit-log any
  // privilege-affecting changes (role flips, deactivations). Without this
  // the audit trail only catches password changes — a demoted admin would
  // leave no record. Also reads session_version so we can compute the
  // next value when a privilege-affecting change requires invalidation.
  const { data: beforeRow } = await supabase
    .from("team_members")
    .select("role, active, username, session_version")
    .eq("id", id)
    .single();

  const updates: Record<string, unknown> = {};

  // ── Profile fields (anyone — self OR admin) ───────────────────────
  // These don't grant privileges, so the user is allowed to edit them
  // on their own row. Empty strings are stored as NULL to keep the DB
  // clean — frontend treats null and "" identically anyway.
  const nullableText = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = cleanInput(v);
    return trimmed.length ? trimmed : null;
  };
  if (body.photoUrl     !== undefined) updates.photo_url     = nullableText(body.photoUrl);
  if (body.phone        !== undefined) updates.phone         = nullableText(body.phone);
  if (body.email        !== undefined) updates.email         = nullableText(body.email);
  if (body.roleTitle    !== undefined) updates.role_title    = nullableText(body.roleTitle);
  if (body.bio          !== undefined) updates.bio           = nullableText(body.bio);
  if (body.workingHours !== undefined) updates.working_hours = nullableText(body.workingHours);
  if (body.timezone     !== undefined) updates.timezone      = nullableText(body.timezone);
  if (body.slackHandle  !== undefined) updates.slack_handle  = nullableText(body.slackHandle);
  if (body.oooStatus    !== undefined) updates.ooo_status    = !!body.oooStatus;
  if (body.oooMessage   !== undefined) updates.ooo_message   = nullableText(body.oooMessage);
  if (body.oooUntil     !== undefined) updates.ooo_until     = nullableText(body.oooUntil); // YYYY-MM-DD or null

  // ── Identity & avatar (anyone — these aren't privilege-affecting,
  // they're more like "what people see in the team list") ──────────
  if (body.name)                 updates.name         = cleanInput(body.name as string);
  if (body.initials)             updates.initials     = cleanInput(body.initials as string).toUpperCase().slice(0, 2);
  if (body.avatarColor)          updates.avatar_color = body.avatarColor;
  if (body.avatar_color)         updates.avatar_color = body.avatar_color;

  // ── Privilege-affecting fields (admin only) ───────────────────────
  // username change is included here because a user changing their own
  // username could break audit trails and login flows; keep it admin.
  if (body.username !== undefined || body.role !== undefined || body.active !== undefined) {
    if (!auth.isAdmin) {
      return NextResponse.json(
        { error: "Forbidden — admin only for username, role, or active changes" },
        { status: 403 }
      );
    }
    if (body.username)             updates.username = cleanInput(body.username as string).toLowerCase();
    if (body.role)                 updates.role     = body.role === "admin" ? "admin" : "member";
    if (body.active !== undefined) updates.active   = body.active;
  }

  // Hash password with bcrypt before saving — admin only.
  if (body.password) {
    if (!auth.isAdmin) {
      return NextResponse.json(
        { error: "Forbidden — admin only for password changes" },
        { status: 403 }
      );
    }
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

  // ── Session-version bump for privilege-affecting changes ─────────────
  // If the user is being demoted, deactivated, or their password is
  // changing, bump session_version so any outstanding JWTs they hold
  // get invalidated on next verification (see lib/authOptions.ts jwt
  // callback). Atomic with the rest of the UPDATE so we never have a
  // window where the privilege change is live but the bump isn't.
  //
  // We bump on:
  //   - role change (admin ↔ member, either direction)
  //   - deactivation (active flips to false)
  //   - password change (already invalidates passwords, but the JWT
  //     still carries authority via the role claim — bumping forces
  //     re-login with the new credentials)
  //
  // We do NOT bump on: name change, initials change, avatar color,
  // username change, reactivation (a reactivated user has no current
  // JWT to invalidate anyway).
  if (beforeRow) {
    const roleChanged =
      updates.role !== undefined && updates.role !== beforeRow.role;
    const deactivated =
      updates.active === false && beforeRow.active;
    const passwordChanged = !!body.password;

    if (roleChanged || deactivated || passwordChanged) {
      updates.session_version = (beforeRow.session_version ?? 1) + 1;
    }
  }

  // ⚠ DEACTIVATING RELEASES THEIR OPEN WORK FIRST (2026-10-19) -- see
  // retireClaims. Whenever this request deactivates, even a member already
  // inactive: what they still hold is released, which is safe to repeat.
  let claims: ClaimsOutcome | null = null;
  if (updates.active === false) {
    const r = await retireClaims(id,
      { name: auth.session.user.name ?? auth.session.user.username, username: auth.session.user.username },
      "deactivated", {});
    if (r instanceof NextResponse) return r;
    claims = r;
  }

  const { error } = await supabase.from("team_members").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Avatar storage cleanup on photo removal ──────────────────────────
  // When the user explicitly removes their photo (photoUrl sent and
  // resolved to null), the DB column is nulled above — but the stored
  // file would otherwise linger in the bucket forever. Delete the user's
  // avatar folder contents. Gated on BOTH conditions so this only fires on
  // an actual remove, never on an unrelated profile edit. Best-effort.
  if (body.photoUrl !== undefined && updates.photo_url === null) {
    try {
      const { data: existing } = await supabase.storage
        .from("team-avatars")
        .list(id);
      if (existing && existing.length > 0) {
        const paths = existing.map((f) => `${id}/${f.name}`);
        const { error: removeError } = await supabase.storage
          .from("team-avatars")
          .remove(paths);
        if (removeError) {
          console.warn(`[avatar] failed to remove files on photo-clear for ${id}:`, removeError.message);
        }
      }
    } catch (err) {
      console.warn(`[avatar] cleanup threw on photo-clear for ${id}:`, err);
    }
  }

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

  return NextResponse.json({ ok: true, ...(claims ? { claims } : {}) });
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

  // The delete dialog's hand-overs, {"project:SHO-1050": "<member id>", ...}.
  // Only a hard delete takes them; no body hands nothing on.
  let assign: Record<string, string> = {};
  if (hard) {
    let body: unknown = null;
    try { body = await req.json(); } catch { /* no body */ }
    const a = (body as { assign?: unknown } | null)?.assign;
    if (a !== undefined) {
      if (!a || typeof a !== "object" || Array.isArray(a) || !Object.values(a).every((v) => typeof v === "string")) {
        return NextResponse.json({ error: "invalid_assign" }, { status: 400 });
      }
      assign = a as Record<string, string>;
    }
  }

  // Capture target identity before deletion for the audit log. Also
  // reads session_version so we can compute the bump for soft-delete.
  const { data: beforeRow } = await supabase
    .from("team_members")
    .select("username, role, session_version")
    .eq("id", id)
    .single();

  // ⚠ THEIR OPEN WORK GOES FIRST (2026-10-19) -- see retireClaims. Refused,
  // the member is left exactly as they were.
  const claims = await retireClaims(id,
    { name: auth.session.user.name ?? auth.session.user.username, username: auth.session.user.username },
    hard ? "removed" : "deactivated", assign);
  if (claims instanceof NextResponse) return claims;

  if (hard) {
    // Hard delete: the row disappears. The JWT callback will fail its
    // lookup-by-username on next verification and force logout, so no
    // explicit bump is needed (there's nothing to bump on).
    const { error } = await supabase.from("team_members").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // The row is gone for good — remove the user's avatar files too so
    // they don't linger in the bucket as orphans. Best-effort.
    try {
      const { data: existing } = await supabase.storage
        .from("team-avatars")
        .list(id);
      if (existing && existing.length > 0) {
        const paths = existing.map((f) => `${id}/${f.name}`);
        await supabase.storage.from("team-avatars").remove(paths);
      }
    } catch (err) {
      console.warn(`[avatar] cleanup threw on hard-delete for ${id}:`, err);
    }
  } else {
    // Soft delete: bump session_version so any outstanding JWTs are
    // invalidated within the verification window, even if some part of
    // the JWT callback's row-fetch races us.
    const nextVersion = (beforeRow?.session_version ?? 1) + 1;
    const { error } = await supabase
      .from("team_members")
      .update({ active: false, session_version: nextVersion })
      .eq("id", id);
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

  return NextResponse.json({ ok: true, claims });
}
