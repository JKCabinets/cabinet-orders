import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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
export async function DELETE(
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

  // Delete from storage (best effort — if it fails we still remove the DB
  // row so the UI doesn't keep showing a phantom attachment)
  await supabase.storage.from("order-attachments").remove([attachment.file_path]);

  // Delete from DB
  const { error } = await supabase.from("order_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit-log every deletion. Useful when an attachment goes missing and we
  // need to know who removed it (the UI doesn't currently restrict deletes
  // by ownership, so accountability matters here).
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
}
