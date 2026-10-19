import { supabase } from "@/lib/supabase";
import { removeOrderFiles } from "@/lib/orderFiles";
import { logWebhook } from "@/lib/webhookLog";

/**
 * ⚠ HOW A SHOPIFY PURCHASE LEAVES THE OMS — ONE PLACE (2026-10-19).
 *
 * Moved here from the webhook's `orders/cancelled` / `orders/delete` handler so
 * that the hourly reconciler in app/api/cron/webhook-health removes a purchase
 * whose deletion webhook was LOST exactly as the webhook would have (Garrett,
 * 2026-10-19). Two copies would drift, and a removal that drifted is how
 * SHO-1051 sat in the OMS through two deletions.
 *
 * It decides and records; the CALLER decides what to answer. The webhook
 * answers Shopify (a 5xx is a retry, a 200 is not); the reconciler answers its
 * cron. Every outcome is logged to `webhook_events` here, once, with `topic`
 * saying which of the two acted.
 *
 * ⚠ A READ THAT FAILS IS NOT AN ABSENCE (2026-10-19). Its three reads used to
 * ignore their errors: a failed project lookup read as "no project" (and the
 * webhook's 200 meant Shopify never redelivered: the deletion was lost); a
 * failed groups read skipped the claim check and the files and deleted the
 * project anyway; a failed claim check read as "nothing refers to it", so the
 * files went and then the row delete failed on the claim -- a purchase that
 * should have been KEPT lost its files. Each now refuses as `failed`.
 */
export type RemovalResult =
  | { outcome: "no_project" }
  | { outcome: "blocked"; projectId: string; blockedBy: string[] }
  | { outcome: "failed"; projectId: string | null; table: string; message: string }
  | { outcome: "removed"; projectId: string; groups: number };

export async function removeShopifyPurchase(shopifyId: string, topic: string): Promise<RemovalResult> {
  const { data: project, error: projectErr } = await supabase
    .from("projects").select("id").eq("shopify_id", shopifyId).maybeSingle();
  if (projectErr) {
    logWebhook("delete_failed", { shopify_id: shopifyId, topic, table: "projects", message: projectErr.message });
    return { outcome: "failed", projectId: null, table: "projects", message: projectErr.message };
  }

  // ⚠ A DELETION WE CANNOT MATCH USED TO VANISH. `if (project)` had no else,
  // so an unknown shopify_id returned 200 and logged nothing at all -- the
  // same silence as a delete that failed.
  if (!project) {
    logWebhook("delete_no_project", { shopify_id: shopifyId, topic });
    return { outcome: "no_project" };
  }

  const { data: groups, error: groupsErr } = await supabase
    .from("orders").select("id").eq("project_id", project.id);
  if (groupsErr) {
    logWebhook("delete_failed", { order_id: project.id, shopify_id: shopifyId, topic, table: "orders", message: groupsErr.message });
    return { outcome: "failed", projectId: project.id, table: "orders", message: groupsErr.message };
  }
  const ids = (groups ?? []).map(g => g.id);

  // ⚠ WARRANTY CLAIMS HOLD THE ONE NO ACTION EDGE LEFT.
  // `orders.about_order_id -> orders` is NO ACTION, and a claim is
  // standalone -- it has no project_id, so it is never among `ids` and never
  // gets cleared. Postgres rejects the orders delete, the projects delete
  // fails behind it, and before this commit both errors were discarded and
  // the handler logged "removed". SHO-1051 sat in the OMS through two
  // deletions that way.
  //
  // Refused rather than resolved: nulling about_order_id orphans the claim
  // and deleting it destroys real work because somebody tidied up Shopify.
  // A warranty claim is evidence and should outlive the purchase record, so
  // a person decides.
  if (ids.length > 0) {
    const { data: referrers, error: refErr } = await supabase
      .from("orders").select("id, type").in("about_order_id", ids);
    if (refErr) {
      logWebhook("delete_failed", { order_id: project.id, shopify_id: shopifyId, topic, table: "orders", message: refErr.message });
      return { outcome: "failed", projectId: project.id, table: "orders", message: refErr.message };
    }
    const blocking = (referrers ?? []).filter(r => !ids.includes(r.id));
    if (blocking.length > 0) {
      logWebhook("delete_blocked", {
        order_id: project.id, shopify_id: shopifyId, topic,
        blocked_by: blocking.map(r => r.id),
      });
      return { outcome: "blocked", projectId: project.id, blockedBy: blocking.map(r => r.id) };
    }
  }

  if (ids.length > 0) {
    // ⚠ THESE FOUR ARE BELT TO CASCADE'S BRACES, NOT THE LOAD-BEARING STEP.
    // The comment here used to say every foreign key on these tables was
    // NO ACTION and that children therefore had to go first. They are all
    // CASCADE today -- damage_reports, order_acknowledgments, order_activity
    // and order_attachments -- and that stale claim is what sent the
    // 2026-09-14 investigation hunting a child table when the blocker was
    // `orders.about_order_id`. Kept because they are harmless and explicit;
    // the comment is what needed fixing.
    //
    // ⚠ THE FILES GO TOO (Garrett, 2026-10-13). This said leaving them was
    // deliberate -- "silently destroying a customer's uploaded files on a
    // Shopify cancel is a decision" -- and the decision is: once these rows
    // are gone nothing in the OMS can show or reach those files, so they go
    // with the order, FIRST (below).
    //
    // ⚠ EVERY ERROR IS CHECKED AND RETURNED. Six of these discarded their
    // error, so a rejected delete was indistinguishable from a completed one.
    const files = await removeOrderFiles(ids);
    if (!files.ok) {
      logWebhook("delete_failed", {
        order_id: project.id, shopify_id: shopifyId, topic,
        table: "storage", message: files.error,
      });
      return { outcome: "failed", projectId: project.id, table: "storage", message: files.error };
    }

    for (const step of [
      { table: "order_activity", column: "order_id" },
      { table: "order_acknowledgments", column: "order_id" },
      { table: "order_attachments", column: "order_id" },
      { table: "damage_reports", column: "order_id" },
      { table: "orders", column: "id" },
    ]) {
      const { error: delError } = await supabase
        .from(step.table).delete().in(step.column, ids);
      if (delError) {
        logWebhook("delete_failed", {
          order_id: project.id, shopify_id: shopifyId, topic,
          table: step.table, message: delError.message,
        });
        return { outcome: "failed", projectId: project.id, table: step.table, message: delError.message };
      }
    }
  }

  const { error: projectError } = await supabase
    .from("projects").delete().eq("id", project.id);
  if (projectError) {
    logWebhook("delete_failed", {
      order_id: project.id, shopify_id: shopifyId, topic,
      table: "projects", message: projectError.message,
    });
    return { outcome: "failed", projectId: project.id, table: "projects", message: projectError.message };
  }

  logWebhook("removed", {
    order_id: project.id, shopify_id: shopifyId, topic, groups: ids.length,
  });
  return { outcome: "removed", projectId: project.id, groups: ids.length };
}
