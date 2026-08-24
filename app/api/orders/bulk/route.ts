import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Bulk actions — a CLEANUP tool, deliberately.
 *
 * ⚠ THE `move` ACTION WAS REMOVED 2026-08-24, along with the GET preflight that
 * only served it. Bulk stage moves do not fit how the business runs, and the
 * implementation had drifted badly from the single-order PATCH:
 *
 *   - NO delivery-proof gate. At cross dock -> Delivered skipped the signed
 *     receipt entirely -- no receipt, no reason, no activity row -- while the
 *     single-order path demands all three. The gate is designed as
 *     accountability rather than permission, and this route offered neither.
 *   - NO payment hold. A refunded order could be moved forward with nothing
 *     recorded, which is the one thing that control exists to prevent.
 *   - HALF an attachment gate. It counted attachments but never checked
 *     orderAllVendorsGreen, so it REFUSED orders the PATCH route allows.
 *   - `claimed_by` wiped on every forward move, not just when leaving New.
 *   - `entered_by` written as a display name where PATCH writes a
 *     team_members.id.
 *
 * Five defects, removed by deleting the feature rather than by writing five
 * patches to keep a feature nobody wanted correct. Stage moves happen one order
 * at a time, through PATCH /api/orders/[id], which has all of the above.
 *
 * What remains:
 *   archive  — reversible, permission-checked, any type.
 *   delete   — DESTRUCTIVE, admin only, CUSTOM ROWS ONLY.
 *
 * Custom jobs are contract work tracked here for organisation; they carry no
 * Shopify products at all. Every other type is Shopify-owned, and an order
 * deleted in Shopify already reaches the OMS through the webhook. Deleting one
 * of those by hand is how the two systems drift apart, so this route refuses.
 */

const MAX_BULK_IDS = 50;

interface BulkResult {
  id: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = await rateLimitOr429(req, 10, 60_000, "orders:bulk");
  if (limited) return limited;

