import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken } from "@/lib/shopify";
import {
  ALLOWED_STAGES,
  stageIndex,
  timingSafeStringEqual,
  ADMIN_PIN,
} from "@/lib/stageGuards";

// Cap on bulk operations per request. Higher than this should be done in
// batches client-side to keep request times reasonable.
const MAX_BULK_IDS = 50;

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

  let body: { ids?: unknown; action?: unknown; stage?: unknown; archived?: unknown; admin_pin?: unknown };
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

  // ── Load all affected orders in one round-trip so we can do per-row checks ──
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, source, created_by, stage, shopify_id, archived, type")
    .in("id", ids);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const orderMap = new Map((orders ?? []).map(o => [o.id, o]));
  const isAdmin = auth.session.user.role === "admin";
  const username = auth.session.user.username;
  const displayName = auth.session.user.name ?? username;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // ── PRE-FLIGHT: if move involves any backwards transitions, require PIN ───
  // We check this ONCE for the whole batch so the user enters their PIN once.
  // The PIN is constant-time compared. We don't enumerate which orders would
  // require it — the batch is admin-gated or not.
  let backwardsMoveDetected = false;
  if (action === "move" && targetStage) {
    const targetInfo = stageIndex(targetStage);
    for (const id of ids) {
      const order = orderMap.get(id);
      if (!order) continue;
      const currentInfo = stageIndex(order.stage);
      // Backwards if in the same flow and target idx < current idx
      if (currentInfo.flow === targetInfo.flow && targetInfo.idx < currentInfo.idx) {
        backwardsMoveDetected = true;
        break;
      }
    }
  }

  if (backwardsMoveDetected) {
    const providedPin = typeof body.admin_pin === "string" ? body.admin_pin : "";
    if (!timingSafeStringEqual(providedPin, ADMIN_PIN)) {
      return NextResponse.json(
        { error: "admin_pin_required", message: "Backwards moves require admin PIN" },
        { status: 403 }
      );
    }
  }

  // ── Process each id, collecting per-row results ───────────────────────────
  const results: BulkResult[] = [];
  const activityInserts: { order_id: string; text: string; time: string }[] = [];

  for (const id of ids) {
    const order = orderMap.get(id);
    if (!order) {
      results.push({ id, ok: false, error: "not_found" });
      continue;
    }

    // Permission check — only restrictive for archive. Stage moves match the
    // single-order PATCH (any authenticated user).
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

      // ── GATE: moving New → Entered requires at least one attachment ───────
      // Mirrors the gate in OrderModal.tsx (doMoveStage). Per-row failure
      // mode: report it, continue with the rest.
      if (targetStage === "Entered" && order.stage === "New") {
        const { count, error: countError } = await supabase
          .from("order_attachments")
          .select("id", { count: "exact", head: true })
          .eq("order_id", id);

        if (countError) {
          results.push({ id, ok: false, error: `failed to verify attachments: ${countError.message}` });
          continue;
        }
        if (!count || count === 0) {
          results.push({
            id,
            ok: false,
            error: "needs_attachment: New → Entered requires at least one attachment (e.g. the manufacturer's acknowledgment PDF)",
          });
          continue;
        }
      }

      const updates: Record<string, unknown> = {
        stage: targetStage,
        // Bump stage_entered_at so the SLA page reads real per-stage age.
        // DB trigger also does this; setting it here is explicit.
        stage_entered_at: new Date().toISOString(),
      };
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
        backwards_move: backwardsMoveDetected,
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

/**
 * GET /api/orders/bulk?ids=a,b,c&stage=Entered
 *
 * Pre-flight check — returns whether each provided id would pass the stage
 * gates for the given target stage. The UI uses this to show a preview
 * before the user clicks "Move N orders" in the confirm dialog, so they
 * know up front which ones will succeed and which won't.
 *
 * This does NOT do any writes. PIN-gated backwards moves return
 * `{ requires_pin: true }` at the top level.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "orders:bulk-preflight");
  if (limited) return limited;

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const targetStage = url.searchParams.get("stage") ?? "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(s => s.length > 0 && s.length < 100);

  if (ids.length === 0 || ids.length > MAX_BULK_IDS) {
    return NextResponse.json({ error: "1 to 50 ids required" }, { status: 422 });
  }
  if (!ALLOWED_STAGES.has(targetStage)) {
    return NextResponse.json({ error: "valid stage required" }, { status: 422 });
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, stage")
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targetInfo = stageIndex(targetStage);
  let requiresPin = false;
  const checks: { id: string; will_pass: boolean; reason?: string }[] = [];

  // Pre-load attachment counts in one round-trip for orders moving to Entered
  let attachmentMap = new Map<string, number>();
  if (targetStage === "Entered") {
    const newOrderIds = (orders ?? []).filter(o => o.stage === "New").map(o => o.id);
    if (newOrderIds.length > 0) {
      const { data: atts } = await supabase
        .from("order_attachments")
        .select("order_id")
        .in("order_id", newOrderIds);
      attachmentMap = new Map();
      for (const a of (atts ?? [])) {
        attachmentMap.set(a.order_id as string, (attachmentMap.get(a.order_id as string) ?? 0) + 1);
      }
    }
  }

  for (const id of ids) {
    const order = (orders ?? []).find(o => o.id === id);
    if (!order) {
      checks.push({ id, will_pass: false, reason: "not_found" });
      continue;
    }

    if (order.stage === targetStage) {
      checks.push({ id, will_pass: true, reason: "no_change" });
      continue;
    }

    const currentInfo = stageIndex(order.stage);
    if (currentInfo.flow === targetInfo.flow && targetInfo.idx < currentInfo.idx) {
      requiresPin = true;
    }

    if (targetStage === "Entered" && order.stage === "New") {
      const attCount = attachmentMap.get(id) ?? 0;
      if (attCount === 0) {
        checks.push({ id, will_pass: false, reason: "needs_attachment" });
        continue;
      }
    }

    checks.push({ id, will_pass: true });
  }

  return NextResponse.json({
    ok: true,
    requires_pin: requiresPin,
    checks,
  });
}
