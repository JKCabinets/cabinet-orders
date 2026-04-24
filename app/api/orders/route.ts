import { NextRequest, NextResponse } from "next/server";
import { requireAuth, sanitize, checkRateLimit } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  if (!checkRateLimit(req)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { searchParams } = new URL(req.url);
  const type     = searchParams.get("type") ?? "order";
  const archived = searchParams.get("archived");

  let query = supabase
    .from("orders")
    .select("*, order_activity(*)")
    .eq("type", type)
    .order("created_at", { ascending: false });

  if (archived === "true")  query = query.eq("archived", true);
  if (archived === "false") query = query.eq("archived", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-advance any "In production" orders whose est finish date has passed
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const todayLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
  const toAdvance = (data ?? []).filter(
    o => o.stage === "In production" && o.production_est_finish_date && o.production_est_finish_date < today
  );
  for (const o of toAdvance) {
    await supabase.from("orders").update({ stage: "At cross dock" }).eq("id", o.id);
    await supabase.from("order_activity").insert({
      order_id: o.id,
      text: `Production complete — automatically moved to "At cross dock"`,
      time: todayLabel,
    });
    o.stage = "At cross dock"; // reflect in this response immediately
  }

  // Shape activity into array format the frontend expects
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

  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" });
  const isOrder = body.type !== "warranty";
  const id = isOrder
    ? `ORD-${Date.now()}`
    : `WRN-${String(Date.now()).slice(-4).padStart(4, "0")}`;

  const newOrder = {
    id,
    type:       body.type    ?? "order",
    name:       sanitize(body.name as string),
    source:     body.source  ?? "Manual",
    detail:     sanitize((body.detail as string) ?? ""),
    stage:      isOrder ? "New" : "New claim",
    member:     body.member  ?? "AX",
    date:       today,
    sku:        sanitize((body.sku as string) ?? ""),
    notes:      sanitize((body.notes as string) ?? ""),
    archived:   false,
    door_style: sanitize((body.door_style as string) ?? ""),
    color:      sanitize((body.color as string) ?? ""),
    sku_items:  body.sku_items ?? [],
  };

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert(newOrder)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("order_activity").insert({
    order_id: id,
    text: `Order logged by ${auth.session.user.name}`,
    time: today,
  });

  return NextResponse.json({ data: { ...inserted, activity: [{ text: `Order logged by ${auth.session.user.name}`, time: today }] } }, { status: 201 });
}
