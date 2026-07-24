import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { getShopifyToken } from "@/lib/shopify";

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

/**
 * The OMS stage names. Any of these already on the order is the PREVIOUS
 * stage tag and gets replaced, so stages do not pile up over an order's life.
 */
const STAGE_TAGS = ["New", "Entered", "In production", "At cross dock", "Delivered"];

/**
 * Merge our tags into whatever the order already carries.
 *
 * Shopify's PUT replaces the entire tag list, so anything omitted here is
 * destroyed — including the vendor tags the team relies on. Keep every tag we
 * do not own, drop the stale stage tag, and add the current one.
 */
function mergeTags(existing: string, stage: string): string {
  const stageNames = new Set(STAGE_TAGS.map(s => s.toLowerCase()));
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of (existing ?? "").split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const l = t.toLowerCase();
    if (stageNames.has(l)) continue;   // previous stage — replaced below
    if (l === "jk order") continue;    // re-added below, in a fixed position
    if (seen.has(l)) continue;         // de-duplicate
    seen.add(l);
    kept.push(t);
  }
  return ["JK Order", stage, ...kept].join(", ");
}

async function syncStageToShopify(shopifyId: string, stage: string) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyId) return;

  // Defense against SSRF via misconfigured env / order corruption
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) return;
  if (!/^\d+$/.test(shopifyId)) return;

  let token: string;
  try { token = await getShopifyToken(); } catch { return; }

  let currentAttributes: { name: string; value: string }[] = [];
  // null means we could NOT read the tags. In that case we leave them alone
  // rather than risk replacing a list we never saw.
  let currentTags: string | null = null;
  try {
    const getRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json?fields=note_attributes,tags`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (getRes.ok) {
      const j = await getRes.json();
      currentAttributes = j.order?.note_attributes ?? [];
      currentTags = typeof j.order?.tags === "string" ? j.order.tags : "";
    }
  } catch {}

  const attrMap = new Map(currentAttributes.map((a: { name: string; value: string }) => [a.name, a.value]));
  attrMap.set("Production Stage", stage);

  const orderPayload: Record<string, unknown> = {
    id: shopifyId,
    note_attributes: Array.from(attrMap.entries()).map(([name, value]) => ({ name, value })),
  };
  // Only touch tags when we actually read them.
  if (currentTags !== null) {
    orderPayload.tags = mergeTags(currentTags, stage);
  }

  await fetch(
    `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ order: orderPayload }),
    }
  );
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
