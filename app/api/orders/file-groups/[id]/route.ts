/**
 * PATCH  /api/orders/file-groups/[id] { name }  rename a group
 * DELETE /api/orders/file-groups/[id]           delete it WITH ITS FILES
 * (2026-10-27, item 8 step 5; Garrett: deleting a group deletes its files,
 * after a prompt -- the prompt is the client's; this is the deed.)
 *
 * ⚠ A ROOM'S OR STYLE GROUP'S GROUP FOLLOWS ITS ROOM. Renaming or deleting it
 * here is refused (follows_room): the next save of the room would overwrite a
 * name typed here, and deleting a room is how its group and files go.
 *
 * ⚠ ROWS FIRST, THEN STORAGE: delete_file_group removes the rows and the group
 * in one transaction and returns the paths; the stored files are removed after.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, rateLimitOr429 } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { activityDate } from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { cleanGroupName, GROUP_NAME_MAX, removeStoredFiles } from "@/lib/fileGroups";

type GroupRow = { id: number; order_id: string; name: string; role: string | null };

const FOLLOWS_ROOM = (verb: string) => NextResponse.json({ error: "follows_room",
  message: `This group is named after a room in Custom Job Specs; ${verb} the room there.` }, { status: 422 });

/** The group, its order, and the gates every change to it passes. */
async function gate(req: NextRequest, idParam: string, overrides: ClaimOverrideLog, action: string, limitKey: string) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, limitKey);
  if (limited) return limited;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  const { data: group, error: gErr } = await supabase
    .from("order_file_groups").select("id, order_id, name, role").eq("id", id).maybeSingle();
  if (gErr) return NextResponse.json({ error: "group_unavailable", message: "Could not read the group. Try again." }, { status: 500 });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  const g = group as GroupRow;
  const { data: order, error: orderErr } = await supabase
    .from("orders").select("id, archived, project_id").eq("id", g.order_id).maybeSingle();
  if (orderErr) return NextResponse.json({ error: "order_unavailable", message: "Could not read the order. Try again." }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);
  const claimGate = await requireOrderClaim(g.order_id, auth.session, overrides, action);
  if (claimGate instanceof NextResponse) return claimGate;
  return { auth, g };
}

export const PATCH = withClaimOverrideLog(async function PATCH(
  overrides: ClaimOverrideLog, req: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const gated = await gate(req, id, overrides, "File group renamed", "file-groups:patch");
  if (gated instanceof NextResponse) return gated;
  const { auth, g } = gated;
  if (g.role === "area") return FOLLOWS_ROOM("rename");
  const name = cleanGroupName(body.name);
  if (!name) {
    return NextResponse.json({ error: "group_name_invalid",
      message: `A group needs a name of 1 to ${GROUP_NAME_MAX} characters.` }, { status: 422 });
  }
  if (name === g.name) return NextResponse.json({ data: g });
  const { data: others, error: listErr } = await supabase
    .from("order_file_groups").select("id, name").eq("order_id", g.order_id);
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if ((others ?? []).some((o: { id: number; name: string }) => o.id !== g.id && o.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "group_name_taken",
      message: `This order already has a group named \u201c${name}\u201d.` }, { status: 409 });
  }
  const { error } = await supabase.from("order_file_groups").update({ name }).eq("id", g.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const who = auth.session.user.name ?? auth.session.user.username;
  await supabase.from("order_activity").insert({
    order_id: g.order_id, text: `File group \u201c${g.name}\u201d renamed to \u201c${name}\u201d by ${who}`, time: activityDate(),
  });
  return NextResponse.json({ data: { ...g, name } });
});

export const DELETE = withClaimOverrideLog(async function DELETE(
  overrides: ClaimOverrideLog, req: NextRequest, { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gated = await gate(req, id, overrides, "File group deleted", "file-groups:delete");
  if (gated instanceof NextResponse) return gated;
  const { auth, g } = gated;
  if (g.role === "area") return FOLLOWS_ROOM("delete");
  const { data, error } = await supabase.rpc("delete_file_group", { p_order_id: g.order_id, p_group_id: g.id });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "No answer from the database" }, { status: 500 });
  const r = data as { result: string; removed_files?: string[] };
  if (r.result === "not_found") return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (r.result === "follows_room") return FOLLOWS_ROOM("delete");
  if (r.result !== "ok") return NextResponse.json({ error: "Unexpected answer from the database" }, { status: 500 });
  const paths = Array.isArray(r.removed_files) ? r.removed_files : [];
  await removeStoredFiles(paths);
  const who = auth.session.user.name ?? auth.session.user.username;
  const n = paths.length;
  await supabase.from("order_activity").insert({
    order_id: g.order_id,
    text: `File group \u201c${g.name}\u201d deleted by ${who}${n > 0 ? ` (${n} file${n === 1 ? "" : "s"} deleted with it)` : ""}`,
    time: activityDate(),
  });
  return NextResponse.json({ ok: true, removed: n });
});