  let body: { ids?: unknown; action?: unknown; archived?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Validate input ────────────────────────────────────────────────────────
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 422 });
  }
  if (body.ids.length > MAX_BULK_IDS) {
    return NextResponse.json(
      { error: `Too many ids (max ${MAX_BULK_IDS} per request)` },
      { status: 422 }
    );
  }
  const ids = body.ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0 && id.length < 100);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no valid ids" }, { status: 422 });
  }

  const action = body.action;
  if (action !== "archive" && action !== "delete") {
    // "move" lands here on purpose. If a stale client still sends it, this is
    // the message that explains why rather than a bare 422.
    return NextResponse.json(
      {
        error: "action must be 'archive' or 'delete'",
        message: action === "move"
          ? "Bulk stage moves were removed. Move orders individually so the "
            + "delivery-proof and payment-hold gates apply."
          : undefined,
      },
      { status: 422 }
    );
  }

  let targetArchived: boolean | null = null;
  if (action === "archive") {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "archived (boolean) required for archive" }, { status: 422 });
    }
    targetArchived = body.archived;
  }

  const isAdmin = auth.session.user.role === "admin";

  // Delete is admin-only, checked BEFORE any row is loaded. A destructive
  // cleanup tool should refuse early and whole, not per row.
  if (action === "delete" && !isAdmin) {
    return NextResponse.json(
      { error: "forbidden", message: "Bulk delete is admin only" },
      { status: 403 }
    );
  }

  // ── Load all affected orders in one round-trip ────────────────────────────
  const { data: orders, error: fetchError } = await supabase
    .from("orders")
    .select("id, source, created_by, stage, archived, type, project_id")
    .in("id", ids);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const orderMap = new Map((orders ?? []).map(o => [o.id, o]));
  const username = auth.session.user.username;
  const displayName = auth.session.user.name ?? username;
  // America/Phoenix, matching the webhook and the production cron. Without it
  // this ran on server-local time, so after 5pm Phoenix every activity row was
  // dated tomorrow.
  const today = new Date().toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/Phoenix",
  });

  const results: BulkResult[] = [];
  const activityInserts: { order_id: string; text: string; time: string }[] = [];
  // Projects whose last group may have just been deleted. Checked after the
  // loop, because two groups of one project can be in the same batch.
  const touchedProjects = new Set<string>();

  for (const id of ids) {
    const order = orderMap.get(id);
    if (!order) {
      results.push({ id, ok: false, error: "not_found" });
      continue;
    }

    // ── Archive ─────────────────────────────────────────────────────────────
    if (action === "archive" && targetArchived !== null) {
      if (!isAdmin) {
        if (order.source !== "Manual") {
          results.push({ id, ok: false, error: "forbidden: only admins can archive non-manual orders" });
          continue;
        }
        if (!order.created_by || order.created_by !== username) {
          results.push({ id, ok: false, error: "forbidden: you can only archive orders you created" });
          continue;
        }
      }

      if (order.archived === targetArchived) {
        results.push({ id, ok: true });
        continue;
      }

      const { error: updateError } = await supabase
        .from("orders").update({ archived: targetArchived }).eq("id", id);
      if (updateError) {
        results.push({ id, ok: false, error: updateError.message });
        continue;
      }

      activityInserts.push({
        order_id: id,
        text: `${targetArchived ? "Archived" : "Restored from archive"} by ${displayName} (bulk action)`,
        time: today,
      });
      results.push({ id, ok: true });
      continue;
    }

    // ── Delete ──────────────────────────────────────────────────────────────
    if (action === "delete") {
      // CUSTOM ROWS ONLY. Not a permission — a statement about where the row's
      // truth lives. Shopify owns every other type, and deleting one here
      // without deleting it there is how the two drift apart.
      if (order.type !== "custom") {
        results.push({
          id, ok: false,
          error: `shopify_owned: ${order.type} orders are deleted in Shopify, not here`,
        });
        continue;
      }

      // ── Storage FIRST, then rows ──────────────────────────────────────────
      //
      // The order is deliberate and it is the opposite of what looks natural.
      // `order_attachments.file_path` carries NO foreign key, so nothing links
      // a storage object to its row except that string.
      //
      //   Rows first:    a storage failure leaves files nobody has a record of.
      //                  Unrecoverable garbage, invisible, growing.
      //   Storage first: a row failure leaves a row whose files are gone --
      //                  visible as "no attachments", and retryable.
      //
      // Files go when the job goes.
      const { data: attachments, error: attErr } = await supabase
        .from("order_attachments")
        .select("file_path")
        .eq("order_id", id);
      if (attErr) {
        results.push({ id, ok: false, error: `failed to list attachments: ${attErr.message}` });
        continue;
      }
      const paths = (attachments ?? [])
        .map(a => a.file_path as string)
        .filter(Boolean);
      if (paths.length > 0) {
        const { error: storageErr } = await supabase
          .storage.from("order-attachments").remove(paths);
        if (storageErr) {
          results.push({ id, ok: false, error: `failed to delete files: ${storageErr.message}` });
          continue;
        }
      }

      // Children in FK order. Every one of these constraints is NO ACTION
      // (verified 2026-08-20), so the parent delete is REJECTED outright while
      // any child still points at it -- order_acknowledgments in particular,
      // which an earlier version of the webhook cancel path forgot.
      let childFailed = false;
      for (const table of ["order_activity", "order_acknowledgments",
                           "order_attachments", "damage_reports"]) {
        const { error: childErr } = await supabase.from(table).delete().eq("order_id", id);
        if (childErr) {
          results.push({ id, ok: false, error: `failed to clear ${table}: ${childErr.message}` });
          childFailed = true;
          break;
        }
      }
      if (childFailed) continue;

      const { error: delErr } = await supabase.from("orders").delete().eq("id", id);
      if (delErr) {
        results.push({ id, ok: false, error: delErr.message });
        continue;
      }

      if (order.project_id) touchedProjects.add(order.project_id as string);
      results.push({ id, ok: true });
    }
  }

  // ── Clean up projects left with no groups ─────────────────────────────────
  // A project is the purchase; a group is the work. A project with no groups
  // left is invisible work -- nothing lists it and nothing can claim it.
  //
  // Checked AFTER the loop and re-queried per project, because two groups of
  // the same project can appear in one batch, and because a project may still
  // hold groups that were not selected.
  const deletedProjects: string[] = [];
  for (const projectId of touchedProjects) {
    const { count, error: countErr } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if (countErr) continue;
    if (!count || count === 0) {
      const { error: projErr } = await supabase.from("projects").delete().eq("id", projectId);
      if (!projErr) deletedProjects.push(projectId);
    }
  }

  if (activityInserts.length > 0) {
    await supabase.from("order_activity").insert(activityInserts);
  }

  // Audit-log the bulk action. Deletions especially: this is the only record
  // that survives, since the order's own activity rows went with it.
  try {
    await supabase.from("audit_log").insert({
      event: action === "delete" ? "bulk_delete" : "bulk_action",
      username,
      details: {
        action,
        ...(targetArchived !== null ? { archived: targetArchived } : {}),
        requested: ids.length,
        succeeded: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        ...(action === "delete" ? {
          deleted_ids: results.filter(r => r.ok).map(r => r.id),
          deleted_projects: deletedProjects,
        } : {}),
      },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({
    ok: true,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    ...(deletedProjects.length > 0 ? { deleted_projects: deletedProjects.length } : {}),
    results,
  });
}
