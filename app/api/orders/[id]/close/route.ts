import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { activityDate } from "@/lib/data";
import { removeOrderFiles, removeClaimSubmissionPhotos } from "@/lib/orderFiles";
import { pushClaimNotes } from "@/lib/claimHelpScout";

/**
 * POST /api/orders/[id]/close -- close a warranty claim (Garrett, 2026-10-13).
 *
 *   { "outcome": "approved" }                    archived, everything kept
 *   { "outcome": "denied", "reason": "..." }     archived, its FILES REMOVED;
 *                                                the reason is required
 *
 * ⚠ A CLAIM IS CLOSED, NEVER DELETED. It is the record of what a customer
 * reported and what we decided, and its submission keeps pointing at it.
 * DELETE refuses claims; this is the only way into the archive for one.
 * Restoring it (PATCH archived:false) reopens it.
 *
 * Who may: whoever may change the claim -- its claimer, or an admin, recorded
 * (requireOrderClaim). Help Scout hears of it through the queue: the
 * orders_claim_close_note trigger queues the note; this route only sends it.
 */

const REASON_MAX = 2000;

export const POST = withClaimOverrideLog(async function POST(
  overrides,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: { outcome?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const outcome = body.outcome;
  if (outcome !== "approved" && outcome !== "denied") {
    return NextResponse.json({ error: "outcome_required", message: "Close it as approved or denied." }, { status: 422 });
  }
  const reason = cleanInput(body.reason ?? "").slice(0, REASON_MAX);
  if (outcome === "denied" && !reason) {
    return NextResponse.json({ error: "reason_required", message: "Say why the claim is denied." }, { status: 422 });
  }

  const { data: order } = await supabase
    .from("orders").select("id, type, archived, claim_outcome").eq("id", id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.type !== "warranty") {
    return NextResponse.json({ error: "not_a_claim", message: "Only a warranty claim is closed this way." }, { status: 422 });
  }
  if (order.archived || order.claim_outcome) {
    return NextResponse.json({ error: "already_closed", message: "This claim is already closed. Restore it from the archive to reopen it." }, { status: 409 });
  }

  const gate = await requireOrderClaim(id, auth.session, overrides, "Closed");
  if (gate instanceof NextResponse) return gate;

  // ⚠ DENIED: THE FILES GO, BOTH COPIES, STORAGE FIRST. A promoted claim's
  // photos were COPIED into its attachments; the originals stay with the
  // submission. Removing one copy would keep the photos. A failure here leaves
  // the claim open and whole -- close it again.
  let filesRemoved = 0;
  if (outcome === "denied") {
    const files = await removeOrderFiles([id]);
    if (!files.ok) return NextResponse.json({ error: files.error }, { status: 500 });
    const photos = await removeClaimSubmissionPhotos(id);
    if (!photos.ok) return NextResponse.json({ error: photos.error }, { status: 500 });
    const { error: rowsError } = await supabase.from("order_attachments").delete().eq("order_id", id);
    if (rowsError) return NextResponse.json({ error: `failed to clear attachments: ${rowsError.message}` }, { status: 500 });
    filesRemoved = files.removed + photos.removed;
  }

  const who = auth.session.user.name || auth.session.user.username;
  const now = new Date().toISOString();
  // Only if still open: two closes at once must not both write an outcome.
  const { data: closed, error } = await supabase
    .from("orders")
    .update({ archived: true, archived_at: now, claim_outcome: outcome, closed_at: now, closed_by: who, closed_reason: reason || null })
    .eq("id", id).is("claim_outcome", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!closed || closed.length === 0) {
    return NextResponse.json({ error: "already_closed", message: "Someone closed this claim a moment ago." }, { status: 409 });
  }

  await supabase.from("order_activity").insert({
    order_id: id,
    text: `Closed \u2014 ${outcome === "denied" ? "Denied" : "Approved"} by ${who}${reason ? `: ${reason}` : ""}`
      + (outcome === "denied" && filesRemoved > 0 ? ` (${filesRemoved} file${filesRemoved === 1 ? "" : "s"} removed)` : ""),
    time: activityDate(),
  });
  // Not awaited; the 15-minute sweep sends whatever this does not.
  pushClaimNotes({ orderId: id }).catch((e) => console.error(`[helpscout] closing ${id}: ${(e as Error).message}`));
  try {
    await supabase.from("audit_log").insert({
      event: "claim_closed", username: auth.session.user.username,
      details: { order_id: id, outcome, files_removed: filesRemoved },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, outcome, closed_by: who, closed_at: now, files_removed: filesRemoved });
});
