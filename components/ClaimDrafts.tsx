"use client";

import { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import {
  WarrantyClaimModal,
  type ClaimSubmissionSeed,
} from "@/components/WarrantyClaimModal";

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

  // Nothing waiting is the ordinary state. An empty band would be a permanent
  // reminder of an empty queue, so it renders nothing at all.
  if (!loading && !error && drafts.length === 0) return null;

  return (
    <>
      <div className="rounded-2xl mb-5 overflow-hidden" style={{ border: HAIRLINE }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: drafts.length ? HAIRLINE : "none", background: "rgba(145,165,151,0.12)" }}>
          <div>
            <h3 className="text-[13px] text-cream">
              {loading ? "Loading customer submissions" : `${drafts.length} customer submission${drafts.length === 1 ? "" : "s"} waiting`}
            </h3>
            <p className="text-[11px] text-[rgba(232,227,218,0.45)] mt-0.5">
              Attach each to an order and record what needs replacing.
            </p>
          </div>
          <button onClick={() => void load()}
            className="text-[rgba(232,227,218,0.45)] hover:text-cream transition-colors p-1"
            aria-label="Reload submissions">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {error && (
          <p className="text-[12px] px-4 py-3" style={{ color: "#e0806a" }}>{error}</p>
        )}

        {drafts.map((d, i) => (
          <button
            key={d.id}
            onClick={() => setOpen(d)}
            className="w-full text-left px-4 py-3 transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            style={{ borderTop: i === 0 ? "none" : HAIRLINE }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-cream">{d.claimant_name}</span>
              <span className="text-[11px] text-[rgba(232,227,218,0.40)] shrink-0">
                {new Date(d.received_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", timeZone: "America/Phoenix",
                })}
              </span>
            </div>
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
        ))}
      </div>

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
