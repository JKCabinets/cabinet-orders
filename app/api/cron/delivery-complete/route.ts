import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { syncStageToShopify } from "@/lib/shopifyStageSync";

/**
 * Verify the cron Bearer token using a constant-time compare. Fails CLOSED
 * if no CRON_SECRET is configured.
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

  const today = new Date().toISOString().split("T")[0];

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, name, shopify_id, scheduled_delivery_date")
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

  const results: { id: string; name: string; shopify_synced: boolean }[] = [];

  for (const order of orders) {
    await supabase.from("orders").update({
      stage: "Delivered",
      stage_entered_at: new Date().toISOString(),
    }).eq("id", order.id);
    await supabase.from("order_activity").insert({
      order_id: order.id,
      text: `Delivery date reached — moved to "Delivered" automatically`,
      time: todayLabel,
    });

    // Keep Shopify in step. Without this the Shopify order showed
    // "At cross dock" forever, even once the OMS said Delivered.
    let shopify_synced = false;
    if (order.shopify_id) {
      try {
        shopify_synced = await syncStageToShopify(order.shopify_id, "Delivered");
      } catch {}
    }

    results.push({ id: order.id, name: order.name, shopify_synced });
  }

  return NextResponse.json({ ok: true, advanced: results.length, orders: results });
}
