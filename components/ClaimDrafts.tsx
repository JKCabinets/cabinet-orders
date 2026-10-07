"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  WarrantyClaimModal,
  type ClaimSubmissionSeed,
} from "@/components/WarrantyClaimModal";
import { EmailClaimForm } from "@/components/EmailClaimForm";

/**
 * Customer claim submissions waiting to be turned into claims.
 *
 * ⚠ THESE ARE DRAFTS, NOT ROWS IN `orders`. A submission is what the customer
 * sent -- "my base drawer cabinet has a dent in the drawer front" -- which no
 * vendor can fill. It becomes a warranty claim when a team member attaches it
 * to an order and writes what is actually needed. Until then it has no id, no
 * stage of its own and no SLA clock; it sits at New claim because that is what
 * New claim means: nobody has worked it yet.
 *
 * ⚠ WHICH IS WHY THEY ARE NOT SHAPED INTO Order OBJECTS. The hub feeds its
 * rows to OrderTable, BulkActionBar, OrderModal and the stage-move path. A
 * draft wearing an Order's shape would reach all four, and the first person to
 * bulk-advance a stage would be advancing something that does not exist. Their
 * own band, their own component, their own fetch.
 *
 * ⚠ CLAIMED LIKE AN ORDER (Garrett, 2026-10-06). Once claimed, a submission is
 * that person's: one person answers the customer, one person promotes it.
 * Claim and Release sit BELOW each card, not inside it -- the card is a button
 * that opens the promotion form, and a button inside a button is invalid. A
 * card claimed by someone else does not open; it says who has it.
 */

const HAIRLINE = "0.5px solid rgba(255,255,255,0.12)";

interface Draft extends ClaimSubmissionSeed {
  candidate_groups?: { id: string; type: string; stage: string }[];
}

