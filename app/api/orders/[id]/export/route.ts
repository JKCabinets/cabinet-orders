import { NextRequest, NextResponse } from "next/server";
import { requireAuth, escapeHtml, rateLimitOr429 } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { groupSkuItemsByStyle, decodeSku, doorStyleNameToCode, colorNameToCode } from "@/lib/skuDecoder";
import { lookupVendorsForSkus } from "@/lib/vendorLookup";
import type { SkuItem } from "@/lib/skuDecoder";
import { poReference, displayOrderNumber } from "@/lib/data";
import { latestAckByVendor } from "@/lib/acknowledgments";
import { customerIssues, ackIssues, ackNotesFor, keyedByName as keyedBy } from "@/lib/orderIssues";

// Short alias since this file does a lot of escaping
const h = escapeHtml;
// Post-sanitize-refactor, every text column stores raw characters. Render
// is just "escape for HTML output." (Historically this composed with a
// decodeHtmlEntities call to undo legacy entity-encoded rows; the v11
// backfill removed those, and the Shopify webhook now decodes at ingress.)
const text = (s: unknown) => h(String(s ?? ""));

// The JK Cabinets mark, inline (2026-10-07) -- from kitchen-logo_Green.svg, its
// fixed size removed so the page sets the height. Inline SVG needs nothing from
// the page's content-security policy, which allows no external images.
const LOGO_SVG = `<svg class="logo" role="img" aria-label="JK Cabinets" xmlns="http://www.w3.org/2000/svg" viewBox="326 158 1378 1702"> <g transform="translate(0.000000,2048.000000) scale(0.100000,-0.100000)" fill="#576257" stroke="none"> <path d="M5879 18623 c0 -21 -2 -2902 -4 -6403 -4 -6301 -5 -6367 -24 -6525 -34 -271 -58 -363 -135 -529 -70 -153 -212 -339 -306 -403 -14 -9 -27 -20 -30 -24 -3 -3 -30 -22 -60 -41 -180 -115 -405 -187 -684 -218 -282 -32 -540 -22 -881 35 -77 13 -166 27 -197 30 l-58 7 0 -1174 0 -1175 108 -17 c59 -9 188 -23 287 -31 99 -8 198 -17 220 -20 293 -31 902 -29 1273 5 322 29 377 39 718 124 480 121 957 364 1249 638 28 25 72 66 98 90 58 51 263 285 322 366 86 119 144 210 195 307 29 55 63 118 75 140 13 22 32 63 43 90 67 163 122 309 142 375 12 41 31 102 41 135 10 33 23 80 29 105 21 86 41 175 46 200 3 14 7 32 9 40 3 8 7 33 10 55 3 22 10 54 15 70 20 73 44 298 67 625 15 226 16 738 14 6455 -1 3416 -2 6321 -1 6458 l0 247 -1290 0 -1290 0 -1 -37z"/> <path d="M9187 18608 c-7 -65 -7 -13835 0 -13898 l5 -45 1104 0 1104 0 0 2220 0 2220 86 160 c76 142 262 511 290 576 5 13 28 60 51 104 22 44 71 143 107 220 37 77 71 147 75 155 28 48 240 479 245 498 7 19 29 34 24 15 -2 -8 20 -85 63 -223 12 -36 22 -73 24 -82 8 -41 78 -274 84 -283 5 -5 20 -57 36 -115 15 -58 31 -114 36 -125 4 -11 15 -45 23 -75 14 -51 69 -235 167 -565 22 -71 41 -138 44 -148 8 -35 58 -192 68 -217 5 -14 11 -37 13 -53 2 -15 10 -43 18 -62 14 -33 55 -166 138 -450 22 -77 60 -201 83 -275 24 -74 55 -175 70 -225 15 -49 29 -97 32 -105 3 -8 7 -26 9 -40 3 -13 32 -112 65 -220 32 -107 66 -217 74 -245 8 -27 35 -116 60 -197 25 -80 54 -177 64 -215 10 -37 40 -138 65 -223 26 -85 55 -184 65 -220 11 -36 37 -130 60 -210 40 -139 60 -204 135 -445 80 -255 126 -403 137 -445 7 -25 40 -137 75 -250 34 -113 70 -233 78 -267 9 -35 28 -90 43 -123 l26 -60 56 0 c31 -1 547 -1 1146 -1 880 0 1090 3 1089 13 -3 27 -47 187 -75 273 -16 50 -49 159 -74 243 -24 84 -60 203 -79 265 -18 61 -43 146 -55 187 -46 164 -76 263 -136 455 -78 245 -145 472 -151 505 -3 14 -23 79 -46 145 -34 100 -100 320 -113 375 -2 8 -20 69 -41 135 -20 66 -54 176 -75 245 -21 69 -43 139 -48 155 -6 17 -12 41 -14 55 -3 14 -21 77 -41 139 -20 63 -36 120 -36 127 0 8 -18 69 -41 136 -41 122 -64 199 -119 393 -48 169 -90 307 -110 367 -11 31 -22 71 -25 89 -3 18 -8 36 -11 41 -3 5 -8 20 -10 34 -3 15 -19 70 -36 123 -17 52 -32 100 -33 106 -1 5 -6 25 -10 43 -4 18 -12 35 -16 38 -5 3 -9 13 -9 22 0 15 -24 96 -97 327 -14 44 -36 118 -48 165 -13 47 -41 143 -63 214 -23 71 -39 133 -36 138 3 4 1 8 -4 8 -5 0 -12 8 -15 18 -30 104 -124 413 -143 467 -14 39 -27 79 -29 90 -3 11 -11 43 -19 70 -47 158 -110 377 -122 425 -8 30 -19 64 -24 75 -5 11 -29 88 -54 170 -25 83 -66 220 -91 305 -26 85 -49 164 -51 175 -2 11 -8 31 -14 45 -9 24 -93 301 -110 365 -4 17 -21 73 -38 125 -17 52 -38 122 -47 155 -25 91 -76 258 -85 280 -5 11 -11 34 -15 50 -3 17 -16 64 -29 105 -13 41 -30 100 -39 130 -8 30 -25 86 -36 124 -12 38 -21 82 -21 98 0 16 42 111 98 221 54 105 110 219 125 252 15 33 39 80 53 105 24 40 232 450 535 1053 61 120 124 241 141 270 17 28 61 113 98 187 228 458 466 927 580 1140 42 80 116 224 165 320 48 96 91 180 95 185 5 6 79 150 165 320 87 171 198 386 247 478 139 263 298 587 298 608 0 19 -22 19 -1103 19 l-1103 0 -24 -52 c-12 -29 -49 -109 -82 -178 -33 -69 -100 -210 -149 -315 -50 -104 -119 -248 -154 -320 -99 -203 -255 -531 -255 -538 0 -3 -45 -97 -101 -209 -55 -112 -132 -273 -171 -358 -39 -85 -113 -242 -164 -349 -52 -107 -94 -197 -94 -202 0 -4 -38 -86 -84 -181 -45 -95 -120 -252 -166 -348 -45 -96 -107 -227 -138 -290 -30 -63 -65 -137 -77 -165 -12 -27 -56 -121 -98 -207 -42 -86 -77 -159 -77 -162 0 -6 -110 -238 -210 -441 -122 -251 -210 -434 -210 -440 0 -4 -28 -63 -61 -133 -85 -175 -149 -311 -149 -316 0 -2 -18 -36 -41 -77 -22 -41 -56 -110 -75 -154 -20 -44 -72 -153 -117 -243 l-82 -163 -3 2920 -2 2921 -1104 0 -1104 0 -5 -52z"/> <path d="M9100 4156 c-173 -61 -233 -128 -301 -331 -23 -69 -23 -74 -27 -626 -3 -520 -2 -562 17 -652 51 -253 195 -387 431 -401 193 -12 352 63 437 205 45 75 63 189 63 395 l0 164 -154 0 -153 0 -5 -173 c-4 -153 -7 -178 -26 -219 -34 -69 -111 -96 -185 -64 -93 39 -97 63 -97 712 0 507 1 535 20 598 16 50 29 72 54 91 64 49 156 42 189 -14 29 -49 49 -159 47 -256 -2 -49 -2 -96 -1 -102 2 -20 269 -17 295 2 17 13 18 25 13 167 -9 256 -65 382 -203 464 -105 62 -299 81 -414 40z"/> <path d="M16240 4169 c-108 -18 -230 -96 -293 -186 -14 -21 -36 -77 -48 -123 -27 -108 -22 -287 10 -390 29 -91 155 -273 230 -331 14 -11 76 -69 137 -129 88 -87 118 -124 148 -182 72 -143 71 -277 -1 -345 -32 -30 -40 -33 -99 -33 -59 0 -69 3 -94 28 -37 37 -51 86 -57 200 l-5 92 -149 0 -149 0 0 -107 c0 -123 19 -225 55 -298 35 -71 117 -148 195 -181 61 -27 73 -28 215 -29 148 0 151 0 217 32 169 80 253 241 252 478 -1 131 -25 229 -81 332 -29 55 -77 108 -245 274 -179 178 -212 216 -238 271 -43 91 -49 174 -20 251 25 68 63 97 123 97 91 0 134 -60 144 -205 6 -83 7 -85 32 -86 97 -2 263 1 272 6 12 8 2 168 -17 253 -19 85 -47 136 -108 196 -107 106 -248 144 -426 115z"/> <path d="M10115 4128 c-2 -7 -9 -53 -15 -103 -6 -49 -22 -151 -35 -225 -41 -226 -44 -241 -64 -370 -11 -69 -31 -195 -45 -280 -14 -85 -35 -213 -46 -285 -11 -71 -29 -177 -40 -235 -10 -58 -31 -175 -45 -260 -15 -85 -29 -163 -31 -172 -5 -17 7 -18 150 -18 153 0 156 0 160 23 4 18 31 189 52 330 l6 37 76 1 c43 0 88 2 102 4 14 2 53 2 86 -2 l62 -5 11 -57 c11 -52 61 -321 61 -328 0 -2 75 -3 166 -3 l167 0 -7 33 c-4 17 -16 84 -27 147 -11 63 -27 151 -35 195 -8 44 -23 136 -34 205 -10 69 -35 208 -54 310 -19 102 -46 262 -61 355 -14 94 -30 190 -35 215 -5 25 -18 97 -30 160 -11 63 -27 149 -35 191 -8 42 -15 92 -15 112 l0 37 -220 0 c-168 0 -222 -3 -225 -12z m284 -863 c12 -77 23 -152 26 -165 3 -14 8 -47 11 -75 3 -27 10 -72 15 -99 17 -92 26 -86 -121 -86 l-130 0 0 33 c0 17 7 79 15 137 9 58 25 166 35 240 11 74 32 220 47 323 l28 188 26 -178 c15 -98 36 -241 48 -318z"/> <path d="M11008 3383 c-2 -417 -2 -858 0 -980 l2 -223 308 0 c392 0 432 9 548 125 49 49 65 72 83 126 55 167 54 500 -3 624 -29 65 -75 117 -132 150 l-45 27 43 27 c93 59 134 144 149 306 17 182 -23 367 -99 456 -39 45 -135 95 -211 109 -29 5 -186 10 -347 10 l-294 0 -2 -757z m549 456 c18 -12 44 -40 56 -63 19 -36 22 -56 22 -166 0 -105 -3 -131 -20 -164 -34 -68 -61 -81 -181 -84 l-104 -4 0 251 0 251 96 0 c81 0 102 -3 131 -21z m-2 -788 c86 -39 103 -83 104 -267 1 -205 -16 -275 -77 -303 -13 -6 -74 -11 -137 -11 l-115 0 0 294 0 295 38 4 c92 9 148 6 187 -12z"/> <path d="M12150 3160 l0 -980 155 0 155 0 1 108 c4 318 4 1829 1 1840 -3 9 -44 12 -158 12 l-154 0 0 -980z"/> <path d="M12680 3160 l0 -980 139 0 140 0 4 98 c3 53 3 371 0 707 -2 335 -2 608 0 605 5 -5 60 -209 102 -375 13 -55 38 -149 55 -210 17 -60 32 -117 34 -125 2 -8 20 -80 40 -160 48 -188 113 -432 132 -492 l16 -48 164 0 164 0 0 980 0 980 -145 0 -145 0 -2 -557 -3 -558 -21 85 c-20 81 -84 325 -173 670 -22 85 -54 200 -70 255 l-29 100 -201 3 -201 2 0 -980z"/> <path d="M13880 3723 c-1 -230 -2 -665 -3 -968 -2 -302 -1 -556 1 -562 3 -10 99 -13 433 -13 l429 0 0 145 0 145 -270 0 -270 0 0 300 0 300 214 0 215 0 3 113 c2 61 1 127 -1 145 l-3 32 -214 0 -214 0 0 250 0 250 270 0 270 0 0 140 0 140 -430 0 -430 0 0 -417z"/> <path d="M14800 4000 l0 -140 168 0 169 0 -2 -827 c-1 -456 0 -834 2 -840 4 -10 46 -13 165 -13 l160 0 -2 748 c-1 411 -2 789 -1 840 l1 92 159 0 159 0 4 37 c3 21 2 84 0 140 l-5 103 -488 0 -489 0 0 -140z"/> </g> </svg>`;

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

