/**
 * POST /api/orders/file-groups { orderId, name } -- a group people make
 * (2026-10-27, item 8 step 5). The name is 1-80 characters and unique on the
 * order (case aside); the same gates as an upload: not archived, and the
 * order's claim (or a logged override). Written to the trail.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, rateLimitOr429 } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { activityDate } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { cleanGroupName, GROUP_NAME_MAX } from "@/lib/fileGroups";

const ORDER_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

export const POST = withClaimOverrideLog(async function POST(overrides: ClaimOverrideLog, req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "file-groups:post");
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!ORDER_ID_RE.test(orderId)) return NextResponse.json({ error: "orderId required" }, { status: 422 });
  const name = cleanGroupName(body.name);
  if (!name) {
    return NextResponse.json({ error: "group_name_invalid",
      message: `A group needs a name of 1 to ${GROUP_NAME_MAX} characters.` }, { status: 422 });
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders").select("id, archived, project_id").eq("id", orderId).maybeSingle();
  if (orderErr) {
    return NextResponse.json({ error: "order_unavailable",
      message: "Could not read the order, so no group was made. Try again." }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);
  const claimGate = await requireOrderClaim(orderId, auth.session, overrides, "File group created");
  if (claimGate instanceof NextResponse) return claimGate;

  const { data: existing, error: listErr } = await supabase
    .from("order_file_groups").select("id, name").eq("order_id", orderId);
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if ((existing ?? []).some((g: { name: string }) => g.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "group_name_taken",
      message: `This order already has a group named \u201c${name}\u201d.` }, { status: 409 });
  }

  const who = auth.session.user.name ?? auth.session.user.username;
  const { data: group, error } = await supabase
    .from("order_file_groups").insert({ order_id: orderId, name, created_by: who }).select().single();
  if (error || !group) return NextResponse.json({ error: error?.message ?? "No group returned" }, { status: 500 });
  await supabase.from("order_activity").insert({
    order_id: orderId, text: `File group \u201c${name}\u201d created by ${who}`, time: activityDate(),
  });
  return NextResponse.json({ data: group }, { status: 201 });
});
