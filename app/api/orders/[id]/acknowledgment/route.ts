import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { decodeSku, type SkuItem } from "@/lib/skuDecoder";
import { parseWaypointAck, type Grid } from "@/lib/waypointAck";
import { reconcileAck, type OrderForReconcile } from "@/lib/reconcile";
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

export async function POST(
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

  // ── Parse the workbook into a 0-indexed cell grid (grid[0] = row 1) ──────
  let sheetName: string;
  let grid: Grid;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
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
    .select("id, name, ship_to, sku_items")
    .eq("id", id)
    .single();
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Filter the order's lines to the Waypoint family ─────────────────────
  // Post-fix orders store the full composite, whose 3-part door+color shape
  // identifies the family unambiguously (decodeSku sets doorCode only for the
  // Waypoint shape), so the variant_id resolver isn't needed here.
  const skuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const waypointLines = skuItems.filter((it) => {
    const d = decodeSku(it.sku);
    return !!(d && d.doorCode);
  });

  const orderForReconcile: OrderForReconcile = {
    id: order.id,
    name: order.name ?? "",
    ship_to: order.ship_to ?? "",
    sku_items: waypointLines.map((it) => ({
      sku: it.sku,
      quantity: Number(it.quantity) || 0,
      // Carry the line's modification sub-SKUs through; without them the mod
      // gate has nothing on the order side to compare against.
      //
      // SkuItem now carries modifications directly (unified in lib/data).
      modifications: (it.modifications ?? []).map((m) => m.sku),
    })),
  };

  const result = reconcileAck(ack, orderForReconcile);

  // PO cross-check (non-blocking): the team types the SHO id into Waypoint's PO field.
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const poMatchesOrder = ack.po ? norm(ack.po) === norm(order.id) : false;

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
  });
  if (insErr) {
    // Surface the failure — never report success on a failed write (Principle #3).
    logAckReject(id, "insert_failed", file, {
      reason: insErr.message,
      verdict: result.verdict,
    });
    return NextResponse.json(
      { error: "Reconciled, but failed to save the result. Please retry." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    result,
    vendor: VENDOR,
    waypoint_order: ack.waypoint_order,
    po: ack.po,
    po_matches_order: poMatchesOrder,
    waypoint_line_count: waypointLines.length,
    total_line_count: skuItems.length,
  });
}
