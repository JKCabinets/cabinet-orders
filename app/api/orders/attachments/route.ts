import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, cleanInput, rateLimitOr429 } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { SNIFF_BYTES, sniffMagicBytes, safeContentType } from "@/lib/fileValidation";
import { supabase } from "@/lib/supabase";
import { readCustomSpecs, specRefResolves, SPEC_ID_RE } from "@/lib/data";

// Hard caps on attachment uploads. Twenty MB per file mirrors what Supabase
// Storage will accept without bucket-side tuning. (This said the quote-form
// webhook matched it. It has not since 2026-09-24: a public form takes five
// files of 10 MB, because its caller is anyone.)
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILENAME_LEN = 200;
// Order IDs follow patterns like `SHO-123456`, `ORD-1700000000000`,
// `QUO-1700000000000`, `WAR-...`. Allow alphanumerics, dot, underscore, hyphen.
// 100 char ceiling matches what the bulk route uses for id validation.
const ORDER_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * What an attachment IS, as opposed to what file type it is.
 *
 *   general           manufacturer acknowledgments, exports, anything else
 *   proof_of_delivery a signed delivery receipt
 *
 * A SUBSET of the CHECK on order_attachments.kind, on purpose: the CHECK also
 * allows `customer_upload`, which only the quote webhook writes -- staff do not
 * upload the customer's files. (This said "MUST match" until 2026-09-30, which
 * stopped being true when customer_upload was added on 2026-09-28.) Validating
 * here turns a value the database would reject into a clear 422.
 *
 * The gate on At cross dock -> Delivered looks for proof_of_delivery
 * specifically, because every order at that stage already carries the ack
 * PDFs from Entered and a plain attachment count would pass immediately.
 */
const ATTACHMENT_KINDS = ["general", "proof_of_delivery"] as const;
type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

