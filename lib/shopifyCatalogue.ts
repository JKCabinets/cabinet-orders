import { supabase } from "@/lib/supabase";
import { colorOptionOf } from "@/lib/shopifyColor";
import { isValidShopifyDomain, shopifyGraphql } from "@/lib/shopify";

/**
 * ⚠ THE CATALOGUE AS SHOPIFY HAS IT (2026-11-04, item 5 part 2). One home for
 * the three things shopify_products needs, so the admin page's "Sync SKUs", the
 * daily cron (app/api/cron/sync-shopify-catalog) and the product webhook cannot
 * drift apart:
 *   - THE READ, over GraphQL (lib/shopify's version): the whole catalogue
 *     (readCatalogue), or one product (readProduct);
 *   - THE ROW (catalogueRows): one row per variant, the ONE builder -- the Sync
 *     route and the webhook each built it until now;
 *   - THE RUN (runCatalogueSync): read whole, write, mark the rest removed
 *     (item 59), judge the colours (item 60).
 *
 * WHY GRAPHQL: REST 2024-01 (retired) returned at most 100 variants a product,
 * so every variant past the hundredth was never seen -- 85 of them on
 * 2026-11-03 -- and the full Sync marked them removed (SESSION-HANDOFF-
 * 2026-11-03.md §6.3). Garrett: "Should pull its truth from shopify and update
 * based on what actually live." Shopify's own answer is the truth; an event is
 * only the signal to read it.
 *
 * ⚠ NUMERIC IDS, ALWAYS. A row's id is the variant's REST id -- GraphQL's
 * `legacyResourceId` -- because order lines carry it (lib/vendorLookup reads
 * shopify_products.id by variant id) and every existing row is keyed by it. A
 * `gid://` id would make every row new and mark the whole catalogue removed, so
 * a read with any id that is not all digits is REFUSED, nothing written.
 */

const NUMERIC = /^\d+$/;

/** One variant, in the fields a row needs, as Shopify answers it. */
export interface CatalogueVariant {
  /** The variant's numeric id (`legacyResourceId`). */
  id: string;
  title: string;
  sku: string | null;
  /** Money, a decimal string ("1024.00"). */
  price: string | null;
  inventoryQuantity: number | null;
  selectedOptions: { name: string; value: string }[];
}

/** One product and ALL its variants. */
export interface CatalogueProduct {
  /** The product's numeric id (`legacyResourceId`). */
  id: string;
  title: string;
  vendor: string;
  options: { name: string; position: number }[];
  variants: CatalogueVariant[];
}

type Failed = { ok: false; error: string };

/**
 * The rows for one product: the shape the Sync wrote over REST, field for field
 * (title with the variant's name when the product has more than one; SKU "" when
 * Shopify has none -- the column is NOT NULL; vendor trimmed -- NOT NULL DEFAULT
 * ''; current; its Color option, read by lib/shopifyColor from the REST shape
 * built here, so that one reading stays shared).
 */
export function catalogueRows(product: CatalogueProduct, now: string): Record<string, unknown>[] {
  const several = product.variants.length > 1;
  const vendor = String(product.vendor ?? "").trim();
  // lib/shopifyColor reads REST's shapes: options with their positions, and the
  // variant's option1..option3. Built from GraphQL's names, matched by NAME.
  const restProduct = { options: product.options.map((o) => ({ name: o.name, position: o.position })) };
  return product.variants.map((v) => {
    const restVariant: Record<string, unknown> = {};
    for (const o of product.options) {
      const chosen = v.selectedOptions.find((s) => s.name === o.name);
      if (chosen) restVariant[`option${o.position}`] = chosen.value;
    }
    return {
      id: v.id,
      title: `${product.title}${several ? ` - ${v.title}` : ""}`,
      sku: String(v.sku ?? ""),
      vendor,
      variant_id: v.id,
      price: parseFloat(String(v.price ?? "0")),
      inventory_quantity: Number(v.inventoryQuantity ?? 0),
      synced_at: now,
      // Its product, and current: a variant Shopify returns again is no longer removed.
      product_id: product.id,
      removed_at: null,
      // Its Color option, and that its options were read (item 60).
      color_option: colorOptionOf(restProduct, restVariant),
      options_at: now,
    };
  });
}

