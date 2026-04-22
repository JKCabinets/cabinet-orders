"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Search, ChevronLeft, ShoppingBag, Check, ChevronDown, ChevronUp, Download } from "lucide-react";
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
  const [syncResult, setSyncResult] = useState<{ synced: number; products: number } | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ newly_imported: number; already_imported: number; total_in_shopify: number } | null>(null);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [selectedVendor, setSelectedVendor] = useState("");

  useEffect(() => { fetchProducts(); }, []);

  async function fetchProducts() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (selectedVendor) params.set("vendor", selectedVendor);
      const res = await fetch(`/api/shopify/sync?${params}`);
      const data = await res.json();
      if (data.data) {
        setProducts(data.data);
        const latest = data.data.reduce((a: ShopifyProduct, b: ShopifyProduct) =>
          new Date(a.synced_at) > new Date(b.synced_at) ? a : b, data.data[0]);
        if (latest?.synced_at) setLastSynced(latest.synced_at);
      }
    } catch {}
    setLoading(false);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setSyncResult({ synced: data.synced, products: data.products });
        await fetchProducts();
      }
    } catch {}
    setSyncing(false);
  }

  async function backfillOrders() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/shopify/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultMember: "GB" }),
      });
      const data = await res.json();
      if (data.ok) setBackfillResult(data);
    } catch {}
    setBackfilling(false);
  }

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
  const allVendors = [...new Set(products.map(p => p.vendor || "No vendor"))].sort();

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
          {backfillResult && (
            <span className="flex items-center gap-1 text-[11px] text-green-400">
              <Check className="w-3 h-3" /> {backfillResult.newly_imported} orders imported · {backfillResult.already_imported} already existed
            </span>
          )}
          {syncResult && !backfillResult && (
            <span className="flex items-center gap-1 text-[11px] text-green-400">
              <Check className="w-3 h-3" /> {syncResult.synced} variants from {syncResult.products} products
            </span>
          )}
          {lastSynced && !syncResult && (
            <span className="text-[10px] text-[#5a5650]">
              Synced {new Date(lastSynced).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={backfillOrders} disabled={backfilling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] disabled:opacity-50 transition-all">
            <Download className={`w-3.5 h-3.5 ${backfilling ? "animate-spin" : ""}`} />
            {backfilling ? "Importing..." : "Import orders"}
          </button>
          <button onClick={syncNow} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] disabled:opacity-50 transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync SKUs"}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Stats */}
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

        {/* Search + filters */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5a5650]" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchProducts()}
              placeholder="Search by SKU or product name..."
              className="w-full pl-9 pr-4 py-2.5 bg-[#181818] border border-[#2e2e2e] rounded-xl text-sm text-[#e8e2d4] placeholder:text-[#5a5650] focus:border-[#5a5650] focus:outline-none transition-colors" />
          </div>
          <select value={selectedVendor} onChange={e => { setSelectedVendor(e.target.value); setTimeout(fetchProducts, 0); }}
            className="px-3 py-2.5 bg-[#181818] border border-[#2e2e2e] rounded-xl text-sm text-[#9e9888] focus:border-[#5a5650] focus:outline-none appearance-none min-w-[160px]">
            <option value="">All vendors</option>
            {allVendors.map(v => <option key={v} value={v === "No vendor" ? "" : v}>{v}</option>)}
          </select>
          <button onClick={fetchProducts}
            className="px-3 py-2.5 bg-[#181818] border border-[#2e2e2e] rounded-xl text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] transition-all">
            Search
          </button>
        </div>

        {/* Setup notice */}
        {!loading && products.length === 0 && (
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl p-6 text-center mb-4">
            <ShoppingBag className="w-8 h-8 text-[#5a5650] mx-auto mb-3" />
            <p className="text-sm text-[#9e9888] mb-1">No products synced yet</p>
            <p className="text-xs text-[#5a5650] mb-4">Click Sync now to pull products from Shopify</p>
          </div>
        )}

        {/* Vendor groups */}
        {vendors.length > 0 && (
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
