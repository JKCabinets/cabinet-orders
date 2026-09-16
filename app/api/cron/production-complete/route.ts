import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { syncStageToShopify } from "@/lib/shopifyStageSync";
import { PRODUCTION_COMPLETE_TYPES, productionAutoAdvanceSkip, type ProductionAdvanceSkip } from "@/lib/autoAdvance";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, name, shopify_id, production_est_finish_date, project_id, payment_status, payment_hold_cleared_for")
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
    // their flow is New -> Shipped -> Delivered and never reaches this
    // stage at all.
    //
    // A denylist would automate the NEXT type added without anyone
    // choosing to, which is exactly how custom orders ended up here.
    // ⚠ THE LIST MOVED TO lib/autoAdvance, because the modal now tells
    // people this run will advance their order and has to be reading the
    // same rule. Two copies would let the UI promise an automatic move on
    // a row this query never returns -- and somebody would wait for it.
    .in("type", [...PRODUCTION_COMPLETE_TYPES])
    .lte("production_est_finish_date", today)
    .not("production_est_finish_date", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ ok: true, advanced: 0, message: "No orders ready to advance" });
  }

  // ⚠ THE PURCHASE DECIDES, NOT THE GROUP (2026-09-16, handoff item 16). A
  // refunded purchase, or an archived one, is not advanced -- see
  // productionAutoAdvanceSkip, which the modal's "moves on its own" promise
  // reads too. If the projects cannot be read, NOTHING is advanced: moving an
  // order and pushing its stage to Shopify without knowing whether it was
  // refunded is worse than moving it tomorrow. Non-2xx, so the dead-man's
  // switch reports it.
  type PurchaseRow = {
    id: string; archived: boolean | null;
    payment_status: string | null; payment_hold_cleared_for: string | null;
  };
  const projectIds = [...new Set(
    orders.map((o: { project_id?: string | null }) => o.project_id)
      .filter((p: string | null | undefined): p is string => !!p))];
  const projectsById = new Map<string, PurchaseRow>();
  if (projectIds.length > 0) {
    const { data: projectRows, error: projectError } = await supabase
      .from("projects")
      .select("id, archived, payment_status, payment_hold_cleared_for")
      .in("id", projectIds);
    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }
    for (const p of (projectRows ?? []) as PurchaseRow[]) projectsById.set(p.id, p);
  }

  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  const results: { id: string; name: string; shopify_synced: boolean }[] = [];

  const failures: { id: string; reason: string }[] = [];

  // Reported, not silent: cron.log shows which order waited and why. The work
  // queue surfaces a held order as "Refund acknowledgment required" too.
  const skipped: { id: string; reason: ProductionAdvanceSkip }[] = [];

  for (const order of orders) {
    const project = order.project_id ? (projectsById.get(order.project_id) ?? null) : null;
    const skip = productionAutoAdvanceSkip(order, project);
    if (skip) {
      skipped.push({ id: order.id, reason: skip });
      continue;
    }

    // ⚠ THE UPDATE'S ERROR WAS DISCARDED. A failed write still wrote the
    // activity row saying the order had advanced, and still counted toward
    // the reported total -- so the one record that would reveal the failure
    // asserted the opposite. There is nothing to DO about a failure here
    // except not lie about it, which matters more once this cron owns a
    // customer notification.
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        stage: "At cross dock",
        stage_entered_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateError) {
      failures.push({ id: order.id, reason: updateError.message });
      console.warn("[production-complete]", JSON.stringify({
        outcome: "advance_failed", order_id: order.id, reason: updateError.message,
      }));
      continue;
    }

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

  // ⚠ run-cron.sh pings on the HTTP STATUS. A run where every advance failed
  // must be non-2xx or the dead-man's switch stays green through an outage --
  // the exact shape of the six-day monitoring failure. A PARTIAL failure stays
  // 200 and reports the count: the orders that advanced genuinely did.
  if (results.length === 0 && failures.length > 0) {
    return NextResponse.json(
      { ok: false, advanced: 0, failed: failures.length, failures },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    advanced: results.length,
    ...(failures.length > 0 ? { failed: failures.length, failures } : {}),
    ...(skipped.length > 0 ? { skipped: skipped.length, skips: skipped } : {}),
    orders: results,
  });
}
