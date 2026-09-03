import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { createWarranty } from "@/lib/createWarranty";

/**
 * POST /api/claim-submissions/[id]/promote — turn a public submission into a
 * warranty claim.
 *
 * ⚠ A HUMAN CHOOSES THE GROUP, AND THAT IS THE WHOLE REASON THIS IS A ROUTE
 *   AND NOT A TRIGGER. The customer typed an order number, which normalises to
 *   a PROJECT. A claim is about a GROUP, because the 48-hour window runs from
 *   a delivery and deliveries are per group. A checkout of cabinets plus
 *   samples has two, delivered at different times, and nothing in the
 *   submission says which one arrived damaged. Guessing "the cabinets" would
 *   be right most of the time, which is worse than asking.
 *
 * ⚠ received_at BECOMES reported_at HERE. That carry is the point of the
 *   staging table: a claim submitted Thursday evening and promoted Monday
 *   morning was reported THURSDAY, and Terms 12.3 makes the reporting windows
 *   conditions precedent. Nothing else writes reported_at.
 */

const PHOTO_BUCKET = "claim-photos";
const ATTACHMENT_BUCKET = "order-attachments";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 20, 60_000, "claims:promote");
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid submission id" }, { status: 422 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const aboutOrderId = String(body.about_order_id ?? "").trim();
  if (!aboutOrderId) {
    return NextResponse.json(
      {
        error: "about_order_id_required",
        message: "Choose which order group this claim is about.",
      },
      { status: 422 },
    );
  }

  const { data: sub, error: subErr } = await supabase
    .from("claim_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  if (!sub) return NextResponse.json({ error: "submission not found" }, { status: 404 });

  // ⚠ ONLY FROM `new`. Promoting twice would create a second claim from one
  // report, and the second would carry the same reported_at -- two rows both
  // claiming to be the thing the customer sent once.
  if (sub.status !== "new") {
    return NextResponse.json(
      {
        error: "already_resolved",
        message: `This submission is already ${sub.status}`
          + (sub.promoted_to_order_id ? ` (${sub.promoted_to_order_id}).` : "."),
      },
      { status: 409 },
    );
  }

  // The claim's working notes: what the customer actually said, kept verbatim
  // rather than summarised, because it is the report.
  const notesParts = [
    `📮 CUSTOMER CLAIM — submitted ${new Date(sub.received_at).toLocaleString("en-US", { timeZone: "America/Phoenix" })}`,
    `Type: ${sub.claim_type}`,
    `Order as typed: ${sub.order_number_raw}`,
  ];
  if (sub.delivered_on)   notesParts.push(`Delivered on: ${sub.delivered_on}`);
  if (sub.claimant_phone) notesParts.push(`Phone: ${sub.claimant_phone}`);
  if (sub.policy_version) notesParts.push(`Policy version: ${sub.policy_version}`);
  if (sub.message)        notesParts.push(`\n${sub.message}`);

  const created = await createWarranty({
    aboutOrderId,
    name: sub.claimant_name,
    detail: `${sub.claim_type} claim`,
    notes: notesParts.join("\n"),
    createdBy: auth.session.user.username,
    claimantName: sub.claimant_name,
    claimantEmail: sub.claimant_email,
    // The carry. See the header.
    reportedAt: sub.received_at,
    source: "Manual",
    activityText: `Promoted from customer claim submission by ${auth.session.user.name}`,
  });

  if (!created.ok) {
    return NextResponse.json(
      { error: created.error, message: created.message },
      { status: created.status },
    );
  }

  const claimId = created.order.id as string;

  // ── Photos ───────────────────────────────────────────────────────────────
  //
  // Copied into the attachments bucket rather than referenced where they are:
  // order_attachments has no bucket column, so a path pointing into
  // claim-photos would be indistinguishable from one pointing at an
  // order-attachments object, and the signed-URL minting would look in the
  // wrong place.
  //
  // ⚠ A FAILED PHOTO NEVER FAILS THE PROMOTION. The claim is the thing with a
  // deadline. Every failure is written to the activity log so it is visible
  // rather than merely absent.
  const paths: string[] = Array.isArray(sub.photo_paths) ? sub.photo_paths : [];
  let copied = 0;
  for (const path of paths) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(PHOTO_BUCKET).download(path);
      if (dlErr || !blob) throw new Error(dlErr?.message ?? "download failed");

      const fileName = String(path).split("/").pop() ?? "photo";
      const dest = `${claimId}/${fileName}`;
      const bytes = await blob.arrayBuffer();

      const { error: upErr } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(dest, bytes, { contentType: blob.type || "image/jpeg", upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { error: rowErr } = await supabase.from("order_attachments").insert({
        order_id: claimId,
        file_name: cleanInput(fileName),
        file_path: dest,
        file_size: bytes.byteLength,
        file_type: blob.type || "image/jpeg",
        uploaded_by: "Customer (claim form)",
        // 'general', not 'proof_of_delivery'. A customer's photo of damage is
        // not a signed delivery receipt, and the cross-dock gate counts the
        // latter specifically.
        kind: "general",
      });
      if (rowErr) throw new Error(rowErr.message);
      copied++;
    } catch (e) {
      await supabase.from("order_activity").insert({
        order_id: claimId,
        text: `⚠️ Photo "${cleanInput(String(path))}" could not be attached: `
          + cleanInput(e instanceof Error ? e.message : "unknown error"),
        time: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Phoenix" }),
      });
    }
  }

  // ── Mark the submission, last ────────────────────────────────────────────
  //
  // ⚠ AFTER the claim exists. If this ran first and the insert then failed,
  // the submission would read `promoted` with nothing to point at, and it
  // would drop out of the triage queue -- a customer's claim lost silently,
  // which is the worst outcome available here.
  const { error: markErr } = await supabase
    .from("claim_submissions")
    .update({
      status: "promoted",
      promoted_to_order_id: claimId,
      promoted_at: new Date().toISOString(),
      promoted_by: auth.session.user.username,
    })
    .eq("id", id)
    // Only if still `new`, so two simultaneous promotions cannot both mark it.
    .eq("status", "new");

  if (markErr) {
    // The claim exists and is correct; only the bookkeeping failed. Say so
    // rather than implying the promotion did not happen.
    return NextResponse.json({
      data: created.order,
      photos_attached: copied,
      warning: `Claim ${claimId} was created, but the submission could not be `
        + `marked as promoted: ${markErr.message}. It may still appear in the queue.`,
    }, { status: 201 });
  }

  return NextResponse.json(
    { data: created.order, photos_attached: copied },
    { status: 201 },
  );
}
