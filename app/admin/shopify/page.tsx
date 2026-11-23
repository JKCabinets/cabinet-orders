"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Search, ChevronLeft, ShoppingBag, Check, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";

interface ShopifyProduct {
  id: string;
  title: string;
  sku: string;
  vendor: string;
  price: number;
  inventory_quantity: number;
  synced_at: string;
}

export default function ShopifySyncPage() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ synced: number; products: number; removed?: number; discontinued?: number; restored?: number } | null>(null);
  // ⚠ "Import orders" lived here until 2026-09-16, and "Backfill payments" until
  // 2026-11-05 -- see the notes below.
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState("");
  // The vendors to choose from: those of the last list loaded WITHOUT a vendor
  // filter, so picking one does not shrink the choice to that one.
  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  // ⚠ A FAILURE SAYS SO (2026-11-23, item 6 bundle 2). Both were an empty
  // `catch`: a refused sync stopped the spinner and said nothing, and a failed
  // load showed "No products synced yet", false, and an invitation to sync.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => { void fetchProducts(); }, []);

  /**
   * The list, for the filter GIVEN, defaulting to the current one.
   *
   * ⚠ THE VENDOR IS PASSED, NOT READ FROM STATE (2026-11-23). The vendor list
   * called this through setTimeout after setSelectedVendor -- but the function
   * it called was the previous render's, holding the vendor chosen BEFORE, so
   * each pick listed the one before it.
   */
  async function fetchProducts(vendor: string = selectedVendor, q: string = search) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (vendor) params.set("vendor", vendor);
      const res = await fetch(`/api/shopify/sync?${params}`);
      const data = await res.json().catch(() => null) as { data?: ShopifyProduct[]; error?: string } | null;
      if (!res.ok || !Array.isArray(data?.data)) {
        setLoadError(!res.ok ? (data?.error || `HTTP ${res.status}`) : "the answer held no product list");
        return;
      }
      const list = data.data;
      setLoadError(null);
      setProducts(list);
      if (!vendor) setVendorOptions([...new Set(list.map(p => p.vendor || "No vendor"))].sort());
      const latest = list.reduce((a: ShopifyProduct, b: ShopifyProduct) =>
        new Date(a.synced_at) > new Date(b.synced_at) ? a : b, list[0]);
      if (latest?.synced_at) setLastSynced(latest.synced_at);
    } catch {
      setLoadError("no answer from the server");
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json().catch(() => null) as
        { ok?: boolean; error?: string; synced: number; products: number; removed?: number; discontinued?: number; restored?: number } | null;
      if (res.ok && data?.ok) {
        setSyncResult({ synced: data.synced, products: data.products, removed: data.removed, discontinued: data.discontinued, restored: data.restored });
      } else {
        // The route's reason: lib/shopifyCatalogue's -- the 15 s read among them.
        setSyncError(`Sync failed: ${data?.error || `HTTP ${res.status}`}`);
      }
      // Reloaded either way: a sync can fail after writing part of the
      // catalogue, and the "Synced" time should say what is stored.
      await fetchProducts();
    } catch {
      setSyncError("No answer from the server — the sync may still have run. Reload in a minute to see its time.");
    } finally {
      setSyncing(false);
    }
  }

  /*
   * ⚠ "IMPORT ORDERS" WAS REMOVED 2026-09-16 (handoff item 15). It posted to
   * /api/shopify/orders, which inserted one `type: "order"` row per Shopify
   * order with NO project -- the shape from before projects existed, which the
   * archiving rule, the payment hold and the store all now read as a standalone
   * job. It had never run in this schema and nothing was live to import. A real
   * import, if one is ever needed, should create projects and groups the way
   * the webhook does, sharing its code rather than growing a second copy.
   */

  /*
   * ⚠ "BACKFILL PAYMENTS" WAS REMOVED 2026-11-05 (item 5 part 3). It walked
   * /api/admin/backfill-payment-status, which filled a Shopify project's
   * payment_status from REST 2024-01 -- the app's last REST call. Its job was
   * done: production had no Shopify project without a status, and the webhook
   * writes one on every project it creates and on every update
   * (SESSION-HANDOFF-2026-11-03.md §6.3, "Part 3").
   */

  function toggleVendor(vendor: string) {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(vendor)) next.delete(vendor);
      else next.add(vendor);
      return next;
    });
  }

  function expandAll() {
    setExpandedVendors(new Set(vendors));
  }

  function collapseAll() {
    setExpandedVendors(new Set());
  }

  // Group by vendor
  const grouped = products.reduce((acc, p) => {
    const v = p.vendor || "No vendor";
    if (!acc[v]) acc[v] = [];
    acc[v].push(p);
    return acc;
  }, {} as Record<string, ShopifyProduct[]>);

  const vendors = Object.keys(grouped).sort();
  const allVendors = vendorOptions;

  const totalInStock = products.filter(p => p.inventory_quantity > 0).length;
  const totalOutOfStock = products.filter(p => p.inventory_quantity <= 0).length;

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 border-b border-[#2e2e2e] bg-[#181818]/90 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="flex items-center gap-1.5 text-xs text-[#9e9888] hover:text-[#e8e2d4] transition-colors mr-2">
            <ChevronLeft className="w-3.5 h-3.5" />Back
          </Link>
          <div className="w-px h-4 bg-[#2e2e2e]" />
          <ShoppingBag className="w-4 h-4 text-[#9e9888] ml-2" />
          <h1 className="text-sm font-medium text-[#e8e2d4]">Shopify product sync</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* The "orders imported" banner went with the importer, 2026-09-16; the
              payment backfill's with its button, 2026-11-05. */}
          {syncResult && (
            <span className="flex items-center gap-1 text-[11px] text-green-400">
              <Check className="w-3 h-3" /> {syncResult.synced} variants from {syncResult.products} products
              {(syncResult.removed ?? 0) > 0 && ` · ${syncResult.removed} no longer in Shopify, hidden`}
              {(syncResult.discontinued ?? 0) > 0 && ` · ${syncResult.discontinued} colour${syncResult.discontinued === 1 ? "" : "s"} discontinued`}
              {(syncResult.restored ?? 0) > 0 && ` · ${syncResult.restored} colour${syncResult.restored === 1 ? "" : "s"} back in Shopify`}
            </span>
          )}
          {syncError && (
            <span role="alert" className="text-[11px] text-red-400 max-w-[28rem]">{syncError}</span>
          )}
          {lastSynced && !syncResult && (
            <span className="text-[10px] text-[#5a5650]">
              Synced {new Date(lastSynced).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {/* "Backfill payments" removed 2026-11-05 and "Import orders" 2026-09-16;
              see the notes above. */}
          <button onClick={syncNow} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] disabled:opacity-50 transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync SKUs"}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* A failed load, in place of the stats and the list: they would read
            as an empty catalogue, which it is not (2026-11-23). */}
        {loadError && (
          <div role="alert" className="bg-[#181818] border border-red-900/50 rounded-xl p-6 text-center mb-6">
            <p className="text-sm text-red-400 mb-3">Could not load the catalogue: {loadError}</p>
            <button onClick={() => void fetchProducts()} disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] disabled:opacity-50 transition-all">
              {loading ? "Loading..." : "Try again"}
            </button>
          </div>
        )}

        {/* Stats */}
        {!loadError && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">Total SKUs</p>
            <p className="text-2xl font-medium text-[#e8e2d4]">{products.length}</p>
          </div>
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">Vendors</p>
            <p className="text-2xl font-medium text-[#e8e2d4]">{vendors.length}</p>
          </div>
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">In stock</p>
            <p className="text-2xl font-medium text-green-400">{totalInStock}</p>
          </div>
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">Out of stock</p>
            <p className="text-2xl font-medium text-red-400">{totalOutOfStock}</p>
          </div>
        </div>
        )}

        {/* Search + filters */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5a5650]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") void fetchProducts(); }}
              placeholder="Search by SKU or product name..."
              className="field-glass w-full pl-9 pr-4 py-2.5 rounded-xl text-sm focus:outline-none transition-colors" />
          </div>
          {/* The vendor chosen goes to the fetch directly -- see fetchProducts. */}
          <select value={selectedVendor} onChange={e => { const v = e.target.value; setSelectedVendor(v); void fetchProducts(v); }}
            className="field-glass px-3 py-2.5 rounded-xl text-sm focus:outline-none appearance-none min-w-[160px]">
            <option value="">All vendors</option>
            {allVendors.map(v => <option key={v} value={v === "No vendor" ? "" : v}>{v}</option>)}
          </select>
          <button onClick={() => void fetchProducts()}
            className="px-3 py-2.5 bg-[#181818] border border-[#2e2e2e] rounded-xl text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] transition-all">
            Search
          </button>
        </div>

        {/* Setup notice */}
        {!loading && !loadError && products.length === 0 && (
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl p-6 text-center mb-4">
            <ShoppingBag className="w-8 h-8 text-[#5a5650] mx-auto mb-3" />
            <p className="text-sm text-[#9e9888] mb-1">No products synced yet</p>
            <p className="text-xs text-[#5a5650] mb-4">Click Sync SKUs to pull products from Shopify</p>
          </div>
        )}

        {/* Vendor groups */}
        {!loadError && vendors.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#5a5650]">{vendors.length} vendor{vendors.length !== 1 ? "s" : ""} · {products.length} SKUs</p>
              <div className="flex gap-2">
                <button onClick={expandAll} className="text-[11px] text-[#9e9888] hover:text-[#e8e2d4] transition-colors">Expand all</button>
                <span className="text-[#3e3e3e]">·</span>
                <button onClick={collapseAll} className="text-[11px] text-[#9e9888] hover:text-[#e8e2d4] transition-colors">Collapse all</button>
              </div>
            </div>

            {vendors.map(vendor => {
              const items = grouped[vendor];
              const isExpanded = expandedVendors.has(vendor);
              const inStock = items.filter(p => p.inventory_quantity > 0).length;

              return (
                <div key={vendor} className="bg-[#181818] border border-[#2e2e2e] rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleVendor(vendor)}
                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-[#1e1e1e] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-[#e8e2d4]">{vendor}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#111] border border-[#2e2e2e] text-[#5a5650]">
                        {items.length} SKU{items.length !== 1 ? "s" : ""}
                      </span>
                      {inStock > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-green-900/30 border border-green-800/50 text-green-400">
                          {inStock} in stock
                        </span>
                      )}
                      {items.length - inStock > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-900/30 border border-red-800/50 text-red-400">
                          {items.length - inStock} out of stock
                        </span>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-[#5a5650]" /> : <ChevronDown className="w-4 h-4 text-[#5a5650]" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[#2e2e2e]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-[#2e2e2e]">
                            <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-widest text-[#5a5650] font-medium">SKU</th>
                            <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#5a5650] font-medium">Product</th>
                            <th className="text-right px-3 py-2.5 text-[10px] uppercase tracking-widest text-[#5a5650] font-medium">Price</th>
                            <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-widest text-[#5a5650] font-medium">Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(p => (
                            <tr key={p.id} className="border-b border-[#2e2e2e]/50 hover:bg-[#1e1e1e] transition-colors last:border-0">
                              <td className="px-4 py-2.5 font-mono text-[#e8e2d4]">{p.sku || <span className="text-[#3e3e3e]">—</span>}</td>
                              <td className="px-3 py-2.5 text-[#9e9888] max-w-[280px] truncate">{p.title}</td>
                              <td className="px-3 py-2.5 text-right text-[#9e9888]">${Number(p.price).toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right">
                                <span className={p.inventory_quantity > 0 ? "text-green-400" : "text-red-400"}>
                                  {p.inventory_quantity}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
