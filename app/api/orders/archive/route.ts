import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Archive / restore an order.
 *
 * Authorization: admins can archive anything. Members can archive only their
 * own manually-created orders, matching the same rule the DELETE handler uses.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "archive");
  if (limited) return limited;

  let body: { id?: string; archived?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 422 });
  if (typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "archived must be boolean" }, { status: 422 });
  }

  const isAdmin = auth.session.user.role === "admin";

  if (!isAdmin) {
    const { data: order } = await supabase
      .from("orders")
      .select("source, created_by")
      .eq("id", body.id)
      .single();
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    if (order.source !== "Manual") {
      return NextResponse.json(
        { error: "Only admins can archive non-manual orders" },
        { status: 403 }
      );
    }
    if (!order.created_by || order.created_by !== auth.session.user.username) {
      return NextResponse.json(
        { error: "You can only archive orders you created" },
        { status: 403 }
      );
    }
  }

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
