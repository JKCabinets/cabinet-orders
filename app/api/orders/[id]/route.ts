import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data, error } = await supabase
    .from("orders")
    .select("*, order_activity(*)")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const shaped = {
    ...data,
    activity: (data.order_activity ?? [])
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((a: { text: string; time: string }) => ({ text: a.text, time: a.time })),
    order_activity: undefined,
  };

  return NextResponse.json({ data: shaped });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.stage)                  updates.stage      = body.stage;
  if (body.notes !== undefined)    updates.notes      = sanitize(body.notes as string);
  if (body.archived !== undefined) updates.archived   = body.archived;
  if (body.member)                 updates.member     = body.member;
  if (body.door_style !== undefined) updates.door_style = sanitize(body.door_style as string);
  if (body.color !== undefined)    updates.color      = sanitize(body.color as string);
  if (body.sku_items !== undefined) updates.sku_items = body.sku_items;
  if (body.delivery_date !== undefined) updates.delivery_date = body.delivery_date;
  if (body.delivery_window !== undefined) updates.delivery_window = sanitize(body.delivery_window as string);
  if (body.delivery_notes !== undefined) updates.delivery_notes = sanitize(body.delivery_notes as string);

  const { error } = await supabase.from("orders").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let activityText = "";
  if (body.stage)   activityText = `Moved to "${body.stage}" by ${auth.session.user.name}`;
  else if (body.notes !== undefined) activityText = `Notes updated by ${auth.session.user.name}`;
  else if (body.archived === true)   activityText = `Archived by ${auth.session.user.name}`;
  else if (body.archived === false)  activityText = `Restored by ${auth.session.user.name}`;

  if (activityText) {
    await supabase.from("order_activity").insert({ order_id: id, text: activityText, time: today });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  // Check order exists and is Manual source
  const { data: order } = await supabase
    .from("orders")
    .select("source")
    .eq("id", id)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Only Manual orders can be deleted by any user; Shopify orders need admin
  if (order.source === "Shopify" && auth.session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete Shopify orders" }, { status: 403 });
  }

  // Hard delete — remove activity first due to foreign key
  await supabase.from("order_activity").delete().eq("order_id", id);
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted_by: auth.session.user.username });
}
