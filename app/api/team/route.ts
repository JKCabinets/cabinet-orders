import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

  const newMember = {
    id:           `member-${Date.now()}`,
    username:     sanitize(body.username as string).toLowerCase(),
    name:         sanitize(body.name as string),
    initials:     sanitize(body.initials as string).toUpperCase().slice(0, 2),
    role:         body.role === "admin" ? "admin" : "member",
    avatar_color: body.avatarColor ?? "blue",
    active:       true,
    password:     "demo1234",
  };

  const { data, error } = await supabase.from("team_members").insert(newMember).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data }, { status: 201 });
}