/**
 * A line's door style and colour WITH THEIR CODES, under its SKU (Garrett,
 * 2026-10-07): Waypoint orders by the codes -- Shaker is "410F", Painted Harbor
 * "PH" -- so every line carries them, not only its style band. Decoded from the
 * SKU when it embeds them (W939-410F-PH); otherwise the names stored at ingest
 * (door_style, color -- a configurator line) are turned back into codes. A name
 * with no code says so, in amber: the vendor cannot order it as it stands.
 */
function styleCodes(item: SkuItem): string {
  const d = decodeSku(item.sku);
  const doorStyle = d?.doorStyle || item.door_style || "";
  const color = d?.color || item.color || "";
  if (!doorStyle && !color) return "";
  const doorCode = d?.doorCode || (doorStyle ? doorStyleNameToCode()[doorStyle] : "") || "";
  const colorCode = d?.colorCode || (color ? colorNameToCode()[color] : "") || "";
  const part = (name: string, code: string) => !name ? ""
    : `${text(name)} ${code ? `<span class="sub-code">"${h(code)}"</span>` : `<span class="no-code">no code</span>`}`;
  return `<span class="code-sub">${[part(doorStyle, doorCode), part(color, colorCode)].filter(Boolean).join(" \u00b7 ")}</span>`;
}

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
  // ⚠ A NAME, NEVER AN ID (2026-10-07). claimed_by holds a team_members.id,
  // and this printed it as "Keyed By" on every claimed order's PDF.
  let claimerName: string | null = null;
  if (!order.entered_by && order.claimed_by) {
    const { data: claimer } = await supabase
      .from("team_members").select("name").eq("id", order.claimed_by).maybeSingle();
    claimerName = (claimer?.name as string | undefined) ?? null;
  }
  let keyedByName = keyedBy(order, () => claimerName) || "—";
  if (keyedByName === "—" && order.member) {
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

  // The vendor's acknowledgment, reconciled against the order (2026-10-07): the
  // latest per vendor this PDF covers. Each line that differs is told on its
  // line, as on the order modal's Full Order tab -- lib/orderIssues, one copy.
  const ack = ackIssues(await latestAckByVendor(
    order.id, vendorFilter ? [vendorFilter] : vendorLookup.uniqueVendors, order));

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
  // Battles-SHO-1049. Derived here rather than inline in the template so
  // the header, the PO row and the filename cannot drift apart.
  const poRef               = poReference(order);
  const orderNumber         = displayOrderNumber(order);
  // NO `|| order.id` FALLBACK. Ingest denormalises shopify_id onto the
  // first group only, so a hardware or sample group would otherwise print
  // its group handle in a field labelled "Shopify Id" -- a plausible-looking
  // wrong number is worse than an em dash. Falls back to the project id,
  // which at least identifies the right purchase.
  const shopifyId           = order.shopify_id      || orderNumber || "—";
  const status              = order.stage           || "—";
  const orderedOn           = order.date            || "—";

  // ⚠ ORDER ISSUES (Garrett, 2026-10-07): what a vendor cannot ship to, reach
  // or file without -- amber in its card and listed in the banner. The checks
  // live in lib/orderIssues, shared with the order modal.
  const issue = customerIssues(order);
  const orderIssues = Object.values(issue).filter(Boolean);
  // A card cell, amber when its value has an issue; "Missing" when it is empty.
  const flag = (bad: string) => (bad ? " issue" : "");
  const shown = (value: unknown) => String(value ?? "").trim() ? text(value) : `<span class="missing">Missing</span>`;

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
        const rf = item as ReviewFields;
        const reviewTag = rf.needs_review
          ? ` <span class="review-pill">\u26a0 ${h(REVIEW_LABEL[rf.review_reason ?? ""] ?? "review")}</span>`
          : "";
        const mainRow = `
    <tr class="${rf.needs_review || ackNotesFor(ack, item.sku).length > 0 ? "review-row" : ""}">
      <td>${rowIndex++}</td>
      <td class="code">${h(displaySku)}${styleCodes(item)}</td>
      <td>${text(item.description ?? "—")}${reviewTag}${ackNotesFor(ack, item.sku).map((t) => `<span class="ack-note">\u26a0 Acknowledgment: ${h(t)}</span>`).join("")}</td>
      <td class="center">—</td>
      <td class="center">${h(item.quantity ?? 1)}</td>
      <td class="center">—</td>
    </tr>`;
        // Attaching modification sub-SKUs — one indented sub-row each, so
        // the vendor sees exactly which mods to build under the cabinet.
        const mods = (item as { modifications?: Array<{ sku: string; label: string }> }).modifications ?? [];
        const modRows = mods.map(m => `
    <tr class="mod-row">
      <td></td>
      <td class="code mod-code">\u21b3 ${h(m.sku)}</td>
      <td class="mod-label" colspan="4">${text(m.label)}</td>
    </tr>`).join("");
        return mainRow + modRows;
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
      <td class="code">${h(displaySku)}${styleCodes(item)}</td>
      <td>${text(item.description ?? "—")} <span class="unassigned-pill">⚠ unmapped vendor</span></td>
      <td class="center">—</td>
      <td class="center">${h(item.quantity ?? 1)}</td>
      <td class="center">—</td>
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
    // ⚠ ARIZONA TIME (2026-10-07). Without a zone this printed the SERVER's
    // clock -- UTC -- so an export at 1:19 pm read "08:19 PM".
    timeZone: "America/Phoenix",
  });

  // The printed footer is a CSS string (the page's bottom margin box): the same
  // words as the on-screen footer, escaped for a CSS string, not for HTML.
  const footerCss = `Exported ${exportedAt} - JK Cabinets Order Management`
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");

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
  // The PO reference, not the group handle. This PDF goes to the
  // manufacturer, and "SHO-1048-CAB" is a string they have never seen --
  // whereas Battles-SHO-1048 is the whole point of the format.
  //
  // poRef is declared with the other field mappings above, so the header,
  // the PO row and this filename cannot drift apart. Declaring it a second
  // time here is TS2451, cannot redeclare a block-scoped variable.
  const pageTitle = vendorFilter
    ? `Order ${poRef} — ${vendorFilter}`
    : `Order ${poRef}`;

  // Vendor sub-header — visible "VENDOR PDF" indicator (per #4c)
  const vendorSubHeader = vendorFilter
    ? `<div class="vendor-banner">For vendor: <strong>${h(vendorFilter)}</strong></div>`
    : "";

  // Needs-review banner — surfaces flagged lines on the printout so a
  // wrong-spec order isn't entered from a clean-looking PDF. Order-wide
  // (shown on the combined and per-vendor PDFs alike).
  const reviewLines = filteredSkuItems.filter(i => (i as ReviewFields).needs_review);
  const reviewParts = reviewLines.length > 0
    ? [`${reviewLines.length} line${reviewLines.length > 1 ? "s" : ""}: `
      + reviewLines.map(i => `${h(i.sku || "\u2014")} (${h(REVIEW_LABEL[(i as ReviewFields).review_reason ?? ""] ?? "review")})`).join("; ")]
    : [];
  // The order's own issues join the lines' (2026-10-07).
  const ackParts = ack.count > 0
    ? [`${ack.count} acknowledgment discrepanc${ack.count === 1 ? "y" : "ies"}`
       + (ack.stale ? " (the acknowledgment is older than the order's last change)" : "")]
    : [];
  const bannerParts = [...reviewParts, ...ackParts, ...orderIssues.map((s) => h(s))];
  const needsReviewBanner = bannerParts.length > 0
    ? `<div class="review-banner">\u26a0 NEEDS REVIEW \u2014 ${bannerParts.join(" \u00b7 ")}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${h(pageTitle)}</title>
  <style>
    /* ⚠ THE DESIGN (Garrett's mockup, 2026-10-07). The OMS's sage, taken from the
       logo (#576257): a dark sage table head, pale sage bands, rounded cards.
       Every colour is printed: print-color-adjust keeps the bands on paper. */
    @import url('https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;1,400&display=swap');
    :root {
      --sage: #576257;  --sage-dark: #4c564c;  --band: #e3e9e3;
      --line: #dde2dd;  --soft: #f4f6f4;       --ink: #22281f;  --muted: #7d847d;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Lato', 'Helvetica Neue', Arial, sans-serif;
      font-size: 10px;
      color: var(--ink);
      background: #fff;
      padding: 28px 32px;
      max-width: 820px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* The one control on the page: a pill, as every action in the OMS. */
    .toolbar { text-align: right; margin-bottom: 18px; }
    .save-pdf {
      padding: 7px 18px; border-radius: 999px; border: none; cursor: pointer;
      background: var(--sage); color: #fff; font: inherit; font-size: 10.5px;
      font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    }

    .header { display: flex; align-items: center; gap: 24px; margin-bottom: 22px; }
    .logo { height: 74px; width: auto; flex-shrink: 0; display: block; }
    .title-block { flex: 1; min-width: 0; }
    .order-title { display: flex; align-items: baseline; gap: 14px; margin-bottom: 9px; }
    .order-label { font-size: 14px; color: var(--muted); }
    .order-number { font-size: 26px; font-weight: 700; color: #2b312c; letter-spacing: -0.2px; }

    /* "For vendor": the per-vendor PDF says whose it is, under the number. */
    .vendor-banner {
      background: var(--band); border-radius: 7px; padding: 7px 16px;
      font-size: 11px; color: #2b312c;
    }
    .vendor-banner strong { font-weight: 400; }

    /* Needs review: lines flagged at ingest, so a wrong-spec order is never
       entered from a clean-looking PDF. */
    .review-banner {
      background: #fdf2e1; border: 1px solid #e6b45f; border-radius: 8px;
      padding: 9px 16px; margin-bottom: 16px; font-size: 11px; font-weight: 700; color: #7a4a12;
    }

    .cards { display: grid; grid-template-columns: 0.96fr 1.04fr; gap: 16px; margin-bottom: 22px; }
    .card { border: 1px solid #d6dbd6; border-radius: 10px; padding: 4px 15px; }
    .kv { width: 100%; border-collapse: collapse; }
    .kv td { padding: 9px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
    .kv tr:last-child td { border-bottom: none; }
    .kv .lbl { color: var(--muted); font-size: 9px; white-space: nowrap; padding-right: 11px; }
    .kv .val { color: var(--ink); font-size: 10.5px; }
    .kv4 .lbl { width: 1%; }
    .kv4 .val { white-space: nowrap; padding-right: 11px; }
    .kv4 .val.small { font-size: 8.5px; padding-right: 0; }
    .kv2 .lbl { width: 112px; }

    /* Rounded by the TABLE, clipped, not by its first and last cells: a rounded
       cell's edge blends into the next and left a pale seam in the PDF. */
    .items-table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 9px 9px 0 0; overflow: hidden; }
    .items-table thead th {
      background: var(--sage-dark); color: #fff; font-weight: 700; font-size: 10px;
      text-align: left; padding: 12px 12px;
    }
    .items-table td {
      padding: 10px 12px; border-bottom: 1px solid var(--line);
      vertical-align: top; font-size: 10.5px; color: var(--ink);
    }
    /* Fine dividers between an item's columns, as the mockup. */
    .items-table tbody tr:not(.section-row):not(.vendor-row) td + td { border-left: 1px solid var(--line); }
    .items-table .code { color: var(--ink); }
    .center { text-align: center; }
    .right  { text-align: right; }

    .section-row td { background: var(--band); padding: 9px 12px; font-size: 10.5px; color: #2b312c; }
    .section-label { font-weight: 400; }
    .section-style { font-weight: 400; }
    .sku-code { font-weight: inherit; color: inherit; }

    .mod-row td { background: var(--soft); color: #8a918a; font-size: 9px; padding: 7px 12px; }
    .mod-row .mod-code { padding-left: 22px; }
    .mod-row .mod-label { font-style: italic; }

    /* Multi-vendor exports: a heading per vendor above its style groups. */
    .vendor-row td { background: var(--sage); color: #fff; padding: 8px 12px; font-size: 10.5px; }
    .vendor-label { text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
    .vendor-name { font-weight: 700; }

    .review-row td { background: #fdf2e1; }
    .review-pill, .unassigned-pill {
      display: inline-block; font-size: 8px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; border-radius: 999px; padding: 1px 7px; margin-left: 6px; vertical-align: 1px;
    }
    .review-pill { color: #7a4a12; background: #ffe9c9; border: 1px solid #e6b45f; }
    .unassigned-section td { background: #fbeeee; }
    .unassigned-row td { background: #fdf6f6; }
    .unassigned-pill { color: #b23a3a; background: #fff; border: 1px solid #d47a7a; }

    /* Internal notes: a row of the order card, below Status (2026-10-07). */
    .notes-row td { vertical-align: top; }
    .notes-row .lbl { color: #b23a3a; }
    .kv4 .notes-row .val { white-space: normal; padding-right: 0; }
    .notes-tag {
      display: inline-block; font-size: 7.5px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #b23a3a; border: 1px solid #e3a3a3;
      border-radius: 999px; padding: 1px 7px; margin-bottom: 4px;
    }
    .notes-body { font-size: 10px; color: #333; white-space: pre-wrap; line-height: 1.45; }

    /* An order issue: amber, as a line under review (2026-10-07). */
    .kv td.issue { background: #fdf2e1; }
    .kv td.issue.lbl { color: #8a5a1c; padding-left: 8px; border-radius: 6px 0 0 6px; }
    .kv td.issue.val { border-radius: 0 6px 6px 0; padding-right: 8px; }
    .missing, .no-code { color: #b5651d; font-style: italic; }
    /* What the acknowledgment says differs, on the line or the field (2026-10-07). */
    .ack-note { display: block; margin-top: 3px; font-size: 9px; font-style: italic; color: #9a5a12; }

    /* A line's door style and colour, with the codes it is ordered by. */
    .code-sub { display: block; margin-top: 3px; font-size: 9px; color: var(--muted); }
    .code-sub .sub-code { color: #4c564c; }

    .footer {
      margin-top: 30px; padding-top: 11px; border-top: 1px solid #ccd2cc;
      text-align: center; font-size: 9px; color: var(--muted);
    }

    /* ⚠ THE FOOTER PRINTS IN THE PAGE'S BOTTOM MARGIN (2026-10-07), at the foot
       of every page as the mockup -- and never over a row. A footer fixed to the
       page sat ON TOP of the last rows of a full page: on a three-page order it
       hid a modifier, which on a vendor PDF is a wrong order. A margin box lives
       outside the area rows can use. Chromium 131+ (Chrome, Edge); a browser
       without margin boxes prints no footer rather than a hidden row. */
    @page {
      size: letter portrait;
      margin: 10mm 10mm 16mm;
      @bottom-center {
        content: "${footerCss}";
        font-family: 'Lato', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9px; color: #7d847d;
        border-top: 1px solid #ccd2cc; vertical-align: top; padding-top: 3mm;
      }
    }
    @media print {
      body { padding: 0; max-width: none; }
      .footer { display: none; }
      .no-print { display: none !important; }
      /* A long order: the column heads repeat, and no row splits across pages. */
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>

  <div class="no-print toolbar">
    <button class="save-pdf" onclick="window.print()">Save as PDF</button>
  </div>

  <div class="header">
    ${LOGO_SVG}
    <div class="title-block">
      <div class="order-title"><span class="order-label">Order#</span><span class="order-number">${h(orderNumber)}</span></div>
      ${vendorSubHeader}
    </div>
  </div>

  ${needsReviewBanner}

  <div class="cards">
    <div class="card">
      <table class="kv kv4"><tbody>
        <tr><td class="lbl">Keyed By</td><td class="val">${h(keyedByName)}</td><td class="lbl">Delivery Method</td><td class="val small">${h(deliveryMethod)}</td></tr>
        <tr><td class="lbl">Ordered On</td><td class="val">${h(orderedOn)}</td><td class="lbl">Vendor</td><td class="val small">${h(headerVendor || "—")}</td></tr>
        <tr><td class="lbl${flag(issue.name)}">PO</td><td class="val${flag(issue.name)}">${h(poRef)}</td><td class="lbl">Shopify Id</td><td class="val small">${h(shopifyId)}</td></tr>
        <tr><td class="lbl">Status</td><td class="val">${h(status)}</td><td></td><td></td></tr>
        ${internalNotes ? `<tr class="notes-row"><td class="lbl">Internal notes</td><td class="val" colspan="3"><span class="notes-tag">Not for customer</span><div class="notes-body">${text(internalNotes)}</div></td></tr>` : ""}
      </tbody></table>
    </div>
    <div class="card">
      <table class="kv kv2"><tbody>
        <tr><td class="lbl${flag(issue.name || ack.fields.name || "")}">Customer Name:</td><td class="val${flag(issue.name || ack.fields.name || "")}">${shown(customerName)}${ack.fields.name ? `<span class="ack-note">${h(ack.fields.name)}</span>` : ""}</td></tr>
        <tr><td class="lbl${flag(issue.shipTo || ack.fields.address || "")}">Ship To Address:</td><td class="val${flag(issue.shipTo || ack.fields.address || "")}">${shown(shipToAddress)}${ack.fields.address ? `<span class="ack-note">${h(ack.fields.address)}</span>` : ""}</td></tr>
        <tr><td class="lbl${flag(issue.phone)}">Customer Phone:</td><td class="val${flag(issue.phone)}">${shown(customerPhone)}</td></tr>
        <tr><td class="lbl">Special instructions:</td><td class="val">${text(specialInstructions)}</td></tr>
        <tr><td class="lbl${flag(issue.email)}">Customer Email:</td><td class="val${flag(issue.email)}">${shown(customerEmail)}</td></tr>
      </tbody></table>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th style="width:196px">Item</th>
        <th>Description</th>
        <th class="center" style="width:76px">Unit Price</th>
        <th class="center" style="width:68px">Quantity</th>
        <th class="center" style="width:76px">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows || (vendorFilter && unassignedItems.length === 0
        ? `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;">No line items for vendor "${h(vendorFilter)}"</td></tr>`
        : !lineRows
          ? `<tr><td colspan="6" style="text-align:center;color:#aaa;padding:18px;">No line items recorded</td></tr>`
          : "")}
      ${unassignedRows}
      ${ack.extras.length > 0 ? `
    <tr class="section-row ack-extra-section"><td colspan="6">\u26a0 On the acknowledgment, not on the order</td></tr>`
        + ack.extras.map((e) => `
    <tr class="review-row"><td></td><td class="code">${h(e.sku)}</td><td colspan="4"><span class="ack-note">${h(e.text)}</span></td></tr>`).join("") : ""}
    </tbody>
  </table>


  <div class="footer">
    Exported ${h(exportedAt)} - JK Cabinets Order Management
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
