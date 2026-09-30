import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, rateLimitOr429 } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { activityDate } from "@/lib/data";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/orders/[id]/specs -- save or remove ONE ROOM of a custom job's
 * specifications (handoff item 24, step 1; 2026-09-30).
 *
 *   { op: "save",   area: { id, name, sets }, base_rev: number | null }
 *   { op: "remove", area_id: string,          base_rev: number }
 *
 * `base_rev` is the room's revision as the caller loaded it; null means a room
 * that has never been saved.
 *
 * ⚠ WHY THIS IS NOT A FIELD ON PATCH /api/orders/[id] ANY MORE. That route took
 * the whole document and wrote it. Proven on 2026-09-30 against the real panel:
 * "Save room" sent every room, a refused save reverted every room, a removed
 * room could not be saved on its own, and nothing noticed a stale write. The
 * work now happens in public.custom_specs_save_area / _remove_area
 * (migrations/2026-09-30-custom-specs-rooms.sql), which lock the row, check the
 * ROOM's revision, merge, and unlink the files of anything removed -- in one
 * transaction. PostgREST has no multi-statement transactions; a function is the
 * only way to get one. PATCH now refuses `custom_specs` so a tab still running
 * the old panel cannot write around this.
 *
 * ⚠ THE GUARDS STAY HERE, NOT ONLY IN THE FUNCTION. Archived and claimed are
 * answered first with the same refusals every other write route gives, and an
 * admin acting over somebody's claim reaches the trail through
 * withClaimOverrideLog only when the save succeeds. The function re-checks
 * type and archived under its row lock; that is its own guarantee, not a
 * replacement for these.
 */

/** Trim every string the room carries; pass everything else through UNTOUCHED.
 *  Rebuilding the object from known keys would drop an unknown one silently --
 *  the database function refuses it instead and says which. */
function trimStrings(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(trimStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trimStrings(v)]));
  }
  return value;
}

const isRev = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 2147483647;

type SpecsResult =
  | { result: "ok"; specs: unknown; area: { name?: string; rev?: number }; unlinked: number }
  | { result: "conflict"; current: unknown; specs: unknown }
  | { result: "invalid"; problem: string }
  | { result: "not_found" | "not_custom" | "archived" };

const roomName = (area: { name?: string } | null | undefined) =>
  area?.name && area.name.trim() ? `"${area.name}"` : "(untitled room)";

const filesNote = (n: number) =>
  n > 0 ? ` — ${n} file${n === 1 ? "" : "s"} no longer filed under it` : "";

// ⚠ WRAPPED so an admin's override of a claim reaches the trail only if this
// save succeeds. See ClaimOverrideLog in lib/auth.
export const POST = withClaimOverrideLog(async function POST(
  overrides: ClaimOverrideLog,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "orders:specs");
  if (limited) return limited;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── The request's shape, before anything is read ─────────────────────────
  const op = body.op;
  if (op !== "save" && op !== "remove") {
    return NextResponse.json({ error: "op must be \"save\" or \"remove\"" }, { status: 422 });
  }
  if (op === "save") {
    if (!body.area || typeof body.area !== "object" || Array.isArray(body.area)) {
      return NextResponse.json({ error: "area (object) required" }, { status: 422 });
    }
    if (body.base_rev !== null && !isRev(body.base_rev)) {
      return NextResponse.json({ error: "base_rev must be null (a new room) or the room's revision" }, { status: 422 });
    }
  } else {
    if (typeof body.area_id !== "string" || !body.area_id) {
      return NextResponse.json({ error: "area_id required" }, { status: 422 });
    }
    if (!isRev(body.base_rev)) {
      return NextResponse.json({ error: "base_rev must be the room's revision" }, { status: 422 });
    }
  }

  // ── The row: custom only, not archived, and yours to edit ─────────────────
  const { data: order } = await supabase
    .from("orders")
    .select("id, type, archived, project_id")
    .eq("id", id)
    .single();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // A Shopify group's specification comes decoded from its SKUs, and a
  // warranty claim is about work already done. Same refusal PATCH gave.
  if (order.type !== "custom") {
    return NextResponse.json(
      { error: "custom_specs_not_allowed", message: `Specifications belong to custom jobs; ${id} is a ${order.type} order.` },
      { status: 422 },
    );
  }

  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);

  const claimGate = await requireOrderClaim(id, auth.session, overrides, "Job specifications edited");
  if (claimGate instanceof NextResponse) return claimGate;

  // ── The function does the work, under a row lock ─────────────────────────
  const { data, error } = op === "save"
    ? await supabase.rpc("custom_specs_save_area", {
        p_order_id: id, p_area: trimStrings(body.area), p_base_rev: body.base_rev,
      })
    : await supabase.rpc("custom_specs_remove_area", {
        p_order_id: id, p_area_id: String(body.area_id).trim(), p_base_rev: body.base_rev,
      });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "No answer from the database" }, { status: 500 });
  }
  const r = data as SpecsResult;

  switch (r.result) {
    case "ok": {
      const who = auth.session.user.name ?? auth.session.user.username;
      const verb = op === "remove" ? "removed" : body.base_rev === null ? "added" : "saved";
      await supabase.from("order_activity").insert({
        order_id: id,
        text: `Room ${roomName(r.area)} ${verb} by ${who}${filesNote(r.unlinked)}`,
        time: activityDate(),
      });
      return NextResponse.json({ ok: true, data: { custom_specs: r.specs, area: r.area, unlinked: r.unlinked } });
    }
    case "conflict":
      // ⚠ 409 WITH THE STORED ROOM, so the panel can show what is actually
      // there instead of the draft that lost. `current` null: the room is gone.
      return NextResponse.json(
        {
          error: "specs_conflict",
          message: r.current
            ? "This room was changed by someone else since you opened it. Their version is shown; your edits to it were not saved."
            : "This room was removed by someone else since you opened it.",
          current: r.current,
          custom_specs: r.specs,
        },
        { status: 409 },
      );
    case "invalid":
      return NextResponse.json(
        { error: "custom_specs_invalid", message: `These specifications could not be saved: ${r.problem}.` },
        { status: 422 },
      );
    case "not_found":
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    case "not_custom":
      return NextResponse.json({ error: "custom_specs_not_allowed" }, { status: 422 });
    case "archived":
      // Archived between the check above and the lock. Same refusal.
      return archivedReadOnly(order, "row");
    default:
      return NextResponse.json({ error: "Unexpected answer from the database" }, { status: 500 });
  }
});
