"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, Plus, X, Check, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";

interface DamageReport {
  id: number;
  order_id: string;
  damage_type: string;
  affected_skus: string[];
  description: string;
  cause: string;
  resolution: string;
  status: "open" | "in_progress" | "resolved";
  reported_by: string;
  created_at: string;
}

const DAMAGE_TYPES = [
  "Finish defect", "Door alignment", "Hinge/hardware failure",
  "Structural damage", "Wrong size/dimensions", "Wrong color/finish",
  "Missing parts", "Shipping damage", "Installation damage", "Other",
];

const CAUSES = [
  "Manufacturing defect", "Shipping damage",
  "Installation error", "Customer damage", "Unknown",
];

const STATUS_STYLES = {
  open:        { label: "Open",        color: "bg-red-900/40 text-red-400 border-red-800/50" },
  in_progress: { label: "In progress", color: "bg-amber-900/40 text-amber-400 border-amber-800/50" },
  resolved:    { label: "Resolved",    color: "bg-green-900/40 text-green-400 border-green-800/50" },
};

interface DamageReportPanelProps {
  orderId: string;
  orderSkus?: string[];
}

export function DamageReportPanel({ orderId, orderSkus = [] }: DamageReportPanelProps) {
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [damageType, setDamageType] = useState("");
  const [affectedSkus, setAffectedSkus] = useState<string[]>([]);
  const [customSku, setCustomSku] = useState("");
  const [description, setDescription] = useState("");
  const [cause, setCause] = useState("");

  useEffect(() => { fetchReports(); }, [orderId]);

  async function fetchReports() {
    setLoading(true);
    try {
      const res = await fetch(`/api/damage-reports?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json();
      if (data.data) setReports(data.data);
    } catch {}
    setLoading(false);
  }

  async function submitReport() {
    if (!damageType || !description) return;
    setSaving(true);
    try {
      const res = await fetch("/api/damage-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, damage_type: damageType, affected_skus: affectedSkus, description, cause }),
      });
      const data = await res.json();
      if (data.data) {
        setReports(prev => [data.data, ...prev]);
        setShowForm(false);
        setDamageType(""); setAffectedSkus([]); setDescription(""); setCause("");
      }
    } catch {}
    setSaving(false);
  }

  async function updateStatus(id: number, status: "open" | "in_progress" | "resolved") {
    try {
      await fetch(`/api/damage-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    } catch {}
  }

  function toggleSku(sku: string) {
    setAffectedSkus(prev => prev.includes(sku) ? prev.filter(s => s !== sku) : [...prev, sku]);
  }

  return (
    <div className="p-5 border-b border-[rgba(255,255,255,0.10)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)]">Damage reports</p>
          {reports.filter(r => r.status === "open").length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/50">
              {reports.filter(r => r.status === "open").length} open
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1 text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-colors"
        >
          <Plus className="w-3 h-3" /> Report damage
        </button>
      </div>

      {/* New report form */}
      {showForm && (
        <div className="mb-3 p-3 bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-xl">
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Damage type *</label>
              <select value={damageType} onChange={e => setDamageType(e.target.value)}
                className="w-full field-input text-xs py-1.5 px-2 appearance-none">
                <option value="">— Select type —</option>
                {DAMAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {orderSkus.length > 0 && (
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Affected SKUs</label>
                <div className="flex flex-wrap gap-1.5">
                  {orderSkus.map(sku => (
                    <button key={sku} onClick={() => toggleSku(sku)}
                      className={clsx("text-[10px] px-2 py-0.5 rounded-md border font-mono transition-all",
                        affectedSkus.includes(sku)
                          ? "bg-red-900/40 text-red-300 border-red-800"
                          : "bg-[rgba(255,255,255,0.04)] text-[rgba(232,227,218,0.50)] border-[rgba(255,255,255,0.10)] hover:border-[rgba(86,100,72,0.55)]"
                      )}>
                      {sku}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  <input value={customSku} onChange={e => setCustomSku(e.target.value.toUpperCase())}
                    placeholder="Add SKU manually"
                    className="flex-1 field-input text-[11px] py-1 px-2 font-mono" />
                  <button onClick={() => { if (customSku.trim()) { toggleSku(customSku.trim()); setCustomSku(""); } }}
                    className="px-2 py-1 rounded-md border border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] text-[11px] transition-all">
                    Add
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Description *</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                rows={3} placeholder="Describe the damage in detail..."
                className="w-full field-input text-xs py-1.5 px-2 resize-none" />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Likely cause</label>
              <select value={cause} onChange={e => setCause(e.target.value)}
                className="w-full field-input text-xs py-1.5 px-2 appearance-none">
                <option value="">— Select cause —</option>
                {CAUSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] text-[11px] text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] transition-all">
                Cancel
              </button>
              <button onClick={submitReport} disabled={saving || !damageType || !description}
                className="flex-1 py-1.5 rounded-lg bg-red-950/40 border border-red-800 text-[11px] text-red-300 hover:bg-red-950/60 disabled:opacity-40 transition-all">
                {saving ? "Submitting..." : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reports list */}
      {loading ? (
        <p className="text-[11px] text-[rgba(232,227,218,0.30)] text-center py-3">Loading...</p>
      ) : reports.length === 0 ? (
        <button onClick={() => setShowForm(true)}
          className="w-full border border-dashed border-[rgba(255,255,255,0.10)] rounded-lg py-3 text-[11px] text-[rgba(232,227,218,0.30)] hover:text-[rgba(232,227,218,0.50)] hover:border-[rgba(86,100,72,0.55)] transition-colors flex items-center justify-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> No damage reports
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map(r => (
            <div key={r.id} className="bg-[#111] border border-[rgba(255,255,255,0.10)] rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              >
                <div className="flex items-center gap-2 text-left">
                  <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] text-[#e8e3da]">{r.damage_type}</p>
                    <p className="text-[10px] text-[rgba(232,227,218,0.30)]">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {r.reported_by}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx("text-[9px] px-1.5 py-0.5 rounded border", STATUS_STYLES[r.status].color)}>
                    {STATUS_STYLES[r.status].label}
                  </span>
                  {expandedId === r.id ? <ChevronUp className="w-3 h-3 text-[rgba(232,227,218,0.30)]" /> : <ChevronDown className="w-3 h-3 text-[rgba(232,227,218,0.30)]" />}
                </div>
              </button>

              {expandedId === r.id && (
                <div className="px-3 pb-3 border-t border-[rgba(255,255,255,0.10)]">
                  {r.affected_skus?.length > 0 && (
                    <div className="mt-2.5 mb-2">
                      <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Affected SKUs</p>
                      <div className="flex flex-wrap gap-1">
                        {r.affected_skus.map(sku => (
                          <span key={sku} className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-800/50 font-mono">{sku}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2.5 mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Description</p>
                    <p className="text-[11px] text-[rgba(232,227,218,0.50)]">{r.description}</p>
                  </div>
                  {r.cause && (
                    <div className="mb-2.5">
                      <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1">Cause</p>
                      <p className="text-[11px] text-[rgba(232,227,218,0.50)]">{r.cause}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-[rgba(232,227,218,0.30)] mb-1.5">Update status</p>
                    <div className="flex gap-1.5">
                      {(["open", "in_progress", "resolved"] as const).map(s => (
                        <button key={s} onClick={() => updateStatus(r.id, s)}
                          className={clsx("flex-1 py-1 rounded-md border text-[10px] transition-all",
                            r.status === s ? STATUS_STYLES[s].color : "border-[rgba(255,255,255,0.10)] text-[rgba(232,227,218,0.30)] hover:border-[rgba(86,100,72,0.55)]"
                          )}>
                          {STATUS_STYLES[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
