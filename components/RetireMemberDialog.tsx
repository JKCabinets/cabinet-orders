"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import type { TeamMember } from "@/lib/data";
import type { MemberWorkItem } from "@/lib/store";

/**
 * ⚠ DELETING A MEMBER HANDS ON THEIR OPEN WORK FIRST (Garrett, 2026-10-19).
 *
 * Lists what they hold that is still open -- a purchase, a custom job, a
 * warranty claim, a customer submission -- and lets each go to an active
 * member, or "Release" (back to unclaimed, the default). "Assign all to…" sets
 * every row at once. Nothing has to be assigned. Finished work is not listed:
 * it keeps their name as the record of who handled it.
 *
 * The server works from what they hold WHEN the delete runs, not from this
 * list: anything taken by someone else meanwhile stays with them and is
 * reported back. One refusal -- a submission of theirs mid-promotion, or an
 * assignee who is no longer active -- deletes nothing.
 */
const KIND: Record<MemberWorkItem["kind"], string> = {
  project: "Purchase", job: "Custom job", claim: "Warranty claim", submission: "Submission",
};
const keyOf = (w: MemberWorkItem) => `${w.kind}:${w.id}`;
const RELEASE_ALL = "__release";
const PILL = "px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

export function RetireMemberDialog({ member, team, loadWork, onConfirm, onCancel }: {
  member: TeamMember;
  team: TeamMember[];
  loadWork: (id: string) => Promise<{ ok: boolean; work?: MemberWorkItem[]; error?: string }>;
  /** Resolves with an error to show, or null once the member is gone. */
  onConfirm: (assign: Record<string, string>) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [work, setWork] = useState<MemberWorkItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = team.filter((m) => m.active && m.id !== member.id);

  useEffect(() => {
    let live = true;
    void loadWork(member.id).then((r) => {
      if (!live) return;
      if (r.ok) setWork(r.work ?? []); else setLoadError(r.error ?? "Could not load their work.");
    });
    return () => { live = false; };
  }, [member.id, loadWork]);

  const setOne = (k: string, to: string) => setAssign((a) => {
    const next = { ...a };
    if (to) next[k] = to; else delete next[k];
    return next;
  });
  // "Release all" clears every row; a member's id hands them all to that member.
  const setAll = (to: string) => setAssign(!to || to === RELEASE_ALL || !work ? {} : Object.fromEntries(work.map((w) => [keyOf(w), to])));

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm(assign);
    if (err) { setError(err); setBusy(false); }
  }

  const select = "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.12)] rounded-lg px-2 py-1 text-[11px] text-[#e8e3da]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Delete ${member.name}`}>
      <div className="w-full max-w-lg rounded-2xl bg-[#2b3238] border border-[rgba(255,255,255,0.10)] p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-medium text-[#f0ece4]">Delete {member.name} permanently?</h2>
            <p className="text-[11px] text-[rgba(232,227,218,0.50)] mt-1">
              Hand their open work to someone, or leave it to be released. Their finished work keeps their name.
            </p>
          </div>
          <button onClick={onCancel} disabled={busy} aria-label="Cancel" className="p-1 text-[rgba(232,227,218,0.50)] hover:text-[#e8e3da] disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loadError ? (
          <p role="alert" className="text-[11px] text-red-400 mb-3">{loadError}</p>
        ) : work === null ? (
          <p className="text-[11px] text-[rgba(232,227,218,0.50)] mb-3 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading their work…</p>
        ) : work.length === 0 ? (
          <p className="text-[11px] text-[rgba(232,227,218,0.50)] mb-3">They hold no open work.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] text-[rgba(232,227,218,0.50)]">{work.length} open {work.length === 1 ? "item" : "items"}</span>
              <label className="flex items-center gap-2 text-[11px] text-[rgba(232,227,218,0.50)]">
                Assign all to…
                <select aria-label="Assign all to" className={select} disabled={busy} value="" onChange={(e) => setAll(e.target.value)}>
                  <option value="">Choose</option>
                  <option value={RELEASE_ALL}>Release all</option>
                  {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            </div>
            <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto mb-3">
              {work.map((w) => (
                <li key={keyOf(w)} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)]">
                  <div className="min-w-0">
                    <p className="text-[12px] text-[#e8e3da] truncate">{w.label}</p>
                    <p className="text-[10px] text-[rgba(232,227,218,0.40)]">{KIND[w.kind]} · {w.kind === "submission" ? "submission" : w.id}</p>
                  </div>
                  <select aria-label={`Hand ${w.label} to`} className={select} disabled={busy}
                    value={assign[keyOf(w)] ?? ""} onChange={(e) => setOne(keyOf(w), e.target.value)}>
                    <option value="">Release</option>
                    {others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}

        {error && <p role="alert" className="text-[11px] text-red-400 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className={`${PILL} border border-[rgba(255,255,255,0.12)] text-[rgba(232,227,218,0.70)] hover:text-[#e8e3da]`}>Cancel</button>
          <button onClick={() => void confirm()} disabled={busy || (work === null && !loadError)}
            className={`${PILL} flex items-center gap-1.5 bg-red-900/40 text-red-300 hover:bg-red-900/60`}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
