"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { X, Check, Clock, ChevronRight, Archive, RotateCcw, Trash2, Loader2, Download } from "lucide-react";
import clsx from "clsx";
import { useSession } from "next-auth/react";
import {
  Order, Stage, ORDER_STAGES, STAGE_LIST_BY_TYPE,
  AVATAR_COLOR_STYLES,
  isPaymentHoldStatus, paymentHoldActive, paymentHoldLabel,
  displayOrderNumber, nextStageFor, poReference,
  type TeamMember,
} from "@/lib/data";
import { slaRuleFor, slaAgeHours, hoursInStage, slaTier, formatStageAge } from "@/lib/sla";
import { useStore } from "@/lib/store";
import { AvatarWithProfile } from "./AvatarWithProfile";
import { useToast } from "./Toast";
import { checkAttachmentGate } from "@/lib/stageGates";
import { AttachmentsPanel, type AttachmentsPanelHandle } from "./AttachmentsPanel";
import { OrderDetails } from "./OrderDetails";
import { DamageReportPanel } from "./DamageReportPanel";
import { AcknowledgmentPanel, type AcknowledgmentPanelHandle } from "./AcknowledgmentPanel";
import { consumeAckPicker } from "@/lib/ackStatus";
import { STAGE_ACCENT } from "@/lib/data";

interface OrderModalProps {
  /**
   * The row. Its `type` is the single source of truth for which stage
   * list to offer and which panels to render -- there is deliberately no
   * `tab` prop telling us again, because the two could disagree.
   */
  order: Order;
  onClose: () => void;
  onStageChange: (stage: Stage) => void;
  /**
   * Optional reason explaining why the modal was opened. When set to
   * "needs-attachment", the modal shows a prominent banner at the top and
   * auto-opens the file picker so the user can attach the required PDF.
   */
  initialReason?: "needs-attachment";
}


/**
 * Refund / void banner, with the acknowledgement control.
 *
 * The server enforces this independently -- see the payment hold block in
 * app/api/orders/[id]/route.ts. This exists so the reason someone cannot move
 * the order is visible before they try, rather than as a 409 with no remedy.
 *
 * PATCHes directly rather than going through the store: the row change comes
 * back over realtime, so there is nothing to reconcile locally.
 */
function PaymentHoldBanner({ order }: { order: Order }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  const status = order.payment_status ?? "";
  if (!isPaymentHoldStatus(status)) return null;

  const active = paymentHoldActive(order);

  async function acknowledge() {
    const text = reason.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/orders/" + encodeURIComponent(order.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledge_payment_hold: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? data.error ?? "Could not acknowledge");
        return;
      }
      setReason("");
      showToast("Payment hold acknowledged", { kind: "success" });
    } catch {
      setError("Network error — not saved");
    } finally {
      setBusy(false);
    }
  }

  const accent = active ? "#e89090" : "rgba(232,227,218,0.45)";

  return (
    <div
      className="m-5 mb-0 rounded-brand p-4 flex items-start gap-3"
      style={{
        background: active ? "rgba(232,144,144,0.14)" : "rgba(255,255,255,0.04)",
        border: `0.5px solid ${active ? "rgba(232,144,144,0.50)" : "rgba(232,227,218,0.14)"}`,
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: active ? "rgba(232,144,144,0.22)" : "rgba(255,255,255,0.06)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accent}
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-display text-[18px] text-cream leading-tight mb-1">
          {paymentHoldLabel(status)}
        </p>

        {active ? (
          <>
            <p className="text-[12px] text-cream/65 leading-snug mb-3">
              It cannot move forward until this is acknowledged. Check whether the
              order can still be cancelled with the manufacturer, then record what
              you found — it goes in the order&apos;s activity against your name.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What did you find?"
                maxLength={300}
                className="field-glass flex-1 min-w-[200px] px-3 py-1.5 rounded-full text-[12px]"
                style={{ fontSize: "16px" }}
              />
              <button
                onClick={acknowledge}
                disabled={busy || reason.trim().length === 0}
                className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: "rgba(232,144,144,0.20)",
                  color: "#e89090",
                  border: "0.5px solid rgba(232,144,144,0.50)",
                }}
              >
                {busy ? "…" : "Acknowledge"}
              </button>
            </div>
            {error && <p className="text-[11px] mt-2" style={{ color: "#e89090" }}>{error}</p>}
          </>
        ) : (
          <p className="text-[12px] text-cream/55 leading-snug">
            Acknowledged — this order can move forward. The refund still stands;
            see the activity below for who cleared it and why.
          </p>
        )}
      </div>
    </div>
  );
}

const STAGE_COLOR: Record<string, string> = {
  "New":              "#c97070",
  "Entered":          "#d4922a",
  "In production":    "#c8b84a",
  "At cross dock":    "#5a8db8",
  "Delivered":        "#8fbe70",
  "New claim":        "#c97070",
  "In review":        "#d4922a",
  "Parts ordered":    "#c8b84a",
  "Shipped":          "#5a8db8",
  "Resolved":         "#8fbe70",
};

const PANEL: React.CSSProperties = {
  // Brand: signature frosted sage glass — matches the sidebar's sage tone
  // exactly so the modal feels like the same material as the chrome.
  // Keeping a slightly heavier shadow than the sidebar since the modal is
  // a larger floating surface over a darkened overlay.
  background: "rgba(87, 98, 87, 0.28)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: "0.5px solid rgba(145, 165, 151, 0.30)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55)",
};

const SECTION_BORDER: React.CSSProperties = {
  borderBottom: "0.5px solid rgba(255,255,255,0.10)",
};

const CELL: React.CSSProperties = {
  borderTop: "0.5px solid rgba(255,255,255,0.08)",
  borderLeft: "0.5px solid rgba(255,255,255,0.08)",
};
const LABEL = "text-[10px] uppercase tracking-[0.16em] text-cream/50 mb-1.5";

// PIN validation lives server-side only. The modal sends whatever the user
// typed; the server compares against ADMIN_BACKWARD_PIN (constant-time) and
// surfaces a 403 with `admin_pin_required` if it doesn't match. This avoids
// the previous footgun where the modal's hardcoded "4951" and Vercel's env
// var could drift out of sync, breaking every backward move silently.

