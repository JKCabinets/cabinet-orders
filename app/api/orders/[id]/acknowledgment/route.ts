import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrderClaim, withClaimOverrideLog, type ClaimOverrideLog, rateLimitOr429, cleanInput } from "@/lib/auth";
import { purchaseOf, archivedVia, archivedReadOnly } from "@/lib/archived";
import { supabase } from "@/lib/supabase";
import { type SkuItem } from "@/lib/skuDecoder";
import { linesForAckVendor, ackFingerprint } from "@/lib/ackFingerprint";
import { parseWaypointAck, type Grid } from "@/lib/waypointAck";
import { reconcileAck, type OrderForReconcile } from "@/lib/reconcile";
import { displayOrderNumber } from "@/lib/data";
import { fileGroupForRole, removeStoredFiles } from "@/lib/fileGroups";
import { ATTACHMENT_BUCKET } from "@/lib/orderFiles";
import { ensureSkuMaps } from "@/lib/skuMappings";
import * as XLSX from "xlsx";

/**
 * POST /api/orders/[id]/acknowledgment
 *
 * Upload a Waypoint order-acknowledgment .xlsx for THIS order. The order is
 * taken from the URL [id] (the ack is uploaded on the order's detail page);
 * the ack's PO is a non-blocking cross-check, not the resolver.
 *
 * Flow: parse the sheet into a cell grid -> reconstruct composites
 * (parseWaypointAck) -> reconcile against the order's WAYPOINT-family lines
 * only (a Waypoint ack never covers HCI/J&K lines) -> store one row in
 * order_acknowledgments (full history: a resubmission is a NEW row) -> return
 * the ReconcileResult so the UI can react.
 *
 * Auth: any authenticated team member (uploading an ack is part of the
 * order-entry workflow). No stage advance / export gating here — that is a
 * separate step that touches the stage machine.
 */

const VENDOR = "Waypoint Cabinetry"; // canonical vendors-table string for Waypoint
const MAX_BYTES = 5 * 1024 * 1024;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Log a rejected ack upload so an intermittent failure is diagnosable
 * after the fact.
 *
 * Every rejection path below used to return its status code silently, so
 * "the ack upload fails sometimes" could not be attributed to a branch or
 * a file. One structured line to stdout, which Kamal captures:
 *
 *   docker logs <container> | grep ack-reject
 *
 * METADATA ONLY. Never log sheet contents.
 */
function logAckReject(
  orderId: string,
  branch: string,
  file?: File | null,
  extra?: Record<string, unknown>,
) {
  console.warn("[ack-reject]", JSON.stringify({
    branch,
    order_id: orderId,
    file_name: file?.name ?? null,
    file_size: file?.size ?? null,
    ...extra,
  }));
}