export function ClaimDrafts({ onCompleted }: { onCompleted?: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const { team } = useStore();
  const { data: session } = useSession();
  // team_members.id -- what claimed_by holds -- as OrderModal reads it.
  const me = (session?.user as { id?: string } | undefined)?.id;
  const nameOf = (id: string) => team.find((m) => m.id === id)?.name ?? "another member";

  // Claim or release, then reload: the queue is not on the realtime channel,
  // so the list is re-read rather than patched.
  const setClaim = async (d: Draft, claim: boolean) => {
    setBusy(d.id);
    setError("");
    try {
      const res = await fetch(`/api/claim-submissions/${d.id}/claim`, { method: claim ? "POST" : "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const who = json.claimed_by ? ` (${nameOf(json.claimed_by)})` : "";
        throw new Error(`${d.ref ?? "This submission"}: ${json.message ?? "could not be changed"}${who}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the claim.");
    } finally {
      setBusy(null);
    }
  };

  // Someone else's claim does not open: promoting it would be refused anyway,
  // after the form had been filled in.
  const openCard = (d: Draft) => {
    if (d.claimed_by && d.claimed_by !== me) {
      setError(`${d.ref ?? "This submission"} is claimed by ${nameOf(d.claimed_by)}. Ask them to release it.`);
      return;
    }
    setOpen(d);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/claim-submissions?status=new");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load submissions.");
      setDrafts(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ⚠ THE BAND ALWAYS RENDERS NOW (2026-10-06). It used to vanish when nothing
  // was waiting; but "Claim from an email" lives in it, and an emailed claim
  // arrives precisely when the queue may be empty.
  const enteredBy = (username: string | null | undefined) =>
    team.find((m) => m.username === username)?.name ?? username ?? "a team member";

  return (
    <>
      <div className="rounded-2xl mb-5 overflow-hidden" style={{ border: HAIRLINE }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: drafts.length ? HAIRLINE : "none", background: "rgba(145,165,151,0.12)" }}>
          <div>
            <h3 className="text-[13px] text-cream">
              {loading ? "Loading customer submissions"
                : drafts.length === 0 ? "No customer submissions waiting"
                : `${drafts.length} customer submission${drafts.length === 1 ? "" : "s"} waiting`}
            </h3>
            <p className="text-[11px] text-[rgba(232,227,218,0.45)] mt-0.5">
              Attach each to an order and record what needs replacing.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* ⚠ EVERY ACTION IS A PILL (Garrett, 2026-10-07): underlined text is
                too easily missed. The OMS's own styles, verbatim. */}
            <button onClick={() => { setNotice(""); setEmailOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-cream/18 bg-white/4 text-[11px] uppercase tracking-wider text-cream/85 hover:bg-white/8 hover:border-terracotta/40 transition-all disabled:opacity-50">
              Claim from an email
            </button>
            <button onClick={() => void load()}
              className="text-[rgba(232,227,218,0.45)] hover:text-cream transition-colors p-1"
              aria-label="Reload submissions">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {notice && (
          <p className="text-[12px] px-4 py-2 text-[rgba(232,227,218,0.75)]" style={{ borderBottom: HAIRLINE }}>{notice}</p>
        )}

        {error && (
          <p className="text-[12px] px-4 py-3" style={{ color: "#e0806a" }}>{error}</p>
        )}

        {drafts.map((d, i) => (
          <div key={d.id} style={{ borderTop: i === 0 ? "none" : HAIRLINE }}>
          <button
            onClick={() => openCard(d)}
            className="w-full text-left px-4 pt-3 pb-2 transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-cream">
                {d.ref && <span className="text-[rgba(232,227,218,0.45)] mr-2">{d.ref}</span>}
                {d.claimant_name}
              </span>
              <span className="text-[11px] text-[rgba(232,227,218,0.40)] shrink-0">
                {new Date(d.received_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", timeZone: "America/Phoenix",
                })}
              </span>
            </div>
            {d.source === "email" && (
              <p className="text-[11px] mt-1 text-[rgba(232,227,218,0.55)]">From an email, entered by {enteredBy(d.entered_by)}</p>
            )}
            {/* ⚠ FLAGGED, NOT DROPPED (2026-10-01). The spam checks used to throw
                these away behind a fake success; a browser autofilling the
                hidden field would have cost a real customer their claim. Shown
                at New claim like any other, with the reason in plain words. */}
            {d.screening && (
              <p className="text-[11px] mt-1" style={{ color: "#d4922a" }}>
                {d.screening === "honeypot"
                  ? `Flagged: the hidden spam-trap field was filled${d.screening_value ? ` with “${d.screening_value}”` : ""}. A company name or an address usually means a browser's autofill; junk means a bot.`
                  : "Flagged: sent within two seconds of the page opening. Usually a bot."}
              </p>
            )}
            {/* ⚠ WHERE IT IS IN HELP SCOUT (2026-10-05). Every claim from the
                website becomes a Help Scout conversation, where the customer is
                answered. A claim that has not got there yet says why, so nobody
                waits on a reply that cannot come. `skipped` -- every claim from
                before the push existed -- says nothing. */}
            {/* The link itself is a pill in the row below (2026-10-07): an action
                inside the card would be a button inside a button. */}
            {d.helpscout_state === "sent" && d.helpscout_last_error && (
              <p className="text-[11px] mt-1" style={{ color: "#d4922a" }}>In Help Scout, but: {d.helpscout_last_error}</p>
            )}
            {d.helpscout_state === "pending" && (
              <p className="text-[11px] mt-1" style={{ color: d.helpscout_last_error ? "#d4922a" : "rgba(232,227,218,0.45)" }}>
                {d.helpscout_last_error
                  ? `Not in Help Scout yet (tried ${d.helpscout_attempts ?? 0} times): ${d.helpscout_last_error}`
                  : "On its way to Help Scout."}
              </p>
            )}
            <p className="text-[12px] text-[rgba(232,227,218,0.60)] mt-0.5 line-clamp-2">
              {d.message || "No description given."}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[rgba(232,227,218,0.35)]">
              <span>{d.claim_type}</span>
              {/* The number the customer TYPED, and whether it matched anything.
                  A mismatch is normal and is exactly why a person picks the
                  order rather than the system resolving it. */}
              <span>order {d.order_number_raw}</span>
              {d.candidate_groups && d.candidate_groups.length > 0
                ? <span>{d.candidate_groups.length} matching group{d.candidate_groups.length === 1 ? "" : "s"}</span>
                : <span style={{ color: "#d4922a" }}>no match — pick by hand</span>}
              {(d.photos ?? []).length > 0 && (
                <span className="flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />{(d.photos ?? []).length}
                </span>
              )}
            </div>
          </button>
          <div className="flex items-center gap-3 px-4 pb-3 text-[11px]">
            {d.claimed_by ? (
              <span style={{ color: d.claimed_by === me ? "rgba(232,227,218,0.70)" : "#d4922a" }}>
                Claimed by {d.claimed_by === me ? "you" : nameOf(d.claimed_by)}
              </span>
            ) : (
              <span className="text-[rgba(232,227,218,0.40)]">Unclaimed</span>
            )}
            {!d.claimed_by && (
              <button onClick={() => void setClaim(d, true)} disabled={busy === d.id}
                className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40">
                Claim
              </button>
            )}
            {d.claimed_by === me && (
              <button onClick={() => void setClaim(d, false)} disabled={busy === d.id}
                className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream disabled:opacity-40">
                Release
              </button>
            )}
            {d.helpscout_state === "sent" && (
              <a href={d.helpscout_url || `https://secure.helpscout.net/conversation/${d.helpscout_conversation_id}`}
                target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream disabled:opacity-40">
                In Help Scout
              </a>
            )}
          </div>
          </div>
        ))}
      </div>

      {emailOpen && (
        <EmailClaimForm
          onClose={() => setEmailOpen(false)}
          onDone={(ref, photosFailed) => {
            setEmailOpen(false);
            setNotice(photosFailed.length
              ? `${ref} recorded and claimed by you. Not stored, try again from the claim: ${photosFailed.join(", ")}.`
              : `${ref} recorded and claimed by you. It goes to its Help Scout conversation next.`);
            void load();
          }}
        />
      )}

      {open && (
        <WarrantyClaimModal
          submission={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            // Drop it from the queue immediately; the claim itself arrives on
            // the realtime channel like any other new row.
            void load();
            onCompleted?.();
          }}
        />
      )}
    </>
  );
}
