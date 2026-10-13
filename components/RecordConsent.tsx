"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { Project } from "@/lib/data";
import { useStore } from "@/lib/store";
import { CONSENT_WORDING, CURRENT_CONSENT_WORDING } from "@/lib/consent";

/**
 * Recording consent a customer gave BY EMAIL (2026-10-13), for a purchase that
 * arrived without the website's. The customer is sent the current wording in
 * their Help Scout conversation; their written reply is the record, and this
 * points at it. See app/api/projects/[id]/consent.
 */
export function RecordConsentButton({ project }: { project: Project }) {
  const { recordConsent } = useStore();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const r = await recordConsent(project.id, link.trim(), when);
    setBusy(false);
    if (!r.ok) { setError(r.message ?? r.error ?? "Could not record consent."); return; }
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setError(null); }}
        className="mt-1 inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/8 border border-white/15 text-cream/75 hover:bg-white/12 hover:text-cream">
        Record consent
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50" onClick={() => !busy && setOpen(false)}>
          <div className="w-[30rem] max-w-[92vw] rounded-brand p-5" onClick={(e) => e.stopPropagation()}
            style={{ background: "#2e3a40", border: "0.5px solid rgba(255,255,255,0.15)" }}>
            <p className="text-[13px] text-cream/90 mb-1">Record consent for {project.id}</p>
            <p className="text-[11px] text-cream/55 mb-2">
              Send the customer this wording in their Help Scout conversation. Once they reply agreeing, record it here.
            </p>
            <p className="text-[11px] text-cream/75 italic rounded-lg px-3 py-2 mb-3" style={{ background: "rgba(255,255,255,0.05)" }}>
              {CONSENT_WORDING[CURRENT_CONSENT_WORDING]}
            </p>
            <label className="block text-[10px] uppercase tracking-wider text-cream/45 mb-1">Help Scout conversation link</label>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://secure.helpscout.net/conversation/..."
              className="w-full rounded-lg px-3 py-2 text-[12px] text-cream/90 bg-white/5 border border-white/15 focus:outline-none focus:border-cream/30 mb-3" />
            <label className="block text-[10px] uppercase tracking-wider text-cream/45 mb-1">When their reply arrived (Arizona time)</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-[12px] text-cream/90 bg-white/5 border border-white/15 focus:outline-none focus:border-cream/30 mb-3" />
            {error && <p className="text-[11px] mb-2" style={{ color: "#e89090" }}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={busy}
                className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider text-cream/60 hover:text-cream">Cancel</button>
              <button onClick={() => { void submit(); }} disabled={busy || !link.trim() || !when}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider bg-white/10 border border-white/20 text-cream/90 hover:bg-white/15 disabled:opacity-40">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />} Record consent
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
