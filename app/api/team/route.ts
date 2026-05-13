import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { validatePassword } from "@/lib/passwordPolicy";

const BCRYPT_COST = 12;

/**
 * Generate a cryptographically random initial password that satisfies the
 * password policy. Used when the admin doesn't supply one — the admin can
 * read the value once from the response and pass it on to the new user out
 * of band, then force a reset on first login.
 */
function generateTemporaryPassword(): string {
  // 18 random bytes -> 24 base64 chars, plus required class characters
  const raw = crypto.randomBytes(18).toString("base64").replace(/[+/=]/g, "");
  // Guarantee policy compliance regardless of what randomness produced
  return `Aa1!${raw}`;
}

export async function GET(_req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabase
    .from("team_members")
    .select("id, username, name, initials, role, avatar_color, active")
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name || !body.username || !body.initials) {
    return NextResponse.json({ error: "name, username, initials required" }, { status: 422 });
  }

  // Validate (or generate) the initial password before any DB write.
  let initialPassword: string;
  let generated = false;
  if (typeof body.password === "string" && body.password.length > 0) {
    const pwdError = validatePassword(body.password);
    if (pwdError) return NextResponse.json({ error: pwdError }, { status: 422 });
    initialPassword = body.password;
  } else {
    initialPassword = generateTemporaryPassword();
    generated = true;
  }

  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);

  const newMember = {
    id:            `member-${Date.now()}`,
    username:      sanitize(body.username as string).toLowerCase(),
    name:          sanitize(body.name as string),
    initials:      sanitize(body.initials as string).toUpperCase().slice(0, 2),
    role:          body.role === "admin" ? "admin" : "member",
    avatar_color:  body.avatarColor ?? "blue",
    active:        true,
    // Never store the plaintext — only the bcrypt hash. Force-reset is enforced
    // by the `force_password_reset` flag if your schema supports it; otherwise
    // the temp password should be communicated out of band and rotated soon.
    password:      null,
    password_hash: passwordHash,
  };

  const { data, error } = await supabase
    .from("team_members")
    .insert(newMember)
    .select("id, username, name, initials, role, avatar_color, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit-log the account creation (don't log the password — even temp).
  try {
    await supabase.from("audit_log").insert({
      event: "account_created",
      username: auth.session.user.username,
      details: { new_username: newMember.username, role: newMember.role, password_generated: generated },
    });
  } catch { /* non-critical */ }

  // If the admin let us generate the password, return it ONCE in the response
  // so they can deliver it to the new user. It's never stored anywhere else.
  const responseBody: Record<string, unknown> = { data };
  if (generated) {
    responseBody.temporary_password = initialPassword;
    responseBody.note = "Temporary password shown once. The user should change it on first login.";
  }

  return NextResponse.json(responseBody, { status: 201 });
}
