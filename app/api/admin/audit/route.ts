import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, parseBoundedInt } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);

  // CWE-1285 fix: bound the limit. The previous `parseInt(...)` accepted
  // negative numbers, NaN, and unbounded huge values that would let any admin
  // (or any caller that bypasses admin check) trigger massive DB reads.
  const limit = parseBoundedInt(searchParams.get("limit"), {
    min: 1,
    max: MAX_LIMIT,
    fallback: DEFAULT_LIMIT,
  });

  const usernameRaw = searchParams.get("username");
  // Username is alphanumeric + ._- (matches what the team-creation endpoint allows)
  const username = usernameRaw && /^[a-zA-Z0-9._-]{1,64}$/.test(usernameRaw)
    ? usernameRaw
    : null;

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