function sanitizeFileName(name: string): string {
  // Restrict to alphanum, dot, underscore, hyphen — same as the quote-form
  // webhook so both ingest paths agree on what's storable.
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.replace(/^\.+/, "_").slice(0, MAX_FILENAME_LEN) || "file";
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "attachments:get");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");
  if (!orderId || !ORDER_ID_RE.test(orderId)) {
    return NextResponse.json({ error: "orderId required" }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("order_attachments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ⚠ WRAPPED so an admin's override of a claim reaches the trail only if the
// upload succeeds. See ClaimOverrideLog in lib/auth.
export const POST = withClaimOverrideLog(async function POST(
  overrides: ClaimOverrideLog,
  req: NextRequest,
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  // Lower limit on uploads than reads — each upload writes to storage AND
  // the DB, so spamming this could fill the bucket quickly.
  const limited = await rateLimitOr429(req, 20, 60_000, "attachments:post");
  if (limited) return limited;

  let formData: FormData;
  try { formData = await req.formData(); } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const rawOrderId = formData.get("orderId");
  const orderId = typeof rawOrderId === "string" ? rawOrderId : "";

  if (!file || !orderId) {
    return NextResponse.json({ error: "file and orderId required" }, { status: 422 });
  }

  // Optional. Omitting it keeps the existing behaviour exactly: every
  // upload that does not say otherwise is a general attachment.
  const rawKind = formData.get("kind");
  const kindStr = rawKind === null || rawKind === "" ? "general" : String(rawKind);
  if (!(ATTACHMENT_KINDS as readonly string[]).includes(kindStr)) {
    return NextResponse.json(
      { error: `kind must be one of: ${ATTACHMENT_KINDS.join(", ")}` },
      { status: 422 },
    );
  }
  const kind = kindStr as AttachmentKind;

  // ⚠ spec_ref FILES THE UPLOAD UNDER A ROOM OR A STYLE GROUP of a custom job
  // (handoff item 24, step 3; 2026-09-30). Optional, and empty is the same as
  // absent: the file belongs to the job itself. Its shape is checked here;
  // whether the job HAS that room is checked once the order is read, below.
  const rawSpecRef = formData.get("spec_ref");
  const specRef = rawSpecRef === null || rawSpecRef === "" ? null : String(rawSpecRef);
  if (specRef !== null && !SPEC_ID_RE.test(specRef)) {
    return NextResponse.json({ error: "spec_ref must be a room or style-group id" }, { status: 422 });
  }
  if (specRef !== null && kind !== "general") {
    return NextResponse.json(
      { error: "spec_ref_kind", message: "A delivery receipt belongs to the order, not to a room." },
      { status: 422 },
    );
  }

  // ── Validate orderId shape ────────────────────────────────────────────
  // The id is interpolated into a storage path below. Without validation,
  // a string like "../../foo" would let an attacker write files outside
  // the order's namespace (Supabase normalizes some of this, but defense
  // in depth costs nothing).
  if (!ORDER_ID_RE.test(orderId)) {
    return NextResponse.json({ error: "invalid orderId" }, { status: 422 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "empty file" }, { status: 422 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 413 });
  }

  // ── Verify the order exists before doing any work ─────────────────────
  // Without this, an authenticated user could write attachments under any
  // string they chose — accumulating orphan files in storage and in the
  // order_attachments table.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, type, archived, project_id, custom_specs")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ⚠ ARCHIVED IS READ-ONLY (2026-09-16). An upload is a stage action in
  // everything but name -- see the claim note below -- so it is exactly the
  // kind of edit the archive does not take.
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);

  // ⚠ AN UPLOAD IS A STAGE ACTION IN EVERYTHING BUT NAME. An attachment is
  // what satisfies the Entered gate, so uploading to somebody else's
  // claimed order is the duplicated work claims exist to prevent -- the
  // stage gate refused it from the modal while this route accepted it.
  const claimGate = await requireOrderClaim(orderId, auth.session, overrides, "Attachment added");
  if (claimGate instanceof NextResponse) return claimGate;

  // ⚠ A ROOM THE JOB DOES NOT HAVE IS REFUSED, WITH THE REASON, BEFORE A BYTE IS
  // WRITTEN -- never stored as a pointer to nothing. Read against the job's
  // STORED specs: a room another tab has not saved yet does not exist, and one
  // somebody removed is gone. specRefResolves is the same reading the views use.
  //
  // ⚠ ONE RACE IS LEFT, AND IT IS SAFE. A room removed between this check and the
  // insert below leaves this file pointing at an id that no longer exists:
  // custom_specs_remove_area unlinks the files it can see, and this one was not
  // there yet. It then reads as filed under the job -- the fallback agreed in
  // item 24 -- and ids are never reused, so it cannot surface in another room.
  // Closing the race would mean inserting through a function that locks the
  // order row; a file in the job's own bin is not worth that.
  if (specRef !== null) {
    if (order.type !== "custom") {
      return NextResponse.json(
        { error: "spec_ref_not_custom", message: `Only a custom job has rooms to file under; ${orderId} is a ${order.type} order.` },
        { status: 422 },
      );
    }
    if (!specRefResolves(readCustomSpecs(order.custom_specs), specRef)) {
      return NextResponse.json(
        { error: "spec_ref_unknown", message: "That room or style group is not on this job any more. Reload to see its rooms." },
        { status: 422 },
      );
    }
  }

  // Sanitize the display filename ONCE, then use the same value for the
  // storage key and the DB row. Previously the route stored `file.name`
  // verbatim in the DB and a separately-escaped copy in the storage path,
  // so a malicious filename could surface back in the UI as raw HTML.
  const safeName = sanitizeFileName(file.name);
  const filePath = `${orderId}/${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  // Staff uploads legitimately include spreadsheets and documents, so the
  // type is NOT restricted here. But the browser's claim is never stored
  // directly: a dangerous filename or claim, or bytes we cannot identify,
  // become application/octet-stream -- which a browser downloads rather
  // than renders. That closes the stored-XSS path without blocking .xlsx.
  const sniffed = sniffMagicBytes(new Uint8Array(arrayBuffer.slice(0, SNIFF_BYTES)));
  const storedType = safeContentType(sniffed, file.name, file.type || "");

  const { error: uploadError } = await supabase.storage
    .from("order-attachments")
    .upload(filePath, arrayBuffer, {
      // ⚠ storedType, NOT file.type. This is the whole point of sniffing the
      // magic bytes above: `file.type` is whatever the uploading client said,
      // and on a file that turns out to be SVG or HTML it is what makes a
      // signed URL execute in a staff member's session. The sniffed value was
      // computed here and discarded until 2026-09-08.
      contentType: storedType,
      upsert: false,
    });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: attachment, error: dbError } = await supabase
    .from("order_attachments")
    .insert({
      order_id: orderId,
      // Sanitize every text field — uploaded_by and file_name end up in
      // markup-aware contexts (admin pages, export PDFs, the modal's
      // attachments panel). The session name was already sanitized when
      // the team_member row was created, but defense in depth is cheap.
      file_name: cleanInput(safeName),
      file_path: filePath,
      file_size: file.size,
      // Matches the stored object. Two different answers to "what is this
      // file" — one on the object, one on the row — is the kind of drift that
      // makes a later fix look already done.
      file_type: cleanInput(storedType).slice(0, 200),
      uploaded_by: cleanInput(auth.session.user.name ?? auth.session.user.username),
      // Whitelisted above, and constrained again by the DB CHECK.
      kind,
      // Checked above against the stored specs; null is the job itself.
      spec_ref: specRef,
    })
    .select()
    .single();

  if (dbError) {
    // Best effort: try to clean up the storage object we just wrote, so a
    // failed DB insert doesn't leave an orphan.
    await supabase.storage.from("order-attachments").remove([filePath]).catch(() => {});
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ data: attachment }, { status: 201 });
});
