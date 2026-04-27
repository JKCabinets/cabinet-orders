"use client";

import { useState } from "react";
import { Plus, Trash2, Check, X, Pencil } from "lucide-react";
import { SkuItem } from "@/lib/data";
import { useStore } from "@/lib/store";

interface OrderDetailsProps {
  orderId: string;
  doorStyle: string;
  color: string;
  skuItems: SkuItem[];
}

export function OrderDetails({ orderId, doorStyle, color, skuItems }: OrderDetailsProps) {
  const { updateOrderDetails } = useStore();

  const [editingField, setEditingField] = useState<"door_style" | "color" | null>(null);
  const [fieldValue, setFieldValue] = useState("");
  const [localSkuItems, setLocalSkuItems] = useState<SkuItem[]>(skuItems);
  const [addingItem, setAddingItem] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newDesc, setNewDesc] = useState("");
  const [editingItemIdx, setEditingItemIdx] = useState<number | null>(null);
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
          onEdit={() => startEdit("door_style")}
          onEditChange={setFieldValue}
          onSave={saveField}
          onCancel={() => setEditingField(null)}
          placeholder="e.g. Shaker"
        />
        <DetailField
          label="Color"
          value={color}
          isEditing={editingField === "color"}
          editValue={fieldValue}
          onEdit={() => startEdit("color")}
          onEditChange={setFieldValue}
          onSave={saveField}
          onCancel={() => setEditingField(null)}
          placeholder="e.g. White"
        />
      </div>

      {/* SKU Items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)]">SKUs & quantities</p>
          <button
            onClick={() => setAddingItem(true)}
            className="flex items-center gap-1 text-[10px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors"
          >
            <Plus className="w-3 h-3" /> Add SKU
          </button>
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
          <button
            onClick={() => setAddingItem(true)}
            className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-3 text-[11px] text-[rgba(232,227,218,0.30)] hover:text-[rgba(232,227,218,0.50)] hover:border-[rgba(86,100,72,0.55)] transition-colors"
          >
            + Add SKUs and quantities
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Header */}
            {localSkuItems.length > 0 && (
              <div className="grid grid-cols-12 gap-1.5 px-2 mb-0.5">
                <span className="col-span-3 text-[9px] uppercase tracking-widest text-[#3e3e3e]">SKU</span>
                <span className="col-span-1 text-[9px] uppercase tracking-widest text-[#3e3e3e] text-center">Qty</span>
                <span className="col-span-7 text-[9px] uppercase tracking-widest text-[#3e3e3e]">Description</span>
              </div>
            )}
            {localSkuItems.map((item, idx) => (
              <div key={idx}>
                {editingItemIdx === idx ? (
                  <EditSkuRow
                    item={item}
                    onSave={(updates) => updateSkuItem(idx, updates)}
                    onCancel={() => setEditingItemIdx(null)}
                  />
                ) : (
                  <div className="grid grid-cols-12 gap-1.5 items-center px-2 py-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.04)] group transition-colors">
                    <span className="col-span-3 text-[11px] font-mono text-[#e8e3da] truncate">{item.sku}</span>
                    <span className="col-span-1 text-[11px] text-[rgba(232,227,218,0.50)] text-center font-medium">{item.quantity}</span>
                    <span className="col-span-6 text-[11px] text-[rgba(232,227,218,0.50)] truncate">{item.description ?? "—"}</span>
                    <div className="col-span-2 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditingItemIdx(idx)} className="p-0.5 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors">
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button onClick={() => removeSkuItem(idx)} className="p-0.5 text-[rgba(232,227,218,0.50)] hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
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

function DetailField({ label, value, isEditing, editValue, onEdit, onEditChange, onSave, onCancel, placeholder }: {
  label: string; value: string; isEditing: boolean; editValue: string;
  onEdit: () => void; onEditChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; placeholder: string;
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
        <button
          onClick={onEdit}
          className="w-full text-left px-2.5 py-1.5 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.10)] text-xs hover:border-[rgba(86,100,72,0.55)] transition-colors group"
        >
          {value ? (
            <span className="text-[#e8e3da]">{value}</span>
          ) : (
            <span className="text-[#3e3e3e]">{placeholder}</span>
          )}
          <Pencil className="w-2.5 h-2.5 text-[rgba(232,227,218,0.30)] float-right mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
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