export function OrderModal({ order, onClose, onStageChange, initialReason }: OrderModalProps) {
  const { moveStage, updateOrderDetails, updateNotes, updateInternalNotes, archiveOrder, unarchiveOrder, deleteOrder, allOrders, team, claimOrder: rawClaimOrder } = useStore();
  const { showToast } = useToast();
  const [claimBusy, setClaimBusy] = useState(false);
  const [reDecodeBusy, setReDecodeBusy] = useState(false);

  // Wrap claimOrder with the same conflict-toast UX used in OrderTable.
  // Returns void; busy state is set/unset around the call so the button
  // can disable itself while in flight.
  async function handleClaim(target: string | null) {
    setClaimBusy(true);
    try {
      const result = await rawClaimOrder(liveOrder.id, target);
      if (!result.ok) {
        if (result.reason === "already_claimed" && result.claimedBy) {
          // result.claimedBy is now a team_members.id
          const claimer = team.find((m) => m.id === result.claimedBy);
          showToast(`Already claimed by ${claimer?.name ?? result.claimedBy}`, { kind: "warn" });
        } else if (result.reason === "not_owner") {
          showToast("You can\'t release someone else\'s claim", { kind: "warn" });
        } else if (result.reason === "network_error") {
          showToast("Network error — claim not saved", { kind: "error" });
        } else {
          showToast("Claim failed", { kind: "error" });
        }
      }
    } finally {
      setClaimBusy(false);
    }
  }
  const { data: session } = useSession();
  // currentUserId is the team_members.id — the IMMUTABLE identifier used
  // for claim/release comparisons and writes to claimed_by / entered_by.
  // currentUserDisplayName is for human-facing strings only (damage
  // reports, audit text the user sees).
  const sessUser = session?.user as { id?: string; name?: string; username?: string } | undefined;
  const currentUserId = sessUser?.id ?? undefined;
  const currentUserDisplayName = sessUser?.name ?? undefined;
  // Admin gate for the Re-decode action (route enforces it server-side too).
  const isAdmin = team.find((m) => m.id === currentUserId)?.role === "admin";
  const [notes, setNotes] = useState(order.notes);
  const [notesChanged, setNotesChanged] = useState(false);
  const [internalNotes, setInternalNotes] = useState(order.internal_notes ?? "");
  const [internalNotesChanged, setInternalNotesChanged] = useState(false);
  const [enteredGateError, setEnteredGateError] = useState(false);
  const [checkingAttachments, setCheckingAttachments] = useState(false);
  // Distinct vendors on this order, for per-manufacturer PDF export buttons.
  const [exportVendors, setExportVendors] = useState<string[]>([]);
  // Admin PIN for manual stage changes from the modal (forward or back).
  // Normal flows (date entry → auto-advance, table buttons with gates)
  // do not require the PIN.
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<AttachmentsPanelHandle>(null);
  const ackPanelRef = useRef<AcknowledgmentPanelHandle>(null);
  const attachmentsAnchorRef = useRef<HTMLDivElement>(null);

  // When the modal opens because of a missing-attachment gate, show a
  // banner and auto-jump to the attachment area. The banner stays visible
  // until the user uploads a file (the attachment panel re-renders, the
  // gate would now pass) or they dismiss it manually.
  const [showGateBanner, setShowGateBanner] = useState(
    initialReason === "needs-attachment",
  );

  useEffect(() => {
    if (initialReason !== "needs-attachment") return;
    // Wait one frame so refs are mounted, then scroll to the attachment
    // section and pop the OS file picker. Slight delay on the click so
    // the scroll animation has a chance to land before the picker steals
    // focus.
    requestAnimationFrame(() => {
      attachmentsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => attachmentsRef.current?.openFilePicker(), 350);
    });
  }, [initialReason]);

  // ── The project and its groups ──────────────────────────────────────
  //
  // A Shopify checkout is one PROJECT with one row per product category:
  // cabinets, hardware, samples. They run on genuinely different
  // timelines -- a box of pulls arrives in a week, cabinets take six --
  // and each is claimed and worked separately. This modal is the join:
  // open any group and you see the whole project.
  //
  // A custom job or a warranty claim has no project, so it is a project of
  // ONE. Same shell, one row in it -- deliberately not a second code path.
  const projectGroups = useMemo(() => {
    const self = allOrders.find((o) => o.id === order.id) ?? order;
    if (!self.project_id) return [self];
    const siblings = allOrders.filter((o) => o.project_id === self.project_id);
    return siblings.length > 0 ? siblings : [self];
  }, [allOrders, order]);

  // Counts for the tab labels. Across the PROJECT, not the selected group --
  // the tabs describe the whole order, and a count that changed when you
  // clicked between groups would read as files or lines disappearing.
  // Which group's lines are open on Full Order. null = the summary table.
  // Reset with the tab so reopening the modal never lands mid-drill.
  const [itemsGroupId, setItemsGroupId] = useState<string | null>(null);
  // Which of the three bottom cards is expanded. One at a time -- three open
  // at once is the height problem this was meant to solve.
  const [openPane, setOpenPane] = useState<"customer" | "internal" | "files" | null>(null);
  const itemCount = useMemo(
    () => projectGroups.reduce((n, g) => n + (g.sku_items?.length ?? 0), 0),
    [projectGroups],
  );
  // No Files badge. ProjectFiles is what fetches the attachments, so a count
  // shown before you open that tab would read 0 -- meaning "not looked yet"
  // while looking exactly like "no files". A badge that is usually true is
  // worse than no badge. itemCount is safe because sku_items is already in the
  // store row.

  // Which tab. Resets when the modal is opened on a different order -- a stale
  // tab across opens is how someone lands on Files wondering where the stage
  // rail went.
  const [tab, setTab] = useState<"project" | "items" | "files" | "activity">("project");
  useEffect(() => { setTab("project"); setItemsGroupId(null); }, [order.id]);

  // Which group the panels below operate on. Opens on the one you clicked
  // from, so arriving from /samples selects the sample group and
  // consumeAckPicker fires against a panel that is actually mounted.
  const [selectedGroupId, setSelectedGroupId] = useState(order.id);
  useEffect(() => { setSelectedGroupId(order.id); }, [order.id]);

  // Every panel in this component reads `liveOrder`. Pointing it at the
  // SELECTED GROUP rather than the passed order is what makes the whole
  // modal group-aware without rewriting the panels.
  //
  // Searches EVERY type. This used to pick between `orders` and
  // `warranties` from the `tab` prop, so a sample or custom row -- in
  // neither list -- fell through to the static prop and rendered from a
  // frozen snapshot with no realtime updates.
  const liveOrder =
    projectGroups.find((o) => o.id === selectedGroupId)
    ?? projectGroups[0]
    ?? order;

  // If the modal was opened via the row Submit/Resubmit, pop the .xlsx picker.
  useEffect(() => {
    if (consumeAckPicker(liveOrder.id)) {
      requestAnimationFrame(() => {
        setTimeout(() => ackPanelRef.current?.openFilePicker(), 200);
      });
    }
  }, [liveOrder.id]);

  // Fetch distinct vendors for this order (drives the per-vendor export pills).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/orders/" + encodeURIComponent(liveOrder.id) + "/vendors");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setExportVendors(Array.isArray(data.vendors) ? data.vendors : []);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [liveOrder.id]);
  // ORDER_STAGES is a runtime fallback only: shapeOrder casts the DB value
  // to OrderType, so a corrupted `type` column would lie to the compiler.
  const stages = STAGE_LIST_BY_TYPE[liveOrder.type] ?? ORDER_STAGES;
  const stageIdx = (stages as string[]).indexOf(liveOrder.stage);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingStage) { setPendingStage(null); setAdminPin(""); setPinError(false); }
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pendingStage]);

  useEffect(() => {
    setNotes(liveOrder.notes);
    setNotesChanged(false);
  }, [liveOrder.notes]);

  useEffect(() => {
    setInternalNotes(liveOrder.internal_notes ?? "");
    setInternalNotesChanged(false);
  }, [liveOrder.internal_notes]);

  // When PIN prompt appears: blur whatever has focus, then claim it
  useEffect(() => {
    if (pendingStage) {
      (document.activeElement as HTMLElement | null)?.blur();
      requestAnimationFrame(() => pinInputRef.current?.focus());
    }
  }, [pendingStage]);

  async function handleMoveStage(stage: Stage) {
    const targetIdx = (stages as string[]).indexOf(stage);
    if (targetIdx === stageIdx) return; // No-op: already there

    // All manual stage changes from the modal require admin approval.
    // The normal forward flow is:
    //   - Set the date in the Production Dates / Delivery Date editor
    //     above (auto-advances when applicable), or
    //   - Use the row buttons on the stage pages (which enforce gates).
    // This modal picker is reserved for admin overrides only — both
    // forward and backward — so guardrails (attachment gate, date
    // gate, Early Push confirm) can't be skipped accidentally.
    (document.activeElement as HTMLElement | null)?.blur();
    setPendingStage(stage);
    setAdminPin("");
    setPinError(false);
  }

  async function doMoveStage(stage: Stage, providedPin: string) {
    // Gate 2: moving to "Entered" requires at least one attachment
    // SAMPLES AND HARDWARE ARE EXEMPT, matching the server.
    //
    // PATCH /api/orders/[id] skips this gate when the row type is not a
    // cabinet flow -- samples ship from JK's own stock, so there is no
    // manufacturer acknowledgment to attach, and hardware has none either.
    // This client gate checked the stage only, so it refused a sample before
    // the request was ever made: the server would have allowed it.
    //
    // Same shape as the bulk route's half-implemented gate. One rule, two
    // places, and only one of them had the clause.
    const gateApplies = liveOrder.type !== "sample" && liveOrder.type !== "hardware";
    if (gateApplies && stage === "Entered" && liveOrder.stage === "New") {
      setCheckingAttachments(true);
      setEnteredGateError(false);
      const result = await checkAttachmentGate(liveOrder.id);
      setCheckingAttachments(false);
      if (!result.ok) {
        setEnteredGateError(true);
        return;
      }
    }
    setEnteredGateError(false);
    // Send the PIN to the server. For backwards moves the API requires it
    // and rejects with 403 admin_pin_required if it's missing or wrong.
    // Forward moves don't need a PIN but accept one harmlessly.
    const result = await moveStage(liveOrder.id, stage, currentUserId, providedPin);
    if (!result.ok && result.pinRequired) {
      // Server rejected the PIN — keep the dialog open and let the user
      // try again. The PIN dialog is the canonical place to surface this
      // error since that's where the user typed it.
      setPendingStage(stage);
      setAdminPin("");
      setPinError(true);
      // Re-focus the input on the next frame so the user can retype.
      requestAnimationFrame(() => pinInputRef.current?.focus());
      return;
    }
    if (!result.ok) {
      // Some other error (network, 422, 500). Close the PIN dialog and
      // surface a generic error — the user can re-attempt from the picker.
      // Logged to console for debugging since we don't have a toast system.
      console.error("Stage move failed:", result.error);
      return;
    }
    onStageChange(stage);
  }

  function handlePinSubmit() {
    // No client-side comparison — that was the source of the drift bug
    // where ADMIN_CODE here had to match ADMIN_BACKWARD_PIN in Vercel.
    // Send whatever the user typed to the server; the server decides.
    if (!pendingStage || !adminPin) {
      setPinError(true);
      setTimeout(() => setPinError(false), 2000);
      return;
    }
    const stage = pendingStage;
    const pin = adminPin;
    // Close the dialog optimistically; doMoveStage will re-open it if the
    // server rejects the PIN. This keeps the happy path snappy.
    setPendingStage(null);
    setAdminPin("");
    setPinError(false);
    doMoveStage(stage, pin);
  }

  function handleSaveNotes() {
    updateNotes(liveOrder.id, notes);
    setNotesChanged(false);
  }

  function handleSaveInternalNotes() {
    updateInternalNotes(liveOrder.id, internalNotes);
    setInternalNotesChanged(false);
  }

  function handleDelete() {
    deleteOrder(liveOrder.id);
    onClose();
  }

  function handleArchive() {
    if (liveOrder.archived) {
      unarchiveOrder(liveOrder.id);
    } else {
      archiveOrder(liveOrder.id);
      onClose();
    }
  }

  // Re-decode this order's stored lines against the CURRENT mappings and
  // clear any flags that now resolve. Realtime refreshes the view on success.
  async function handleReDecode() {
    setReDecodeBusy(true);
    try {
      const res = await fetch("/api/admin/orders/" + encodeURIComponent(liveOrder.id) + "/re-decode", { method: "POST" });
      const data = await res.json().catch(() => ({} as { error?: string; message?: string; still_flagged?: number }));
      if (!res.ok) {
        showToast(data.error ?? "Re-decode failed", { kind: "error" });
      } else {
        showToast(data.message ?? "Re-decoded", { kind: (data.still_flagged ?? 0) > 0 ? "warn" : "success" });
      }
    } catch {
      showToast("Network error — re-decode not run", { kind: "error" });
    } finally {
      setReDecodeBusy(false);
    }
  }

  const isCompleted = liveOrder.stage === "Delivered" || liveOrder.stage === "Resolved";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-stretch justify-center animate-fade-in p-4 md:p-8"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-[1200px] max-h-[92vh] flex flex-col animate-slide-in overflow-hidden rounded-panel"
        style={PANEL}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 flex-shrink-0" style={SECTION_BORDER}>
          <div className="min-w-0">
            <h2 className="font-display text-[26px] text-cream leading-tight">{liveOrder.name}</h2>
            {/* Meta line, per the redesign mockup: the ORDER NUMBER, where it
                came from, and when. The number was an eyebrow above the name;
                below it reads as one line of context instead of a label. */}
            <p className="text-[11px] text-cream/45 mt-1">
              <span className="font-mono">{displayOrderNumber(liveOrder)}</span>
              <span className="mx-1.5">&middot;</span>
              {liveOrder.source === "Manual" ? "Custom" : liveOrder.source}
              <span className="mx-1.5">&middot;</span>
              {liveOrder.date}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
