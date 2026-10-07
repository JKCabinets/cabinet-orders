"use client";

import { useState } from "react";
import { X } from "lucide-react";

/**
 * Enter a claim that arrived by EMAIL (2026-10-06).
 *
 * ⚠ EVERYTHING BY HAND (Garrett, 2026-10-06). Nothing is read out of the email;
 * staff copy what the customer sent. The Help Scout link is asked for because
 * the claim adopts that conversation -- the customer's confirmation then comes
 * in their own thread -- and the server checks it is a real one in our inbox,
 * not used by another claim.
 *
 * ⚠ "WHEN THE EMAIL ARRIVED" IS THE REPORT DATE: the claim is judged against
 * it. Arizona time, as Help Scout shows it to the team here.
 *
 * Photos: JPEG or PNG, as the claim form takes -- checked and scrubbed of
 * location on the server like a customer's own. No PDFs (Garrett).
 */

const FIELD = "w-full rounded-lg px-3 py-2 text-[13px] text-cream bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.12)] focus:outline-none focus:border-[rgba(232,227,218,0.45)]";
const LABEL = "block text-[11px] uppercase tracking-wider text-[rgba(232,227,218,0.55)] mb-1";

export function EmailClaimForm({ onClose, onDone }: { onClose: () => void; onDone: (ref: string, photosFailed: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim-submissions", { method: "POST", body: new FormData(e.currentTarget) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "The claim could not be recorded.");
      onDone(json.ref, json.photos_failed ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The claim could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} role="dialog" aria-label="Claim from an email">
      <form onSubmit={submit} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl p-6 space-y-4"
        style={{ background: "#2c3a44", border: "0.5px solid rgba(255,255,255,0.12)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] text-cream">Claim from an email</h2>
            <p className="text-[12px] text-[rgba(232,227,218,0.55)] mt-0.5">
              Copy what the customer sent. The claim keeps their Help Scout conversation.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[rgba(232,227,218,0.55)] hover:text-cream">
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block">
          <span className={LABEL}>Help Scout conversation link</span>
          <input name="conversation" required className={FIELD} placeholder="https://secure.helpscout.net/conversation/…" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={LABEL}>Customer name</span><input name="name" required className={FIELD} /></label>
          <label className="block"><span className={LABEL}>Customer email</span><input name="email" type="email" required className={FIELD} /></label>
          <label className="block"><span className={LABEL}>Phone</span><input name="phone" className={FIELD} /></label>
          <label className="block"><span className={LABEL}>Order number</span><input name="order_number" required className={FIELD} /></label>
          <label className="block">
            <span className={LABEL}>Type of claim</span>
            <select name="claim_type" required defaultValue="" className={FIELD}>
              <option value="" disabled>Choose…</option>
              <option value="visible">Visible shipping damage</option>
              <option value="shortage">Something missing from the order</option>
              <option value="concealed">Damage found after unpacking</option>
              <option value="defect">Defect</option>
            </select>
          </label>
          <label className="block"><span className={LABEL}>Delivered on</span><input name="delivered_on" type="date" className={FIELD} /></label>
        </div>

        <label className="block">
          <span className={LABEL}>When the email arrived (Arizona time)</span>
          <input name="email_received" type="datetime-local" required className={FIELD} />
          <span className="block text-[11px] text-[rgba(232,227,218,0.45)] mt-1">
            The claim is judged against this date, so take it from the email itself.
          </span>
        </label>

        <label className="block">
          <span className={LABEL}>What the customer described</span>
          <textarea name="message" rows={4} maxLength={1000} className={FIELD} />
        </label>

        <label className="block">
          <span className={LABEL}>Photos (JPEG or PNG, up to 6, 10 MB each)</span>
          <input name="photos" type="file" multiple accept="image/jpeg,image/png" className="text-[12px] text-[rgba(232,227,218,0.70)]" />
        </label>

        {error && <p className="text-[12px]" style={{ color: "#e0806a" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-full text-[12px] text-[rgba(232,227,218,0.70)] hover:text-cream">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-full text-[12px] text-cream border border-[rgba(232,227,218,0.35)] hover:border-cream disabled:opacity-50">
            {busy ? "Recording…" : "Record the claim"}
          </button>
        </div>
      </form>
    </div>
  );
}
