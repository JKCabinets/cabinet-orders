import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken } from "@/lib/shopify";

// Cap on bulk operations per request. Higher than this should be done in
// batches client-side to keep request times reasonable.
const MAX_BULK_IDS = 50;

const ALLOWED_STAGES = new Set([
  // Order stages
  "New", "Entered", "In production", "At cross dock", "Delivered",
  // Warranty stages
  "New claim", "In review", "Parts ordered", "Shipped", "Resolved",
]);

interface BulkResult {
  id: string;
  ok: boolean;
  error?: string;
  shopify_synced?: boolean;
}

/**
 * Push a single order's stage change back to Shopify. Mirrors syncToShopify in
 * /api/orders/[id]/route.ts but minimized for the bulk path (only stage + tags).
 */
async function syncStageToShopify(shopifyId: string, stage: string): Promise<boolean> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyId) return false;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) return false;
  if (!/^\d+$/.test(shopifyId)) return false;

  let token: string;
  try { token = await getShopifyToken(); } catch { return false; }

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
  } catch { return false; }

  const attrMap = new Map(currentAttributes.map((a: { name: string; value: string }) => [a.name, a.value]));
  attrMap.set("Production Stage", stage);

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({
          order: {
            id: shopifyId,
            note_attributes: Array.from(attrMap.entries()).map(([name, value]) => ({ name, value })),
            tags: `JK Order, ${stage}`,
          },
        }),
      }
    );
    return res.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Lower rate limit for bulk — each request can fan out to dozens of DB writes
  const limited = await rateLimitOr429(req, 10, 60_000, "orders:bulk");
  if (limited) return limited;

  let body: { ids?: unknown; action?: unknown; stage?: unknown; archived?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Validate input ────────────────────────────────────────────────────────
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 422 });
  }
  if (body.ids.length > MAX_BULK_IDS) {
    return NextResponse.json(
      { error: `Too many ids (max ${MAX_BULK_IDS} per request)` },
      { status: 422 }
    );
  }
  const ids = body.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 100);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no valid ids" }, { status: 422 });
  }

  const action = body.action;
  if (action !== "move" && action !== "archive") {
    return NextResponse.json({ error: "action must be 'move' or 'archive'" }, { status: 422 });
  }

  let targetStage: string | null = null;
  if (action === "move") {
    if (typeof body.stage !== "string" || !ALLOWED_STAGES.has(body.stage)) {
      return NextResponse.json({ error: "valid stage required for move" }, { status: 422 });
    }
    targetStage = body.stage;
  }

  let targetArchived: boolean | null = null;
  if (action === "archive") {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "archived (boolean) required for archive" }, { status: 422 });
    }
    targetArchived = body.archived;
  }

  // ── Load all affected orders in one round-trip so we can do per-row auth ──
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, source, created_by, stage, shopify_id, archived")
    .in("id", ids);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const orderMap = new Map((orders ?? []).map(o => [o.id, o]));
  const isAdmin = auth.session.user.role === "admin";
  const username = auth.session.user.username;
  const displayName = auth.session.user.name ?? username;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // ── Process each id, collecting per-row results ───────────────────────────
  // We do these serially rather than in parallel to keep Shopify API calls
  // (and DB writes) sequential. Bulk = 50 max, this is still fast.
  const results: BulkResult[] = [];
  const activityInserts: { order_id: string; text: string; time: string }[] = [];

  for (const id of ids) {
    const order = orderMap.get(id);
    if (!order) {
      results.push({ id, ok: false, error: "not_found" });
      continue;
    }

    // Permission check — mirrors the single-action rules. Stage moves work
    // like the single PATCH (any authenticated user). Archive follows the
    // stricter rule from /api/orders/archive (admin or own manual orders).
    if (action === "archive" && !isAdmin) {
      if (order.source !== "Manual") {
        results.push({ id, ok: false, error: "forbidden: only admins can archive non-manual orders" });
        continue;
      }
      if (!order.created_by || order.created_by !== username) {
        results.push({ id, ok: false, error: "forbidden: you can only archive orders you created" });
        continue;
      }
    }

    if (action === "move" && targetStage) {
      // Skip no-op moves
      if (order.stage === targetStage) {
        results.push({ id, ok: true, shopify_synced: false });
        continue;
      }

      const updates: Record<string, unknown> = { stage: targetStage };
      // Clear claim when leaving New; record entered_by when moving to Entered
      if (targetStage !== "New") updates.claimed_by = null;
      if (targetStage === "Entered") updates.entered_by = displayName;

      const { error: updateError } = await supabase
        .from("orders").update(updates).eq("id", id);
      if (updateError) {
        results.push({ id, ok: false, error: updateError.message });
        continue;
      }

      activityInserts.push({
        order_id: id,
        text: `Moved to "${targetStage}" by ${displayName} (bulk action)`,
        time: today,
      });

      // Shopify writeback (failure is non-fatal — we surface it in the result)
      let shopify_synced = false;
      if (order.shopify_id) {
        shopify_synced = await syncStageToShopify(order.shopify_id, targetStage);
      }

      results.push({ id, ok: true, shopify_synced });
    }

    if (action === "archive" && targetArchived !== null) {
      if (order.archived === targetArchived) {
        results.push({ id, ok: true });
        continue;
      }

      const { error: updateError } = await supabase
        .from("orders").update({ archived: targetArchived }).eq("id", id);
      if (updateError) {
        results.push({ id, ok: false, error: updateError.message });
        continue;
      }

      activityInserts.push({
        order_id: id,
        text: `${targetArchived ? "Archived" : "Restored from archive"} by ${displayName} (bulk action)`,
        time: today,
      });

      results.push({ id, ok: true });
    }
  }

  // Batch-insert activity entries (1 round-trip instead of N)
  if (activityInserts.length > 0) {
    await supabase.from("order_activity").insert(activityInserts);
  }

  // Audit-log the bulk action so admins can see it in the audit panel
  try {
    await supabase.from("audit_log").insert({
      event: "bulk_action",
      username,
      details: {
        action,
        ...(targetStage ? { stage: targetStage } : {}),
        ...(targetArchived !== null ? { archived: targetArchived } : {}),
        requested: ids.length,
        succeeded: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
      },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({
    ok: true,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}
