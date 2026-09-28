"use client";

import { useState } from "react";
import {
  readCustomSpecs, newSpecId,
  type Order, type CustomSpecs, type CustomSpecArea, type CustomSpecSet,
} from "@/lib/data";
import { useToast } from "./Toast";
import { Plus, Copy, Trash2, ChevronDown, ChevronRight, Loader2, Check } from "lucide-react";

/**
 * A custom job's specifications: what the customer CHOSE, as the designer
 * records it.
 *
 * ⚠ ONE SET IS ONE COMBINATION of manufacturer, door style and colour. A kitchen
 * whose island differs from its perimeter is TWO SETS under one area. The UI
 * follows the data rather than the other way round -- there is no way to put two
 * door styles in one set, because that is not a thing a set is.
 *
 * ⚠ SAVE IS PER AREA, AND EXPLICIT (decided 2026-09-25). `custom_specs` is ONE
 * json document: with save-as-you-type, two designers editing different rooms of
 * the same job would each write the whole document and the later one would erase
 * the other's work -- losing whole rooms, silently. An explicit Save writes the
 * document the panel is holding, and the refusal path below tells the designer
 * when it did not take. It also means a half-typed set never reaches the
 * database.
 *
 * ⚠ FREE TEXT, NOT DROPDOWNS (decided 2026-09-25). Manufacturer, door style and
 * colour are typed. A list would need a source of truth for every manufacturer's
 * range, and would refuse the one-off that custom work exists for.
 *
 * Nothing here reaches a customer: it is the designer's working record.
 */
