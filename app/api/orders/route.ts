import { NextRequest, NextResponse } from "next/server";
import { requireAuth, cleanInput, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "orders:get");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const type     = searchParams.get("type") ?? "order";
  const archived = searchParams.get("archived");

  // Whitelist `type` so a malicious caller can't request arbitrary row sets
  if (type !== "order" && type !== "warranty") {
    return NextResponse.json({ error: "Invalid type" }, { status: 422 });
  }

  let query = supabase
    .from("orders")
    .select("*, order_activity(*)")
    .eq("type", type)
    .order("created_at", { ascending: false });

  if (archived === "true")  query = query.eq("archived", true);
  if (archived === "false") query = query.eq("archived", false);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Step 4 (In production -> At cross dock) is owned solely by the
  // production-complete cron. It used to ALSO happen here, on every list fetch,
  // with a different comparison (`<` vs the cron's `<=`) and no Shopify sync —
  // so whichever ran first decided both the timing and whether Shopify was told.

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
  const limited = await rateLimitOr429(req, 20, 60_000, "orders:post");
  if (limited) return limited;

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
    name:       cleanInput(body.name as string),
    source:     body.source  ?? "Manual",
    detail:     cleanInput((body.detail as string) ?? ""),
    stage:      isOrder ? "New" : "New claim",
    member:     body.member  ?? "AX",
    date:       today,
    sku:        cleanInput((body.sku as string) ?? ""),
    notes:      cleanInput((body.notes as string) ?? ""),
    internal_notes: cleanInput((body.internal_notes as string) ?? ""),
    archived:   false,
    door_style: cleanInput((body.door_style as string) ?? ""),
    color:      cleanInput((body.color as string) ?? ""),
    // sku_items is a complex JSON value — frontend already passes structured
    // objects. The export route HTML-escapes everything before rendering and
    // React handles the rest, so we don't need to encode at write time.
    sku_items:  body.sku_items ?? [],
    vendor:          cleanInput((body.vendor as string) ?? ""),
    ship_to:         cleanInput((body.ship_to as string) ?? ""),
    customer_phone:  cleanInput((body.customer_phone as string) ?? ""),
    customer_email:  cleanInput((body.customer_email as string) ?? ""),
    delivery_method: cleanInput((body.delivery_method as string) ?? ""),
    // Track who created the order — useful for audit and for the authorization
    // checks in /api/orders/[id] DELETE.
    created_by:      auth.session.user.username,
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
