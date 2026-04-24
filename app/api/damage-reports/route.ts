import { NextRequest, NextResponse } from "next/server";
import { requireAuth, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 422 });

  const { data, error } = await supabase
    .from("damage_reports")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.orderId || !body.damage_type || !body.description) {
    return NextResponse.json({ error: "orderId, damage_type, and description required" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("damage_reports")
    .insert({
      order_id: body.orderId,
      damage_type: sanitize(body.damage_type as string),
      affected_skus: body.affected_skus ?? [],
      description: sanitize(body.description as string),
      cause: sanitize((body.cause as string) ?? ""),
      reported_by: auth.session.user.name ?? auth.session.user.username,
      status: "open",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
