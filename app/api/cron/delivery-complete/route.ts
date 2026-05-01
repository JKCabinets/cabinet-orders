import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Called daily by Vercel Cron.
// Finds "At cross dock" orders whose scheduled_delivery_date has passed
// and automatically moves them to "Delivered".

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, name, scheduled_delivery_date")
    .eq("stage", "At cross dock")
    .eq("archived", false)
    .lte("scheduled_delivery_date", today)
    .not("scheduled_delivery_date", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, advanced: 0 });
  }

  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  for (const order of orders) {
    await supabase.from("orders").update({ stage: "Delivered" }).eq("id", order.id);
    await supabase.from("order_activity").insert({
      order_id: order.id,
      text: `Delivery date reached — moved to "Delivered" automatically`,
      time: todayLabel,
    });
  }

  return NextResponse.json({ ok: true, advanced: orders.length });
}