// ─── The read ────────────────────────────────────────────────────────────────

const VARIANT_FIELDS = "legacyResourceId title sku price inventoryQuantity selectedOptions { name value }";

type GqlVariant = {
  legacyResourceId?: unknown; title?: unknown; sku?: unknown; price?: unknown;
  inventoryQuantity?: unknown; selectedOptions?: { name?: unknown; value?: unknown }[] | null;
};
type GqlProduct = { legacyResourceId?: unknown; title?: unknown; vendor?: unknown; options?: { name?: unknown; position?: unknown }[] | null };
type Page<T> = { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: T[] };
type CatalogueAnswer = { productVariants?: Page<GqlVariant & { product?: GqlProduct | null }> | null };
type ProductAnswer = { product?: (GqlProduct & { variants?: Page<GqlVariant> | null }) | null };

/**
 * ⚠ THE BUDGET COVERS EVERYTHING. lib/shopify's call bounds its own request, but
 * not the token it fetches first, so each read is raced against its whole
 * budget. A read writes nothing, so an answer that comes too late is ignored.
 */
function within<T>(ms: number, work: Promise<T>, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(late()), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function variantOf(n: GqlVariant): CatalogueVariant | string {
  const id = String(n.legacyResourceId ?? "");
  if (!NUMERIC.test(id)) return `Shopify answered a variant id that is not numeric (${JSON.stringify(id).slice(0, 60)})`;
  return {
    id,
    title: String(n.title ?? ""),
    sku: typeof n.sku === "string" ? n.sku : null,
    price: n.price == null ? null : String(n.price),
    inventoryQuantity: typeof n.inventoryQuantity === "number" ? n.inventoryQuantity : null,
    selectedOptions: (n.selectedOptions ?? []).map((s) => ({ name: String(s?.name ?? ""), value: String(s?.value ?? "") })),
  };
}

function productOf(p: GqlProduct): Omit<CatalogueProduct, "variants"> | string {
  const id = String(p.legacyResourceId ?? "");
  if (!NUMERIC.test(id)) return `Shopify answered a product id that is not numeric (${JSON.stringify(id).slice(0, 60)})`;
  return {
    id,
    title: String(p.title ?? ""),
    vendor: String(p.vendor ?? ""),
    options: (p.options ?? []).map((o, i) => ({ name: String(o?.name ?? ""), position: Number(o?.position ?? i + 1) })),
  };
}

/** Shopify's throttle, as lib/shopify's strict call reports it: a refusal that passes. */
function isThrottled(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\bThrottled\b/i.test(m) || /^Shopify GraphQL 429\b/.test(m);
}

const PAGE_SIZE = 200;
/** As the REST Sync's cap: a runaway answer cannot chain the run forever. */
const MAX_PAGES = 200;
/**
 * ⚠ THE WHOLE READ, inside kamal-proxy's 30 s with the writes still to come. MEASURED
 * in production on 2026-11-04 (item5p2-shopify-check.js): 14 pages in 7.7 s, a
 * token fetched for every call (lib/shopify). 15 s is about twice that, and
 * leaves the writes their half.
 */
const CATALOGUE_READ_MS = 15_000;
const PAGE_TIMEOUT_MS = 10_000;
const THROTTLE_WAIT_MS = 2_000;
const MAX_THROTTLE_WAITS = 5;

const CATALOGUE_QUERY = `query CatalogueVariants($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ${VARIANT_FIELDS} product { legacyResourceId title vendor options { name position } } }
  }
}`;

/**
 * The WHOLE catalogue, every variant of every product, 200 a page by cursor.
 * Read whole before anything is written: any page failing fails the read. A
 * throttled page waits and is asked again, at most five times and inside the
 * read's 20 s.
 */
type CatalogueRead = { ok: true; products: CatalogueProduct[] } | (Failed & { status: number });
export function readCatalogue(): Promise<CatalogueRead> {
  return within<CatalogueRead>(CATALOGUE_READ_MS, readCatalogueWhole(),
    () => ({ ok: false, status: 502, error: `Shopify's catalogue was not read within ${CATALOGUE_READ_MS / 1000}s` }));
}
async function readCatalogueWhole(): Promise<CatalogueRead> {
  const deadline = Date.now() + CATALOGUE_READ_MS;
  const products = new Map<string, CatalogueProduct>();
  const byId = new Map<string, Map<string, CatalogueVariant>>();
  let after: string | null = null;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) return { ok: false, status: 502, error: `Pagination cap reached (${MAX_PAGES} pages)` };
    let data: CatalogueAnswer | null = null;
    for (let waits = 0; ; waits++) {
      const left = deadline - Date.now();
      if (left <= 0) return { ok: false, status: 502, error: `Shopify's catalogue was not read within ${CATALOGUE_READ_MS / 1000}s (page ${page})` };
      try {
        data = await shopifyGraphql<CatalogueAnswer>(CATALOGUE_QUERY, { first: PAGE_SIZE, after }, Math.min(PAGE_TIMEOUT_MS, left));
        break;
      } catch (e) {
        if (isThrottled(e) && waits < MAX_THROTTLE_WAITS && deadline - Date.now() > THROTTLE_WAIT_MS) {
          await new Promise((r) => setTimeout(r, THROTTLE_WAIT_MS));
          continue;
        }
        return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const conn: CatalogueAnswer["productVariants"] = data?.productVariants;
    if (!conn || !Array.isArray(conn.nodes)) return { ok: false, status: 502, error: "Shopify answered no productVariants" };
    for (const n of conn.nodes) {
      const v = variantOf(n);
      if (typeof v === "string") return { ok: false, status: 502, error: v };
      if (!n.product) return { ok: false, status: 502, error: `Shopify answered variant ${v.id} without its product` };
      const p = productOf(n.product);
      if (typeof p === "string") return { ok: false, status: 502, error: p };
      if (!products.has(p.id)) { products.set(p.id, { ...p, variants: [] }); byId.set(p.id, new Map()); }
      byId.get(p.id)!.set(v.id, v); // a variant answered twice (the catalogue moved mid-read) counts once
    }
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor ?? null;
    if (!after) return { ok: false, status: 502, error: "Shopify said there is a next page but gave no cursor" };
  }
  for (const [id, p] of products) p.variants = [...byId.get(id)!.values()];
  return { ok: true, products: [...products.values()] };
}

const PRODUCT_PAGE_SIZE = 250;
/** Shopify allows a product 2,048 variants: nine pages of 250. */
const MAX_PRODUCT_PAGES = 10;
/**
 * ⚠ THE WEBHOOK HAS FIVE SECONDS IN ALL (Shopify's limit), and the writes come
 * after the read: the read gets three (Garrett, 2026-11-04).
 */
export const PRODUCT_READ_MS = 3_000;

const PRODUCT_QUERY = `query CatalogueProduct($id: ID!, $first: Int!, $after: String) {
  product(id: $id) {
    legacyResourceId title vendor options { name position }
    variants(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } }
  }
}`;

/**
 * ONE product and ALL its variants, paged past 250, inside `budgetMs` in all.
 * `product: null` is Shopify saying the product does not exist. Any failure --
 * an error, a refusal, the time running out -- is `ok: false`: a failed read,
 * which writes nothing.
 */
type ProductRead = { ok: true; product: CatalogueProduct | null } | Failed;
export function readProduct(productId: string, budgetMs = PRODUCT_READ_MS): Promise<ProductRead> {
  return within<ProductRead>(budgetMs, readProductWhole(productId, budgetMs),
    () => ({ ok: false, error: `product ${productId} was not read within ${budgetMs / 1000}s` }));
}
async function readProductWhole(productId: string, budgetMs: number): Promise<ProductRead> {
  if (!NUMERIC.test(productId)) return { ok: false, error: `not a product id: ${JSON.stringify(productId).slice(0, 40)}` };
  const deadline = Date.now() + budgetMs;
  let head: Omit<CatalogueProduct, "variants"> | null = null;
  const variants = new Map<string, CatalogueVariant>();
  let after: string | null = null;
  for (let page = 1; ; page++) {
    if (page > MAX_PRODUCT_PAGES) return { ok: false, error: `product ${productId}: more than ${MAX_PRODUCT_PAGES} pages of variants` };
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, error: `product ${productId} was not read within ${budgetMs / 1000}s` };
    let data: ProductAnswer;
    try {
      data = await shopifyGraphql<ProductAnswer>(PRODUCT_QUERY, { id: `gid://shopify/Product/${productId}`, first: PRODUCT_PAGE_SIZE, after }, left);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const p = data?.product;
    if (p === null || p === undefined) {
      if (page === 1) return { ok: true, product: null };
      return { ok: false, error: `product ${productId} disappeared between pages` };
    }
    if (!head) {
      const h = productOf(p);
      if (typeof h === "string") return { ok: false, error: h };
      if (h.id !== productId) return { ok: false, error: `asked for product ${productId}, Shopify answered ${h.id}` };
      head = h;
    }
    const conn = p.variants;
    if (!conn || !Array.isArray(conn.nodes)) return { ok: false, error: `product ${productId}: Shopify answered no variants list` };
    for (const n of conn.nodes) {
      const v = variantOf(n);
      if (typeof v === "string") return { ok: false, error: v };
      variants.set(v.id, v);
    }
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor ?? null;
    if (!after) return { ok: false, error: `product ${productId}: a next page with no cursor` };
  }
  return { ok: true, product: { ...head!, variants: [...variants.values()] } };
}

// ─── The run ─────────────────────────────────────────────────────────────────

export type CatalogueSyncResult =
  | { ok: true; synced: number; products: number; removed: number; discontinued: number; restored: number }
  | { ok: false; status: number; error: string };

/**
 * THE FULL SYNC, for the admin page's "Sync SKUs" and the daily cron alike.
 * Its answer is the one the admin page has always read.
 */
export async function runCatalogueSync(): Promise<CatalogueSyncResult> {
  if (!isValidShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN)) {
    return { ok: false, status: 500, error: "Invalid SHOPIFY_STORE_DOMAIN" };
  }
  if (!process.env.SHOPIFY_ADMIN_API_TOKEN && (!process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET)) {
    return { ok: false, status: 500, error: "Missing Shopify credentials" };
  }
  try {
    const read = await readCatalogue();
    if (!read.ok) return { ok: false, status: read.status, error: read.error };

    const now = new Date().toISOString();
    const rows = read.products.flatMap((p) => catalogueRows(p, now));
    // 500 a call (the REST Sync wrote 100): six calls for 2,622 rows, not 27 -- the
    // writes share the 30 s, and Supabase answered a call in up to 0.7 s on 2026-11-04.
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await supabase.from("shopify_products").upsert(rows.slice(i, i + batchSize), { onConflict: "id" });
      if (error) return { ok: false, status: 500, error: error.message };
    }

    // ⚠ THE REST IS MARKED REMOVED (item 59). The read above returned before
    // anything was written if any page failed, so reaching here means the WHOLE
    // catalogue. Never when Shopify returned nothing: an empty answer is far
    // likelier a fault than an empty store, and would mark everything.
    let removed = 0;
    if (rows.length > 0) {
      const { data: marked, error: markErr } = await supabase.rpc("shopify_mark_removed", { p_seen: rows.map((r) => String(r.id)) });
      if (markErr) return { ok: false, status: 500, error: markErr.message };
      removed = Number(marked ?? 0);
    }
    // ⚠ THEN THE COLOURS (item 60): a mapping no current variant uses is
    // discontinued, one used again is current. See sku_judge_discontinued().
    const { data: judged, error: judgeErr } = await supabase.rpc("sku_judge_discontinued");
    if (judgeErr) return { ok: false, status: 500, error: `the products were saved, but the colours were not judged: ${judgeErr.message}` };
    const j = (judged ?? {}) as { marked?: number; restored?: number };
    return { ok: true, synced: rows.length, products: read.products.length, removed,
      discontinued: Number(j.marked ?? 0), restored: Number(j.restored ?? 0) };
  } catch (err) {
    return { ok: false, status: 500, error: String(err) };
  }
}
