import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { syncStageToShopify } from "@/lib/shopifyStageSync";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, name, shopify_id, production_est_finish_date")
    .eq("stage", "In production")
    .eq("archived", false)
    // ALLOWLIST, deliberately -- not .neq("type", "custom").
    //
    // Custom orders are contract work: priced by hand, paid in person,
    // scheduled by conversation. Their stages RECORD what happened rather
    // than drive it, so a cron advancing one at 1am is asserting something
    // it cannot know. This filter is what keeps date entry on a custom
    // order inert.
    //
    // Samples are listed because they are Shopify orders with Shopify
    // payment, same as standard -- though the entry is inert today, since
    // their flow is New -> Entered -> Delivered and never reaches this
    // stage at all.
    //
    // A denylist would automate the NEXT type added without anyone
    // choosing to, which is exactly how custom orders ended up here.
    .in("type", ["order", "sample"])
    .lte("production_est_finish_date", today)
    .not("production_est_finish_date", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, advanced: 0, message: "No orders ready to advance" });
  }

  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  const results: { id: string; name: string; shopify_synced: boolean }[] = [];

  for (const order of orders) {
    await supabase
      .from("orders")
      .update({
        stage: "At cross dock",
        stage_entered_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await supabase.from("order_activity").insert({
      order_id: order.id,
      text: `Production complete — moved to "At cross dock" automatically`,
      time: todayLabel,
    });

    let shopify_synced = false;
    if (order.shopify_id) {
      try {
        shopify_synced = await syncStageToShopify(order.shopify_id, "At cross dock");
      } catch {}
    }

    results.push({ id: order.id, name: order.name, shopify_synced });
  }

  return NextResponse.json({ ok: true, advanced: results.length, orders: results });
}
