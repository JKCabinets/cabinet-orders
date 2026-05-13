import { NextRequest, NextResponse } from "next/server";
import { requireAuth, sanitize } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getShopifyToken } from "@/lib/shopify";

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
  try {
    const getRes = await fetch(
      `https://${domain}/admin/api/2024-01/orders/${shopifyId}.json?fields=note_attributes,tags,note`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (getRes.ok) {
      const getJson = await getRes.json();
      currentAttributes = getJson.order?.note_attributes ?? [];
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

  if (updates.stage !== undefined) {
    orderPayload.tags = `JK Order, ${updates.stage}`;
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
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.stage)                  updates.stage      = body.stage;
  // Auto-clear claim when order leaves New; set entered_by when moving to Entered
  if (body.stage && body.stage !== "New") updates.claimed_by = null;
  if (body.stage === "Entered")    updates.entered_by = auth.session.user.name;
  if (body.notes !== undefined)    updates.notes      = sanitize(body.notes as string);
  if (body.internal_notes !== undefined) updates.internal_notes = sanitize(body.internal_notes as string);
  if (body.archived !== undefined) updates.archived   = body.archived;
  if (body.member)                 updates.member     = body.member;
  if (body.door_style !== undefined) updates.door_style = sanitize(body.door_style as string);
  if (body.color !== undefined)    updates.color      = sanitize(body.color as string);
  if (body.sku_items !== undefined) updates.sku_items = body.sku_items;
  if (body.delivery_date !== undefined) updates.delivery_date = body.delivery_date;
  if (body.scheduled_delivery_date !== undefined) updates.scheduled_delivery_date = body.scheduled_delivery_date;
  if (body.delivery_window !== undefined) updates.delivery_window = sanitize(body.delivery_window as string);
  if (body.delivery_notes !== undefined) updates.delivery_notes = sanitize(body.delivery_notes as string);
  if (body.production_start_date !== undefined) updates.production_start_date = body.production_start_date;
  if (body.production_est_finish_date !== undefined) updates.production_est_finish_date = body.production_est_finish_date;
  if ("claimed_by" in body) updates.claimed_by = body.claimed_by ?? null;
  if (body.vendor !== undefined)          updates.vendor          = sanitize(body.vendor as string);
  if (body.ship_to !== undefined)         updates.ship_to         = sanitize(body.ship_to as string);
  if (body.customer_phone !== undefined)  updates.customer_phone  = sanitize(body.customer_phone as string);
  if (body.customer_email !== undefined)  updates.customer_email  = sanitize(body.customer_email as string);
  if (body.delivery_method !== undefined) updates.delivery_method = sanitize(body.delivery_method as string);

  const { error } = await supabase.from("orders").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let activityText = "";
  if (body.stage)                          activityText = `Moved to "${body.stage}" by ${auth.session.user.name}`;
  else if (body.notes !== undefined)       activityText = `Notes updated by ${auth.session.user.name}`;
  else if (body.internal_notes !== undefined) activityText = `Internal notes updated by ${auth.session.user.name}`;
  else if (body.archived === true)         activityText = `Archived by ${auth.session.user.name}`;
  else if (body.archived === false)        activityText = `Restored by ${auth.session.user.name}`;
  else if (body.production_start_date !== undefined || body.production_est_finish_date !== undefined)
                                           activityText = `Production dates updated by ${auth.session.user.name}`;
  else if (body.delivery_date !== undefined) activityText = `Delivery scheduled by ${auth.session.user.name}`;
  else if ("claimed_by" in body)           activityText = body.claimed_by
    ? `Order claimed by ${body.claimed_by}`
    : `Order unclaimed by ${auth.session.user.name}`;

  if (activityText) {
    await supabase.from("order_activity").insert({ order_id: id, text: activityText, time: today });
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
