import { NextRequest, NextResponse } from "next/server";
import { requireAuth, escapeHtml, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { groupSkuItemsByStyle, decodeSku } from "@/lib/skuDecoder";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import type { SkuItem } from "@/lib/skuDecoder";

// Short alias since this file does a lot of escaping
const h = escapeHtml;
// Post-sanitize-refactor, every text column stores raw characters. Render
// is just "escape for HTML output." (Historically this composed with a
// decodeHtmlEntities call to undo legacy entity-encoded rows; the v11
// backfill removed those, and the Shopify webhook now decodes at ingress.)
const text = (s: unknown) => h(String(s ?? ""));

// Per-line review flags (Step 3/4) live in the sku_items JSONB. The export
// route types items via skuDecoder's SkuItem (no review fields), so read
// them through this narrow cast rather than widening that shared type.
type ReviewFields = { needs_review?: boolean; review_reason?: string };
const REVIEW_LABEL: Record<string, string> = {
  unmapped_value: "Unmapped value",
  decoder_unavailable: "Decoder unavailable",
  sku_mismatch: "SKU mismatch",
  missing_sku: "Missing SKU",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  // PDF generation is more expensive than regular reads — vendor lookup
  // hits shopify_products, full SKU decode runs per line item, and we may
  // render the whole acknowledgment template. Cap at 20/min to prevent
  // accidental loops or scripted abuse.
  const limited = await rateLimitOr429(req, 20, 60_000, "orders:export");
  if (limited) return limited;
  const { id } = await params;

  // Optional ?vendor= filter. When present, render only the line items for
  // that vendor; otherwise render the combined PDF as before. Unmapped SKUs
  // (no vendor in shopify_products and no order.vendor fallback) appear as
  // warning rows on every per-vendor PDF.
  const { searchParams } = new URL(req.url);
  const rawVendorParam = searchParams.get("vendor");
  const vendorFilter = rawVendorParam && rawVendorParam.length < 200
    ? rawVendorParam.trim()
    : null;

  // Fetch order
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !order) {
    return new NextResponse("Order not found", { status: 404 });
  }

  // ── Keyed By: prefer claimed_by / entered_by (the live ownership
  //    source the UI uses), fall back to the legacy `member` initials
  //    only when neither is set. Older orders may have a stale "GB"
  //    default in `member` from before the webhook fix; we still want
  //    the PDF to reflect the actual current owner.
  let keyedByName = "—";
  const ownerName = (order.entered_by as string | null) ?? (order.claimed_by as string | null) ?? null;
  if (ownerName) {
    keyedByName = ownerName;
  } else if (order.member) {
    const { data: teamMember } = await supabase
      .from("team_members")
      .select("name")
      .eq("initials", order.member)
      .single();
    keyedByName = teamMember?.name ?? order.member ?? "—";
  }

  // ── Vendor mapping for every SKU on the order ────────────────────────────
  const allSkuItems: SkuItem[] = Array.isArray(order.sku_items) ? order.sku_items : [];
  const vendorLookup = await lookupVendorsForSkus(allSkuItems, order.vendor);

  // The "Vendor" field on the order header. For a vendor-filtered export it's
  // the filtered vendor; otherwise fall back to the legacy logic (first SKU's
  // vendor, then order.vendor).
  let headerVendor = "";
  if (vendorFilter) {
    headerVendor = vendorFilter;
  } else if (order.vendor) {
    headerVendor = order.vendor;
  } else if (vendorLookup.uniqueVendors.length === 1) {
    // Single-vendor order — use that vendor in the header even without a filter
    headerVendor = vendorLookup.uniqueVendors[0];
  } else if (vendorLookup.uniqueVendors.length > 1) {
    headerVendor = vendorLookup.uniqueVendors.join(", ");
  }

  // If the filter is set but doesn't match any vendor on this order, 404.
  // Defensive — protects against a stale UI sending a vendor that no longer
  // has line items.
  if (vendorFilter && !vendorLookup.uniqueVendors.includes(vendorFilter)) {
    return new NextResponse(
      `No line items for vendor "${vendorFilter}" on this order`,
      { status: 404 }
    );
  }

  // ── Field mappings (raw — escaping happens at interpolation site) ────────
  const customerName        = order.name            || "";
  const shipToAddress       = order.ship_to         || "";
  const customerPhone       = order.customer_phone  || "";
  const customerEmail       = order.customer_email  || "";
  const specialInstructions = order.notes           || "";
  const internalNotes       = order.internal_notes  || "";
  const deliveryMethod      = order.delivery_method || "";
  const shopifyId           = order.shopify_id      || order.id || "—";
  const status              = order.stage           || "—";
  const orderedOn           = order.date            || "—";

  // ── Filter line items by vendor ──────────────────────────────────────────
  // For a per-vendor PDF: include items that belong to this vendor PLUS any
  // unassigned items (per the spec — they appear on every per-vendor PDF as
  // warning rows so they're easy to spot).
  // For the combined PDF: include everything.
  let filteredSkuItems: SkuItem[];
  const unassignedItems: SkuItem[] = [];

  if (vendorFilter) {
    filteredSkuItems = [];
    for (const item of allSkuItems) {
      if (!item.sku) continue;
      const v = vendorLookup.vendorBySku.get(item.sku);
      if (v === vendorFilter) {
        filteredSkuItems.push(item);
      } else if (!v) {
        unassignedItems.push(item);
      }
      // Items mapped to other vendors are skipped on this per-vendor PDF
    }
  } else {
    filteredSkuItems = allSkuItems;
  }

  // ── Group items: vendor → style+color → line items ──────────────────
  // For each rendered line item we need to know:
  //   (a) what vendor it belongs to (so we can group them)
  //   (b) what style/color group it sits in within that vendor
  // We bucket items by vendor first, then run groupSkuItemsByStyle()
  // within each bucket. Items with no vendor mapping are placed in a
  // synthetic "Unassigned" bucket only when there's something else to
  // contrast with — for single-vendor and per-vendor-filter exports we
  // skip the bucket header entirely so the PDF stays clean.
  const vendorBuckets = new Map<string, SkuItem[]>();
  for (const item of filteredSkuItems) {
    const vendor = item.sku ? (vendorLookup.vendorBySku.get(item.sku) ?? "") : "";
    const key = vendor || "Unassigned";
    const list = vendorBuckets.get(key) ?? [];
    list.push(item);
    vendorBuckets.set(key, list);
  }
  // Sort vendor headings alphabetically, but always push "Unassigned"
  // to the end so it doesn't precede real vendors.
  const orderedVendorKeys = Array.from(vendorBuckets.keys()).sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
  // Only render vendor headers when there are 2+ vendors AND we're not
  // already filtering to a single vendor. Single-vendor exports already
  // have the vendor in the page header; doubling up just adds noise.
  const showVendorHeaders = !vendorFilter && orderedVendorKeys.length > 1;

  let rowIndex = 1;
  const lineRows = orderedVendorKeys.map(vendorKey => {
    const items = vendorBuckets.get(vendorKey) ?? [];
    const groups = groupSkuItemsByStyle(items);

    const vendorHeader = showVendorHeaders
      ? `
    <tr class="vendor-row">
      <td colspan="6">
        <span class="vendor-label">Vendor</span>
        &nbsp;→&nbsp;
        <span class="vendor-name">${text(vendorKey)}</span>
      </td>
    </tr>`
      : "";

    const groupRows = groups.map(group => {
      const firstItem = group.items[0];
      const decoded = firstItem ? decodeSku(firstItem.sku) : null;
      const doorCode  = decoded?.doorCode  ?? "";
      const colorCode = decoded?.colorCode ?? "";

      const doorLabel  = doorCode
        ? `${text(group.doorStyle)} <span class="sku-code">"${h(doorCode)}"</span>`
        : text(group.doorStyle);
      const colorLabel = colorCode
        ? `${text(group.color)} <span class="sku-code">"${h(colorCode)}"</span>`
        : text(group.color);

      const sectionRow = `
    <tr class="section-row">
      <td colspan="6">
        <span class="section-label">Style</span>
        &nbsp;→&nbsp;
        <span class="section-style">${doorLabel} - ${colorLabel}</span>
      </td>
    </tr>`;

      const itemRows = group.items.map(item => {
        const displaySku = item.sku ?? "—";
        return `
    <tr>
      <td>${rowIndex++}</td>
      <td class="mono">${h(displaySku)}</td>
      <td>${text(item.description ?? "—")}</td>
      <td class="right">—</td>
      <td class="center">${h(item.quantity ?? 1)}</td>
      <td class="right">—</td>
    </tr>`;
      }).join("");

      return sectionRow + itemRows;
    }).join("");

    return vendorHeader + groupRows;
  }).join("");

  // ── Unassigned-SKU warning rows (per-vendor PDFs only) ───────────────────
  let unassignedRows = "";
  if (vendorFilter && unassignedItems.length > 0) {
    const items = unassignedItems.map(item => {
      const displaySku = item.sku ?? "—";
      return `
    <tr class="unassigned-row">
      <td>${rowIndex++}</td>
      <td class="mono">${h(displaySku)}</td>
      <td>${text(item.description ?? "—")} <span class="unassigned-pill">⚠ unmapped vendor</span></td>
      <td class="right">—</td>
      <td class="center">${h(item.quantity ?? 1)}</td>
      <td class="right">—</td>
    </tr>`;
    }).join("");

    unassignedRows = `
    <tr class="section-row unassigned-section">
      <td colspan="6">
        <span class="section-label" style="color:#c44">⚠ Unmapped SKUs</span>
        &nbsp;—&nbsp;
        <span class="section-style" style="color:#c44">These items aren&#x27;t mapped to any vendor. Verify before fulfilling.</span>
      </td>
    </tr>${items}`;
  }

  const exportedAt = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'unsafe-inline'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  // ── Page title — vendor-aware for per-vendor PDFs ────────────────────────
  const pageTitle = vendorFilter
    ? `Order ${order.id} — ${vendorFilter}`
    : `Order ${order.id}`;

  // Vendor sub-header — visible "VENDOR PDF" indicator (per #4c)
  const vendorSubHeader = vendorFilter
    ? `<div class="vendor-banner">For vendor: <strong>${h(vendorFilter)}</strong></div>`
    : "";

  // Needs-review banner — surfaces flagged lines on the printout so a
  // wrong-spec order isn't entered from a clean-looking PDF. Order-wide
  // (shown on the combined and per-vendor PDFs alike).
  const reviewLines = allSkuItems.filter(i => (i as ReviewFields).needs_review);
  const needsReviewBanner = reviewLines.length > 0
    ? `<div class="review-banner">\u26a0 NEEDS REVIEW \u2014 ${reviewLines.length} line${reviewLines.length > 1 ? "s" : ""}: `
      + reviewLines.map(i => `${h(i.sku || "\u2014")} (${h(REVIEW_LABEL[(i as ReviewFields).review_reason ?? ""] ?? "review")})`).join("; ")
      + `</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${h(pageTitle)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', Arial, sans-serif;
      font-size: 10px;
      color: #222;
      background: #fff;
      padding: 24px 32px;
      max-width: 760px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .logo-box {
      width: 48px; height: 48px;
      border: 2.5px solid #1a1a1a;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      line-height: 1;
    }
    .logo-jk       { font-size: 15px; font-weight: 800; letter-spacing: -1px; color: #1a1a1a; }
    .logo-cabinets { font-size: 5px; font-weight: 600; letter-spacing: 1.5px; color: #1a1a1a; text-transform: uppercase; margin-top: 2px; }
    .order-title   { font-size: 18px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
    .order-title span { font-weight: 400; }

    /* Vendor banner — only present on per-vendor PDFs */
    .vendor-banner {
      background: #f0f6fb;
      border: 1px solid #5a8fb8;
      border-left: 4px solid #2e5e8a;
      padding: 6px 12px;
      margin-bottom: 10px;
      font-size: 11px;
      color: #1a3e60;
      border-radius: 2px;
    }

    /* Needs-review banner — order has line items flagged for review */
    .review-banner {
      background: #fff4e6;
      border: 1px solid #e0a848;
      border-left: 4px solid #c9772e;
      padding: 8px 12px;
      margin-bottom: 10px;
      font-size: 11px;
      font-weight: 600;
      color: #7a4a12;
      border-radius: 2px;
    }

    .info-table { width: 100%; border-collapse: collapse; border: 1px solid #d0d0d0; margin-bottom: 10px; }
    .info-table td { padding: 4px 8px; border: 1px solid #d0d0d0; vertical-align: top; }
    .info-table .lbl { font-weight: 700; white-space: nowrap; width: 80px; color: #111; }
    .info-table .val { color: #333; }

    .customer-block { border: 1px solid #d0d0d0; padding: 8px 10px; margin-bottom: 10px; }
    .cust-row { display: flex; gap: 6px; margin-bottom: 4px; align-items: baseline; line-height: 1.3; }
    .cust-row:last-child { margin-bottom: 0; }
    .cust-lbl { font-weight: 700; white-space: nowrap; min-width: 120px; color: #111; }
    .cust-val { color: #333; border-bottom: 1px solid #ccc; flex: 1; min-height: 12px; }

    .items-table { width: 100%; border-collapse: collapse; border: 1px solid #d0d0d0; }
    .items-table th { background: #f5f5f5; font-weight: 700; padding: 5px 7px; border: 1px solid #d0d0d0; text-align: left; font-size: 9.5px; }
    .items-table td { padding: 5px 7px; border: 1px solid #d0d0d0; vertical-align: top; }
    .items-table .mono { font-family: 'Courier New', monospace; font-size: 9px; }
    .right  { text-align: right; }
    .center { text-align: center; }

    .section-row td { background: #fafafa; padding: 4px 7px; font-size: 9px; color: #444; }
    .section-label { display: inline-flex; align-items: center; gap: 4px; text-decoration: underline; font-weight: 500; }
    .section-style { font-weight: 600; }
    .sku-code { font-family: 'Courier New', monospace; font-weight: 400; font-size: 8.5px; color: #555; }

    /* Vendor heading — sits above style+color groups on multi-vendor exports */
    .vendor-row td {
      background: #1f2933;
      color: #fff;
      padding: 6px 8px;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .vendor-label { text-transform: uppercase; opacity: 0.65; font-weight: 500; }
    .vendor-name { font-weight: 700; font-size: 11px; }

    /* Unassigned SKU rows — warning treatment on per-vendor PDFs */
    .unassigned-section td { background: #fff5f5; }
    .unassigned-row td { background: #fff8f8; }
    .unassigned-pill {
      display: inline-block;
      font-size: 8px;
      font-weight: 700;
      padding: 1px 4px;
      margin-left: 4px;
      background: #fff;
      border: 1px solid #c44;
      color: #c44;
      border-radius: 2px;
      vertical-align: middle;
    }

    .internal-block {
      margin-top: 12px;
      border: 1.5px dashed #c44;
      background: #fff8f6;
      padding: 8px 10px;
    }
    .internal-banner {
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #c44;
      margin-bottom: 4px;
    }
    .internal-body {
      font-size: 10px;
      color: #333;
      white-space: pre-wrap;
      line-height: 1.4;
    }

    .footer { margin-top: 12px; font-size: 8px; color: #aaa; text-align: center; }

    @media print {
      body { padding: 0; max-width: 100%; }
      @page { margin: 10mm 10mm; size: letter portrait; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="text-align:right; margin-bottom:16px;">
    <button onclick="window.print()"
      style="padding:7px 18px; background:#1a1a1a; color:#fff; border:none; border-radius:5px;
             font-size:12px; cursor:pointer; font-family:inherit; font-weight:600;">
      ⬇ Save as PDF
    </button>
  </div>

  <div class="header">
    <div class="logo-box">
      <div class="logo-jk">JK</div>
      <div class="logo-cabinets">CABINETS</div>
    </div>
    <div class="order-title"><span>Order#</span> ${h(order.id)}</div>
  </div>

  ${needsReviewBanner}
  ${vendorSubHeader}

  <table class="info-table">
    <tbody>
      <tr>
        <td class="lbl">Keyed By</td>
        <td class="val">${h(keyedByName)}</td>
        <td class="lbl" style="width:110px">Delivery Method</td>
        <td class="val">${h(deliveryMethod)}</td>
      </tr>
      <tr>
        <td class="lbl">Ordered On</td>
        <td class="val" colspan="3">${h(orderedOn)}</td>
      </tr>
      <tr>
        <td class="lbl">Vendor</td>
        <td class="val" colspan="3">${h(headerVendor || "—")}</td>
      </tr>
      <tr>
        <td class="lbl">Shopify Id</td>
        <td class="val" colspan="3">${h(shopifyId)}</td>
      </tr>
      <tr>
        <td class="lbl">Status</td>
        <td class="val" colspan="3">${h(status)}</td>
      </tr>
    </tbody>
  </table>

  <div class="customer-block">
    <div class="cust-row">
      <span class="cust-lbl">Customer Name:</span>
      <span class="cust-val">${text(customerName)}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Ship To Address:</span>
      <span class="cust-val">${text(shipToAddress)}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Customer Phone:</span>
      <span class="cust-val">${text(customerPhone)}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Special instructions:</span>
      <span class="cust-val">${text(specialInstructions)}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Customer Email:</span>
      <span class="cust-val">${text(customerEmail)}</span>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th style="width:120px">Item</th>
        <th>Description</th>
        <th class="right" style="width:72px">Unit Price</th>
        <th class="center" style="width:62px">Quantity</th>
        <th class="right" style="width:72px">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || (vendorFilter && unassignedItems.length === 0
        ? `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;">No line items for vendor "${h(vendorFilter)}"</td></tr>`
        : !lineRows
          ? `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;">No line items recorded</td></tr>`
          : "")}
      ${unassignedRows}
    </tbody>
  </table>

  ${internalNotes ? `
  <div class="internal-block">
    <div class="internal-banner">⚠ Internal Notes — Not for Customer</div>
    <div class="internal-body">${text(internalNotes)}</div>
  </div>` : ""}

  <div class="footer">
    Exported ${h(exportedAt)} · JK Cabinets Order Management
  </div>


</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": csp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