<div className="flex items-center gap-1.5">
            {(() => {
              const tier = slaTier(liveOrder);
              if (tier === "ok") return null;
              const rule = slaRuleFor(liveOrder);
              const age = rule ? slaAgeHours(liveOrder, rule) : hoursInStage(liveOrder);
              return (
                <span
                  className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium"
                  style={tier === "hard"
                    ? { background: "rgba(224,85,85,0.16)", color: "#e08585", border: "0.5px solid rgba(224,85,85,0.45)" }
                    : { background: "rgba(232,181,106,0.14)", color: "#e8b56a", border: "0.5px solid rgba(232,181,106,0.40)" }}
                >
                  {tier === "hard" ? "Past SLA" : "Due"} {formatStageAge(age)}
                </span>
              );
            })()}
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "rgba(232,227,218,0.55)",
                border: "0.5px solid rgba(255,255,255,0.14)",
              }}
            >
              {liveOrder.claimed_by
                ? (team.find((m) => m.id === liveOrder.claimed_by)?.name ?? "Claimed")
                : "Unclaimed"}
            </span>
            </div>
            {isCompleted && (
              <button
                onClick={handleArchive}
                title={liveOrder.archived ? "Restore" : "Archive"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/8 border border-white/15 text-cream/70 hover:bg-white/12 hover:text-cream"
              >
                {liveOrder.archived ? <><RotateCcw className="w-3 h-3" /> Restore</> : <><Archive className="w-3 h-3" /> Archive</>}
              </button>
            )}
            {liveOrder.source === "Manual" && (
              <button
                onClick={handleDelete}
                title="Delete order"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] transition-all hover:text-red-400"
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "0.5px solid rgba(255,255,255,0.18)",
                  color: "rgba(232,227,218,0.45)",
                }}
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )}
            {/* Per-manufacturer order PDF. Not for samples -- they ship from
                JK's own stock, so there is no manufacturer to send one to. */}
            {liveOrder.type !== "sample"
              && (liveOrder.stage !== "New" || !!liveOrder.claimed_by)
              && exportVendors.map((v) => (
              <a
                key={v}
                href={"/api/orders/" + encodeURIComponent(liveOrder.id) + "/export?vendor=" + encodeURIComponent(v)}
                target="_blank"
                rel="noopener noreferrer"
                title={"Export the " + v + " order PDF"}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/4 border border-cream/15 text-cream/85 hover:bg-white/8"
              >
                <Download className="w-3 h-3" />
                {v} PDF
              </a>
            ))}
            {isAdmin && (
              <button
                onClick={handleReDecode}
                disabled={reDecodeBusy}
                title="Re-run decode against the current mappings — clears flags that now resolve, and raises any that no longer do"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all disabled:opacity-50"
                style={
                  liveOrder.needs_review
                    ? { background: "rgba(224,168,72,0.14)", border: "0.5px solid rgba(224,168,72,0.45)", color: "#e8b866" }
                    : { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(232,227,218,0.60)" }
                }
              >
                {reDecodeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Re-decode
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-all hover:text-[#e8e3da]"
              style={{ color: "rgba(232,227,218,0.60)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* The project's other groups. Renders nothing for a project
            of one -- a custom job, a warranty claim, or a checkout with
            a single category. Outside the scroll container on purpose. */}
        <GroupStrip
          groups={projectGroups}
          selectedId={liveOrder.id}
          onSelect={setSelectedGroupId}
          team={team}
        />

        {/* Tabs. The group strip above belongs to the PROJECT and stays put;
            these switch what you see about it. */}
        <div className="flex items-center gap-1 px-6 pt-1 pb-0 flex-shrink-0">
          {([
            ["project", "Overview", null],
            ["items", "Full Order", itemCount],
            ["files", "Files", null],
            ["activity", "Activity", null],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="px-3 py-2 text-[11px] uppercase tracking-wider font-medium transition-all flex items-center gap-1.5"
              style={{
                color: tab === key ? "#f0ece4" : "rgba(232,227,218,0.45)",
                borderBottom: tab === key
                  ? "1.5px solid rgba(184,130,106,0.85)"
                  : "1.5px solid transparent",
              }}
            >
              {label}
              {count !== null && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(232,227,218,0.55)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Gate banner — shown when the modal opens because of a missing
              attachment. Prominent, terracotta accent, with a CTA that
              re-triggers the file picker. */}
          {/* Payment hold banner — a refunded, partially refunded or voided
              order cannot move forward until somebody acknowledges it. The
              banner stays after acknowledgement, because the refund is still
              a fact; only the wording and the control change. */}
          {tab === "project" && (<>
          <PaymentHoldBanner order={liveOrder} />

          {/* ── PIPELINE DETAILS ────────────────────────────────────────────
              The rail, the current stage, the next action and the claim, as
              ONE card. They were four separate blocks with four borders and
              four gaps -- the rail in its own section, the next action in
              another, the claim two sections further down in ORDER INFO. That
              is why it read as stitched together rather than designed. */}
          <div className="px-6 pt-4 pb-1">
            <div className="flex items-baseline gap-2 mb-2">
              <p className={LABEL + " mb-0"}>Pipeline details</p>
              <span className="text-[10px] text-cream/30">&middot;</span>
              <span className="text-[10px] text-cream/45">
                {GROUP_LABEL[liveOrder.type] ?? liveOrder.type}
              </span>
              {slaRuleFor(liveOrder) && (
                <span className="text-[10px] text-cream/35 ml-auto">
                  SLA target {slaRuleFor(liveOrder)!.hardHours}h
                </span>
              )}
            </div>

            {/* No outer border. The rail and the strip below are each their
                own frosted card; wrapping them in a bordered box as well is a
                box inside a box, which is what "disorganised" looks like. */}
            <div>
              <div>
            <div className="glass-sage rounded-panel px-4 py-4">
              <div className="flex items-start">
                {stages.map((s, i) => {
                  const isActive = liveOrder.stage === s;
                  const isPast = stageIdx > i;
                  const color = STAGE_COLOR[s] ?? "#91a597";
                  const isEnteredGate = s === "Entered" && liveOrder.stage === "New";
                  const lineDone = "rgba(145,165,151,0.55)";
                  const lineTodo = "rgba(255,255,255,0.12)";
                  return (
                    <div key={s} className="flex-1 flex flex-col items-center min-w-0">
                      <div className="flex items-center w-full">
                        <span className="flex-1 h-[1.5px] rounded-full" style={{ background: i === 0 ? "transparent" : (i <= stageIdx ? lineDone : lineTodo) }} />
                        <button
                          type="button"
                          onClick={() => handleMoveStage(s as Stage)}
                          disabled={checkingAttachments}
                          title={isEnteredGate ? "Requires a matching acknowledgment or attachment" : isPast ? "Move back (admin PIN)" : s}
                          className="relative flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ease-brand disabled:opacity-60"
                          style={
                            isActive
                              ? { background: color, boxShadow: `0 0 0 3px ${color}33, 0 0 10px ${color}66` }
                              : isPast
                              ? { background: `${color}cc` }
                              : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)" }
                          }
                        >
                          {isActive && checkingAttachments ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#15110c" }} />
                          ) : isPast ? (
                            <Check className="w-3.5 h-3.5" strokeWidth={3} style={{ color: "#15110c" }} />
                          ) : isActive ? (
                            <span className="w-2 h-2 rounded-full" style={{ background: "rgba(0,0,0,0.5)" }} />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: isEnteredGate ? "#e8b56a" : "rgba(240,236,228,0.35)" }} />
                          )}
                        </button>
                        <span className="flex-1 h-[1.5px] rounded-full" style={{ background: i === stages.length - 1 ? "transparent" : (i < stageIdx ? lineDone : lineTodo) }} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMoveStage(s as Stage)}
                        disabled={checkingAttachments}
                        className="mt-1.5 px-0.5 text-[9px] uppercase tracking-[0.07em] font-medium text-center leading-tight transition-colors disabled:opacity-60"
                        style={{ color: isActive ? color : isPast ? "rgba(240,236,228,0.62)" : "rgba(240,236,228,0.40)" }}
                      >
                        {s}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* PIN prompt for backwards moves */}
            {pendingStage && (
              <div className="mt-4 rounded-brand px-4 py-3.5"
                style={{
                  background: "rgba(232,144,144,0.10)",
                  border: "0.5px solid rgba(232,144,144,0.35)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
                }}>
                <p className="font-display text-[16px] mb-1" style={{ color: "#e89090" }}>
                  Admin code <em className="italic-storm">required</em>
                </p>
                <p className="text-[11px] mb-3 text-cream/55">
                  Moving to &ldquo;{pendingStage}&rdquo; from this view requires the admin override code. The normal workflow happens via the stage pages or by setting dates above.
                </p>
                <div className="flex gap-2">
                  <input
                    ref={pinInputRef}
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    name="order-modal-pin-no-autofill"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    maxLength={6}
                    value={adminPin}
                    onChange={(e) => {
                      // Accept alphanumeric only — letters and digits, no spaces
                      // or symbols. Server compares as-is, so we keep case sensitive.
                      setAdminPin(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 6));
                      setPinError(false);
                    }}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") handlePinSubmit(); }}
                    placeholder="••••••"
                    className="flex-1 rounded-full px-4 py-2 text-sm text-center tracking-[0.4em] font-mono transition-colors"
                    style={{
                      background: pinError ? "rgba(232,144,144,0.18)" : "rgba(255,255,255,0.08)",
                      border: pinError ? "0.5px solid rgba(232,144,144,0.60)" : "0.5px solid rgba(255,255,255,0.18)",
                      color: "#f0ece4",
                      outline: "none",
                      WebkitTextSecurity: "disc",
                      textSecurity: "disc",
                    } as React.CSSProperties}
                  />
                  <button
                    onClick={handlePinSubmit}
                    className="px-4 py-2 rounded-full text-[11px] uppercase tracking-wider font-medium transition-all"
                    style={{
                      background: "rgba(232,144,144,0.22)",
                      border: "0.5px solid rgba(232,144,144,0.50)",
                      color: "#e89090",
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => { setPendingStage(null); setAdminPin(""); setPinError(false); }}
                    className="px-4 py-2 rounded-full text-[11px] uppercase tracking-wider transition-all bg-white/4 border border-white/12 text-cream/55 hover:bg-white/8 hover:text-cream/85"
                  >
                    Cancel
                  </button>
                </div>
                {pinError && (
                  <p className="text-[11px] mt-2" style={{ color: "#e89090" }}>Incorrect code. Try again.</p>
                )}
              </div>
            )}
            {/* Attachment gate error */}
            {enteredGateError && (
              <div className="mt-4 rounded-brand px-4 py-3"
                style={{ background: "rgba(212,146,42,0.12)", border: "0.5px solid rgba(212,146,42,0.40)" }}>
                <p className="font-display text-[15px] mb-1" style={{ color: "#e8b56a" }}>
                  Acknowledgment <em className="italic-storm">required</em>
                </p>
                <p className="text-[11px] text-cream/65">
                  Upload the manufacturer&apos;s acknowledgment PDF in the Attachments section below before moving to Entered.
                </p>
              </div>
            )}
              </div>

              {/* Same frosted treatment as the rail above it. They were a
                  glass card and a flat outline sitting together, which is
                  what made the pair look unrelated. */}
              <div className="glass-sage rounded-panel overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto] items-stretch mt-2.5">
                <div className="px-4 py-3">
                  <p className={LABEL + " mb-1"}>Current stage</p>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: STAGE_ACCENT[liveOrder.stage] ?? "#8a8a8a" }} />
                    <span className="text-[13px] font-medium"
                      style={{ color: STAGE_ACCENT[liveOrder.stage] ?? "#8a8a8a" }}>
                      {liveOrder.stage}
                    </span>
                  </div>
                  <p className="text-[10px] text-cream/45 mt-1">
                    {formatStageAge(
                      slaRuleFor(liveOrder)
                        ? slaAgeHours(liveOrder, slaRuleFor(liveOrder)!)
                        : hoursInStage(liveOrder))} in stage
                    {slaTier(liveOrder) === "hard" && <span style={{ color: "#e08585" }}> &middot; overdue</span>}
                    {slaTier(liveOrder) === "soft" && <span style={{ color: "#e8b56a" }}> &middot; due</span>}
                  </p>
                </div>

                <div className="px-4 py-3 flex items-center justify-between gap-3"
                  style={{ borderLeft: "0.5px solid rgba(255,255,255,0.10)" }}>
                  <div className="min-w-0">
                    <p className={LABEL + " mb-1"}>Next action</p>
                    <p className="text-[11px] text-cream/65 leading-snug">
                      {nextStageFor(liveOrder)
                        ? <>Move this to <span className="text-cream/90">{nextStageFor(liveOrder)}</span> when it is ready.</>
                        : "Nothing further \u2014 this is the last stage."}
                    </p>
                  </div>
                  {nextStageFor(liveOrder) && (
                    <button
                      onClick={() => {
                        const next = nextStageFor(liveOrder);
                        // Empty PIN on purpose: this only ever offers the NEXT
                        // stage, so it is never a backward move.
                        if (next) doMoveStage(next as Stage, "");
                      }}
                      disabled={checkingAttachments}
                      className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all flex-shrink-0 disabled:opacity-40"
                      style={{
                        background: "rgba(184,130,106,0.20)",
                        border: "0.5px solid rgba(184,130,106,0.55)",
                        color: "#d9a888",
                      }}
                    >
                      {checkingAttachments ? "\u2026" : nextStageFor(liveOrder)}
                    </button>
                  )}
                </div>

                {/* One container, not two. This cell came out of ORDER INFO
                    still wearing that grid's borderTop/borderLeft, nested
                    inside the slot's own div -- the inset box that made it
                    read as a mistake. */}
                <div className="px-4 py-3 min-w-[190px] flex flex-col justify-center"
                  style={{ borderLeft: "0.5px solid rgba(255,255,255,0.10)" }}>
                {(() => {
                  // Stage-aware ownership:
                  //   New / New claim: claimed_by is the source of truth.
                  //     An order rolled back to New is unclaimed until
                  //     someone picks it up again — entered_by is kept
                  //     in the DB for audit but hidden here.
                  //   Later stages: entered_by takes precedence.
                  const isNewStage = liveOrder.stage === "New" || liveOrder.stage === "New claim";
                  const ownerName = isNewStage
                    ? liveOrder.claimed_by ?? null
                    : liveOrder.entered_by ?? liveOrder.claimed_by ?? null;
                  // ownerName is now a team_members.id; look up by id, render m.name
                  const ownerMember = ownerName ? team.find(m => m.id === ownerName) : null;
                  const claimedBy = liveOrder.claimed_by ?? null;
                  const isClaimedByMe = !!currentUserId && claimedBy === currentUserId;
                  const isClaimedByOther = !!claimedBy && !isClaimedByMe;
                  // Claim/release affordance only on New stages — once
                  // entered, ownership is tracked by entered_by which the
                  // PATCH endpoint maintains on stage transitions.
                  const showClaimUi = isNewStage;
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className={LABEL}>Team member</p>
                        {showClaimUi && (
                          isClaimedByMe ? (
                            <button
                              type="button"
                              onClick={() => handleClaim(null)}
                              disabled={claimBusy}
                              className="text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream transition-colors disabled:opacity-40"
                            >
                              {claimBusy ? "..." : "Release"}
                            </button>
                          ) : isClaimedByOther ? (
                            <span className="text-[10px] uppercase tracking-wider text-amber-300/70" title={`Claimed by ${ownerMember?.name ?? claimedBy}`}>
                              Locked
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleClaim(currentUserId ?? null)}
                              disabled={claimBusy || !currentUserId}
                              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 transition-all disabled:opacity-40"
                            >
                              {claimBusy ? "..." : "Claim"}
                            </button>
                          )
                        )}
                      </div>
                      <div className="mt-1">
                        {!ownerName ? (
                          <p className="text-xs text-cream/35 italic">unclaimed</p>
                        ) : ownerMember ? (
                          <div className="flex items-center gap-2">
                            <AvatarWithProfile member={ownerMember} size="sm" />
                            <span className="text-xs text-cream/65">{ownerMember.name}</span>
                          </div>
                        ) : (
                          // Fallback when the team row isn\'t loaded yet
                          <span className="text-xs text-cream/65">{ownerName}</span>
                        )}
                      </div>
                    </>
                  );
                })()}
                </div>
              </div>
            </div>
          </div>

          {/* ── ORDER INFO ──────────────────────────────────────────────────
              Six cells on a 3-column grid, so the second row fills. The
              4-column version went ragged the moment the claim cell moved out
              of it -- two cells on a row built for four. */}
          <div className="px-6 py-4">
            <p className={LABEL}>Order info</p>
            <div className="grid grid-cols-2 md:grid-cols-3 rounded-brand overflow-hidden"
              style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
              <div className="px-4 py-3" style={CELL}>
                <p className={LABEL + " mb-1"}>Source</p>
                <span className="text-[10px] uppercase tracking-wider px-2 py-px rounded-full font-medium inline-block"
                  style={
                    liveOrder.source === "Shopify"
                      ? { background: "rgba(184,130,106,0.15)", color: "#d9a888", border: "0.5px solid rgba(184,130,106,0.40)" }
                      : { background: "rgba(145,165,151,0.18)", color: "#b8d0bd", border: "0.5px solid rgba(145,165,151,0.45)" }
                  }>
                  {liveOrder.source === "Manual" ? "Custom" : liveOrder.source}
                </span>
              </div>
              <div className="px-4 py-3" style={CELL}>
                <p className={LABEL + " mb-1"}>Order date</p>
                <p className="text-xs text-cream/65">{liveOrder.date}</p>
              </div>
              <div className="px-4 py-3" style={CELL}>
                <p className={LABEL + " mb-1"}>Order type</p>
                <p className="text-xs text-cream/65">{GROUP_LABEL[liveOrder.type] ?? liveOrder.type}</p>
              </div>
              <div className="px-4 py-3" style={CELL}>
                {/* The reference a MANUFACTURER sees. Internal -- never shown
                    to a customer, who knows only the order number. */}
                <p className={LABEL + " mb-1"}>PO / Reference</p>
                <p className="text-xs font-mono text-cream/65">{poReference(liveOrder)}</p>
              </div>
              <div className="px-4 py-3" style={CELL}>
                {/* Start and estimated finish read as a span, not two facts. */}
                <p className={LABEL + " mb-1"}>Production dates</p>
                <p className="text-xs text-cream/65">
                  {liveOrder.production_start_date || liveOrder.production_est_finish_date
                    ? `${liveOrder.production_start_date || "?"} \u2192 ${liveOrder.production_est_finish_date || "?"}`
                    : "Not set"}
                </p>
              </div>
              <div className="px-4 py-3" style={CELL}>
                {/* Scheduled, not actual. A date the customer has not been
                    given is not a promise, and this is the internal view. */}
                <p className={LABEL + " mb-1"}>Delivery target</p>
                <p className="text-xs text-cream/65">
                  {liveOrder.scheduled_delivery_date || liveOrder.delivery_date || "Not set"}
                </p>
              </div>
            </div>
          </div>

            {/* Production & Delivery Dates — editable from Entered stage forward */}
            {/* Warranty claims have no production or delivery dates.
                Standard, sample and custom orders all do -- phrased as
                "not warranty" so a new type gets this by default. */}
            {liveOrder.type !== "warranty" && liveOrder.stage !== "New" && (
              <DateEditor order={liveOrder} updateOrderDetails={updateOrderDetails} />
            )}

            {/* Acknowledgments: per-vendor .xlsx reconciliation.

                NOT for samples. They ship from JK's own stock, so there is no
                manufacturer acknowledgment to reconcile against -- the server
                already exempts them from the Entered gate (phase 1c), and this
                stops the modal asking for a document that cannot exist.

                Phrased "not sample" so a future order type inherits the panel
                by default: showing it wrongly is cosmetic, hiding it wrongly
                means a missed manufacturer confirmation. */}
          {liveOrder.type !== "sample" && (
            <AcknowledgmentPanel ref={ackPanelRef} orderId={liveOrder.id} orderName={liveOrder.name} eligible={liveOrder.stage !== "New" || !!liveOrder.claimed_by} onAdvance={() => { if (liveOrder.stage === "New") moveStage(liveOrder.id, "Entered", currentUserId).then((r) => { if (!r.ok) showToast(r.error ?? "Could not move to Entered", { kind: "error" }); }); }} onAdvanceOverride={() => { if (liveOrder.stage === "New") moveStage(liveOrder.id, "Entered", currentUserId, undefined, true).then((r) => { if (!r.ok) showToast(r.error ?? "Could not move to Entered", { kind: "error" }); }); }} />
          )}
          {/* Notes and attachments as three cards in one row, collapsed to a
              summary line. This was two full-height textareas plus the
              attachments panel -- roughly 380px of an Overview that has to fit
              without scrolling.

              ⚠ THE PANELS ARE HIDDEN WITH CSS, NOT UNMOUNTED. AttachmentsPanel
              exposes openFilePicker() and openReceiptPicker() through an
              imperative handle, and the modal calls them when it opens on a
              missing-attachment or missing-receipt gate. Conditional rendering
              would leave attachmentsRef.current null and those calls would do
              nothing, silently. */}
          <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-2.5" style={SECTION_BORDER}>
            <button
              onClick={() => setOpenPane(openPane === "customer" ? null : "customer")}
              className="glass-sage rounded-panel px-3.5 py-3 text-left transition-all hover:brightness-110"
            >
              <p className={LABEL + " mb-0.5"}>Customer note</p>
              <p className="text-[11px] text-cream/45 truncate">
                {notes.trim() ? notes.trim().split("\n")[0] : "No customer note yet"}
              </p>
            </button>
            <button
              onClick={() => setOpenPane(openPane === "internal" ? null : "internal")}
              className="glass-sage rounded-panel px-3.5 py-3 text-left transition-all hover:brightness-110"
            >
              <div className="flex items-center gap-1.5">
                <p className={LABEL + " mb-0.5"}>Internal note</p>
                <span className="text-[8px] uppercase tracking-wider px-1 rounded-full mb-1"
                  style={{ background: "rgba(232,144,144,0.12)", color: "rgba(232,144,144,0.85)" }}>
                  staff
                </span>
              </div>
              <p className="text-[11px] text-cream/45 truncate">
                {internalNotes.trim() ? internalNotes.trim().split("\n")[0] : "No internal note yet"}
              </p>
            </button>
            <button
              onClick={() => setOpenPane(openPane === "files" ? null : "files")}
              className="glass-sage rounded-panel px-3.5 py-3 text-left transition-all hover:brightness-110"
            >
              <p className={LABEL + " mb-0.5"}>Attachments</p>
              <p className="text-[11px] text-cream/45 truncate">
                Drawings, receipts, measurements
              </p>
            </button>
          </div>

          {/* Expanded pane. One at a time -- three open at once is the height
              problem this was meant to solve. */}
          <div className={openPane === "customer" ? "" : "hidden"}>
            <div className="px-6 py-4" style={SECTION_BORDER}>
              <p className={LABEL}>Customer note</p>
              <p className="text-[10px] text-cream/35 mb-2">
                Visible to the customer &middot; written to the Shopify order
              </p>
              {liveOrder.source === "Manual" && liveOrder.notes?.includes("QUOTE REQUEST") ? (
                <QuoteInfoPanel notes={liveOrder.notes} />
              ) : (<>
                <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setNotesChanged(true); }}
                  placeholder="No customer note yet."
                  rows={3}
                  className="w-full rounded-brand p-2.5 text-[12px] resize-none placeholder:text-cream/25"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "0.5px solid rgba(255,255,255,0.12)",
                    color: "rgba(240,236,228,0.90)",
                    fontSize: "16px",
                  }}
                />
                {notesChanged && (
                  <button onClick={handleSaveNotes}
                    className="mt-2 text-[11px] uppercase tracking-wider font-medium text-terracotta hover:brightness-110">
                    Save note
                  </button>
                )}
              </>)}
            </div>
          </div>

          <div className={openPane === "internal" ? "" : "hidden"}>
            <div className="px-6 py-4" style={SECTION_BORDER}>
              <p className={LABEL}>Internal note</p>
              <p className="text-[10px] text-cream/35 mb-2">
                Visible to staff and on the export PDF. Never sent to Shopify.
              </p>
              <textarea
                value={internalNotes}
                onChange={(e) => { setInternalNotes(e.target.value); setInternalNotesChanged(true); }}
                placeholder="No internal note yet."
                rows={3}
                className="w-full rounded-brand p-2.5 text-[12px] resize-none placeholder:text-cream/25"
                style={{
                  background: "rgba(232,144,144,0.04)",
                  border: "0.5px solid rgba(232,144,144,0.25)",
                  color: "rgba(240,236,228,0.90)",
                  fontSize: "16px",
                }}
              />
              {internalNotesChanged && (
                <button onClick={handleSaveInternalNotes}
                  className="mt-2 text-[11px] uppercase tracking-wider font-medium text-terracotta hover:brightness-110">
                  Save internal note
                </button>
              )}
            </div>
          </div>

          {/* Damage reports */}
          {liveOrder.type === "warranty" && (
            <DamageReportPanel
              orderId={liveOrder.id}
              orderSkus={liveOrder.sku_items?.map((i) => i.sku) ?? (liveOrder.sku ? [liveOrder.sku] : [])}
              orderName={liveOrder.name}
              reporterName={currentUserDisplayName}
            />
          )}

          {/* Always mounted -- see the note above. Only its visibility changes. */}
          <div ref={attachmentsAnchorRef} className={openPane === "files" ? "" : "hidden"}>
            <AttachmentsPanel ref={attachmentsRef} orderId={liveOrder.id} />
          </div>

          </>)}

          {tab === "items" && (() => {
            const workGroups = projectGroups.filter((g) => g.type !== "warranty");
            if (workGroups.length === 0) {
              return (
                <div className="px-6 py-8 text-center">
                  <p className="text-[12px] text-cream/45">
                    A warranty claim carries damage reports, not SKU lines.
                  </p>
                </div>
              );
            }
            // A project of one IS its own detail. Making somebody click a
            // single-row table to reach the only thing in it is ceremony.
            const openId = workGroups.length === 1 ? workGroups[0].id : itemsGroupId;
            const open = openId ? workGroups.find((g) => g.id === openId) : undefined;

            if (open) {
              return (
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 px-6 pt-5 pb-1">
                    {workGroups.length > 1 && (
                      <button
                        onClick={() => setItemsGroupId(null)}
                        className="text-[10px] uppercase tracking-wider text-cream/45 hover:text-cream/85 transition-colors mr-1"
                      >
                        &larr; All
                      </button>
                    )}
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: STAGE_ACCENT[open.stage] ?? "#8a8a8a" }} />
                    <span className="text-[10px] uppercase tracking-wider font-medium text-cream/85">
                      {GROUP_LABEL[open.type] ?? open.type}
                    </span>
                    <span className="text-[10px] text-cream/40">&middot;</span>
                    {/* Stage lives on the HEADER, not as a column repeated down
                        every row. Every line in a group shares its group stage,
                        so a column would be the same value 54 times. */}
                    <span className="text-[10px] uppercase tracking-wider"
                      style={{ color: STAGE_ACCENT[open.stage] ?? "#8a8a8a" }}>
                      {open.stage}
                    </span>
                    <span className="text-[10px] text-cream/30 font-mono ml-auto">{open.id}</span>
                  </div>
                  {/* OrderDetails already groups by vendor, door style and colour
                      with a header per group -- reused, not reimplemented. It is
                      571 lines and it EDITS: adds and removes lines, saves them
                      back, resolves vendors, renders review flags. */}
                  <OrderDetails
                    orderId={open.id}
                    doorStyle={open.door_style ?? ""}
                    color={open.color ?? ""}
                    skuItems={open.sku_items ?? []}
                    productionStartDate={open.production_start_date}
                    productionEstFinishDate={open.production_est_finish_date}
                    scheduledDeliveryDate={open.scheduled_delivery_date}
                    readOnly={open.source === "Shopify"}
                  />
                </div>
              );
            }

            return (
              <div className="px-6 py-5">
                <div className="rounded-brand overflow-hidden" style={{ border: "0.5px solid rgba(255,255,255,0.12)" }}>
                  <div className="grid grid-cols-[1.4fr_1.6fr_auto_auto] gap-3 px-4 py-2.5 text-[9px] uppercase tracking-wider text-cream/40"
                    style={{ background: "rgba(255,255,255,0.03)" }}>
                    <span>Description</span>
                    <span>Vendors</span>
                    <span className="text-right">Parts</span>
                    <span className="text-right">Stage</span>
                  </div>
                  {workGroups.map((g) => {
                    const items = g.sku_items ?? [];
                    const vendors = Array.from(new Set(
                      items.map((i) => String(i.vendor ?? "").trim()).filter(Boolean)));
                    // Total QUANTITY -- "parts" is the number of physical things.
                    // The tab badge counts LINES, the mockup\'s "54 items".
                    // Different questions, both labelled.
                    const parts = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
                    const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";
                    return (
                      <button key={g.id} onClick={() => setItemsGroupId(g.id)}
                        className="w-full grid grid-cols-[1.4fr_1.6fr_auto_auto] gap-3 px-4 py-3 text-left transition-colors hover:bg-white/4"
                        style={{ borderTop: "0.5px solid rgba(255,255,255,0.08)" }}>
                        <span className="text-[12px] text-cream/85">{GROUP_LABEL[g.type] ?? g.type}</span>
                        <span className="text-[11px] text-cream/55 truncate">
                          {vendors.length > 0 ? vendors.join(", ") : (g.vendor || "\u2014")}
                        </span>
                        <span className="text-[11px] text-cream/70 text-right tabular-nums">{parts || "\u2014"}</span>
                        <span className="text-[10px] uppercase tracking-wider text-right whitespace-nowrap"
                          style={{ color: accent }}>{g.stage}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {tab === "files" && <ProjectFiles groups={projectGroups} />}

          {/* Activity — the SELECTED GROUP's trail, not the project's.
              order_activity hangs off orders.order_id, and a merged
              project timeline would need a project_id column that does not
              exist. Per-group is also what you want while working a group. */}
          {tab === "activity" && (
          <div className="px-6 py-5">
            <div className="flex flex-col gap-3">
              {[...liveOrder.activity].reverse().map((a, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                    <Clock className="w-3 h-3 text-cream/45" />
                    {i < liveOrder.activity.length - 1 && (
                      <div className="w-px flex-1 min-h-[12px]" style={{ background: "rgba(255,255,255,0.15)" }} />
                    )}
                  </div>
                  <div className="pb-1">
                    <p className="text-[12px] text-cream/70 leading-snug">{a.text}</p>
                    <p className="text-[10px] text-cream/40 mt-0.5">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Footer. Outside the scroll container so it is always reachable --
            the modal previously just ended, so on a long Overview the only way
            out was scrolling back up to the X.

            No "Update order": every field here saves itself (notes have their
            own save link, stage moves go through the rail, dates through the
            editor). A button implying one atomic save would be lying about
            what it does. It saves pending NOTE edits, and says so. */}
        <div
          className="flex items-center justify-between gap-2 px-6 py-3.5 flex-shrink-0"
          style={{ borderTop: "0.5px solid rgba(255,255,255,0.10)" }}
        >
          <div className="text-[10px] text-cream/30 font-mono truncate">{liveOrder.id}</div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(notesChanged || internalNotesChanged) && (
              <button
                onClick={() => {
                  if (notesChanged) handleSaveNotes();
                  if (internalNotesChanged) handleSaveInternalNotes();
                }}
                className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all"
                style={{
                  background: "rgba(184,130,106,0.20)",
                  border: "0.5px solid rgba(184,130,106,0.55)",
                  color: "#d9a888",
                }}
              >
                Save notes
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/75 hover:bg-white/10 hover:text-cream"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteInfoPanel({ notes }: { notes: string }) {
  function extract(label: string): string {
    const regex = new RegExp(`^${label}:\\s*(.+)`, "im");
    const match = notes.match(regex);
    return match ? match[1].trim() : "";
  }

  const customerName = extract("Customer");
  const phone    = extract("Phone");
  const email    = extract("Email");
  const address  = extract("Address");
  const city     = extract("City");
  const state    = extract("State");
  const zip      = extract("Zip");
  const budget   = extract("Budget");
  const door     = extract("Door Style");
  const color    = extract("Color");
  const notesTxt = extract("Notes");
  const attach   = extract("📎 Attachment");

  const ROW = "flex flex-col gap-0.5";
  const LBL = "text-[9px] uppercase tracking-[0.13em] font-medium text-cream/45" as const;
  const VAL = "text-[13px]" as const;

  return (
    <div className="space-y-3">
      {/* Contact info */}
      <div className="rounded-brand p-4" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
        <p className="eyebrow mb-3">Contact</p>
        <div className="grid grid-cols-2 gap-3">
          {customerName && <div className={ROW + " col-span-2"}><span className={LBL}>Name</span><span className={VAL} style={{ color: "#f0ece4", fontWeight: 500 }}>{customerName}</span></div>}
          {phone && <div className={ROW}><span className={LBL}>Phone</span><span className={VAL} style={{ color: "rgba(240,236,228,0.85)" }}>{phone}</span></div>}
          {email && <div className={ROW}><span className={LBL}>Email</span><span className={VAL} style={{ color: "rgba(240,236,228,0.85)", wordBreak: "break-all" }}>{email}</span></div>}
          {address && <div className={ROW + " col-span-2"}><span className={LBL}>Address</span><span className={VAL} style={{ color: "rgba(240,236,228,0.85)" }}>{address}</span></div>}
          {(city || state || zip) && (
            <div className={ROW + " col-span-2"}>
              <span className={LBL}>City / State / Zip</span>
              <span className={VAL} style={{ color: "rgba(240,236,228,0.85)" }}>{[city, state, zip].filter(Boolean).join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quote selections */}
      {(budget || door || color) && (
        <div className="rounded-brand p-4" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
          <p className="eyebrow mb-3">Selections</p>
          <div className="space-y-2.5">
            {budget && <div className={ROW}><span className={LBL}>Budget</span><span className={VAL} style={{ color: "#a0cc7a" }}>{budget}</span></div>}
            {door && <div className={ROW}><span className={LBL}>Door Style</span><span className={VAL} style={{ color: "rgba(240,236,228,0.85)" }}>{door}</span></div>}
            {color && <div className={ROW}><span className={LBL}>Color</span><span className={VAL} style={{ color: "rgba(240,236,228,0.85)" }}>{color}</span></div>}
          </div>
        </div>
      )}

      {/* Customer notes */}
      {notesTxt && (
        <div className="rounded-brand p-4" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
          <p className="eyebrow mb-2">Customer Notes</p>
          <p className="text-[13px] leading-relaxed" style={{ color: "rgba(240,236,228,0.80)" }}>{notesTxt}</p>
        </div>
      )}

      {/* Attachment link */}
      {attach && (
        <div className="rounded-brand p-4" style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)" }}>
          <p className="eyebrow mb-2">Attachment</p>
          <a href={attach} target="_blank" rel="noopener noreferrer" className="text-[13px] underline text-terracotta hover:brightness-110 transition-all">View uploaded file</a>
        </div>
      )}
    </div>
  );
}

/* ─── Date editor (inline) ──────────────────────────────────────────────
 *
 * Editable production_start_date / production_est_finish_date /
 * scheduled_delivery_date with stage-aware visibility:
 *   - Entered: shows Prod Start + Est Finish editors, prompts user to
 *     set Start (server auto-advances to In production when saved).
 *   - In production: both production dates editable. Delivery date
 *     not yet relevant.
 *   - At cross dock + Delivered: production dates locked (display
 *     only) and delivery date editable.
 *
 * Editing replaces the existing dates; the server PATCHes the new
 * values directly. Clearing the start date is intentionally blocked
 * — once the order is past Entered it shouldn't lose its commit date.
 */
function DateEditor({
  order,
  updateOrderDetails,
}: {
  order: Order;
  updateOrderDetails: (id: string, details: {
    production_start_date?: string | null;
    production_est_finish_date?: string | null;
    scheduled_delivery_date?: string | null;
  }) => Promise<void>;
}) {
  const stage = order.stage;
  const showProdDates = stage === "Entered" || stage === "In production" || stage === "At cross dock" || stage === "Delivered";
  const showDeliveryDate = stage === "At cross dock" || stage === "Delivered";
  const prodEditable = stage === "Entered" || stage === "In production";
  // Whether saving a start date will MOVE the order.
  //
  // For standard and sample rows the server advances Entered -> In
  // production on save, and the production-complete cron then owns In
  // production -> At cross dock. Custom orders are hand-driven end to end
  // and that cron is filtered to exclude them, so their dates are a record,
  // not a trigger. The copy below has to say so rather than promise a move
  // that will not happen.
  const autoAdvances = order.type !== "custom";
  const deliveryEditable = stage === "At cross dock";

  const [editingProd, setEditingProd] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState(false);
  const [prodStart, setProdStart] = useState(order.production_start_date ?? "");
  const [prodFinish, setProdFinish] = useState(order.production_est_finish_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(order.scheduled_delivery_date ?? "");
  const [saving, setSaving] = useState(false);

  // Reset local state when the order data changes (e.g. after a save)
  useEffect(() => {
    setProdStart(order.production_start_date ?? "");
    setProdFinish(order.production_est_finish_date ?? "");
    setDeliveryDate(order.scheduled_delivery_date ?? "");
  }, [order.production_start_date, order.production_est_finish_date, order.scheduled_delivery_date]);

  async function saveProd() {
    if (!prodStart) return; // Start date required — setting it triggers auto-advance
    setSaving(true);
    try {
      await updateOrderDetails(order.id, {
        production_start_date: prodStart,
        production_est_finish_date: prodFinish || null,
      });
      setEditingProd(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveDelivery() {
    if (!deliveryDate) return;
    setSaving(true);
    try {
      await updateOrderDetails(order.id, { scheduled_delivery_date: deliveryDate });
      setEditingDelivery(false);
    } finally {
      setSaving(false);
    }
  }

  const hasAnyDate = !!(order.production_start_date || order.production_est_finish_date || order.scheduled_delivery_date);
  if (!showProdDates && !showDeliveryDate && !hasAnyDate) return null;

  return (
    <div className="space-y-2 mb-1">
      {/* ── Production dates ── */}
      {showProdDates && (
        <>
          {editingProd ? (
            <div className="rounded-brand p-3" style={{ background: "rgba(200,184,74,0.08)", border: "0.5px solid rgba(200,184,74,0.30)" }}>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium">Production dates</p>
                {stage === "Entered" && autoAdvances && (
                  <span className="text-[9px] text-cream/45 italic">
                    Setting start date auto-advances to <em className="italic-storm">In production</em>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-cream/55">Start date <span className="text-terracotta">*</span></span>
                  <input
                    type="date"
                    value={prodStart}
                    onChange={(e) => setProdStart(e.target.value)}
                    className="rounded-brand px-2.5 py-1.5 text-[12px]"
                    style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.18)", color: "#f0ece4", colorScheme: "dark" }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-cream/55">Est. finish</span>
                  <input
                    type="date"
                    value={prodFinish}
                    onChange={(e) => setProdFinish(e.target.value)}
                    className="rounded-brand px-2.5 py-1.5 text-[12px]"
                    style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.18)", color: "#f0ece4", colorScheme: "dark" }}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveProd}
                  disabled={saving || !prodStart}
                  className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
                >
                  {saving ? "…" : "Save dates"}
                </button>
                <button
                  onClick={() => {
                    setProdStart(order.production_start_date ?? "");
                    setProdFinish(order.production_est_finish_date ?? "");
                    setEditingProd(false);
                  }}
                  className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream/85"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (order.production_start_date || order.production_est_finish_date) ? (
            <div className="grid grid-cols-3 gap-2">
              {order.production_start_date && (
                <div className="rounded-brand px-3 py-2" style={{ background: "rgba(200,184,74,0.10)", border: "0.5px solid rgba(200,184,74,0.30)" }}>
                  <p className="text-[9px] uppercase tracking-[0.13em] mb-0.5 text-cream/45">Prod. Start</p>
                  <p className="text-[11px] font-medium" style={{ color: "#d4cc70" }}>{order.production_start_date}</p>
                </div>
              )}
              {order.production_est_finish_date && (
                <div className="rounded-brand px-3 py-2" style={{ background: "rgba(200,184,74,0.10)", border: "0.5px solid rgba(200,184,74,0.30)" }}>
                  <p className="text-[9px] uppercase tracking-[0.13em] mb-0.5 text-cream/45">Est. Finish</p>
                  <p className="text-[11px] font-medium" style={{ color: "#d4cc70" }}>{order.production_est_finish_date}</p>
                </div>
              )}
              {prodEditable && (
                <button
                  onClick={() => setEditingProd(true)}
                  className="rounded-brand px-3 py-2 text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream/85 hover:bg-white/4 transition-all"
                  style={{ border: "0.5px dashed rgba(255,255,255,0.20)" }}
                >
                  Edit dates →
                </button>
              )}
            </div>
          ) : (
            // No dates set yet — show a single CTA to enter them.
            //
            // Gated on prodEditable, NOT on stage === "Entered". A standard
            // order never reaches In production without dates, because it
            // gets there BY having a start date set -- but a custom order
            // arrives by a manual advance, and any order moved backward or
            // by admin PIN arrives the same way. All of them landed here
            // with no way to enter dates at all.
            prodEditable && (
              <button
                onClick={() => setEditingProd(true)}
                className="w-full rounded-brand px-4 py-3 text-left transition-all bg-terracotta/10 hover:bg-terracotta/15"
                style={{ border: "0.5px solid rgba(184,130,106,0.40)" }}
              >
                <p className="font-display text-[15px] mb-0.5" style={{ color: "#d9a888" }}>
                  Set production <em className="italic-storm">start date</em>
                </p>
                <p className="text-[11px] text-cream/55">
                  {stage === "Entered" && autoAdvances ? (
                    <>This will auto-advance the order to <em className="italic-storm">In production</em>.</>
                  ) : (
                    <>Recorded for scheduling — this will not move the order.</>
                  )}
                </p>
              </button>
            )
          )}
        </>
      )}

      {/* ── Delivery date ── */}
      {showDeliveryDate && (
        <>
          {editingDelivery ? (
            <div className="rounded-brand p-3" style={{ background: "rgba(90,141,184,0.08)", border: "0.5px solid rgba(90,141,184,0.30)" }}>
              <p className="text-[10px] uppercase tracking-[0.13em] text-cream/55 font-medium mb-2">Delivery date</p>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="rounded-brand px-2.5 py-1.5 text-[12px] mb-3 w-48"
                style={{ background: "rgba(255,255,255,0.06)", border: "0.5px solid rgba(255,255,255,0.18)", color: "#f0ece4", colorScheme: "dark" }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveDelivery}
                  disabled={saving || !deliveryDate}
                  className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
                >
                  {saving ? "…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setDeliveryDate(order.scheduled_delivery_date ?? "");
                    setEditingDelivery(false);
                  }}
                  className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream/85"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : order.scheduled_delivery_date ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-brand px-3 py-2" style={{ background: "rgba(90,141,184,0.10)", border: "0.5px solid rgba(90,141,184,0.30)" }}>
                <p className="text-[9px] uppercase tracking-[0.13em] mb-0.5 text-cream/45">Delivery Date</p>
                <p className="text-[11px] font-medium" style={{ color: "#a8c8e0" }}>{order.scheduled_delivery_date}</p>
              </div>
              {deliveryEditable && (
                <button
                  onClick={() => setEditingDelivery(true)}
                  className="rounded-brand px-3 py-2 text-[10px] uppercase tracking-wider text-cream/55 hover:text-cream/85 hover:bg-white/4 transition-all"
                  style={{ border: "0.5px dashed rgba(255,255,255,0.20)" }}
                >
                  Edit date →
                </button>
              )}
            </div>
          ) : (
            stage === "At cross dock" && (
              <button
                onClick={() => setEditingDelivery(true)}
                className="w-full rounded-brand px-4 py-3 text-left transition-all bg-terracotta/10 hover:bg-terracotta/15"
                style={{ border: "0.5px solid rgba(184,130,106,0.40)" }}
              >
                <p className="font-display text-[15px] mb-0.5" style={{ color: "#d9a888" }}>
                  Set <em className="italic-storm">delivery date</em>
                </p>
                <p className="text-[11px] text-cream/55">
                  Once set, you can confirm delivery from the stage page.
                </p>
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}

/**
 * The project's groups, as a selectable strip.
 *
 * Renders nothing for a project of one -- a custom job, a warranty claim, or a
 * Shopify order that happened to contain a single category. A strip with one
 * item is noise.
 *
 * ⚠ A GROUP'S STATUS NEVER DRIVES ANOTHER'S. Cabinets in production alongside
 * samples delivered is a normal state, not a conflict, and nothing here should
 * suggest one group is holding another up. They are separate work with separate
 * claims on genuinely different timelines -- that is the whole reason the
 * project splits into groups at all.
 */
/**
 * CURRENT STAGE / NEXT ACTION.
 *
 * The rail says where the order IS. This says what to do about it, which is
 * the question somebody opening a modal is actually asking.
 *
 * Driven by nextStageFor() for the SELECTED GROUP's type, so a warranty claim
 * reads "In review" and a hardware group reads "Shipped" rather than a
 * cabinet-shaped next step. A terminal stage has no next action and says so
 * rather than showing a dead button.
 */
function NextActionCard({
  order, onAdvance, busy, claimSlot,
}: {
  order: Order;
  onAdvance: () => void;
  busy: boolean;
  claimSlot?: React.ReactNode;
}) {
  const next = nextStageFor(order);
  const accent = STAGE_ACCENT[order.stage] ?? "#8a8a8a";
  const rule = slaRuleFor(order);
  const hours = rule ? slaAgeHours(order, rule) : hoursInStage(order);
  const tier = slaTier(order);

  return (
    <div
      className="mx-6 mb-5 rounded-brand flex items-stretch"
      style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.12)" }}
    >
      <div className="flex-1 px-4 py-3">
        <p className="text-[9px] uppercase tracking-[0.16em] text-cream/40 mb-1.5">Current stage</p>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
          <span className="text-[13px] font-medium" style={{ color: accent }}>{order.stage}</span>
        </div>
        <p className="text-[10px] text-cream/45 mt-1">
          {formatStageAge(hours)} in stage
          {rule && ` \u00b7 SLA target ${rule.hardHours}h`}
          {tier === "hard" && <span style={{ color: "#e08585" }}> \u00b7 overdue</span>}
          {tier === "soft" && <span style={{ color: "#e8b56a" }}> \u00b7 due</span>}
        </p>
      </div>
      <div
        className="flex-[1.4] px-4 py-3 flex items-center justify-between gap-3"
        style={{ borderLeft: "0.5px solid rgba(255,255,255,0.10)" }}
      >
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.16em] text-cream/40 mb-1.5">Next action</p>
          <p className="text-[11px] text-cream/65 leading-snug">
            {next
              ? <>Move this to <span className="text-cream/85">{next}</span> when it is ready.</>
              : "Nothing further \u2014 this is the last stage."}
          </p>
        </div>
        {next && (
          <button
            onClick={onAdvance}
            disabled={busy}
            className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all flex-shrink-0 disabled:opacity-40"
            style={{
              background: "rgba(184,130,106,0.20)",
              border: "0.5px solid rgba(184,130,106,0.55)",
              color: "#d9a888",
            }}
          >
            {busy ? "\u2026" : next}
          </button>
        )}
      </div>
      {claimSlot && (
        <div className="px-4 py-3" style={{ borderTop: "0.5px solid rgba(255,255,255,0.10)" }}>
          {claimSlot}
        </div>
      )}
    </div>
  );
}

function GroupStrip({
  groups, selectedId, onSelect, team,
}: {
  groups: Order[];
  selectedId: string;
  onSelect: (id: string) => void;
  team: TeamMember[];
}) {
  if (groups.length < 2) return null;

  return (
    <div className="px-6 py-3 flex-shrink-0" style={SECTION_BORDER}>
      <div className="flex items-baseline gap-2 mb-2">
        <p className={LABEL + " mb-0"}>Order-level overview</p>
        <span className="text-[10px] text-cream/30">&middot;</span>
        <span className="text-[10px] text-cream/40">
          {groups.length} pipelines in this order
        </span>
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto">
        {groups.map((g) => {
          const active = g.id === selectedId;
          const accent = STAGE_ACCENT[g.stage] ?? "#8a8a8a";
          const owner = g.claimed_by ? team.find((m) => m.id === g.claimed_by) : undefined;
          const items = g.sku_items?.length ?? 0;
          const rule = slaRuleFor(g);
          const tier = slaTier(g);
          const age = rule ? slaAgeHours(g, rule) : hoursInStage(g);
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className="flex-1 min-w-[210px] text-left rounded-brand px-3.5 py-3 transition-all"
              style={{
                background: active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.025)",
                border: active
                  ? "0.5px solid rgba(184,130,106,0.65)"
                  : "0.5px solid rgba(255,255,255,0.10)",
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[12px] font-medium text-cream/90">
                  {GROUP_LABEL[g.type] ?? g.type}
                </span>
                {active && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-full flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.08)", color: "rgba(232,227,218,0.55)" }}>
                    Selected
                  </span>
                )}
              </div>
              {/* Counts and target ON THE FACE. The strip this replaced showed
                  only category, stage and claim -- everything else appeared
                  after you selected a group, which is a hub that hides the
                  thing you opened it to compare. */}
              <p className="text-[10px] text-cream/40 mb-2">
                {items} item{items === 1 ? "" : "s"}
                {rule
                  ? <> &middot; SLA target {rule.hardHours}h</>
                  : <> &middot; no SLA</>}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: accent }} />
                <span className="text-[12px] font-medium" style={{ color: accent }}>{g.stage}</span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                {tier !== "ok" ? (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={tier === "hard"
                      ? { background: "rgba(224,85,85,0.16)", color: "#e08585", border: "0.5px solid rgba(224,85,85,0.45)" }
                      : { background: "rgba(232,181,106,0.14)", color: "#e8b56a", border: "0.5px solid rgba(232,181,106,0.40)" }}>
                    {formatStageAge(age)} {tier === "hard" ? "overdue" : "due"}
                  </span>
                ) : (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(143,190,112,0.14)", color: "#a0cc7a", border: "0.5px solid rgba(143,190,112,0.35)" }}>
                    On track
                  </span>
                )}
                {/* Who owns this pipeline, with their avatar -- the strip
                    this replaced showed a name only, and on a card carrying
                    four other facts a name alone does not read as ownership. */}
                <span className="flex items-center gap-1.5 min-w-0">
                  {owner ? (
                    <>
                      <AvatarWithProfile member={owner} size="sm" />
                      <span className="text-[9px] text-cream/45 truncate">{owner.name}</span>
                    </>
                  ) : (
                    <span className="text-[9px] text-cream/30 italic truncate">unclaimed</span>
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Plural, human label per group type. Exhaustive so a sixth type is a compile error. */
const GROUP_LABEL: Record<string, string> = {
  order: "Cabinets",
  hardware: "Hardware",
  sample: "Samples",
  custom: "Custom job",
  warranty: "Warranty claim",
};

/**
 * Every file on the project, across every group -- read-only.
 *
 * Uploading stays on the Project tab under the selected group, where
 * AttachmentsPanel's imperative handle is always mounted and the
 * needs-attachment flow can reach it. This view exists because when you are
 * looking for a signed delivery receipt you do not know, and should not have to
 * know, which group it hangs off.
 *
 * Fetches per group rather than by project: order_attachments has an order_id
 * foreign key and no project column, so the group ids ARE the query.
 */
function ProjectFiles({ groups }: { groups: Order[] }) {
  const [rows, setRows] = useState<
    { order_id: string; file_name: string; kind: string | null; created_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const ids = groups.map((g) => g.id).join(",");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const all: { order_id: string; file_name: string; kind: string | null; created_at: string }[] = [];
      for (const id of ids.split(",").filter(Boolean)) {
        try {
          const res = await fetch("/api/orders/attachments?orderId=" + encodeURIComponent(id));
          if (!res.ok) continue;
          const data = await res.json();
          for (const a of (data.data ?? [])) {
            all.push({
              order_id: id,
              file_name: String(a.file_name ?? a.file_path ?? ""),
              kind: a.kind ?? null,
              created_at: String(a.created_at ?? ""),
            });
          }
        } catch { /* one group failing should not blank the rest */ }
      }
      if (!cancelled) { setRows(all); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ids]);

  if (loading) {
    return <div className="px-6 py-5 text-[12px] text-cream/45">Loading files…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="px-6 py-8 text-center">
        <p className="text-[12px] text-cream/45">No files on this project yet.</p>
        <p className="text-[11px] text-cream/30 mt-1">
          Upload from a group on the Project tab.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 py-5 flex flex-col gap-2">
      {rows.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-brand px-3 py-2"
          style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.10)" }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-cream/85 truncate">{r.file_name}</p>
            <p className="text-[10px] text-cream/40 mt-0.5">
              {GROUP_LABEL[groups.find((g) => g.id === r.order_id)?.type ?? ""] ?? r.order_id}
              {r.kind === "proof_of_delivery" && " · signed delivery receipt"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
