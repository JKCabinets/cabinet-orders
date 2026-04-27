import { NextRequest, NextResponse } from "next/server";
import { requireAuth, sanitize, checkRateLimit } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!checkRateLimit(req)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const archived = searchParams.get("archived");

  let query = supabase
    .from("orders")
    .select("*, order_activity(*)")
    .eq("type", "warranty")
    .order("created_at", { ascending: false });

  if (archived === "true")  query = query.eq("archived", true);
  if (archived === "false") query = query.eq("archived", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shaped = (data ?? []).map((o) => ({
    ...o,
    activity: (o.order_activity ?? [])
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((a: { text: string; time: string }) => ({ text: a.text, time: a.time })),
    order_activity: undefined,
  }));

  return NextResponse.json({ data: shaped });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!checkRateLimit(req, 20)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 422 });

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const id = `WRN-${String(Date.now()).slice(-4).padStart(4, "0")}`;

  const claim = {
    id,
    type: "warranty",
    name:   sanitize(body.name as string),
    source: body.source ?? "Manual",
    detail: sanitize((body.detail as string) ?? ""),
    stage:  "New claim",
    member: body.member ?? "AX",
    date:   today,
    sku:    sanitize((body.sku as string) ?? ""),
    notes:  sanitize((body.notes as string) ?? ""),
    archived: false,
  };

  const { data: inserted, error } = await supabase.from("orders").insert(claim).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("order_activity").insert({
    order_id: id,
    text: `Claim logged by ${auth.session.user.name}`,
    time: today,
  });

  return NextResponse.json({ data: { ...inserted, activity: [] } }, { status: 201 });
}
