import { NextRequest, NextResponse } from "next/server";
import { requireAuth, cleanInput, rateLimitOr429 } from "@/lib/auth";
import { SNIFF_BYTES, sniffMagicBytes, safeContentType } from "@/lib/fileValidation";
import { supabase } from "@/lib/supabase";

// Hard caps on attachment uploads. These match the quote-form webhook so the
// two ingest paths have consistent guardrails. Twenty MB per file mirrors what
// Supabase Storage will accept without bucket-side tuning.
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
 * MUST match the CHECK constraint on order_attachments.kind. The database
 * would reject a mismatch, but the user would see a raw constraint error;
 * validating here turns that into a clear 422.
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

export async function POST(req: NextRequest) {
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
    .select("id")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
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
      contentType: file.type || "application/octet-stream",
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
      file_type: cleanInput(file.type || "application/octet-stream").slice(0, 200),
      uploaded_by: cleanInput(auth.session.user.name ?? auth.session.user.username),
      // Whitelisted above, and constrained again by the DB CHECK.
      kind,
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
}
