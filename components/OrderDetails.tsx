"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Check, X, Pencil, AlertTriangle } from "lucide-react";
import { SkuItem } from "@/lib/data";
import { useStore } from "@/lib/store";
import { decodeSku } from "@/lib/skuDecoder";

interface OrderDetailsProps {
  orderId: string;
  doorStyle: string;
  color: string;
  skuItems: SkuItem[];
  productionStartDate?: string | null;
  productionEstFinishDate?: string | null;
  scheduledDeliveryDate?: string | null;
  readOnly?: boolean;
}

export function OrderDetails({ orderId, skuItems, readOnly = false }: OrderDetailsProps) {
  const { updateOrderDetails } = useStore();

  const [localSkuItems, setLocalSkuItems] = useState<SkuItem[]>(skuItems);
  const [addingItem, setAddingItem] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newDesc, setNewDesc] = useState("");
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [backorderIdx, setBackorderIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  // Vendor-by-SKU lookup. Fetched once on mount and used to group SKU
  // items by Vendor → Style+Color in the rendered list. Falls back
  // silently if the endpoint is unavailable — items just won't group.
  const [vendorBySku, setVendorBySku] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/vendors`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setVendorBySku(data.vendorBySku ?? {});
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  // Group SKU items by Vendor → Style/Color. The order of items within
  // each group preserves the original list order so users see SKUs
  // grouped together rather than re-sorted by code.
  const groupedSkuItems = useMemo(() => {
    interface Group {
      vendor: string;
      style: string;
      color: string;
      items: Array<{ item: SkuItem; index: number }>;
    }
    const map = new Map<string, Group>();
    localSkuItems.forEach((item, index) => {
      const vendor = item.sku ? (vendorBySku[item.sku] ?? "") : "";
      const decoded = item.sku ? decodeSku(item.sku) : null;
      const style = decoded?.doorStyle ?? "";
      const colorVal = decoded?.color ?? "";
      const key = `${vendor}|||${style}|||${colorVal}`;
      const group = map.get(key) ?? { vendor, style, color: colorVal, items: [] };
      group.items.push({ item, index });
      map.set(key, group);
    });
    // Sort: real vendors alphabetically first, then unassigned ("") last;
    // within a vendor, style+color alphabetical with empty trailing.
    return Array.from(map.values()).sort((a, b) => {
      if (!a.vendor && b.vendor) return 1;
      if (a.vendor && !b.vendor) return -1;
      if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor);
      if (a.style !== b.style) return a.style.localeCompare(b.style);
      return a.color.localeCompare(b.color);
    });
  }, [localSkuItems, vendorBySku]);

  // True when the order has multiple groups OR any group has a non-default
  // style/color/vendor. Used to decide whether to render the grouped
  // headers (vs. just a flat SKU list for simple manual orders).
  const shouldShowGroups = useMemo(() => {
    if (groupedSkuItems.length > 1) return true;
    const only = groupedSkuItems[0];
    return !!(only && (only.vendor || only.style || only.color));
  }, [groupedSkuItems]);

  async function saveSkuItems(items: SkuItem[]) {
    setLocalSkuItems(items);
    await updateOrderDetails(orderId, { sku_items: items });
    flash();
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function addSkuItem() {
    if (!newSku.trim()) return;
    const item: SkuItem = {
      sku: newSku.trim().toUpperCase(),
      quantity: parseInt(newQty) || 1,
      description: newDesc.trim() || undefined,
    };
    const updated = [...localSkuItems, item];
    await saveSkuItems(updated);
    setNewSku(""); setNewQty("1"); setNewDesc(""); setAddingItem(false);
  }

  async function removeSkuItem(idx: number) {
    const updated = localSkuItems.filter((_, i) => i !== idx);
    await saveSkuItems(updated);
  }

  async function updateSkuItem(idx: number, updates: Partial<SkuItem>) {
    const updated = localSkuItems.map((item, i) => i === idx ? { ...item, ...updates } : item);
    await saveSkuItems(updated);
    setEditingItemIdx(null);
  }

  /**
   * Save the backorder data for one SKU. Called from the inline editor.
   * Setting backordered=false also clears the date & notes so a re-toggle
   * later starts fresh.
   */
  async function saveBackorder(idx: number, data: { backordered: boolean; expected_ready_date?: string | null; backorder_notes?: string }) {
    const updates: Partial<SkuItem> = data.backordered
      ? {
          backordered: true,
          expected_ready_date: data.expected_ready_date || null,
          backorder_notes: data.backorder_notes ?? "",
        }
      : {
          backordered: false,
          expected_ready_date: null,
          backorder_notes: "",
        };
    const updated = localSkuItems.map((item, i) => i === idx ? { ...item, ...updates } : item);
    await saveSkuItems(updated);
    setBackorderIdx(null);
  }

  // Render one SKU row by index. Pulled out into a function so we can
  // reuse it across two layouts: the flat list (when there's nothing
  // to group on) and the grouped sections (when SKUs decode to
  // distinct vendor/style/color combinations).
  function renderSkuRow(item: SkuItem, idx: number) {
    const isBackordered = !!item.backordered;
    const todayIso = new Date().toISOString().split("T")[0];
    const isReady = isBackordered && item.expected_ready_date && item.expected_ready_date <= todayIso;
    const rowTint = isBackordered
      ? (isReady
          ? "bg-[rgba(76,175,122,0.06)] hover:bg-[rgba(76,175,122,0.10)]"
          : "bg-[rgba(224,128,48,0.06)] hover:bg-[rgba(224,128,48,0.10)]")
      : "hover:bg-[rgba(255,255,255,0.04)]";
    return (
      <div key={idx}>
        {editingItemIdx === idx ? (
          <EditSkuRow
            item={item}
            onSave={(updates) => updateSkuItem(idx, updates)}
            onCancel={() => setEditingItemIdx(null)}
          />
        ) : (
          <>
            <div className={`grid grid-cols-12 gap-1.5 items-center px-2 py-1.5 rounded-lg group transition-colors ${rowTint}`}>
              <span className="col-span-3 text-[11px] font-mono text-cream truncate">{item.sku}</span>
              <span className="col-span-1 text-[11px] text-cream/85 text-center font-medium">{item.quantity}</span>
              <span className="col-span-5 text-[11px] text-cream/85 truncate" title={item.description ?? ""}>
                {item.description ?? "—"}
              </span>
              <div className="col-span-3 flex items-center justify-end gap-1">
                <button
                  onClick={() => setBackorderIdx(backorderIdx === idx ? null : idx)}
                  className="flex items-center gap-1 text-[9px] font-medium px-2 py-0.5 rounded-full transition-colors uppercase tracking-wider"
                  style={
                    isBackordered
                      ? (isReady
                          ? { background: "rgba(143,190,112,0.14)", color: "#a0cc7a", border: "0.5px solid rgba(143,190,112,0.35)" }
                          : { background: "rgba(245,160,69,0.14)", color: "#f5b070", border: "0.5px solid rgba(245,160,69,0.40)" })
                      : { background: "rgba(255,255,255,0.04)", color: "rgba(232,227,218,0.65)", border: "0.5px solid rgba(255,255,255,0.12)" }
                  }
                  title={
                    isBackordered
                      ? (isReady
                          ? `Ready (expected ${item.expected_ready_date})`
                          : `Backordered${item.expected_ready_date ? ` until ${item.expected_ready_date}` : ""}`)
                      : "Mark as backordered"
                  }
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {isBackordered ? (isReady ? "ready" : "back") : "ok"}
                </button>
                {!readOnly && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingItemIdx(idx)} className="p-0.5 text-cream/65 hover:text-cream transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => removeSkuItem(idx)} className="p-0.5 text-cream/65 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {backorderIdx === idx && (
              <BackorderEditor
                item={item}
                onSave={(data) => saveBackorder(idx, data)}
                onCancel={() => setBackorderIdx(null)}
              />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="px-6 py-5 border-b border-white/10">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] uppercase tracking-[0.16em] text-cream/50 font-medium">Order details</p>
        {saved && <span className="text-[10px] text-cream/55 italic">Saved</span>}
      </div>

      {/* SKU Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-cream/55">SKUs &amp; quantities</p>
          {!readOnly && (
          <button
            onClick={() => setAddingItem(true)}
            className="flex items-center gap-1 text-[10px] text-cream/85 hover:text-[#e8e3da] transition-colors"
          >
            <Plus className="w-3 h-3" /> Add SKU
          </button>
          )}
        </div>

        {/* Add SKU form */}
        {addingItem && (
          <div className="mb-2 p-2.5 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg">
            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
              <input
                value={newSku}
                onChange={(e) => setNewSku(e.target.value.toUpperCase())}
                placeholder="SKU"
                autoFocus
                className="col-span-2 field-input text-[11px] font-mono py-1 px-2"
              />
              <input
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="Qty"
                type="number"
                min="1"
                className="col-span-1 field-input text-[11px] py-1 px-2 text-center"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="col-span-2 field-input text-[11px] py-1 px-2"
              />
            </div>
            <div className="flex gap-1.5">
              <button onClick={addSkuItem} disabled={!newSku.trim()} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40 transition-all">
                <Check className="w-3 h-3" /> Add
              </button>
              <button onClick={() => { setAddingItem(false); setNewSku(""); setNewQty("1"); setNewDesc(""); }} className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[rgba(255,255,255,0.10)] text-[11px] text-cream/85 hover:text-[#e8e3da] transition-all">
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* SKU list */}
        {localSkuItems.length === 0 && !addingItem ? (
          readOnly ? (
            <p className="text-[11px] text-cream/55 px-2 py-3">No SKUs recorded</p>
          ) : (
          <button
            onClick={() => setAddingItem(true)}
            className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-3 text-[11px] text-cream/55 hover:text-cream/85 hover:border-[rgba(86,100,72,0.55)] transition-colors"
          >
            + Add SKUs and quantities
          </button>
          )
        ) : (
          <div className="flex flex-col gap-1">
            {/* Header */}
            {localSkuItems.length > 0 && (
              <div className="grid grid-cols-12 gap-1.5 px-2 mb-0.5">
                <span className="col-span-3 text-[9px] uppercase tracking-widest text-cream/55">SKU</span>
                <span className="col-span-1 text-[9px] uppercase tracking-widest text-cream/55 text-center">Qty</span>
                <span className="col-span-5 text-[9px] uppercase tracking-widest text-cream/55">Description</span>
                <span className="col-span-3 text-[9px] uppercase tracking-widest text-cream/55 text-right pr-1">Status</span>
              </div>
            )}
            {shouldShowGroups ? (
              // Grouped rendering: Vendor → Style+Color headers, then rows
              groupedSkuItems.map((group, gi) => (
                <div key={`g-${gi}`} className="flex flex-col gap-1">
                  <GroupHeader vendor={group.vendor} style={group.style} color={group.color} />
                  {group.items.map(({ item, index }) =>
                    renderSkuRow(item, index)
                  )}
                </div>
              ))
            ) : (
              localSkuItems.map((item, idx) => renderSkuRow(item, idx))
            )}
            {localSkuItems.length > 0 && (
              <div className="flex items-center justify-between px-2 mt-1 pt-1.5 border-t border-[rgba(255,255,255,0.10)]">
                <span className="text-[10px] text-cream/55">Total pieces</span>
                <span className="text-[11px] font-medium text-cream/85">
                  {localSkuItems.reduce((sum, i) => sum + i.quantity, 0)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditSkuRow({ item, onSave, onCancel }: { item: SkuItem; onSave: (u: Partial<SkuItem>) => void; onCancel: () => void; }) {
  const [sku, setSku] = useState(item.sku);
  const [qty, setQty] = useState(String(item.quantity));
  const [desc, setDesc] = useState(item.description ?? "");

  return (
    <div className="grid grid-cols-12 gap-1.5 items-center px-1 py-1">
      <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} className="col-span-3 field-input text-[11px] font-mono py-1 px-2" />
      <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="1" className="col-span-1 field-input text-[11px] py-1 px-1 text-center" />
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className="col-span-6 field-input text-[11px] py-1 px-2" />
      <div className="col-span-2 flex gap-1">
        <button onClick={() => onSave({ sku, quantity: parseInt(qty) || 1, description: desc || undefined })} className="p-1 text-green-400 hover:text-green-300"><Check className="w-3 h-3" /></button>
        <button onClick={onCancel} className="p-1 text-cream/85 hover:text-[#e8e3da]"><X className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

/**
 * Inline editor for a single SKU's backorder state. Lets staff toggle the
 * backorder flag, set an expected ready date, and write a quick note.
 * Saving immediately persists via the parent's saveBackorder().
 */
function BackorderEditor({ item, onSave, onCancel }: {
  item: SkuItem;
  onSave: (data: { backordered: boolean; expected_ready_date?: string | null; backorder_notes?: string }) => void;
  onCancel: () => void;
}) {
  const [backordered, setBackordered] = useState(!!item.backordered);
  const [date, setDate] = useState(item.expected_ready_date ?? "");
  const [notes, setNotes] = useState(item.backorder_notes ?? "");

  return (
    <div
      className="mx-2 mt-1 mb-1 p-3 rounded-lg"
      style={{
        background: "rgba(224,128,48,0.05)",
        border: "0.5px dashed rgba(224,128,48,0.35)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(245,160,69,0.85)" }}>
          Backorder · <span className="font-mono normal-case text-[10px]">{item.sku}</span>
        </p>
        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: "rgba(232,227,218,0.75)" }}>
          <input
            type="checkbox"
            checked={backordered}
            onChange={(e) => setBackordered(e.target.checked)}
            className="accent-orange-500"
          />
          Mark as backordered
        </label>
      </div>

      {backordered && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="col-span-1">
            <p className="text-[9px] uppercase tracking-widest text-[rgba(232,227,218,0.40)] mb-1">Expected ready</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full field-input text-[11px] py-1 px-2"
            />
          </div>
          <div className="col-span-2">
            <p className="text-[9px] uppercase tracking-widest text-[rgba(232,227,218,0.40)] mb-1">Notes (internal)</p>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. vendor said 3 weeks"
              className="w-full field-input text-[11px] py-1 px-2"
            />
          </div>
        </div>
      )}

      <div className="flex gap-1.5 justify-end">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[rgba(255,255,255,0.10)] text-[11px] text-cream/85 hover:text-[#e8e3da] transition-all"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
        <button
          onClick={() => onSave({
            backordered,
            expected_ready_date: backordered ? (date || null) : null,
            backorder_notes: backordered ? notes : "",
          })}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[11px] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] transition-all"
        >
          <Check className="w-3 h-3" /> Save
        </button>
      </div>
    </div>
  );
}

/**
 * Section heading shown above a group of SKU rows. Renders as a
 * subtle banner with: Vendor (if known) — Style + Color label. Used
 * when an order contains SKUs spanning multiple vendor / style /
 * color combinations so the team can see the cabinet line at a glance.
 *
 * Empty values (e.g. unmapped vendor, undecodable SKU base) fall back
 * to italic placeholders so the row never looks broken.
 */
function GroupHeader({ vendor, style, color }: { vendor: string; style: string; color: string }) {
  const styleLabel = style ? style : "Unknown style";
  const colorLabel = color ? color : "Unknown color";
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 mt-2 rounded-md"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "0.5px solid rgba(255,255,255,0.10)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-cream/55">Vendor</span>
        <span className="text-[11px] font-medium text-cream">
          {vendor || <span className="italic text-cream/55">Unassigned</span>}
        </span>
      </div>
      <span className="text-cream/30">·</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-widest text-cream/55">Style</span>
        <span className="text-[11px] font-medium text-cream">
          {styleLabel}
          {color ? <span className="text-cream/65"> &middot; {colorLabel}</span> : null}
        </span>
      </div>
    </div>
  );
}
