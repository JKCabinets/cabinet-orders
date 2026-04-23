"use client";

import { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { Source, SkuItem } from "@/lib/data";

interface ShopifyProduct {
  id: string;
  sku: string;
  title: string;
  vendor: string;
  price: number;
  inventory_quantity: number;
}

interface NewOrderModalProps {
  tab: "orders" | "warranty";
  onClose: () => void;
}

const MODAL: React.CSSProperties = {
  background: "rgba(36,52,66,0.97)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 32px 80px rgba(0,0,0,0.5)",
};

const GLASS_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.18)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  borderRadius: "8px",
  color: "#e8e3da",
  fontFamily: "inherit",
  fontSize: "16px",
  padding: "7px 11px",
  width: "100%",
  transition: "border-color 0.15s",
};

const LABEL_CLS = "block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5";

export function NewOrderModal({ tab, onClose }: NewOrderModalProps) {
  const { addOrder, team } = useStore();
  const activeTeam = team.filter((m) => m.active);

  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState<Source>("Manual");
  const [member, setMember] = useState(activeTeam[0]?.initials ?? "AX");
  const [notes, setNotes] = useState("");
  const [doorStyle, setDoorStyle] = useState("");
  const [color, setColor] = useState("");
  const [skuItems, setSkuItems] = useState<SkuItem[]>([]);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [skuDropdownOpen, setSkuDropdownOpen] = useState(false);
  const [addingQty, setAddingQty] = useState("1");
  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    fetchProducts();
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function fetchProducts() {
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/shopify/sync");
      const data = await res.json();
      if (data.data) setAllProducts(data.data);
    } catch {}
    setLoadingProducts(false);
  }

  const vendors = [...new Set(allProducts.map((p) => p.vendor).filter(Boolean))].sort();

  const filteredProducts = allProducts
    .filter((p) => {
      const matchVendor = !selectedVendor || p.vendor === selectedVendor;
      const matchSearch =
        !skuSearch ||
        p.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
        p.title.toLowerCase().includes(skuSearch.toLowerCase());
      return matchVendor && matchSearch;
    })
    .slice(0, 50);

  function addSkuItem(product: ShopifyProduct) {
    const qty = parseInt(addingQty) || 1;
    const existing = skuItems.findIndex((i) => i.sku === (product.sku || product.id));
    if (existing >= 0) {
      setSkuItems((prev) => prev.map((item, idx) => idx === existing ? { ...item, quantity: item.quantity + qty } : item));
    } else {
      setSkuItems((prev) => [...prev, { sku: product.sku || product.id, quantity: qty, description: product.title }]);
    }
    setSkuSearch("");
    setSkuDropdownOpen(false);
  }

  function addManualSku() {
    if (!skuSearch.trim()) return;
    const qty = parseInt(addingQty) || 1;
    const key = skuSearch.trim().toUpperCase();
    const existing = skuItems.findIndex((i) => i.sku === key);
    if (existing >= 0) {
      setSkuItems((prev) => prev.map((item, idx) => idx === existing ? { ...item, quantity: item.quantity + qty } : item));
    } else {
      setSkuItems((prev) => [...prev, { sku: key, quantity: qty }]);
    }
    setSkuSearch("");
    setSkuDropdownOpen(false);
  }

  function removeSkuItem(idx: number) {
    setSkuItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateSkuQty(idx: number, qty: number) {
    setSkuItems((prev) => prev.map((item, i) => (i === idx ? { ...item, quantity: qty } : item)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addOrder({
      type: tab === "orders" ? "order" : "warranty",
      name, detail,
      sku: skuItems.map((i) => i.sku).join(", ") || "",
      source, member, notes,
      door_style: doorStyle,
      color,
      sku_items: skuItems,
    });
    onClose();
  }

  const totalPieces = skuItems.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center animate-fade-in"
      style={{ background: "rgba(0,0,0,0.60)" }}
    >
      <div
        className="w-full md:w-[520px] max-h-[92vh] rounded-t-2xl md:rounded-2xl overflow-hidden animate-slide-in flex flex-col"
        style={MODAL}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "0.5px solid rgba(255,255,255,0.15)" }}
        >
          <h2 className="text-sm font-semibold text-[#e8e3da]">
            {tab === "orders" ? "New order" : "New warranty claim"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-all hover:text-[#e8e3da]"
            style={{ color: "rgba(232,227,218,0.60)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5 overflow-y-auto">

          <Field label="Customer name" required>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              required
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          <Field label={tab === "orders" ? "Description" : "Issue description"}>
            <input
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={tab === "orders" ? "e.g. Full kitchen · shaker" : "e.g. Door hinge alignment"}
              style={GLASS_INPUT}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          {tab === "orders" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Door style">
                <input value={doorStyle} onChange={(e) => setDoorStyle(e.target.value)}
                  placeholder="e.g. Shaker" style={GLASS_INPUT}
                  className="placeholder:text-[rgba(232,227,218,0.20)]" />
              </Field>
              <Field label="Color">
                <input value={color} onChange={(e) => setColor(e.target.value)}
                  placeholder="e.g. White" style={GLASS_INPUT}
                  className="placeholder:text-[rgba(232,227,218,0.20)]" />
              </Field>
            </div>
          )}

          {/* SKU picker */}
          <div>
            <label className={LABEL_CLS}>SKUs & quantities</label>
            <div className="flex gap-2 mb-2">
              <select
                value={selectedVendor}
                onChange={(e) => { setSelectedVendor(e.target.value); setSkuSearch(""); }}
                style={{ ...GLASS_INPUT, padding: "7px 10px" }}
                className="flex-1 appearance-none text-xs"
              >
                <option value="">All vendors{loadingProducts ? " (loading…)" : ""}</option>
                {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <input
                type="number"
                value={addingQty}
                onChange={(e) => setAddingQty(e.target.value)}
                min="1"
                placeholder="Qty"
                style={{ ...GLASS_INPUT, width: "64px", textAlign: "center", padding: "7px 6px" }}
                className="text-xs"
              />
            </div>

            <div className="relative mb-2">
              <input
                value={skuSearch}
                onChange={(e) => { setSkuSearch(e.target.value); setSkuDropdownOpen(true); }}
                onFocus={() => setSkuDropdownOpen(true)}
                onBlur={() => setTimeout(() => setSkuDropdownOpen(false), 200)}
                placeholder={selectedVendor ? `Search ${selectedVendor} SKUs…` : "Search or type SKU…"}
                style={{ ...GLASS_INPUT, fontFamily: "var(--font-geist-mono, monospace)" }}
                className="text-xs placeholder:text-[rgba(232,227,218,0.20)]"
              />
              {skuDropdownOpen && (skuSearch || selectedVendor) && (
                <div
                  className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg overflow-hidden shadow-2xl max-h-52 overflow-y-auto"
                  style={{
                    background: "rgba(22,36,50,0.99)",
                    border: "0.5px solid rgba(255,255,255,0.18)",
                  }}
                >
                  {skuSearch && (
                    <button
                      type="button"
                      onMouseDown={addManualSku}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[rgba(255,255,255,0.20)]"
                      style={{ color: "#8fbe70", borderBottom: "0.5px solid rgba(255,255,255,0.20)" }}
                    >
                      <Plus className="w-3 h-3" />
                      Add &ldquo;{skuSearch.toUpperCase()}&rdquo; manually
                    </button>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-center text-[rgba(232,227,218,0.50)]">
                      {loadingProducts ? "Loading products…" : "No products found"}
                    </div>
                  ) : (
                    filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={() => addSkuItem(p)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-[rgba(255,255,255,0.20)] group"
                        style={{ borderBottom: "0.5px solid rgba(255,255,255,0.18)" }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-[#e8e3da] flex-shrink-0 text-[11px]">{p.sku || "—"}</span>
                          <span className="text-[rgba(232,227,218,0.35)] truncate">{p.title}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className={p.inventory_quantity > 0 ? "text-green-400 text-[10px]" : "text-red-400 text-[10px]"}>
                            {p.inventory_quantity}
                          </span>
                          <Plus className="w-3 h-3 text-[rgba(232,227,218,0.45)] group-hover:text-[rgba(232,227,218,0.60)]" />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {skuItems.length > 0 && (
              <div
                className="rounded-lg overflow-hidden"
                style={{
                  background: "rgba(0,0,0,0.15)",
                  border: "0.5px solid rgba(255,255,255,0.15)",
                }}
              >
                <div
                  className="grid grid-cols-12 gap-1 px-3 py-1.5"
                  style={{ borderBottom: "0.5px solid rgba(255,255,255,0.20)" }}
                >
                  <span className="col-span-4 text-[9px] uppercase tracking-widest text-[rgba(232,227,218,0.45)]">SKU</span>
                  <span className="col-span-1 text-[9px] uppercase tracking-widest text-[rgba(232,227,218,0.45)] text-center">Qty</span>
                  <span className="col-span-6 text-[9px] uppercase tracking-widest text-[rgba(232,227,218,0.45)]">Description</span>
                </div>
                {skuItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-1 items-center px-3 py-1.5 group hover:bg-[rgba(255,255,255,0.03)]"
                    style={{ borderBottom: "0.5px solid rgba(255,255,255,0.18)" }}
                  >
                    <span className="col-span-4 text-[11px] font-mono text-[#e8e3da] truncate">{item.sku}</span>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateSkuQty(idx, parseInt(e.target.value) || 1)}
                      min="1"
                      className="col-span-1 text-[11px] text-center bg-transparent text-[rgba(232,227,218,0.55)] w-full focus:outline-none"
                    />
                    <span className="col-span-6 text-[11px] text-[rgba(232,227,218,0.50)] truncate">{item.description ?? "—"}</span>
                    <button
                      type="button"
                      onClick={() => removeSkuItem(idx)}
                      className="col-span-1 opacity-0 group-hover:opacity-100 flex justify-end transition-all hover:text-red-400"
                      style={{ color: "rgba(232,227,218,0.60)" }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div
                  className="flex justify-between px-3 py-1.5"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.20)" }}
                >
                  <span className="text-[10px] text-[rgba(232,227,218,0.50)]">Total pieces</span>
                  <span className="text-[11px] font-medium text-[rgba(232,227,218,0.60)]">{totalPieces}</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
                style={GLASS_INPUT}
                className="appearance-none text-sm"
              >
                <option value="Manual">Manual</option>
                <option value="Shopify">Shopify</option>
              </select>
            </Field>
            <Field label="Team member">
              <select
                value={member}
                onChange={(e) => setMember(e.target.value)}
                style={GLASS_INPUT}
                className="appearance-none text-sm"
              >
                {activeTeam.map((m) => (
                  <option key={m.id} value={m.initials}>{m.initials} — {m.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
              style={{ ...GLASS_INPUT, resize: "none" }}
              className="placeholder:text-[rgba(232,227,218,0.20)]"
            />
          </Field>

          {/* Footer buttons */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-xs transition-all hover:text-[#e8e3da]"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "0.5px solid rgba(255,255,255,0.18)",
                color: "rgba(232,227,218,0.70)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
              style={{
                background: "rgba(86,100,72,0.22)",
                border: "0.5px solid rgba(86,100,72,0.70)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
                color: "#a0b890",
              }}
            >
              {tab === "orders" ? "Create order" : "Log claim"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.35)] mb-1.5`}>
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
