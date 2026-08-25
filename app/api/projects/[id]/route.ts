import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { STAGE_LIST_BY_TYPE, isPaymentHoldStatus, type OrderType } from "@/lib/data";

/**
 * PATCH /api/projects/[id] — archive or restore a whole purchase.
 *
 * ⚠ THE GATE: every group at the last stage of ITS OWN flow.
 *
 * Not "every group is Delivered" as a string match. The flows differ --
 * cabinets run five stages, samples three, hardware three of its own -- and a
 * string comparison would be a second copy of the stage maps. The terminal
 * stage is read from STAGE_LIST_BY_TYPE, the same map the rails draw from.
 *
 * A REFUNDED project may be archived regardless of stage. A refund on a
 * checkout whose cabinets never shipped means those groups will never reach
 * Delivered; a strict rule would strand it on the board forever, and the
 * refund IS the ending.
 *
 * ⚠ ENFORCED HERE, NOT IN THE UI. Hiding the button is not a gate -- the same
 * lesson as the delivery-proof check, which /api/orders/bulk skipped entirely
 * while the single-order path demanded a reason and an activity row. A rule
 * that only exists in a component is a rule anyone with the API can ignore.
 *
 * The GROUPS ARE NOT TOUCHED. `orders.archived` stays false on project-linked
 * rows; a group is hidden because its project is archived, resolved by lookup.
 * Writing both would be two copies of one fact.
 */

interface GroupRow {
  id: string;
  type: string;
  stage: string;
}

function terminalStage(type: string): string | undefined {
  const flow = STAGE_LIST_BY_TYPE[type as OrderType] as readonly string[] | undefined;
  return flow && flow.length > 0 ? flow[flow.length - 1] : undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 30, 60_000, "projects:patch");
  if (limited) return limited;

  const { id } = await params;

  let body: { archived?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "archived (boolean) required" }, { status: 422 });
  }
  const archived = body.archived;

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, payment_status, archived")
    .eq("id", id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Restoring needs no gate. Putting something back on the board is always
  // safe; it is taking it off that asserts the work is finished.
  if (archived) {
    const { data: groups, error: gErr } = await supabase
      .from("orders")
      .select("id, type, stage")
      .eq("project_id", id);

    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 });

    const rows = (groups ?? []) as GroupRow[];

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: "no_groups",
          message: "This project has no orders in it. Nothing to archive.",
        },
        { status: 422 },
      );
    }

    const refunded = isPaymentHoldStatus(project.payment_status);

    if (!refunded) {
      const unfinished = rows.filter((g) => {
        const last = terminalStage(g.type);
        // A type with no known flow cannot be proven finished. Refuse rather
        // than assume -- an unrecognised type is a bug, and archiving on the
        // strength of one hides it.
        return !last || g.stage !== last;
      });

      if (unfinished.length > 0) {
        return NextResponse.json(
          {
            error: "not_complete",
            message:
              `${unfinished.length} order(s) in this project are not finished yet: `
              + unfinished.map((g) => `${g.id} (${g.stage})`).join(", ")
              + ". Archive once every order is delivered, or if the project is refunded.",
            unfinished: unfinished.map((g) => ({ id: g.id, stage: g.stage })),
          },
          { status: 422 },
        );
      }
    }
  }

  const { data: updated, error: uErr } = await supabase
    .from("projects")
    .update({ archived, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Trail on the groups, not the project: order_activity has an order_id
  // foreign key and no project column, and this is a thing that happened to
  // every order in the purchase.
  const { data: groups } = await supabase
    .from("orders").select("id").eq("project_id", id);
  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });
  const rows = (groups ?? []).map((g) => ({
    order_id: g.id,
    text: `Project ${archived ? "archived" : "restored"} by ${auth.session.user.name}`,
    time: today,
  }));
  if (rows.length > 0) await supabase.from("order_activity").insert(rows);

  return NextResponse.json({ data: updated });
}
