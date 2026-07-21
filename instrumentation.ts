// Next.js boot hook — warm the SKU mapping cache once at server startup so the
// first request already has it. Never throws: if the DB is unreachable at boot,
// we log and continue; the per-handler `await ensureSkuMaps()` calls are the
// self-healing safety net (they retry on the next request).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureSkuMaps } = await import("@/lib/skuMappings");
    await ensureSkuMaps();
    console.log("[instrumentation] sku_mappings cache warmed");
  } catch (e) {
    console.error("[instrumentation] sku_mappings warm failed (will lazy-load on first request):", e);
  }
}
