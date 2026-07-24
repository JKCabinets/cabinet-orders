import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { syncStageToShopify } from "@/lib/shopifyStageSync";

/**
 * Verify the cron Bearer token using a constant-time compare. Fails CLOSED
 * if no CRON_SECRET is configured — the old code silently accepted any
 * caller when the secret env var was unset.
 */
function verifyCronAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;

  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

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
        await syncStageToShopify(order.shopify_id, "At cross dock");
        shopify_synced = true;
      } catch {}
    }

    results.push({ id: order.id, name: order.name, shopify_synced });
  }

  return NextResponse.json({ ok: true, advanced: results.length, orders: results });
}
