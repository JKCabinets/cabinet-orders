"use client";

import { useEffect, useState } from "react";
import {
  readCustomSpecs, newSpecId,
  type Order, type CustomSpecArea, type CustomSpecSet,
} from "@/lib/data";
import { useToast } from "./Toast";
import { Plus, Copy, Trash2, ChevronDown, ChevronRight, Loader2, Check, RotateCcw } from "lucide-react";

/**
 * A custom job's specifications: what the customer CHOSE, as the designer
 * records it.
 *
 * ⚠ ONE SET IS ONE COMBINATION of manufacturer, door style and colour. A kitchen
 * whose island differs from its perimeter is TWO SETS under one area. The UI
 * follows the data rather than the other way round -- there is no way to put two
 * door styles in one set, because that is not a thing a set is.
 *
 * ⚠ ONE ROOM PER SAVE (rewritten 2026-09-30). This panel used to send the whole
 * document on every "Save room". Proven against the real component that day:
 * Kitchen's Save carried Bath's half-typed edit; a refused save reverted every
 * room; removing a room left no Save that could persist it; and it read the
 * order ONCE, so a panel handed another job saved the first job's rooms onto it.
 * Now each room saves and removes on its own through POST /api/orders/[id]/specs,
 * checked in the database against the revision this panel loaded.
 *
 * ⚠ WHAT IS SHOWN: the STORE's document, which realtime keeps current -- except
 * for a room this panel holds a DRAFT of. A draft is either unsaved edits, or a
 * room the server just answered for, shown until the store catches up to that
 * revision (so a save never flickers back to the old values). Nothing else is
 * held locally, so a colleague's save of another room appears as it lands.
 *
 * ⚠ A REFUSAL KEEPS THE DRAFT, VISIBLY UNSAVED. A network failure or a claim
 * refusal did not change the job, and throwing the designer's typing away would
 * be the worse outcome; the room stays marked "Unsaved changes". A CONFLICT is
 * different: somebody else's version is now the truth, so it replaces the draft
 * and the toast says so.
 *
 * ⚠ FREE TEXT, NOT DROPDOWNS (decided 2026-09-25). A list would need a source of
 * truth for every manufacturer's range and would refuse the one-off that custom
 * work exists for.
 *
 * Mounted with key={order.id} by OrderModal, so a different job is a fresh panel.
 * Nothing here reaches a customer: it is the designer's working record.
 */

/** A room as it is edited: everything but the revision, which is the server's. */
type Room = Omit<CustomSpecArea, "rev">;

type Draft = {
  room: Room;
  /** The revision these edits started from; null for a room never saved. */
  baseRev: number | null;
  /** Set when the server accepted this room at that revision: shown until the
   *  store has caught up, then dropped. Absent means unsaved edits. */
  heldRev?: number;
};

const roomOf = (a: CustomSpecArea): Room => ({ id: a.id, name: a.name, sets: a.sets });
const same = (a: Room, b: Room) => JSON.stringify(a) === JSON.stringify(b);

