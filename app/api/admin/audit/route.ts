import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const username = searchParams.get("username");

  let query = supabase
    .from("audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (username) query = query.eq("username", username);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
