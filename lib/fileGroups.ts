/**
 * File groups -- server helpers (2026-10-27, item 8 step 5; Garrett, 2026-10-26).
 *
 * A group belongs to ONE order and is named by people; a file is uploaded INTO
 * a group (migrations/2026-10-27-file-groups-a.sql). The OMS makes two kinds
 * itself and finds them by ROLE, never by name -- people may rename or delete
 * them like any other, and the next such file makes a fresh one:
 *   customer_uploads    the quote form's and a promoted claim's files
 *   proof_of_delivery   a signed delivery receipt
 * A custom job's rooms and style groups have groups too; those FOLLOW their
 * room (custom_specs_save_area / _remove_area), and are renamed and deleted
 * through it.
 */
import { supabase } from "@/lib/supabase";
import { ATTACHMENT_BUCKET } from "@/lib/orderFiles";

export const ROLE_GROUP_NAME = {
  customer_uploads: "Customer uploads",
  proof_of_delivery: "Proof of delivery",
} as const;
export type OmsGroupRole = keyof typeof ROLE_GROUP_NAME;

/** The order's group for this role, made now if it has none. null if the database refused. */
export async function fileGroupForRole(orderId: string, role: OmsGroupRole): Promise<number | null> {
  const { data, error } = await supabase.rpc("file_group_for_role", {
    p_order_id: orderId, p_role: role, p_name: ROLE_GROUP_NAME[role],
  });
  if (error || data === null || data === undefined) return null;
  const id = Number(data);
  return Number.isFinite(id) ? id : null;
}

export const GROUP_NAME_MAX = 80;

/** A group's name as stored: trimmed, inner runs of space made one; null if empty or too long. */
export function cleanGroupName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= GROUP_NAME_MAX ? name : null;
}

/**
 * Remove stored files whose ROWS are already gone. ⚠ ROWS FIRST, THEN STORAGE:
 * if this fails, a file is an orphan -- storage_orphans() lists it and the
 * storage sweep removes it -- never a row pointing at a missing file.
 */
export async function removeStoredFiles(paths: string[]): Promise<{ removed: number; failed: number }> {
  const stored = paths.filter((p) => !!p && !/^https?:\/\//i.test(p));
  let removed = 0, failed = 0;
  for (let i = 0; i < stored.length; i += 100) {
    const batch = stored.slice(i, i + 100);
    const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove(batch);
    if (error) failed += batch.length; else removed += batch.length;
  }
  return { removed, failed };
}
