import { NextRequest, NextResponse } from "next/server";
import { requireSelfOrAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/team/[id]/avatar
 *
 * Upload a profile photo for a team member. Accepts a multipart form
 * body with a "file" field. Anyone (self OR admin) can upload, matching
 * the PATCH endpoint's policy for profile-level fields.
 *
 * Stores the file in the "team-avatars" Supabase Storage bucket under
 * the key <userId>/<timestamp>.<ext>. On success: updates
 * team_members.photo_url to the bucket's public URL.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireSelfOrAdmin(id);
  if (auth instanceof NextResponse) return auth;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing or invalid "file" field' },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    );
  }

  const extByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/webp": "webp",
    "image/gif":  "gif",
  };
  const ext = extByType[file.type];
  const key = `${id}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Clean up any previous avatar(s) for this user before uploading the new
  // one. Files are stored under the per-user folder `${id}/<timestamp>.<ext>`,
  // so each replace would otherwise orphan the prior object and the bucket
  // would grow without bound. Best-effort — a cleanup failure shouldn't
  // block the new upload, but we log it so a persistent leak is visible.
  try {
    const { data: existing } = await supabase.storage
      .from("team-avatars")
      .list(id);
    if (existing && existing.length > 0) {
      const paths = existing.map((f) => `${id}/${f.name}`);
      const { error: removeError } = await supabase.storage
        .from("team-avatars")
        .remove(paths);
      if (removeError) {
        console.warn(`[avatar] failed to remove old files for ${id}:`, removeError.message);
      }
    }
  } catch (err) {
    console.warn(`[avatar] cleanup threw for ${id}:`, err);
  }

  const { error: uploadError } = await supabase.storage
    .from("team-avatars")
    .upload(key, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  const { data: urlData } = supabase.storage
    .from("team-avatars")
    .getPublicUrl(key);
  const publicUrl = urlData.publicUrl;

  const { error: updateError } = await supabase
    .from("team_members")
    .update({ photo_url: publicUrl })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json(
      { error: `DB update failed: ${updateError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: publicUrl });
}
