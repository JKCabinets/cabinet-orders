import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin, sanitize } from "@/lib/auth";
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

  // Merge our fields into the existing note_attributes
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

  // Build the order payload
  const orderPayload: Record<string, unknown> = { id: shopifyId, note_attributes };

  // Also update the Shopify order note if our notes field changed
  if (updates.notes !== undefined) {
    orderPayload.note = updates.notes;
  }

  // Tag the order with the current stage for easy filtering in Shopify
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
  if (body.notes !== undefined)    updates.notes      = sanitize(body.notes as string);
  if (body.archived !== undefined) updates.archived   = body.archived;
  if (body.member)                 updates.member     = body.member;
  if (body.door_style !== undefined) updates.door_style = sanitize(body.door_style as string);
  if (body.color !== undefined)    updates.color      = sanitize(body.color as string);
  if (body.sku_items !== undefined) updates.sku_items = body.sku_items;
  if (body.delivery_date !== undefined) updates.delivery_date = body.delivery_date;
  if (body.delivery_window !== undefined) updates.delivery_window = sanitize(body.delivery_window as string);
  if (body.delivery_notes !== undefined) updates.delivery_notes = sanitize(body.delivery_notes as string);
  if (body.production_start_date !== undefined) updates.production_start_date = body.production_start_date;
  if (body.production_est_finish_date !== undefined) updates.production_est_finish_date = body.production_est_finish_date;

  const { error } = await supabase.from("orders").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let activityText = "";
  if (body.stage)                          activityText = `Moved to "${body.stage}" by ${auth.session.user.name}`;
  else if (body.notes !== undefined)       activityText = `Notes updated by ${auth.session.user.name}`;
  else if (body.archived === true)         activityText = `Archived by ${auth.session.user.name}`;
  else if (body.archived === false)        activityText = `Restored by ${auth.session.user.name}`;
  else if (body.production_start_date !== undefined || body.production_est_finish_date !== undefined)
                                           activityText = `Production dates updated by ${auth.session.user.name}`;
  else if (body.delivery_date !== undefined) activityText = `Delivery scheduled by ${auth.session.user.name}`;

  if (activityText) {
    await supabase.from("order_activity").insert({ order_id: id, text: activityText, time: today });
  }

  // ── Shopify writeback ──────────────────────────────────────────────────────
  // Sync back to Shopify for any field that Shopify should know about.
  // Skip archived changes (those come FROM Shopify) and internal-only fields.
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data: order } = await supabase
    .from("orders")
    .select("source")
    .eq("id", id)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (order.source === "Shopify" && auth.session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete Shopify orders" }, { status: 403 });
  }

  await supabase.from("order_activity").delete().eq("order_id", id);
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted_by: auth.session.user.username });
}