// ⚠ WRAPPED so an admin's override of a claim reaches the trail only if the
// acknowledgment is saved. See ClaimOverrideLog in lib/auth.
export const POST = withClaimOverrideLog(async function POST(
  overrides: ClaimOverrideLog,
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimitOr429(req, 20, 60_000, "ack-upload");
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { session } = auth;

  const { id } = await params;

  // ── Read + validate the uploaded file ───────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    logAckReject(id, "not_multipart");
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    logAckReject(id, "no_file");
    return NextResponse.json({ error: "No file provided (field 'file')" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    logAckReject(id, "not_xlsx", file);
    return NextResponse.json({ error: "File must be a .xlsx" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    logAckReject(id, "too_large", file, { max_bytes: MAX_BYTES });
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });
  }

  // ⚠ READ ONCE (2026-10-28): the bytes parsed are the bytes kept.
  const bytes = Buffer.from(await file.arrayBuffer());

  // ⚠ THE SKU TABLES BEFORE THE PARSE (2026-10-28). The parser turns
  // "410F-PAINTED SAGE" into a composite through sku_mappings, which load once
  // per process -- and lib/skuMappings' rule is that a caller awaits them. This
  // route did not: cold (just after a deploy, before any other route loaded
  // them) a CORRECT acknowledgment parsed as bare "W930" and was recorded red.
  // Unloadable, nothing is checked: a verdict without them would be wrong.
  try {
    await ensureSkuMaps();
  } catch (e) {
    logAckReject(id, "sku_maps_unavailable", file, { reason: e instanceof Error ? e.message : String(e) });
    return NextResponse.json(
      { error: "Could not load the SKU tables, so the acknowledgment was not checked. Please retry." },
      { status: 503 },
    );
  }

  // ── Parse the workbook into a 0-indexed cell grid (grid[0] = row 1) ──────
  let sheetName: string;
  let grid: Grid;
  try {
    const wb = XLSX.read(bytes, { type: "buffer" });
    sheetName = wb.SheetNames[0];
    const ws = sheetName ? wb.Sheets[sheetName] : undefined;
    const ref = ws?.["!ref"];
    if (!ws || !ref) {
      logAckReject(id, "no_readable_sheet", file, {
        sheet_name: sheetName ?? null,
        sheet_count: wb.SheetNames.length,
      });
      return NextResponse.json({ error: "Workbook has no readable sheet" }, { status: 422 });
    }
    const range = XLSX.utils.decode_range(ref);
    grid = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row: (string | number | null)[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cell ? cell.v : null;
        row.push(
          typeof v === "number" || typeof v === "string" ? v : v == null ? null : String(v)
        );
      }
      grid.push(row);
    }
  } catch (e) {
    logAckReject(id, "xlsx_unreadable", file, {
      reason: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "Could not read the .xlsx file" }, { status: 422 });
  }

  const ack = parseWaypointAck(sheetName, grid);
  if (ack.items.length === 0) {
    // The most likely rejection for a file that looks valid: the workbook
    // parsed but the parser recognised no lines. Grid dimensions are what
    // separate "wrong file entirely" (tiny or oddly-shaped grid) from
    // "right file, parser missed the layout" (plausible grid).
    logAckReject(id, "no_line_items", file, {
      sheet_name: sheetName ?? null,
      grid_rows: grid.length,
      grid_cols: grid[0]?.length ?? 0,
      parsed_po: ack.po ?? null,
      parsed_waypoint_order: ack.waypoint_order ?? null,
    });
    return NextResponse.json(
      { error: "No line items found — is this a Waypoint acknowledgment export?" },
      { status: 422 }
    );
  }

  // ── Fetch the order named by the URL ────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, name, ship_to, customer_phone, sku_items, archived, project_id")
    .eq("id", id)
    .single();
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ⚠ ARCHIVED IS READ-ONLY (2026-09-16). An acknowledgment is what moves a
  // cabinet order out of New; submitting one against archived work is a stage
  // action on history.
  const purchase = await purchaseOf(order);
  if (purchase instanceof NextResponse) return purchase;
  const archivedState = archivedVia(order, purchase);
  if (archivedState) return archivedReadOnly(order, archivedState);

  // ⚠ THE ACKNOWLEDGMENT IS WHAT MOVES A CABINET ORDER OUT OF New, so this
  // upload is a stage action and belongs behind the same claim. Reachable
  // from the row as well as the modal, which is why a non-owner used to be
  // able to submit against work somebody else had picked up.
  const claimGate = await requireOrderClaim(id, session, overrides, "Acknowledgment submitted");
  if (claimGate instanceof NextResponse) return claimGate;

  // ── Filter the order's lines to the Waypoint family ─────────────────────
  // Post-fix orders store the full composite, whose 3-part door+color shape
  // identifies the family unambiguously (decodeSku sets doorCode only for the
  // Waypoint shape), so the variant_id resolver isn't needed here.
  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];

  // ⚠ ONE SELECTOR, SHARED WITH THE STAGE GATE. This filtered by SKU shape
  // inline and built the reconcile shape here. lib/ackFingerprint owns both now,
  // because the gate has to fingerprint the IDENTICAL line set -- if the two
  // ever select differently, by even one line, every ack reads stale and no
  // cabinet order can advance.
  //
  // Null means "no selector for this vendor", which cannot happen here: VENDOR
  // is the Waypoint constant. Coalesced rather than asserted so a future vendor
  // reaching this route degrades to "reconciles nothing" instead of throwing.
  const ackLines = linesForAckVendor(VENDOR, skuItems) ?? [];

  const orderForReconcile: OrderForReconcile = {
    id: order.id,
    name: order.name ?? "",
    ship_to: order.ship_to ?? "",
    sku_items: ackLines,
    customer_phone: order.customer_phone ?? "",
    // The PO must name this order's NUMBER (2026-10-28): SHO-1065, not the group's SHO-1065-CAB.
    order_number: displayOrderNumber(order),
  };

  const result = reconcileAck(ack, orderForReconcile);

  // ⚠ THE PO IS CHECKED BY reconcileAck NOW, inside the verdict (2026-10-28).
  // This compared it with order.id -- the GROUP (SHO-1065-CAB), which no PO
  // names -- outside the verdict, and nothing displayed the answer.
  const poMatchesOrder = result.po_matched;

  // ── Keep the acknowledgment as a FILE (2026-10-28, Garrett) ─────────────
  // Every submission, pass or fail, in the order's "Acknowledgments" group, of
  // kind `acknowledgment` -- a kind the Entered gate does NOT count as "an
  // attachment", or a failed acknowledgment would satisfy it by being kept.
  // Kept BEFORE the submission is recorded: no row without its file.
  const who = session.user.name ?? session.user.username;
  const ackGroup = await fileGroupForRole(order.id, "acknowledgments");
  if (ackGroup === null) {
    logAckReject(id, "group_unavailable", file);
    return NextResponse.json(
      { error: "Could not find or make this order's \u201cAcknowledgments\u201d group, so nothing was recorded. Please retry." },
      { status: 500 },
    );
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 200) || "acknowledgment.xlsx";
  const filePath = `${order.id}/${Date.now()}-${safeName}`;
  const { error: storeErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET).upload(filePath, bytes, { contentType: XLSX_TYPE, upsert: false });
  if (storeErr) {
    logAckReject(id, "file_store_failed", file, { reason: storeErr.message });
    return NextResponse.json({ error: "Could not keep the acknowledgment file, so nothing was recorded. Please retry." }, { status: 500 });
  }
  const { data: kept, error: keptErr } = await supabase.from("order_attachments").insert({
    order_id: order.id, file_name: cleanInput(safeName), file_path: filePath, file_size: file.size,
    file_type: XLSX_TYPE, uploaded_by: cleanInput(who), kind: "acknowledgment", group_id: ackGroup,
  }).select("id").single();
  if (keptErr || !kept) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([filePath]);
    logAckReject(id, "file_row_failed", file, { reason: keptErr?.message ?? "no row" });
    return NextResponse.json({ error: "Could not keep the acknowledgment file, so nothing was recorded. Please retry." }, { status: 500 });
  }

  // ⚠ A FAILED SUBMISSION'S FILE GOES WHEN THE NEXT ONE IS SUBMITTED (Garrett):
  // found now, deleted only once this one is recorded. A passed one stays.
  const { data: earlierRed } = await supabase
    .from("order_acknowledgments").select("attachment_id")
    .eq("order_id", order.id).eq("vendor", VENDOR).eq("verdict", "red");
  const replaced = (earlierRed ?? []).map((r: { attachment_id: number | null }) => r.attachment_id)
    .filter((x): x is number => typeof x === "number");

  // ── Persist one acknowledgment row (full history) ───────────────────────
  const { error: insErr } = await supabase.from("order_acknowledgments").insert({
    order_id: order.id,
    vendor: VENDOR,
    verdict: result.verdict,
    po: ack.po || null,
    file_name: file.name,
    parsed_json: ack,
    result_json: result,
    uploaded_by: session.user.id,
    attachment_id: kept.id,
    lines_fingerprint: ackFingerprint(
      order.name ?? "", order.ship_to ?? "", ackLines, order.customer_phone ?? "",
    ),
  });
  if (insErr) {
    // Surface the failure — never report success on a failed write (Principle #3).
    // The file kept for it goes too: no file claims a submission that is not there.
    await supabase.from("order_attachments").delete().eq("id", kept.id);
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([filePath]);
    logAckReject(id, "insert_failed", file, {
      reason: insErr.message,
      verdict: result.verdict,
    });
    return NextResponse.json(
      { error: "Reconciled, but failed to save the result. Please retry." },
      { status: 500 }
    );
  }

  // Rows first, then the stored files (an orphan is the sweep's).
  let replacedFiles = 0;
  if (replaced.length > 0) {
    const { data: gone } = await supabase.from("order_attachments").delete().in("id", replaced).select("file_path");
    const paths = ((gone ?? []) as { file_path: string }[]).map((g) => g.file_path);
    replacedFiles = paths.length;
    await removeStoredFiles(paths);
  }

  return NextResponse.json({
    result,
    vendor: VENDOR,
    waypoint_order: ack.waypoint_order,
    po: ack.po,
    po_matches_order: poMatchesOrder,
    kept_file_id: kept.id,
    replaced_failed_files: replacedFiles,
    waypoint_line_count: ackLines.length,
    total_line_count: skuItems.length,
  });
});