export function CustomSpecsPanel({
  order, readOnly = false,
}: {
  order: Order;
  /** Archived work, or someone else's claim: the specs show and nothing is offered. */
  readOnly?: boolean;
}) {
  const { showToast } = useToast();
  const stored = readCustomSpecs(order.custom_specs);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Rooms this panel removed, hidden until the store stops listing them. */
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Let go of what the store now shows for itself.
  useEffect(() => {
    const now = readCustomSpecs(order.custom_specs);
    const revOf = (id: string) => now.areas.find(a => a.id === id)?.rev;
    setDrafts(prev => {
      let changed = false;
      const next: Record<string, Draft> = {};
      for (const [id, d] of Object.entries(prev)) {
        const rev = revOf(id);
        if (d.heldRev !== undefined && rev !== undefined && rev >= d.heldRev) { changed = true; continue; }
        next[id] = d;
      }
      return changed ? next : prev;
    });
    setRemoved(prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => revOf(id) !== undefined));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [order.custom_specs]);

  const storedRoom = (id: string) => stored.areas.find(a => a.id === id);

  // Stored rooms in their order, then rooms that exist only here (new, or held
  // after a save the store has not delivered yet), in the order they were made.
  const ids = [
    ...stored.areas.map(a => a.id),
    ...Object.keys(drafts).filter(id => !storedRoom(id)),
  ].filter(id => !removed[id]);

  const shown = (id: string): Room => {
    const d = drafts[id];
    const s = storedRoom(id);
    return d ? d.room : roomOf(s!);
  };
  const isDirty = (id: string) => {
    const d = drafts[id];
    if (!d || d.heldRev !== undefined) return false;
    const s = storedRoom(id);
    return !s || !same(d.room, roomOf(s));
  };
  /** Somebody else saved this room after these edits began. */
  const changedElsewhere = (id: string) => {
    const d = drafts[id]; const s = storedRoom(id);
    return !!d && d.heldRev === undefined && d.baseRev !== null && !!s && s.rev > d.baseRev;
  };
  /** Somebody else removed a room these edits belong to. */
  const removedElsewhere = (id: string) => {
    const d = drafts[id];
    return !!d && d.heldRev === undefined && d.baseRev !== null && !storedRoom(id);
  };

  function edit(id: string, fn: (r: Room) => Room) {
    setDrafts(prev => {
      const d = prev[id];
      if (d && d.heldRev === undefined) return { ...prev, [id]: { ...d, room: fn(d.room) } };
      // Editing a held room starts new edits FROM the revision it was held at.
      if (d) return { ...prev, [id]: { room: fn(d.room), baseRev: d.heldRev! } };
      const s = storedRoom(id);
      if (!s) return prev;
      return { ...prev, [id]: { room: fn(roomOf(s)), baseRev: s.rev } };
    });
  }
  const discard = (id: string) => setDrafts(prev => { const { [id]: _, ...rest } = prev; return rest; });
  const hold = (area: CustomSpecArea) =>
    setDrafts(prev => ({ ...prev, [area.id]: { room: roomOf(area), baseRev: area.rev, heldRev: area.rev } }));

  async function post(body: unknown) {
    const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/specs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json().catch(() => ({} as Record<string, unknown>)) };
  }

  async function saveRoom(id: string) {
    const d = drafts[id];
    if (!d) return;
    setBusy(id);
    try {
      const { res, data } = await post({ op: "save", area: d.room, base_rev: d.baseRev });
      if (res.ok) {
        const area = data.data?.area as CustomSpecArea;
        setDrafts(prev => {
          const now = prev[id];
          // Typed more while the save was out: keep that typing, now based on
          // the revision the server just produced. Otherwise hold what it stored.
          if (now && now.room !== d.room) return { ...prev, [id]: { room: now.room, baseRev: area.rev } };
          return { ...prev, [id]: { room: roomOf(area), baseRev: area.rev, heldRev: area.rev } };
        });
        setJustSaved(id);
        setTimeout(() => setJustSaved(cur => (cur === id ? null : cur)), 2000);
        return;
      }
      if (res.status === 409 && data.error === "specs_conflict") {
        if (data.current) hold(data.current as CustomSpecArea);
        else { discard(id); setRemoved(prev => ({ ...prev, [id]: true })); }
      }
      showToast(data.message ?? data.error ?? "Could not save this room", { kind: "error" });
    } catch {
      showToast("Could not reach the server. This room was not saved.", { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function removeRoom(id: string) {
    setConfirmRemove(null);
    const s = storedRoom(id);
    const d = drafts[id];
    const rev = s?.rev ?? d?.heldRev;
    if (rev === undefined) { discard(id); return; }  // never saved: nothing to ask
    setBusy(id);
    try {
      const { res, data } = await post({ op: "remove", area_id: id, base_rev: rev });
      if (res.ok) {
        discard(id);
        setRemoved(prev => ({ ...prev, [id]: true }));
        return;
      }
      if (res.status === 409 && data.error === "specs_conflict") {
        if (data.current) hold(data.current as CustomSpecArea);
        else { discard(id); setRemoved(prev => ({ ...prev, [id]: true })); }
      }
      showToast(data.message ?? data.error ?? "Could not remove this room", { kind: "error" });
    } catch {
      showToast("Could not reach the server. Nothing was removed.", { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const addRoom = () => {
    const id = newSpecId("area");
    setDrafts(prev => ({ ...prev, [id]: { room: { id, name: "", sets: [] }, baseRev: null } }));
  };
  const addSet = (id: string) => edit(id, r => ({
    ...r,
    sets: [...r.sets, { id: newSpecId("set"), name: "", manufacturer: "", door_style: "", color: "", notes: "" }],
  }));
  // A copy is a NEW set with its own id: the original's files stay with the
  // original, which is what "copy" means everywhere else.
  const copySet = (id: string, set: CustomSpecSet) => edit(id, r => ({
    ...r,
    sets: [...r.sets, { ...set, id: newSpecId("set"), name: set.name ? `${set.name} (copy)` : "" }],
  }));
  // Part of editing the room, saved with it; the save unlinks the set's files.
  const removeSet = (id: string, setId: string) => edit(id, r => ({ ...r, sets: r.sets.filter(s => s.id !== setId) }));
  const setField = (id: string, setId: string, key: keyof CustomSpecSet, v: string) =>
    edit(id, r => ({ ...r, sets: r.sets.map(s => (s.id === setId ? { ...s, [key]: v } : s)) }));

  const field = (value: string | undefined, onChange: (v: string) => void, placeholder: string) => (
    <input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      placeholder={placeholder}
      className="w-full rounded-brand px-2 py-1.5 text-[12px] bg-white/4 border border-white/10 text-cream placeholder:text-cream/30 focus:outline-none focus:border-cream/25 read-only:opacity-70"
    />
  );

  const list = readOnly ? stored.areas.map(a => a.id) : ids;

  return (
    <div className="rounded-brand" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-[13px] text-cream/90">Custom Job Specs</p>
          <p className="text-[11px] text-cream/45">What the customer chose, room by room. Each room saves on its own.</p>
        </div>
        {!readOnly && (
          <button
            onClick={addRoom}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10 transition-all"
          >
            <Plus className="w-3 h-3" /> Add Room / Group
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 pb-4 text-[11px] text-cream/35">
          {readOnly ? "No specifications recorded." : "No rooms yet. Add one to record what the customer chose."}
        </p>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          {list.map((id) => {
            const room = readOnly ? roomOf(storedRoom(id)!) : shown(id);
            const isCollapsed = collapsed[id];
            const dirty = !readOnly && isDirty(id);
            const stale = !readOnly && changedElsewhere(id);
            const gone = !readOnly && removedElsewhere(id);
            const isNew = !readOnly && !storedRoom(id) && drafts[id]?.baseRev === null && drafts[id]?.heldRev === undefined;
            return (
              <div key={id} className="rounded-brand" style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setCollapsed(c => ({ ...c, [id]: !c[id] }))} className="text-cream/45 hover:text-cream/80">
                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    {field(room.name, (v) => edit(id, r => ({ ...r, name: v })), "Room or group name — e.g. Kitchen")}
                  </div>
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => addSet(id)}
                        disabled={busy === id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider bg-white/5 border border-white/10 text-cream/70 hover:bg-white/10 whitespace-nowrap disabled:opacity-40"
                      >
                        <Plus className="w-3 h-3" /> Add Style Group
                      </button>
                      <button
                        onClick={() => (isNew ? discard(id) : setConfirmRemove(id))}
                        disabled={busy !== null}
                        title="Remove this room"
                        className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-red-400 disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {confirmRemove === id && (
                  <div className="mx-3 mb-2 px-3 py-2 rounded-brand flex items-center justify-between gap-3" style={{ background: "rgba(220,80,60,0.08)", border: "0.5px solid rgba(220,80,60,0.35)" }}>
                    <p className="text-[11px] text-cream/80">
                      Remove {room.name ? `“${room.name}”` : "this room"}? Its specifications are deleted{dirty ? ", with your unsaved edits" : ""}. Files filed under it stay on the job.
                    </p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => void removeRoom(id)} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-900/50">Remove</button>
                      <button onClick={() => setConfirmRemove(null)} className="text-[10px] text-cream/60 hover:text-cream px-2 py-0.5 rounded border border-white/10">Cancel</button>
                    </div>
                  </div>
                )}

                {(stale || gone) && (
                  <p className="mx-3 mb-2 text-[11px] text-amber-300/85">
                    {gone
                      ? "Someone else removed this room while you were editing it. Your edits cannot be saved to it."
                      : "Someone else saved this room while you were editing it. Saving yours would overwrite theirs, so it is refused — discard to see their version."}
                  </p>
                )}

                {!isCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {room.sets.length === 0 && (
                      <p className="text-[11px] text-cream/30 px-1 pb-1">
                        No style groups yet. One group is one door style and colour — an island with its own style is a second group.
                      </p>
                    )}
                    {room.sets.map((set) => (
                      <div key={set.id} className="rounded-brand px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            {field(set.name, (v) => setField(id, set.id, "name", v), "Style group — e.g. Perimeter")}
                          </div>
                          {!readOnly && (
                            <>
                              <button onClick={() => copySet(id, set)} title="Duplicate this style group" className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-cream/80">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => removeSet(id, set.id)} title="Remove this style group (saved with the room)" className="p-1.5 rounded-full hover:bg-white/10 text-cream/40 hover:text-red-400">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Cabinet manufacturer</p>
                            {field(set.manufacturer, (v) => setField(id, set.id, "manufacturer", v), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Door style</p>
                            {field(set.door_style, (v) => setField(id, set.id, "door_style", v), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Color / finish</p>
                            {field(set.color, (v) => setField(id, set.id, "color", v), "")}
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-cream/35 mb-1">Notes</p>
                            {field(set.notes, (v) => setField(id, set.id, "notes", v), "")}
                          </div>
                        </div>
                      </div>
                    ))}

                    {!readOnly && (
                      <div className="flex items-center justify-end gap-2 pt-1">
                        {dirty && <span className="text-[10px] text-cream/40">Unsaved changes</span>}
                        {justSaved === id && !dirty && (
                          <span className="flex items-center gap-1 text-[10px]" style={{ color: "#b8d0bd" }}>
                            <Check className="w-3 h-3" /> Saved
                          </span>
                        )}
                        {(dirty || stale || gone) && !isNew && (
                          <button
                            onClick={() => discard(id)}
                            disabled={busy === id}
                            title="Throw away the edits to this room and show what is saved"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider bg-white/4 border border-white/10 text-cream/70 hover:bg-white/10 disabled:opacity-40"
                          >
                            <RotateCcw className="w-3 h-3" /> Discard
                          </button>
                        )}
                        <button
                          onClick={() => void saveRoom(id)}
                          disabled={busy !== null || !dirty || stale || gone}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/6 border border-cream/15 text-cream/85 hover:bg-white/10 disabled:opacity-40"
                        >
                          {busy === id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
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
