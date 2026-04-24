import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// GET /api/orders/attachments/[id] — get signed download URL
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const { data: attachment, error: fetchError } = await supabase
    .from("order_attachments")
    .select("file_path")
    .eq("id", id)
    .single();

  if (fetchError || !attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from("order-attachments").remove([attachment.file_path]);

  // Delete from DB
  const { error } = await supabase.from("order_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
