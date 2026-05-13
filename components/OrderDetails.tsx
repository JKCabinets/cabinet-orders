"use client";

import { useState } from "react";
import { Plus, Trash2, Check, X, Pencil, AlertTriangle } from "lucide-react";
import { SkuItem } from "@/lib/data";
import { useStore } from "@/lib/store";

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

export function OrderDetails({ orderId, doorStyle, color, skuItems, readOnly = false }: OrderDetailsProps) {
  const { updateOrderDetails } = useStore();

  const [editingField, setEditingField] = useState<"door_style" | "color" | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  const [localSkuItems, setLocalSkuItems] = useState<SkuItem[]>(skuItems);
  const [addingItem, setAddingItem] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newDesc, setNewDesc] = useState("");
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
  const [backorderIdx, setBackorderIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  function startEdit(field: "door_style" | "color") {
    setEditingField(field);
    setFieldValue(field === "door_style" ? doorStyle : color);
  }

  async function saveField() {
    if (!editingField) return;
    await updateOrderDetails(orderId, { [editingField]: fieldValue });
    setEditingField(null);
    flash();
  }

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

  return (
    <div className="p-5 border-b border-[rgba(255,255,255,0.10)]">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)]">Order details</p>
        {saved && <span className="text-[10px] text-green-400">Saved ✓</span>}
      </div>

      {/* Door Style & Color */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <DetailField
          label="Door style"
          value={doorStyle}
          isEditing={editingField === "door_style"}
          editValue={fieldValue}
          onEdit={() => !readOnly && startEdit("door_style")}
          onEditChange={setFieldValue}
          onSave={saveField}
          onCancel={() => setEditingField(null)}
          placeholder="e.g. Shaker"
          readOnly={readOnly}
        />
        <DetailField
          label="Color"
          value={color}
          isEditing={editingField === "color"}
          editValue={fieldValue}
          onEdit={() => !readOnly && startEdit("color")}
          onEditChange={setFieldValue}
          onSave={saveField}
          onCancel={() => setEditingField(null)}
          placeholder="e.g. White"
          readOnly={readOnly}
        />
      </div>

      {/* SKU Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)]">SKUs &amp; quantities</p>
          {!readOnly && (
          <button
            onClick={() => setAddingItem(true)}
            className="flex items-center gap-1 text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors"
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
              <button onClick={() => { setAddingItem(false); setNewSku(""); setNewQty("1"); setNewDesc(""); }} className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* SKU list */}
        {localSkuItems.length === 0 && !addingItem ? (
          readOnly ? (
            <p className="text-[11px] text-[rgba(232,227,218,0.25)] px-2 py-3">No SKUs recorded</p>
          ) : (
          <button
            onClick={() => setAddingItem(true)}
            className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-3 text-[11px] text-[rgba(232,227,218,0.30)] hover:text-[rgba(232,227,218,0.50)] hover:border-[rgba(86,100,72,0.55)] transition-colors"
          >
            + Add SKUs and quantities
          </button>
          )
        ) : (
          <div className="flex flex-col gap-1">
            {/* Header */}
            {localSkuItems.length > 0 && (
              <div className="grid grid-cols-12 gap-1.5 px-2 mb-0.5">
                <span className="col-span-3 text-[9px] uppercase tracking-widest text-cream/35">SKU</span>
                <span className="col-span-1 text-[9px] uppercase tracking-widest text-cream/35 text-center">Qty</span>
                <span className="col-span-5 text-[9px] uppercase tracking-widest text-cream/35">Description</span>
                <span className="col-span-3 text-[9px] uppercase tracking-widest text-cream/35 text-right pr-1">Status</span>
              </div>
            )}
            {localSkuItems.map((item, idx) => {
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
                        <span className="col-span-3 text-[11px] font-mono text-[#e8e3da] truncate">{item.sku}</span>
                        <span className="col-span-1 text-[11px] text-[rgba(232,227,218,0.50)] text-center font-medium">{item.quantity}</span>
                        <span className="col-span-5 text-[11px] text-[rgba(232,227,218,0.50)] truncate">
                          {item.description ?? "—"}
                        </span>

                        {/* Status column — backorder toggle is ALWAYS available
                            so staff can mark Shopify-sourced SKUs as backordered
                            (backorder data lives staff-side, not in Shopify).
                            Edit/delete are hidden in read-only mode. */}
                        <div className="col-span-3 flex items-center justify-end gap-1">
                          <button
                            onClick={() => setBackorderIdx(backorderIdx === idx ? null : idx)}
                            className="flex items-center gap-1 text-[9px] font-medium px-2 py-0.5 rounded-full transition-colors uppercase tracking-wider"
                            style={
                              isBackordered
                                ? (isReady
                                    ? { background: "rgba(143,190,112,0.14)", color: "#a0cc7a", border: "0.5px solid rgba(143,190,112,0.35)" }
                                    : { background: "rgba(245,160,69,0.14)", color: "#f5b070", border: "0.5px solid rgba(245,160,69,0.40)" })
                                : { background: "rgba(255,255,255,0.04)", color: "rgba(232,227,218,0.45)", border: "0.5px solid rgba(255,255,255,0.12)" }
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
                              <button onClick={() => setEditingItemIdx(idx)} className="p-0.5 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => removeSkuItem(idx)} className="p-0.5 text-[rgba(232,227,218,0.50)] hover:text-red-400 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Backorder editor (expanded) — also available in read-only mode */}
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
            })}
            {localSkuItems.length > 0 && (
              <div className="flex items-center justify-between px-2 mt-1 pt-1.5 border-t border-[rgba(255,255,255,0.10)]">
                <span className="text-[10px] text-[rgba(232,227,218,0.30)]">Total pieces</span>
                <span className="text-[11px] font-medium text-[rgba(232,227,218,0.50)]">
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

function DetailField({ label, value, isEditing, editValue, onEdit, onEditChange, onSave, onCancel, placeholder, readOnly }: {
  label: string; value: string; isEditing: boolean; editValue: string;
  onEdit: () => void; onEditChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; placeholder: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">{label}</p>
      {isEditing ? (
        <div className="flex gap-1">
          <input
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
            autoFocus
            placeholder={placeholder}
            className="flex-1 field-input text-xs py-1.5 px-2"
          />
          <button onClick={onSave} className="p-1.5 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(86,100,72,0.55)] text-[#e8e3da] hover:bg-[rgba(255,255,255,0.06)] transition-all">
            <Check className="w-3 h-3" />
          </button>
          <button onClick={onCancel} className="p-1.5 rounded-md border border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div
          onClick={readOnly ? undefined : onEdit}
          className={`w-full text-left px-2.5 py-1.5 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.10)] text-xs transition-colors group ${readOnly ? "cursor-default" : "hover:border-[rgba(86,100,72,0.55)] cursor-pointer"}`}
        >
          {value ? (
            <span className="text-[#e8e3da]">{value}</span>
          ) : (
            <span className="text-[#3e3e3e]">{placeholder}</span>
          )}
          {!readOnly && <Pencil className="w-2.5 h-2.5 text-[rgba(232,227,218,0.30)] float-right mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
      )}
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
        <button onClick={onCancel} className="p-1 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da]"><X className="w-3 h-3" /></button>
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
          className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all"
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
