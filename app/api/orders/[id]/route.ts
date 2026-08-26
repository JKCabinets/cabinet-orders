import { NextRequest, NextResponse } from "next/server";
import { requireAuth, cleanInput, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken } from "@/lib/shopify";
import { mergeTags } from "@/lib/shopifyStageSync";
import { ALLOWED_STAGES, isStageAllowedForType, isBackwardsMove, verifyAdminPin, fieldsToClearOnBackwardMove, describeFieldsCleared } from "@/lib/stageGuards";
import { isPaymentHoldStatus, paymentHoldLabel, parseMoney, isStageOfferedForType } from "@/lib/data";
import { trackingTargetStage, categoryHasTracking, type OrderCategory } from "@/lib/categories";
import { orderAllVendorsGreen } from "@/lib/acknowledgments";

/** Push order updates back to Shopify */
async function syncToShopify(
  shopifyId: string,
  updates: {
    stage?: string;
    production_start_date?: string | null;
    production_est_finish_date?: string | null;
    delivery_date?: string | null;
    delivery_window?: string;
    delivery_notes?: string;
    notes?: string;
  }
) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain || !shopifyId) return { ok: false, error: "Missing env vars" };

  // Defense against SSRF via misconfigured env: only allow myshopify.com domains
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) {
    return { ok: false, error: "Invalid Shopify domain" };
  }
  // Defense against shopify_id injection — must be a numeric ID
  if (!/^\d+$/.test(shopifyId)) {
    return { ok: false, error: "Invalid Shopify order id" };
  }

  let token: string;
  try { token = await getShopifyToken(); }
  catch (e) { return { ok: false, error: `Token error: ${e}` }; }

  // Fetch current note_attributes from Shopify so we don't overwrite unrelated ones
  let currentAttributes: { name: string; value: string }[] = [];
  // null means we could NOT read the tags, in which case we leave them
  // alone rather than replacing a list we never saw.
  let currentTags: string | null = null;
  try {
    const getRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json?fields=note_attributes,tags,note`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (getRes.ok) {
      const getJson = await getRes.json();
      currentAttributes = getJson.order?.note_attributes ?? [];
      currentTags = typeof getJson.order?.tags === "string" ? getJson.order.tags : "";
    }
  } catch {}

  const attrMap = new Map(currentAttributes.map((a: { name: string; value: string }) => [a.name, a.value]));

  if (updates.stage !== undefined)
    attrMap.set("Production Stage", updates.stage);
  if (updates.production_start_date !== undefined)
    attrMap.set("Production Start Date", updates.production_start_date ?? "");
  if (updates.production_est_finish_date !== undefined)
    attrMap.set("Est. Production Finish", updates.production_est_finish_date ?? "");
  if (updates.delivery_date !== undefined)
    attrMap.set("Delivery Date", updates.delivery_date ?? "");
  if (updates.delivery_window !== undefined)
    attrMap.set("Delivery Window", updates.delivery_window);
  if (updates.delivery_notes !== undefined)
    attrMap.set("Delivery Notes", updates.delivery_notes);

  const note_attributes = Array.from(attrMap.entries()).map(([name, value]) => ({ name, value }));

  const orderPayload: Record<string, unknown> = { id: shopifyId, note_attributes };

  if (updates.notes !== undefined) {
    orderPayload.note = updates.notes;
  }

  // Merge, never replace. A bare assignment here discarded the vendor
  // tags (HCI Order, Waypoint) on every stage change.
  if (updates.stage !== undefined && currentTags !== null) {
    orderPayload.tags = mergeTags(currentTags, String(updates.stage));
  }

  const res = await fetch(
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

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Shopify ${res.status}: ${text}` };
  }
  return { ok: true };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data, error } = await supabase
    .from("orders")
    .select("*, order_activity(*)")
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const shaped = {
    ...data,
    activity: (data.order_activity ?? [])
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((a: { text: string; time: string }) => ({ text: a.text, time: a.time })),
    order_activity: undefined,
  };

  return NextResponse.json({ data: shaped });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  // Rate-limit per-user-ish (by IP) at the same shape as the listing route.
  // Heavier than GET because each PATCH can fan out to a Shopify writeback.
  const limited = await rateLimitOr429(req, 30, 60_000, "orders:patch");
  if (limited) return limited;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Load the current row up front ─────────────────────────────────────
  // Previously the handler did three separate SELECTs against `orders`:
  // one for stage validation, one for the Entered-attachment gate, one
  // for the production-date auto-advance branch. We do it once here and
  // reuse `currentStage` everywhere downstream. (The post-update read
  // for Shopify writeback at the bottom is unavoidable — that needs the
  // values AFTER the update has been applied.)
  const { data: currentRow } = await supabase
    .from("orders")
    .select("stage, type, payment_status, payment_hold_cleared_for, project_id, tracking_number")
    .eq("id", id)
    .single();
  if (!currentRow) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const currentStage: string = currentRow.stage;
  // The row's type decides WHICH stage ordering applies. Stage names are
  // shared across flows now, so every stage comparison below needs it.
  const currentType: string = currentRow.type ?? "order";

  // ── Stage validation & backward-PIN gate ──────────────────────────────
  // Mirrors `/api/orders/bulk` — the single-order PATCH previously accepted
  // any string for `body.stage` and skipped the admin-PIN check, so a
  // direct API call could bypass the modal's PIN dialog entirely.
  if (body.stage !== undefined) {
    if (typeof body.stage !== "string" || !ALLOWED_STAGES.has(body.stage)) {
      return NextResponse.json(
        { error: "Invalid stage value" },
        { status: 422 },
      );
    }
    // ALLOWED_STAGES is the UNION of every flow, so the check above accepts
    // a warranty stage on a custom order. Not hypothetical: on 2026-08-19
    // QUO-1787174567522 was moved to "Parts ordered" and stranded there --
    // no stage tab matched it and stageIndex returned -1.
    //
    // currentType comes from the DATABASE row, never from the body. A
    // client that could name its own type could name one whose flow
    // contains the stage it wanted.
    // ⚠ STILL BOTH, though they now agree for every type.
    //
    // They differed for SAMPLES until 2026-08-25: the index map pointed at the
    // five-stage cabinet flow while the real flow was three, so this route
    // would have accepted "In production" on a sample. The Entered -> Shipped
    // rename gave samples their own array and the gap closed.
    //
    // Both are kept because they ask different questions and could legitimately
    // diverge again -- one is an ORDERING for index maths, the other the LIST a
    // rail draws. A dev-time check in lib/stageLogic.ts now shouts if they stop
    // agreeing, so a future divergence surfaces there rather than here.
    if (!isStageAllowedForType(body.stage, currentType)
        || !isStageOfferedForType(body.stage, currentType)) {
      return NextResponse.json(
        {
          error: "stage_not_in_flow",
          message: `"${body.stage}" is not a stage in the ${currentType} flow`,
        },
        { status: 422 },
      );
    }
    if (isBackwardsMove(currentStage, body.stage, currentType)) {
      if (!verifyAdminPin(body.admin_pin)) {
        return NextResponse.json(
          { error: "admin_pin_required", message: "Backwards moves require admin PIN" },
          { status: 403 },
        );
      }
    }
  }

  // ── Server-side stage gate ────────────────────────────────────────────
  // Moving an order to "Entered" requires at least one attachment. This
  // matches the client-side gate in lib/stageGates.ts and prevents direct
  // API calls from bypassing the rule. Admin role override is NOT provided —
  // attachments are a hard requirement. Only fires on the New → Entered
  // transition (re-saving an already-Entered order with stage="Entered"
  // shouldn't re-check attachments).
  //
  // SAMPLES ARE EXEMPT. They ship from JK's own stock under the
  // "JK Cabinets 2 You" vendor, so there is no manufacturer
  // acknowledgment to attach. Keyed on the type read from the DB, not on
  // anything the client sends. Samples still have to be claimed.
  if (body.stage === "Entered" && currentStage === "New"
      && currentType !== "sample" && !body.override_ack) {
    const { data: attachments } = await supabase
      .from("order_attachments")
      .select("id")
      .eq("order_id", id)
      .limit(1);
    if (!(await orderAllVendorsGreen(id)) && (!attachments || attachments.length === 0)) {
      return NextResponse.json(
        { error: "Attach at least one file before marking this order as Entered" },
        { status: 400 },
      );
    }
  }

  // ── Delivery proof gate ─────────────────────────────────────
  // At cross dock -> Delivered needs the signed delivery receipt, which the
  // confirmation email already tells the customer they will sign.
  //
  // Looks for kind = 'proof_of_delivery' specifically. A plain attachment
  // count would pass on the Entered-stage ack PDFs and enforce nothing.
  //
  // Samples are exempt, as with the ack gate.
  //
  // The override needs a REASON and is checked here, not just in the UI --
  // otherwise it is decoration, which is exactly what override_ack is.
  // ── Payment hold ───────────────────────────────────────
  // financial_status already reaches us on orders/updated, so a refund is
  // known within seconds. Nothing acted on it until now: a refunded order
  // could move through Entered, production and delivery unnoticed.
  //
  // FORWARD moves only. A backward move, an archive or a date edit stays
  // open -- a refunded order usually needs walking BACK, and blocking that
  // would strand it exactly when someone is undoing the damage.
  //
  // The acknowledgement records WHICH status was cleared, so clearing
  // partially_refunded does not pre-clear a later full refund.
  const holdStatus = String(currentRow.payment_status ?? "");
  const holdCleared = String(currentRow.payment_hold_cleared_for ?? "");
  const holdActive =
    isPaymentHoldStatus(holdStatus)
    && holdCleared.trim().toLowerCase() !== holdStatus.trim().toLowerCase();

  let paymentHoldAck: string | null = null;
  if (holdActive) {
    const reason =
      typeof body.acknowledge_payment_hold === "string"
        ? cleanInput(body.acknowledge_payment_hold).trim().slice(0, 300)
        : "";
    if (reason) {
      paymentHoldAck = reason;
    } else if (
      typeof body.stage === "string"
      && body.stage !== currentStage
      && !isBackwardsMove(currentStage, body.stage, currentType)
    ) {
      return NextResponse.json(
        {
          error: "payment_hold",
          payment_status: holdStatus,
          message: paymentHoldLabel(holdStatus)
            + ". Acknowledge it with a reason before moving it forward.",
        },
        { status: 409 },
      );
    }
  }

  // ⚠ "Shipped" REQUIRES A TRACKING NUMBER, whichever direction you come from.
  //
  // The stage means "dispatched, and here is the proof". Allowing it without
  // one would make it a claim nobody can check -- and the public lookup reads
  // this to answer "where are my samples", so an unevidenced Shipped becomes a
  // wrong answer given to a customer.
  if (body.stage === "Shipped" && categoryHasTracking(currentType as OrderCategory)) {
    const incoming = typeof body.tracking_number === "string"
      ? cleanInput(body.tracking_number).trim()
      : "";
    if (!incoming && !currentRow.tracking_number) {
      return NextResponse.json(
        {
          error: "tracking_required",
          message: "Add the tracking number -- that is what marks this shipped.",
        },
        { status: 400 },
      );
    }
  }

  let deliveryOverrideReason: string | null = null;
  if (body.stage === "Delivered" && currentStage === "At cross dock"
      && currentType !== "sample") {
    const { data: receipts } = await supabase
      .from("order_attachments")
      .select("id")
      .eq("order_id", id)
      .eq("kind", "proof_of_delivery")
      .limit(1);
    if (!receipts || receipts.length === 0) {
      const reason =
        typeof body.override_delivery_proof === "string"
          ? cleanInput(body.override_delivery_proof).trim().slice(0, 300)
          : "";
      if (!reason) {
        return NextResponse.json(
          {
            error: "delivery_proof_required",
            message: "Attach the signed delivery receipt, or override with a reason.",
          },
          { status: 400 },
        );
      }
      deliveryOverrideReason = reason;
    }
  }

  // ── Tracking ─────────────────────────────────────────────────────────
  //
  // ⚠ ENTERING A TRACKING NUMBER IS WHAT MAKES A GROUP SHIPPED. Not a button:
  // the number is the evidence, so "Shipped" becomes a fact somebody can
  // answer a customer with. Same shape as production_start_date advancing a
  // cabinet order -- the data and the stage move together, so they cannot
  // disagree.
  //
  // Applies to samples and hardware only. Cabinets travel by freight to a
  // cross dock: there is no number to have, and trackingTargetStage returns
  // null for them.
  let trackingAdvancesTo: string | null = null;
  if (typeof body.tracking_number === "string") {
    const num = cleanInput(body.tracking_number).trim().slice(0, 100);
    const cat = currentType as OrderCategory;
    if (num && !categoryHasTracking(cat)) {
      return NextResponse.json(
        {
          error: "tracking_not_applicable",
          message: `${currentType} orders travel by freight to a cross dock -- there is no tracking number to record.`,
        },
        { status: 422 },
      );
    }
    // A number ADVANCES; clearing one does NOT move the row back. Undoing a
    // stage is a deliberate act with a PIN behind it, not a side effect of
    // correcting a typo.
    if (num) {
      const target = trackingTargetStage(cat);
      if (target && currentStage !== target && !body.stage) trackingAdvancesTo = target;
    }
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.tracking_number === "string") {
    updates.tracking_number = cleanInput(body.tracking_number).trim().slice(0, 100) || null;
  }
  if (typeof body.carrier === "string") {
    updates.carrier = cleanInput(body.carrier).trim().slice(0, 60) || null;
  }
  if (trackingAdvancesTo)          updates.stage      = trackingAdvancesTo;
  if (body.stage)                  updates.stage      = body.stage;
  // Bump stage_entered_at only when the stage ACTUALLY changes.
  //
  // This previously fired on `if (body.stage)` alone -- presence, not
  // change -- so a PATCH re-sending the current stage reset the order's
  // SLA clock. The DB trigger (trg_orders_bump_stage_entered_at) does
  // guard with NEW.stage IS DISTINCT FROM OLD.stage, but that only stops
  // the TRIGGER from writing the column: an explicit value in the SET
  // list from here lands in NEW and is written anyway. So the app was
  // overriding the safety net it credited.
  //
  // /api/orders/bulk has always skipped no-op moves; this matches it.
  if (body.stage && body.stage !== currentStage) {
    updates.stage_entered_at = new Date().toISOString();
  }
  // Auto-clear claim when order leaves New; set entered_by when moving to Entered
  if (body.stage && body.stage !== "New") updates.claimed_by = null;
  // entered_by stores the immutable username (not display name) so that
  // when users rename, the historical record still resolves correctly.
  if (body.stage === "Entered")    updates.entered_by = auth.session.user.id;  // team_members.id
  if (body.notes !== undefined)    updates.notes      = cleanInput(body.notes as string);
  if (body.internal_notes !== undefined) updates.internal_notes = cleanInput(body.internal_notes as string);
  if (body.archived !== undefined) updates.archived   = body.archived;
  if (body.member)                 updates.member     = body.member;
  if (body.door_style !== undefined) updates.door_style = cleanInput(body.door_style as string);
  if (body.color !== undefined)    updates.color      = cleanInput(body.color as string);
  if (body.sku_items !== undefined) updates.sku_items = body.sku_items;
  if (body.delivery_date !== undefined) updates.delivery_date = body.delivery_date;
  if (body.scheduled_delivery_date !== undefined) updates.scheduled_delivery_date = body.scheduled_delivery_date;
  if (body.delivery_window !== undefined) updates.delivery_window = cleanInput(body.delivery_window as string);
  if (body.delivery_notes !== undefined) updates.delivery_notes = cleanInput(body.delivery_notes as string);
  if (body.production_start_date !== undefined) updates.production_start_date = body.production_start_date;
  if (body.production_est_finish_date !== undefined) updates.production_est_finish_date = body.production_est_finish_date;
  if ("claimed_by" in body) updates.claimed_by = body.claimed_by ?? null;
  if (body.vendor !== undefined)          updates.vendor          = cleanInput(body.vendor as string);
  if (body.ship_to !== undefined)         updates.ship_to         = cleanInput(body.ship_to as string);
  if (body.customer_phone !== undefined)  updates.customer_phone  = cleanInput(body.customer_phone as string);
  if (body.customer_email !== undefined)  updates.customer_email  = cleanInput(body.customer_email as string);
  if (body.delivery_method !== undefined) updates.delivery_method = cleanInput(body.delivery_method as string);

  // ── Job total ────────────────────────────────────────────────────────
  //
  // total_price is only valid on a standalone row. A Shopify checkout has
  // ONE total and it lives on `projects`; putting a second copy on a group
  // would double-count any multi-group order the moment somebody sums the
  // column. orders_total_price_standalone_only enforces that in the
  // database -- this check exists so the caller gets a 422 that explains
  // itself rather than a 500 from a constraint name.
  if (body.total_price !== undefined) {
    if (currentRow.project_id) {
      return NextResponse.json(
        {
          error: "total_price_not_allowed",
          message: "This order belongs to a Shopify project; its total lives on the project.",
        },
        { status: 422 },
      );
    }
    const parsed = parseMoney(body.total_price);
    if (parsed === "invalid") {
      return NextResponse.json(
        { error: "total_price must be a non-negative number" },
        { status: 422 },
      );
    }
    updates.total_price = parsed;
  }

  // ── Auto-advance: Entered → In production ──────────────────────────────
  // When a user sets a production_start_date on an order in "Entered" stage,
  // the order auto-advances to "In production". This matches the operational
  // rule that setting the start date IS the act of committing the order to
  // production — no separate "move stage" click required.
  //
  // Guards:
  //   - Only fires when body.stage is NOT explicitly set (so an explicit
  //     stage change still wins).
  //   - Only fires when production_start_date is being set to a non-empty
  //     value (clearing the field shouldn't trigger a stage change).
  //   - Only fires when the order is currently in "Entered" (avoids
  //     re-triggering on later edits).
  let autoAdvancedTo: string | null = null;
  if (
    body.stage === undefined &&
    body.production_start_date !== undefined &&
    body.production_start_date !== null &&
    body.production_start_date !== "" &&
    currentStage === "Entered"
  ) {
    updates.stage = "In production";
    updates.stage_entered_at = new Date().toISOString();
    autoAdvancedTo = "In production";
  }

  // ── Backward moves: clear stale forward-progress dates ────────────────
  // E.g. moving At cross dock → In production clears the delivery date —
  // it won't actually be delivered on the date that was booked while the
  // order was cross-docked. Helper computes which fields go to null.
  //
  // Only apply to fields the request body didn't explicitly set, so a
  // caller that sends `{ stage: "Entered", delivery_date: "..." }` (rare
  // but possible) keeps its explicit value.
  let clearedFields: Record<string, string | null> | null = null;
  if (typeof body.stage === "string") {
    clearedFields = fieldsToClearOnBackwardMove(currentStage, body.stage, currentType);
    if (clearedFields) {
      for (const [k, v] of Object.entries(clearedFields)) {
        if (updates[k] === undefined) updates[k] = v;
      }
    }
  }

  const { error } = await supabase.from("orders").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let activityText = "";
  if (autoAdvancedTo) {
    // Production start date triggered an automatic stage advance.
    activityText = `Production start date set → moved to "${autoAdvancedTo}" by ${auth.session.user.name}`;
  }
  else if (body.stage) {
    activityText = `Moved to "${body.stage}" by ${auth.session.user.name}`;
    // When a backward move clears dates, append the list so the activity
    // log explains why the calendar suddenly looks different.
    const clearedNote = clearedFields ? describeFieldsCleared(clearedFields) : "";
    if (clearedNote) activityText += ` — cleared ${clearedNote}`;
  }
  else if (body.notes !== undefined)       activityText = `Notes updated by ${auth.session.user.name}`;
  else if (body.internal_notes !== undefined) activityText = `Internal notes updated by ${auth.session.user.name}`;
  else if (body.archived === true)         activityText = `Archived by ${auth.session.user.name}`;
  else if (body.archived === false)        activityText = `Restored by ${auth.session.user.name}`;
  else if (body.production_start_date !== undefined || body.production_est_finish_date !== undefined)
                                           activityText = `Production dates updated by ${auth.session.user.name}`;
  else if (body.delivery_date !== undefined || body.scheduled_delivery_date !== undefined)
                                           activityText = `Delivery scheduled by ${auth.session.user.name}`;
  else if (body.total_price !== undefined)
                                           activityText = updates.total_price === null
                                             ? `Job total cleared by ${auth.session.user.name}`
                                             : `Job total set to $${updates.total_price} by ${auth.session.user.name}`;
  else if ("claimed_by" in body) {
    // body.claimed_by is now a team_members.id. Resolve to display
    // name for the audit log; fall back to the raw id if the team
    // member has been deleted (unlikely but defensive).
    let claimDisplay = body.claimed_by ? String(body.claimed_by) : "";
    if (body.claimed_by) {
      const { data: tm } = await supabase
        .from("team_members")
        .select("name")
        .eq("id", body.claimed_by)
        .maybeSingle();
      if (tm?.name) claimDisplay = tm.name;
    }
    activityText = body.claimed_by
      ? `Order claimed by ${claimDisplay}`
      : `Order unclaimed by ${auth.session.user.name}`;
  }

  if (activityText) {
    await supabase.from("order_activity").insert({ order_id: id, text: activityText, time: today });
  }

  // A separate row, not appended to the stage-change text: an override is
  // its own event, and each one should leave its own trace. The name comes
  // from the session, never from the request body.
  // Its own write and its own activity row: acknowledging a refund is an
  // event in itself, and may happen without any stage change at all.
  if (paymentHoldAck) {
    await supabase.from("orders").update({
      payment_hold_cleared_for: holdStatus,
      payment_hold_cleared_at: new Date().toISOString(),
    }).eq("id", id);
    await supabase.from("order_activity").insert({
      order_id: id,
      text: `Payment hold (${holdStatus}) acknowledged by ${auth.session.user.name ?? auth.session.user.username} — ${paymentHoldAck}`,
      time: today,
    });
  }

  if (deliveryOverrideReason) {
    await supabase.from("order_activity").insert({
      order_id: id,
      text: `Delivery proof overridden by ${auth.session.user.name ?? auth.session.user.username} — ${deliveryOverrideReason}`,
      time: today,
    });
  }

  // Shopify writeback — unchanged
  const shouldSync =
    body.stage !== undefined ||
    body.notes !== undefined ||
    body.production_start_date !== undefined ||
    body.production_est_finish_date !== undefined ||
    body.delivery_date !== undefined ||
    body.delivery_window !== undefined ||
    body.delivery_notes !== undefined;

  if (shouldSync) {
    const { data: order } = await supabase
      .from("orders")
      .select("shopify_id, stage, notes, production_start_date, production_est_finish_date, delivery_date, delivery_window, delivery_notes")
      .eq("id", id)
      .single();

    if (order?.shopify_id) {
      const syncResult = await syncToShopify(order.shopify_id, {
        ...(body.stage !== undefined && { stage: order.stage }),
        ...(body.notes !== undefined && { notes: order.notes }),
        ...(body.production_start_date !== undefined && { production_start_date: order.production_start_date }),
        ...(body.production_est_finish_date !== undefined && { production_est_finish_date: order.production_est_finish_date }),
        ...(body.delivery_date !== undefined && { delivery_date: order.delivery_date }),
        ...(body.delivery_window !== undefined && { delivery_window: order.delivery_window }),
        ...(body.delivery_notes !== undefined && { delivery_notes: order.delivery_notes }),
      });

      return NextResponse.json({
        ok: true,
        shopify_synced: syncResult.ok,
        shopify_error: syncResult.ok ? undefined : syncResult.error,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE an order.
 *
 * Authorization: admins can delete anything. Non-admin members can delete only
 * manual orders that they themselves created — they cannot delete Shopify
 * orders, cron-synced records, quote-form submissions, or orders other team
 * members logged. This closes the previous gap where any authenticated user
 * could delete any non-Shopify order.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data: order } = await supabase
    .from("orders")
    .select("source, created_by")
    .eq("id", id)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const isAdmin = auth.session.user.role === "admin";

  if (!isAdmin) {
    // Non-admins may only delete manual orders that they themselves created
    if (order.source !== "Manual") {
      return NextResponse.json(
        { error: "Only admins can delete non-manual orders" },
        { status: 403 }
      );
    }
    if (order.created_by && order.created_by !== auth.session.user.username) {
      return NextResponse.json(
        { error: "You can only delete orders you created" },
        { status: 403 }
      );
    }
    // Legacy rows without created_by also fall to admin-only
    if (!order.created_by) {
      return NextResponse.json(
        { error: "Only admins can delete legacy orders" },
        { status: 403 }
      );
    }
  }

  await supabase.from("order_activity").delete().eq("order_id", id);
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit-log every deletion
  try {
    await supabase.from("audit_log").insert({
      event: "order_deleted",
      username: auth.session.user.username,
      details: { order_id: id, source: order.source },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, deleted_by: auth.session.user.username });
}
