import { supabase } from "@/lib/supabase";

/**
 * An order's stored files, removed when the order goes (2026-10-13) -- ONE
 * copy, for every path that deletes orders: the single delete
 * (app/api/orders/[id]), bulk delete, and a Shopify cancel or delete (the
 * webhook).
 *
 * ⚠ FILES ARE NOT CASCADED. order_attachments rows go with their order
 * (ON DELETE CASCADE), but `file_path` is a string into storage with no
 * foreign key, so the file stays -- unreachable, invisible, and still billed.
 * Until this module only bulk delete removed them; 32 of 36 attachment files
 * were orphans when it was written.
 *
 * ⚠ STORAGE FIRST, ROWS AFTER. If the files go and the row delete then fails,
 * the order is still there, visibly without files, and can be deleted again.
 * The other order leaves files nothing will ever find.
 */

export const ATTACHMENT_BUCKET = "order-attachments";

/** The storage API removes at most this many paths per call. */
const REMOVE_BATCH = 100;

export type RemoveFilesResult = { ok: true; removed: number } | { ok: false; error: string };

/**
 * Removes the stored files of these orders. Legacy attachments whose
 * `file_path` is an external URL (the quote form's old URL-only path) have no
 * file of ours and are skipped.
 */
export async function removeOrderFiles(orderIds: string[]): Promise<RemoveFilesResult> {
  if (orderIds.length === 0) return { ok: true, removed: 0 };
  const { data, error } = await supabase
    .from("order_attachments")
    .select("file_path")
    .in("order_id", orderIds);
  if (error) return { ok: false, error: `failed to list attachments: ${error.message}` };

  const paths = (data ?? [])
    .map((a) => a.file_path as string)
    .filter((p) => !!p && !/^https?:\/\//i.test(p));
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error: rmErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET).remove(paths.slice(i, i + REMOVE_BATCH));
    if (rmErr) return { ok: false, error: `failed to delete files: ${rmErr.message}` };
  }
  return { ok: true, removed: paths.length };
}
