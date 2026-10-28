import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, rateLimitOr429 } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { supabase } from "@/lib/supabase";
import { activityDate } from "@/lib/data";

// GET /api/orders/attachments/[id] — get signed download URL
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "attachments:download");
  if (limited) return limited;
  const { id } = await params;

  const { data: attachment, error: fetchError } = await supabase
    .from("order_attachments")
    .select("file_path, file_name")
    .eq("id", id)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const { data: signedUrl, error: urlError } = await supabase.storage
    .from("order-attachments")
    .createSignedUrl(attachment.file_path, 60 * 5); // 5 min expiry

  if (urlError) return NextResponse.json({ error: urlError.message }, { status: 500 });
  return NextResponse.json({ url: signedUrl.signedUrl, fileName: attachment.file_name });
}

// DELETE /api/orders/attachments/[id] — delete attachment
// ⚠ WRAPPED so an admin's override of a claim reaches the trail only if the
// delete succeeds. See ClaimOverrideLog in lib/auth.
export const DELETE = withClaimOverrideLog(async function DELETE(
  overrides: ClaimOverrideLog,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  // Deletes are irreversible and touch both storage and DB. Rate-limit
  // matches the upload limit so an attacker can't sweep the bucket faster
  // than they can fill it.
  const limited = await rateLimitOr429(req, 20, 60_000, "attachments:delete");
  if (limited) return limited;
  const { id } = await params;

  const { data: attachment, error: fetchError } = await supabase
    .from("order_attachments")
    .select("file_path, file_name, order_id, uploaded_by")
    .eq("id", id)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // ⚠ ARCHIVED IS READ-ONLY (2026-09-16). Removing a receipt from archived
  // work is editing the record of what happened. The row is loaded here only
  // for that question -- everything else this route needs is on the
  // attachment.
  //
  // ⚠ AND A READ THAT FAILS REFUSES (2026-10-19). This asked only `if (order)`,
  // so a failed read -- a timeout, a dropped connection -- skipped the check,
  // and if the claim gate's own read then worked, the file and its row were
  // deleted from archived work: shown, with the read failing once. Refused as
  // purchaseOf refuses an unreadable purchase, and for its reason. A missing
  // order is a 404, told apart from a failure by maybeSingle.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, archived, project_id")
    .eq("id", attachment.order_id)
    .maybeSingle();
  if (orderErr) {
    return NextResponse.json(
      {
        error: "order_unavailable",
        message: "Could not read the order this file belongs to, so nothing was deleted. Try again.",
      },
      { status: 500 },
    );
  }
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);

  // ⚠ GATED LIKE AN UPLOAD, not more strictly. Removing a signed receipt
  // from another member's claimed row is precisely the crossed-wires case
  // claims exist for; a second, stricter rule here would be a second thing
  // to keep in sync for no gain.
  const claimGate = await requireOrderClaim(attachment.order_id, auth.session, overrides, "Attachment deleted");
  if (claimGate instanceof NextResponse) return claimGate;

  // Delete from storage (best effort — if it fails we still remove the DB
  // row so the UI doesn't keep showing a phantom attachment)
  await supabase.storage.from("order-attachments").remove([attachment.file_path]);

  // Delete from DB
  const { error } = await supabase.from("order_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit-log every deletion. Useful when an attachment goes missing and we
  // need to know who removed it. Deletes ARE restricted by ownership now
  // (see the claim gate above), but that answers WHETHER and this answers
  // WHO -- including for the owner, whom the gate lets through.
  try {
    await supabase.from("audit_log").insert({
      event: "attachment_deleted",
      username: auth.session.user.username,
      details: {
        attachment_id: id,
        order_id: attachment.order_id,
        file_name: attachment.file_name,
        original_uploader: attachment.uploaded_by,
      },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true });
});

/**
 * PATCH /api/orders/attachments/[id] { group_id } -- move a file to another
 * group on the SAME order (2026-10-27, item 8 step 5). The same gates as a
 * delete. A receipt may move between groups -- its KIND is what the delivery
 * gate reads -- but not into a room's group: it belongs to the order.
 */
export const PATCH = withClaimOverrideLog(async function PATCH(
  overrides: ClaimOverrideLog,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "attachments:patch");
  if (limited) return limited;
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const target = Number(body.group_id);
  if (!Number.isInteger(target) || target <= 0) return NextResponse.json({ error: "group_id required" }, { status: 422 });

  const { data: attachment, error: fetchError } = await supabase
    .from("order_attachments").select("id, order_id, file_name, kind, group_id").eq("id", id).maybeSingle();
  if (fetchError) return NextResponse.json({ error: "attachment_unavailable", message: "Could not read the file. Try again." }, { status: 500 });
  if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const { data: order, error: orderErr } = await supabase
    .from("orders").select("id, archived, project_id").eq("id", attachment.order_id).maybeSingle();
  if (orderErr) return NextResponse.json({ error: "order_unavailable", message: "Could not read the order this file belongs to, so nothing was moved. Try again." }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);
  const claimGate = await requireOrderClaim(attachment.order_id, auth.session, overrides, "Attachment moved");
  if (claimGate instanceof NextResponse) return claimGate;

  const { data: group, error: gErr } = await supabase
    .from("order_file_groups").select("id, order_id, name, role").eq("id", target).maybeSingle();
  if (gErr) return NextResponse.json({ error: "group_unavailable", message: "Could not read the group. Try again." }, { status: 500 });
  if (!group || group.order_id !== attachment.order_id) {
    return NextResponse.json({ error: "group_unknown", message: "That group is not on this order any more. Reload to see its groups." }, { status: 422 });
  }
  if ((group.role === "area" || group.role === "set") && attachment.kind !== "general") {
    return NextResponse.json({ error: "group_kind", message: "A delivery receipt or a customer's file belongs to the order, not to a room." }, { status: 422 });
  }
  if (group.id === attachment.group_id) return NextResponse.json({ ok: true });
  const { error } = await supabase.from("order_attachments").update({ group_id: group.id }).eq("id", attachment.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const who = auth.session.user.name ?? auth.session.user.username;
  await supabase.from("order_activity").insert({
    order_id: attachment.order_id, text: `\u201c${attachment.file_name}\u201d moved to \u201c${group.name}\u201d by ${who}`, time: activityDate(),
  });
  return NextResponse.json({ ok: true });
});