export function CustomSpecsPanel({
  order, readOnly = false, onSaved,
}: {
  order: Order;
  /** Archived work shows its specs and offers nothing. */
  readOnly?: boolean;
  /** Called with the document the server accepted. */
  onSaved?: (specs: CustomSpecs) => void;
}) {
  const { showToast } = useToast();
  const [specs, setSpecs] = useState<CustomSpecs>(() => readCustomSpecs(order.custom_specs));
  /** The document as the server last accepted it — what a refusal reverts to. */
  const [saved, setSaved] = useState<CustomSpecs>(() => readCustomSpecs(order.custom_specs));
  const [busyArea, setBusyArea] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const dirty = (areaId: string) =>
    JSON.stringify(specs.areas.find(a => a.id === areaId))
    !== JSON.stringify(saved.areas.find(a => a.id === areaId));

  function editArea(areaId: string, fn: (a: CustomSpecArea) => CustomSpecArea) {
    setSpecs(prev => ({ ...prev, areas: prev.areas.map(a => (a.id === areaId ? fn(a) : a)) }));
  }

  /**
   * Write the whole document, with this area as the panel holds it.
   *
   * ⚠ THE PANEL REVERTS ITSELF ON A REFUSAL, to the document the server last
   * accepted — the same rule the store follows for an optimistic change. A panel
   * that keeps showing edits the server rejected is how somebody closes the
   * modal believing their morning's work is saved.
   */
  async function saveArea(areaId: string) {
    setBusyArea(areaId);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_specs: specs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSpecs(saved);
        showToast(data.message ?? data.error ?? "Could not save these specs", { kind: "error" });
        return;
      }
      const accepted = readCustomSpecs(data.data?.custom_specs ?? specs);
      setSpecs(accepted);
      setSaved(accepted);
      onSaved?.(accepted);
      setJustSaved(areaId);
      setTimeout(() => setJustSaved(cur => (cur === areaId ? null : cur)), 2000);
    } catch {
      setSpecs(saved);
      showToast("Could not reach the server. Nothing was saved.", { kind: "error" });
    } finally {
      setBusyArea(null);
    }
  }

  const addArea = () => setSpecs(prev => ({
    ...prev,
    areas: [...prev.areas, { id: newSpecId("area"), name: "", sets: [] }],
  }));

  const addSet = (areaId: string) => editArea(areaId, a => ({
    ...a,
    sets: [...a.sets, { id: newSpecId("set"), name: "", manufacturer: "", door_style: "", color: "", notes: "" }],
  }));

  // A copy is a NEW set with its own id: the original's attachments stay with
  // the original, which is what "copy" means everywhere else.
  const copySet = (areaId: string, set: CustomSpecSet) => editArea(areaId, a => ({
    ...a,
    sets: [...a.sets, { ...set, id: newSpecId("set"), name: set.name ? `${set.name} (copy)` : "" }],
  }));

  const removeSet = (areaId: string, setId: string) => editArea(areaId, a => ({
    ...a, sets: a.sets.filter(s => s.id !== setId),
  }));

  const removeArea = (areaId: string) =>
    setSpecs(prev => ({ ...prev, areas: prev.areas.filter(a => a.id !== areaId) }));

  const field = (value: string | undefined, onChange: (v: string) => void, placeholder: string) => (
    <input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      placeholder={placeholder}
      className="w-full rounded-brand px-2 py-1.5 text-[12px] bg-white/4 border border-white/10 text-cream placeholder:text-cream/30 focus:outline-none focus:border-cream/25 read-only:opacity-70"
    />
  );

  return (
    <div className="rounded-brand" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-[13px] text-cream/90">Custom Job Specs</p>
          <p className="text-[11px] text-cream/45">What the customer chose, room by room.</p>
        </div>
        {!readOnly && (
          <button
            onClick={addArea}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10 transition-all"
          >
            <Plus className="w-3 h-3" /> Add Room / Group
          </button>
        )}
      </div>

      {specs.areas.length === 0 ? (
        <p className="px-4 pb-4 text-[11px] text-cream/35">
          {readOnly ? "No specifications recorded." : "No rooms yet. Add one to record what the customer chose."}
        </p>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          {specs.areas.map((area) => {
            const isCollapsed = collapsed[area.id];
            return (
              <div key={area.id} className="rounded-brand" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setCollapsed(c => ({ ...c, [area.id]: !c[area.id] }))} className="text-cream/45 hover:text-cream/80">
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    {field(area.name, (v) => editArea(area.id, a => ({ ...a, name: v })), "Room or group name — e.g. Kitchen")}
                  </div>
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => addSet(area.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-cream/70 hover:bg-white/10 whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3" /> Add Style Group
                      </button>
                      <button onClick={() => removeArea(area.id)} title="Remove this room" className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {!isCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {area.sets.length === 0 && (
                      <p className="text-[11px] text-cream/30 px-1 pb-1">
                        No style groups yet. One group is one door style and colour — an island with its own style is a second group.
                      </p>
                    )}
                    {area.sets.map((set) => (
                      <div key={set.id} className="rounded-brand px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            {field(set.name, (v) => editArea(area.id, a => ({ ...a, sets: a.sets.map(s => (s.id === set.id ? { ...s, name: v } : s)) })), "Style group — e.g. Perimeter")}
                          </div>
                          {!readOnly && (
                            <>
                              <button onClick={() => copySet(area.id, set)} title="Duplicate this style group" className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-cream/80">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => removeSet(area.id, set.id)} title="Remove this style group" className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-red-400">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Cabinet manufacturer</p>
                            {field(set.manufacturer, (v) => editArea(area.id, a => ({ ...a, sets: a.sets.map(s => (s.id === set.id ? { ...s, manufacturer: v } : s)) })), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Door style</p>
                            {field(set.door_style, (v) => editArea(area.id, a => ({ ...a, sets: a.sets.map(s => (s.id === set.id ? { ...s, door_style: v } : s)) })), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Color / finish</p>
                            {field(set.color, (v) => editArea(area.id, a => ({ ...a, sets: a.sets.map(s => (s.id === set.id ? { ...s, color: v } : s)) })), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Notes</p>
                            {field(set.notes, (v) => editArea(area.id, a => ({ ...a, sets: a.sets.map(s => (s.id === set.id ? { ...s, notes: v } : s)) })), "")}
                          </div>
                        </div>
                      </div>
                    ))}

                    {!readOnly && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        {dirty(area.id) && <span className="text-[10px] text-cream/40">Unsaved changes</span>}
                        {justSaved === area.id && !dirty(area.id) && (
                          <span className="flex items-center gap-1 text-[10px]" style={{ color: "#b8d0bd" }}>
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                        <button
                          onClick={() => void saveArea(area.id)}
                          disabled={busyArea !== null || !dirty(area.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10 disabled:opacity-40"
                        >
                          {busyArea === area.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Save room
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
