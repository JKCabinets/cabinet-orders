import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// This route is called daily by Vercel Cron (see vercel.json).
// It finds any order that is:
//   - stage = "In production"
//   - production_est_finish_date <= today
// and advances them to "At cross dock", syncing back to Shopify.

import { getShopifyToken } from "@/lib/shopify";

async function syncStageToShopify(shopifyId: string, stage: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyId) return;
  let token: string;
  try { token = await getShopifyToken(); } catch { return; }

  // Read current note_attributes first
  let currentAttributes: { name: string; value: string }[] = [];
  try {
    const getRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json?fields=note_attributes`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (getRes.ok) {
      const j = await getRes.json();
      currentAttributes = j.order?.note_attributes ?? [];
    }
  } catch {}

  const attrMap = new Map(currentAttributes.map((a: { name: string; value: string }) => [a.name, a.value]));
  attrMap.set("Production Stage", stage);

  await fetch(
    `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        order: {
          id: shopifyId,
          note_attributes: Array.from(attrMap.entries()).map(([name, value]) => ({ name, value })),
          tags: `JK Order, ${stage}`,
        },
      }),
    }
  );
}

export async function GET(req: NextRequest) {
  // Secure the cron endpoint with a secret so it can't be triggered publicly
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Find all "In production" orders whose est finish date is today or in the past
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
    // Advance stage in Supabase
    await supabase
      .from("orders")
      .update({ stage: "At cross dock" })
      .eq("id", order.id);

    // Log activity
    await supabase.from("order_activity").insert({
      order_id: order.id,
      text: `Production complete — moved to "At cross dock" automatically`,
      time: todayLabel,
    });

    // Sync to Shopify if applicable
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
