"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, Truck, Plus, Pencil, Trash2, Check, X, Mail, RefreshCw } from "lucide-react";
import Link from "next/link";

interface Vendor {
  id: number;
  name: string;
  rma_email: string | null;
  contact_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export default function VendorsAdminPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { fetchVendors(); }, []);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  async function fetchVendors() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      if (data.vendors) setVendors(data.vendors);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "Failed to load vendors");
    }
    setLoading(false);
  }

  async function createVendor(input: {
    name: string; rma_email: string; contact_name: string; notes: string;
  }) {
    const res = await fetch("/api/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast("err", data.error ?? "Failed to create");
      return false;
    }
    setVendors(prev => [...prev, data.vendor].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("ok", `Added ${data.vendor.name}`);
    return true;
  }

  async function updateVendor(id: number, input: Partial<Vendor>) {
    const res = await fetch(`/api/vendors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast("err", data.error ?? "Failed to update");
      return false;
    }
    setVendors(prev => prev.map(v => v.id === id ? data.vendor : v).sort((a, b) => a.name.localeCompare(b.name)));
    showToast("ok", `Updated ${data.vendor.name}`);
    return true;
  }

  async function deleteVendor(id: number) {
    const res = await fetch(`/api/vendors/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast("err", data.error ?? "Failed to delete");
      return;
    }
    const removed = vendors.find(v => v.id === id);
    setVendors(prev => prev.filter(v => v.id !== id));
    setConfirmDeleteId(null);
    showToast("ok", `Deleted ${removed?.name ?? "vendor"}`);
  }

  const withEmail = vendors.filter(v => v.rma_email);
  const withoutEmail = vendors.filter(v => !v.rma_email);

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 border-b border-[#2e2e2e] bg-[#181818]/90 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="flex items-center gap-1.5 text-xs text-[#9e9888] hover:text-[#e8e2d4] transition-colors mr-2">
            <ChevronLeft className="w-3.5 h-3.5" />Back
          </Link>
          <div className="w-px h-4 bg-[#2e2e2e]" />
          <Truck className="w-4 h-4 text-[#9e9888] ml-2" />
          <h1 className="text-sm font-medium text-[#e8e2d4]">Vendors</h1>
        </div>
        <div className="flex items-center gap-3">
          {toast && (
            <span className={`flex items-center gap-1 text-[11px] ${toast.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
              <Check className="w-3 h-3" /> {toast.text}
            </span>
          )}
          <button onClick={fetchVendors} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] disabled:opacity-50 transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button onClick={() => { setShowAddForm(true); setEditingId(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2e2e2e] text-xs text-[#9e9888] hover:text-[#e8e2d4] hover:border-[#5a5650] transition-all">
            <Plus className="w-3.5 h-3.5" /> Add vendor
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">Total vendors</p>
            <p className="text-2xl font-medium text-[#e8e2d4]">{vendors.length}</p>
          </div>
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">With RMA email</p>
            <p className="text-2xl font-medium text-green-400">{withEmail.length}</p>
          </div>
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl px-4 py-3.5">
            <p className="text-xs text-[#9e9888] mb-1">Missing email</p>
            <p className="text-2xl font-medium text-amber-400">{withoutEmail.length}</p>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <VendorForm
            onCancel={() => setShowAddForm(false)}
            onSubmit={async (input) => {
              const ok = await createVendor(input);
              if (ok) setShowAddForm(false);
            }}
          />
        )}

        {/* Vendors list */}
        {loading ? (
          <p className="text-center text-[11px] text-[#5a5650] py-12">Loading vendors…</p>
        ) : vendors.length === 0 ? (
          <div className="text-center py-12 bg-[#181818] border border-[#2e2e2e] rounded-xl">
            <Truck className="w-8 h-8 text-[#5a5650] mx-auto mb-3" />
            <p className="text-sm text-[#9e9888] mb-1">No vendors yet</p>
            <p className="text-xs text-[#5a5650]">Vendors found in Shopify product data should appear here automatically after migration v10 runs.</p>
          </div>
        ) : (
          <div className="bg-[#181818] border border-[#2e2e2e] rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#0f0f0f] border-b border-[#2e2e2e]">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9e9888]">Vendor</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9e9888]">RMA email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9e9888]">Contact</th>
                  <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9e9888]">Notes</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => (
                  <tr key={v.id} className="border-b border-[#2e2e2e] last:border-b-0">
                    {editingId === v.id ? (
                      <td colSpan={5} className="p-3">
                        <VendorForm
                          initial={v}
                          onCancel={() => setEditingId(null)}
                          onSubmit={async (input) => {
                            const ok = await updateVendor(v.id, input);
                            if (ok) setEditingId(null);
                          }}
                        />
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-[#e8e2d4] font-medium">{v.name}</td>
                        <td className="px-4 py-3">
                          {v.rma_email ? (
                            <span className="flex items-center gap-1.5 text-[#e8e2d4]">
                              <Mail className="w-3 h-3 text-[#9e9888]" />
                              {v.rma_email}
                            </span>
                          ) : (
                            <span className="text-amber-400/65 italic">not set</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#9e9888]">{v.contact_name || "—"}</td>
                        <td className="px-4 py-3 text-[#9e9888] truncate max-w-[200px]" title={v.notes ?? ""}>{v.notes || "—"}</td>
                        <td className="px-4 py-3">
                          {confirmDeleteId === v.id ? (
                            <div className="flex items-center gap-1.5 justify-end">
                              <button onClick={() => deleteVendor(v.id)} className="px-2 py-1 rounded text-[10px] bg-red-950/40 border border-red-800 text-red-300 hover:bg-red-950/60 transition-all">Confirm delete</button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-[#9e9888] hover:text-[#e8e2d4]">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 justify-end">
                              <button onClick={() => { setEditingId(v.id); setShowAddForm(false); }}
                                className="p-1.5 rounded hover:bg-[#2e2e2e] text-[#9e9888] hover:text-[#e8e2d4] transition-all" title="Edit">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setConfirmDeleteId(v.id)}
                                className="p-1.5 rounded hover:bg-[#2e2e2e] text-[#9e9888] hover:text-red-400 transition-all" title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[10px] text-[#5a5650] leading-relaxed">
          Vendor names match the &quot;Vendor&quot; field on Shopify products. The RMA email here pre-fills
          the To: address when a team member clicks &quot;Draft email&quot; on a damage report.
        </p>
      </div>
    </div>
  );
}

function VendorForm({ initial, onCancel, onSubmit }: {
  initial?: Partial<Vendor>;
  onCancel: () => void;
  onSubmit: (input: { name: string; rma_email: string; contact_name: string; notes: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rmaEmail, setRmaEmail] = useState(initial?.rma_email ?? "");
  const [contactName, setContactName] = useState(initial?.contact_name ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    await onSubmit({ name: name.trim(), rma_email: rmaEmail.trim(), contact_name: contactName.trim(), notes: notes.trim() });
    setSaving(false);
  }

  return (
    <div className="bg-[#0f0f0f] border border-[#2e2e2e] rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#9e9888] mb-1.5 block">Vendor name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            disabled={!!initial?.id}
            placeholder="e.g. CNC Cabinetry"
            className="w-full px-3 py-1.5 rounded-md bg-[#181818] border border-[#2e2e2e] text-xs text-[#e8e2d4] placeholder:text-[#5a5650] focus:border-[#5a5650] outline-none transition-colors disabled:opacity-50" />
          {initial?.id && (
            <p className="text-[10px] text-[#5a5650] mt-1">Name can&apos;t be changed once created — it must match Shopify exactly.</p>
          )}
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#9e9888] mb-1.5 block">RMA email</label>
          <input value={rmaEmail} onChange={e => setRmaEmail(e.target.value)}
            placeholder="rma@vendor.com"
            type="email"
            className="w-full px-3 py-1.5 rounded-md bg-[#181818] border border-[#2e2e2e] text-xs text-[#e8e2d4] placeholder:text-[#5a5650] focus:border-[#5a5650] outline-none transition-colors" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#9e9888] mb-1.5 block">Contact name (optional)</label>
          <input value={contactName} onChange={e => setContactName(e.target.value)}
            placeholder="e.g. Sarah Wilson"
            className="w-full px-3 py-1.5 rounded-md bg-[#181818] border border-[#2e2e2e] text-xs text-[#e8e2d4] placeholder:text-[#5a5650] focus:border-[#5a5650] outline-none transition-colors" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#9e9888] mb-1.5 block">Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Lead time, special instructions, etc."
            className="w-full px-3 py-1.5 rounded-md bg-[#181818] border border-[#2e2e2e] text-xs text-[#e8e2d4] placeholder:text-[#5a5650] focus:border-[#5a5650] outline-none transition-colors" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-xs text-[#9e9888] hover:text-[#e8e2d4] transition-colors">Cancel</button>
        <button onClick={handleSubmit} disabled={saving || !name.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#5a8d63]/45 bg-[#5a8d63]/15 text-xs text-[#a8d8b0] hover:bg-[#5a8d63]/25 disabled:opacity-40 transition-all">
          <Check className="w-3 h-3" />
          {saving ? "Saving…" : initial?.id ? "Save changes" : "Add vendor"}
        </button>
      </div>
    </div>
  );
}
