import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { username?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.username) return NextResponse.json({ error: "username required" }, { status: 422 });

  const { error } = await supabase
    .from("team_members")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("username", body.username);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_log").insert({
    event: "account_unlocked",
    username: auth.session.user.username,
    details: { unlocked_user: body.username },
  });

  return NextResponse.json({ ok: true });
}
