import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { groupSkuItemsByStyle } from "@/lib/skuDecoder";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  // Fetch order
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !order) {
    return new NextResponse("Order not found", { status: 404 });
  }

  // ── Keyed By: look up full name from team_members ────────────────────────
  const { data: teamMember } = await supabase
    .from("team_members")                        // ← correct table name
    .select("name")
    .eq("initials", order.member)
    .single();

  const keyedByName = teamMember?.name ?? order.member ?? "—";

  // ── Vendor: stored on order, or look up from shopify_products by SKU ─────
  let vendor = order.vendor || "";
  if (!vendor) {
    const skuItemsForVendor: { sku: string }[] = Array.isArray(order.sku_items) ? order.sku_items : [];
    const firstSkuFull = skuItemsForVendor.find(i => i.sku)?.sku ?? "";
    // shopify_products stores base variant SKU — strip door/color codes
    const firstSkuParts = firstSkuFull.split("-");
    const firstSku = firstSkuParts.length >= 3
      ? firstSkuParts.slice(0, firstSkuParts.length - 2).join("-")
      : firstSkuFull;
    if (firstSku) {
      const { data: product } = await supabase
        .from("shopify_products")
        .select("vendor")
        .eq("sku", firstSku)
        .single();
      if (product?.vendor) vendor = product.vendor;
    }
  }

  // ── Field mappings ────────────────────────────────────────────────────────
  const customerName        = order.name            || "";
  const shipToAddress       = order.ship_to         || "";
  const customerPhone       = order.customer_phone  || "";
  const customerEmail       = order.customer_email  || "";
  const specialInstructions = order.notes           || "";
  const deliveryMethod      = order.delivery_method || "";
  const shopifyId           = order.shopify_id      || order.id || "—";
  const status              = order.stage           || "—";
  const orderedOn           = order.date            || "—";

  // ── Line items grouped by door style + color decoded from SKU ────────────
  const skuItems: { sku: string; quantity: number; description?: string }[] =
    Array.isArray(order.sku_items) ? order.sku_items : [];

  const groups = groupSkuItemsByStyle(skuItems);

  let rowIndex = 1;
  const lineRows = groups.map(group => {
    const sectionRow = `
    <tr class="section-row">
      <td colspan="6">
        <span class="section-label">Section by groups</span>
        &nbsp;→&nbsp;
        <span class="section-style">Style: ${group.label}</span>
      </td>
    </tr>`;

    const itemRows = group.items.map(item => {
      const displaySku = item.sku ?? "—";
      return `
    <tr>
      <td>${rowIndex++}</td>
      <td class="mono">${displaySku}</td>
      <td>${item.description ?? "—"}</td>
      <td class="right">—</td>
      <td class="center">${item.quantity ?? 1}</td>
      <td class="right">—</td>
    </tr>`;
    }).join("");

    return sectionRow + itemRows;
  }).join("");

  const exportedAt = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Order ${order.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', Arial, sans-serif;
      font-size: 11px;
      color: #222;
      background: #fff;
      padding: 32px 40px;
      max-width: 860px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .logo-box {
      width: 48px; height: 48px;
      border: 2.5px solid #1a1a1a;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      line-height: 1;
    }
    .logo-jk       { font-size: 17px; font-weight: 800; letter-spacing: -1px; color: #1a1a1a; }
    .logo-cabinets { font-size: 5.5px; font-weight: 600; letter-spacing: 1.5px; color: #1a1a1a; text-transform: uppercase; margin-top: 2px; }
    .order-title   { font-size: 22px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
    .order-title span { font-weight: 400; }

    .info-table { width: 100%; border-collapse: collapse; border: 1px solid #d0d0d0; margin-bottom: 14px; }
    .info-table td { padding: 5px 10px; border: 1px solid #d0d0d0; vertical-align: top; }
    .info-table .lbl { font-weight: 700; white-space: nowrap; width: 90px; color: #111; }
    .info-table .val { color: #333; }

    .customer-block { border: 1px solid #d0d0d0; padding: 10px 12px; margin-bottom: 14px; }
    .cust-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: baseline; line-height: 1.4; }
    .cust-row:last-child { margin-bottom: 0; }
    .cust-lbl { font-weight: 700; white-space: nowrap; min-width: 138px; color: #111; }
    .cust-val { color: #333; border-bottom: 1px solid #ccc; flex: 1; min-height: 14px; }

    .items-table { width: 100%; border-collapse: collapse; border: 1px solid #d0d0d0; }
    .items-table th { background: #f5f5f5; font-weight: 700; padding: 6px 8px; border: 1px solid #d0d0d0; text-align: left; font-size: 10.5px; }
    .items-table td { padding: 6px 8px; border: 1px solid #d0d0d0; vertical-align: top; }
    .items-table .mono { font-family: 'Courier New', monospace; font-size: 10px; }
    .right  { text-align: right; }
    .center { text-align: center; }

    .section-row td { background: #fafafa; padding: 5px 8px; font-size: 10px; color: #444; }
    .section-label { display: inline-flex; align-items: center; gap: 4px; text-decoration: underline; font-weight: 500; }
    .section-style { font-weight: 600; }

    .footer { margin-top: 18px; font-size: 9px; color: #aaa; text-align: center; }

    @media print {
      body { padding: 0; }
      @page { margin: 16mm 12mm; size: letter; }
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
    <div class="order-title"><span>Order#</span> ${order.id}</div>
  </div>

  <table class="info-table">
    <tbody>
      <tr>
        <td class="lbl">Keyed By</td>
        <td class="val">${keyedByName}</td>
        <td class="lbl" style="width:110px">Delivery Method</td>
        <td class="val">${deliveryMethod}</td>
      </tr>
      <tr>
        <td class="lbl">Ordered On</td>
        <td class="val" colspan="3">${orderedOn}</td>
      </tr>
      <tr>
        <td class="lbl">Vendor</td>
        <td class="val" colspan="3">${vendor || "—"}</td>
      </tr>
      <tr>
        <td class="lbl">Shopify Id</td>
        <td class="val" colspan="3">${shopifyId}</td>
      </tr>
      <tr>
        <td class="lbl">Status</td>
        <td class="val" colspan="3">${status}</td>
      </tr>
    </tbody>
  </table>

  <div class="customer-block">
    <div class="cust-row">
      <span class="cust-lbl">Customer Name:</span>
      <span class="cust-val">${customerName}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Ship To Address:</span>
      <span class="cust-val">${shipToAddress}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Customer Phone:</span>
      <span class="cust-val">${customerPhone}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Special instructions:</span>
      <span class="cust-val">${specialInstructions}</span>
    </div>
    <div class="cust-row">
      <span class="cust-lbl">Customer Email:</span>
      <span class="cust-val">${customerEmail}</span>
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
      ${lineRows || `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;">No line items recorded</td></tr>`}
    </tbody>
  </table>

  <div class="footer">
    Exported ${exportedAt} · JK Cabinets Order Management
  </div>

  <script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 350));
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
