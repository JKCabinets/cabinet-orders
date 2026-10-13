import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

/**
 * The storage sweep (2026-10-13): files nothing refers to any more, removed.
 * Admin only. TWO STEPS, ON PURPOSE:
 *
 *   GET   the dry run -- every orphan older than a day, and its count. Nothing
 *         is deleted.
 *   POST  { "confirm": <the dry run's count> } -- deletes them, but only if
 *         the list is still that size. Anything changed in between (an upload,
 *         a delete) and it refuses: run the dry run again.
 *
 * ⚠ THROUGH THE STORAGE API. The list comes from public.storage_orphans
 * (migrations/2026-10-13-storage-orphans.sql); deleting the storage.objects
 * rows directly would leave the files themselves in place.
 */

const MIN_AGE = "1 day";
const REMOVE_BATCH = 100;

type Orphan = { bucket_id: string; name: string; size: number; created_at: string };

async function listOrphans(): Promise<{ ok: true; files: Orphan[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("storage_orphans", { min_age: MIN_AGE });
  if (error) return { ok: false, error: error.message };
  return { ok: true, files: (data ?? []) as Orphan[] };
}

function summarise(files: Orphan[]) {
  const byBucket: Record<string, { files: number; bytes: number }> = {};
  for (const f of files) {
    const b = (byBucket[f.bucket_id] ??= { files: 0, bytes: 0 });
    b.files += 1;
    b.bytes += Number(f.size) || 0;
  }
  return { count: files.length, bytes: files.reduce((s, f) => s + (Number(f.size) || 0), 0), by_bucket: byBucket };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const list = await listOrphans();
  if (!list.ok) return NextResponse.json({ error: "list_failed", message: list.error }, { status: 500 });
  return NextResponse.json({
    dry_run: true,
    older_than: MIN_AGE,
    ...summarise(list.files),
    files: list.files,
    to_delete: `POST this URL with {"confirm": ${list.files.length}}`,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let confirm: unknown;
  try { confirm = (await req.json())?.confirm; } catch { confirm = undefined; }
  if (typeof confirm !== "number" || !Number.isInteger(confirm) || confirm < 0) {
    return NextResponse.json({ error: "confirm_required", message: "Send the dry run's count as {\"confirm\": n}." }, { status: 400 });
  }

  const list = await listOrphans();
  if (!list.ok) return NextResponse.json({ error: "list_failed", message: list.error }, { status: 500 });
  if (list.files.length !== confirm) {
    return NextResponse.json({
      error: "changed_since_dry_run",
      message: `The dry run found ${confirm}; there are ${list.files.length} now. Run the dry run again.`,
      count: list.files.length,
    }, { status: 409 });
  }

  const byBucket = new Map<string, string[]>();
  for (const f of list.files) (byBucket.get(f.bucket_id) ?? byBucket.set(f.bucket_id, []).get(f.bucket_id)!).push(f.name);
  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += REMOVE_BATCH) {
      const batch = names.slice(i, i + REMOVE_BATCH);
      const { error } = await supabase.storage.from(bucket).remove(batch);
      if (error) {
        return NextResponse.json({ error: "remove_failed", bucket, message: error.message, removed }, { status: 500 });
      }
      removed += batch.length;
    }
  }

  try {
    await supabase.from("audit_log").insert({
      event: "storage_swept",
      username: auth.session.user.username,
      details: { removed, ...summarise(list.files).by_bucket },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, removed, ...summarise(list.files) });
}
