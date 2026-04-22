import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { id?: string; archived?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 422 });

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const action = body.archived ? "archived" : "restored from archive";

  const { error } = await supabase
    .from("orders")
    .update({ archived: body.archived })
    .eq("id", body.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("order_activity").insert({
    order_id: body.id,
    text: `Order ${action} by ${auth.session.user.name}`,
    time: today,
  });

  return NextResponse.json({ ok: true, action, by: auth.session.user.username });
}
