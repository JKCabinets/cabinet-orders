"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { X, Check, Clock, Archive, RotateCcw, Trash2, Loader2, Download, FileText, Truck, Inbox, ClipboardCheck, Factory, PackageCheck, Search, ShoppingCart, Send, Wrench, ShieldAlert, CircleCheck, CircleDot, Hash, CalendarDays, User, Mail, MapPin, Layers, StickyNote } from "lucide-react";
import { stageSentence } from "@/lib/stageSentences";
// (clsx, imported and never used, removed in item 56.)
import { useSession } from "next-auth/react";
import {
  Order, Stage, ORDER_STAGES, STAGE_LIST_BY_TYPE,
  isPaymentHoldStatus, paymentHoldActive, paymentHoldLabel,
  displayOrderNumber, nextStageFor, poReference, archivesAsOrder, archivedVia,
  sourceLabel, type TeamMember,
} from "@/lib/data";
import { slaRuleFor, slaAgeHours, hoursInStage, slaTier, formatStageAge } from "@/lib/sla";
import { useStore } from "@/lib/store";
import { AvatarWithProfile } from "./AvatarWithProfile";
import { useToast } from "./Toast";
import { checkAttachmentGate } from "@/lib/stageGates";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { FileGroupTiles } from "./FileGroupTiles";
import { AttachFileCard, type AttachFileCardHandle } from "./AttachFileCard";
// (The purchase's Files tab is AttachmentsPanel per group since 5d, 2026-10-28.)
import { FullOrderGroup, GroupIssueTag } from "./FullOrderGroup";
import { OrderHeaderCards, ConsentMissingPill, ShopifyGonePill } from "./OrderHeaderCards";
import { ClaimCloseButton, ClaimOutcomePill } from "./ClaimClose";
import { DamageReportPanel } from "./DamageReportPanel";
import { AcknowledgmentPanel, type AcknowledgmentPanelHandle } from "./AcknowledgmentPanel";
import { consumeAckPicker, useAckStatus } from "@/lib/ackStatus";
import { STAGE_ACCENT, lastEnteredAt } from "@/lib/data";
import { typeCarriesTracking } from "@/lib/categories";
import type { DateFields } from "./NextActionPanel";
import { requirementsFor } from "@/lib/requirements";
import { formatMDY, orderDate, activityStamp, stageDate } from "@/lib/dates";
import { useOrderEnrichment } from "@/lib/useOrderEnrichment";
import { NextActionPanel } from "./NextActionPanel";
import { CustomSpecsPanel } from "./CustomSpecsPanel";
import { QuoteSubmissionPanel } from "./QuoteSubmissionPanel";

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
  /**
   * Why the modal was opened, when it was opened BY a refusal rather than by a
   * click. Each value is a promise that the modal will explain itself:
   *
   *   needs-attachment  banner, scroll to the attachments, open the picker
   *   needs-tracking    glow the tracking field and focus the number
   *
   * ⚠ ONE MECHANISM, not two. The table refuses and names the reason; the
   * modal responds to the name. Adding a second channel for "and also highlight
   * this" is how the two drift.
   */
  initialReason?: "needs-attachment" | "needs-tracking";
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

// (2026-10-26) The rail's own copy of the stage colours, STAGE_COLOR, is gone:
// it matched lib/data's STAGE_ACCENT except that it lacked "Ordered", so a
// custom job's rail drew Ordered in the fallback sage while its heading, the
// board and the table drew it gold. One map now: STAGE_ACCENT.

const PANEL: React.CSSProperties = {
  // Brand: signature frosted sage glass — matches the sidebar's sage tone
  // exactly so the modal feels like the same material as the chrome.
  // Keeping a slightly heavier shadow than the sidebar since the modal is
  // a larger floating surface over a darkened overlay.
  // ⚠ SAMPLED, NOT GUESSED. The sidebar renders at #3c484c and this modal
  // rendered at #2c302f -- 25% darker, and green-dominant where the sidebar is
  // blue-dominant. Both use glass-sage, so the class was never the problem.
  //
  // The cause is what each one is translucent OVER. The sidebar sits on the
  // blue-grey page; the modal sits on a 55%-black overlay, so the sage tint had
  // no blue beneath it to pick up and read green over near-black.
  //
  // Fixed by making the panel opaque enough to carry its own colour rather than
  // borrowing the overlay's, and tinting it to the sampled sidebar blue.
  background: "rgba(58, 71, 78, 0.92)",
  backdropFilter: "blur(20px) saturate(140%)",
  WebkitBackdropFilter: "blur(20px) saturate(140%)",
  border: "0.5px solid rgba(145, 165, 151, 0.30)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 60px rgba(0,0,0,0.55)",
};

const SECTION_BORDER: React.CSSProperties = {
  borderBottom: "0.5px solid rgba(255,255,255,0.10)",
};

// (CELL, a style nothing used since the stage panel's restyle, removed in item 56.)
// ⚠ 50% ON A DARK PANEL IS A WATERMARK. Every field name in the modal uses
// this, and under it every value sat at 65% -- so the cards read as a grey
// wash and the words got lost. The label is still quieter than its value;
// it is just legible now.
/**
 * The stage panel's icon tile (2026-10-22, item 8 -- Garrett's mockup). One per
 * stage NAME: the five flows share names ("New", "Delivered"), and a name means
 * the same moment in each. A stage not listed falls back to a plain dot.
 */
const STAGE_ICON: Record<string, typeof Truck> = {
  "New": Inbox, "New claim": ShieldAlert, "Entered": ClipboardCheck, "In review": Search,
  "Ordered": ShoppingCart, "Parts ordered": Wrench, "In production": Factory,
  "At cross dock": Truck, "Shipped": Send, "Delivered": PackageCheck, "Resolved": CircleCheck,
};

const LABEL = "text-[10px] uppercase tracking-[0.16em] text-cream/60 mb-1.5";
/** The value under a LABEL. Bright: it is the fact the label names. */
const VALUE = "text-[12px] text-cream/90";

/**
 * The badge beside a card heading. One definition, because two cards sitting
 * side by side with badges half a shade apart is worse than neither having
 * one. Matches the next-action panel's.
 */
const CARD_BADGE = "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0";
const CARD_BADGE_STYLE: React.CSSProperties = {
  background: "rgba(184,130,106,0.18)",
  border: "0.5px solid rgba(184,130,106,0.40)",
};

// PIN validation lives server-side only. The modal sends whatever the user
// typed; the server compares against ADMIN_BACKWARD_PIN (constant-time) and
// surfaces a 403 with `admin_pin_required` if it doesn't match. This avoids
// the previous footgun where the modal's hardcoded "4951" and Vercel's env
// var could drift out of sync, breaking every backward move silently.

export function OrderModal({ order, onClose, onStageChange, initialReason }: OrderModalProps) {
  const { moveStage, updateOrderDetails, updateCustomerDetails, updateNotes, updateInternalNotes, archiveOrder, unarchiveOrder, deleteOrder, allOrders, allOrdersIncludingArchived, projects, team, claimProject, claimOrder: rawClaimOrder } = useStore();
  // ⚠ A CLAIM OPENS ITS PURCHASE IN PLACE (Garrett, 2026-10-19): "About
  // SHO-1050 (cabinets)" on the claim opens that group's modal on top of this
  // one, archived or not; closing it -- or Escape -- comes back to the claim.
  const [aboutOpen, setAboutOpen] = useState<Order | null>(null);
  const { showToast } = useToast();
  const [claimBusy, setClaimBusy] = useState(false);
  const [reDecodeBusy, setReDecodeBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Wrap claimOrder with the same conflict-toast UX used in OrderTable.
  // Returns void; busy state is set/unset around the call so the button
  // can disable itself while in flight.
  /**
   * Claim or release.
   *
   * ⚠ A PROJECT-LINKED ROW CLAIMS ITS PROJECT, not itself.
   *
   * The claim moved up on 2026-08-25: one owner per purchase, so a designer who
   * has finished the cabinets is not blocked from closing it while somebody
   * else sits on the hardware. `orders.claimed_by` is null on every Shopify
   * group now -- writing it here would set a column nothing reads.
   *
   * Custom jobs and warranty claims have no project, so they still claim
   * themselves. Two mechanisms, one button: nobody has to know which they are
   * looking at.
   */
  async function handleClaim(target: string | null) {
    setClaimBusy(true);
    try {
      const result = liveOrder.project_id
        ? await claimProject(liveOrder.project_id, target !== null)
        : await rawClaimOrder(liveOrder.id, target);
      if (!result.ok) {
        if (result.reason === "already_claimed" && result.claimedBy) {
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

  /**
   * ⚠ MIRRORS THE SERVER GATE in app/api/orders/[id], including its
   * resolution through the project -- see `resolvedClaimedBy`. Unclaimed is
   * open: claiming is how you take a row.
   *
   * This hides actions the server would refuse. It is NOT the enforcement;
   * the route is. Anything gated only here would be a rule that looks
   * enforced and is not.
   */
  const [adminEditing, setAdminEditing] = useState(false);
  const [notes, setNotes] = useState(order.notes);
  const [notesChanged, setNotesChanged] = useState(false);
  const [internalNotes, setInternalNotes] = useState(order.internal_notes ?? "");
  const [internalNotesChanged, setInternalNotesChanged] = useState(false);
  // ⚠ SAVED WHEN THE SERVER SAYS SO (item 54): a refused save keeps the note
  // unsaved and shows why. Typing WHILE a save is out is kept: the store's
  // confirmed note then does not reset the text, and the note stays unsaved.
  const [notesSaving, setNotesSaving] = useState<"customer" | "internal" | null>(null);
  const [notesError, setNotesError] = useState<{ customer?: string; internal?: string }>({});
  const typedWhileSaving = useRef({ customer: false, internal: false });
  const [enteredGateError, setEnteredGateError] = useState(false);
  /** Set to the target stage when the server refuses for a missing receipt. */
  const [deliveryGate, setDeliveryGate] = useState<Stage | null>(null);
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
  // A tile opens the Files tab AT its group (2026-10-28, 5d); n re-asks.
  const [filesFocus, setFilesFocus] = useState<{ orderId: string; groupId: number | null; n: number } | null>(null);
  // The "Attach a file" card under the Next Action band (2026-10-27, Garrett).
  const [attachCardOpen, setAttachCardOpen] = useState(false);
  const attachCardRef = useRef<AttachFileCardHandle>(null);
  // "Upload receipt": the same card, for a signed receipt (2026-10-28, 5d).
  const [receiptCardOpen, setReceiptCardOpen] = useState(false);
  const receiptCardRef = useRef<AttachFileCardHandle>(null);
  const ackPanelRef = useRef<AcknowledgmentPanelHandle>(null);
  // (The Files pane's scroll anchor went with the pane, 2026-10-28.)

  // (A needs-attachment open showed a banner; nothing read it since the Attach a
  // file card, which the effect below opens. Its state went in item 56.)
  /**
   * Glow the tracking field when the modal was opened because a move was
   * refused for want of a number.
   *
   * ⚠ IT PERSISTS UNTIL SAVED. A tracking number is a blocking gate -- nothing
   * moves without it -- so the highlight stays put rather than fading on the
   * first keystroke like a hint would. It clears when the save succeeds,
   * because at that point it has been dealt with.
   */
  const [trackingHighlight, setTrackingHighlight] = useState(
    initialReason === "needs-tracking",
  );

  useEffect(() => {
    if (initialReason !== "needs-attachment") return;
    // ⚠ THE CARD UNDER THE NEXT ACTION BAND (2026-10-27). This scrolled to the
    // Files pane and asked there -- but the pane was still HIDDEN, so since
    // file groups (the question replaced the picker) nothing appeared at all.
    setAttachCardOpen(true);
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
  const [openPane, setOpenPane] = useState<"customer" | "internal" | null>(null);
  // No tab counts (2026-10-22, item 8: Garrett dropped Full Order's with the
  // mockup's layout). Files never had one: ProjectFiles was once the only thing
  // that fetched the attachments, so a count shown before that tab opened would
  // read 0 -- "not looked yet" looking exactly like "no files". Since 2026-09-30
  // the list is shared (lib/attachments) and loads when the modal opens, so one
  // could now be honest; nobody has asked for one.

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

  /**
   * Who owns this row, resolved THROUGH THE PROJECT for a Shopify group.
   *
   * ⚠ `orders.claimed_by` is null on every project-linked row since the claim
   * moved up on 2026-08-25. Reading it raw reports a clearly-owned purchase as
   * unclaimed.
   *
   * Computed once here because it was resolved correctly inside the team-member
   * cell and read RAW in AcknowledgmentPanel's `eligible` prop -- so the header
   * showed the owner's name while the panel below concluded the order was
   * unclaimed and rendered nothing. One rule, two readings, and only one of them
   * updated.
   */
  const resolvedClaimedBy = liveOrder.project_id
    ? (projects[liveOrder.project_id]?.claimed_by ?? null)
    : (liveOrder.claimed_by ?? null);

  /**
   * ⚠ ARCHIVED IS READ-ONLY, AND THIS MODAL IS WHERE THAT SHOWS. Every control
   * below asks `readOnly`; the six write routes refuse the same rows anyway
   * (409 `archived_read_only`), so a control left behind here is one that fails
   * on click rather than one that does damage. Same question both sides --
   * archivedVia lives in lib/data for exactly that reason.
   *
   * A group's answer comes from its PURCHASE, which the store already holds.
   * While that project is still loading the modal behaves normally and the
   * server is the backstop.
   */
  const purchaseOfRow = liveOrder.project_id ? (projects[liveOrder.project_id] ?? null) : null;
  const archivedState = archivedVia(liveOrder, purchaseOfRow);
  const readOnly = archivedState !== null;
  const archivedOn = archivedState === "purchase"
    ? (purchaseOfRow?.archived_at ?? null)
    : (liveOrder.archived_at ?? null);

  /**
   * The acknowledgment gate, read where the ACTION is.
   *
   * ⚠ ONE EXPRESSION. `ackEligible` was written out twice -- once here in
   * spirit and once inline in AcknowledgmentPanel's `eligible` prop -- and the
   * copy in the prop read the retired ownership column, which is why the panel
   * was invisible on every owned Shopify cabinet group for two days.
   *
   * The subscription is a shared module-level cache, so the modal and the panel
   * (and the table row) all read one fetch. A second subscriber costs nothing.
   */
  // ⚠ PER ORDER, AND DECLARED HERE BECAUSE `liveOrder` IS. This sat beside
  // the useState 120 lines above, where liveOrder does not exist yet. There
  // is no early return between the two, so the hook order is identical
  // either way. Switching groups in the strip points this modal at another
  // row; an unlock that survived the switch would be an unlock nobody asked
  // for on the row they landed on.
  useEffect(() => { setAdminEditing(false); }, [liveOrder.id]);

  const claimLockedByOther =
    !!resolvedClaimedBy && !!currentUserId && resolvedClaimedBy !== currentUserId;
  const claimOwnerName =
    team.find((m) => m.id === resolvedClaimedBy)?.name ?? "another member";
  const canEdit = !claimLockedByOther || (isAdmin && adminEditing);

  const ackEligible = liveOrder.stage !== "New" || !!resolvedClaimedBy;
  const ackStatus = useAckStatus(liveOrder.id, ackEligible);

  /**
   * Read by doMoveStage's client copy of the Entered gate, which the admin
   * rail still reaches. The next-action panel does NOT read this: it asks
   * lib/requirements through the enrichment below, the same way the work
   * queue does, so the modal and the queue agree by construction rather than
   * by coincidence. `ackGates`, `ackCouldGate` and `ackUnknown` -- the
   * hand-written slot's own copy of the gate -- went with the slot.
   */
  const ackSatisfied = ackStatus.allGreen;

  /**
   * ⚠ THE SAME HOOK THE WORK QUEUE AND DASHBOARD CALL. One request for every
   * group of the project; the panel reads the selected one. Refetches when
   * either upload path calls invalidateEnrichment().
   */
  const enrichFor = useOrderEnrichment(projectGroups);

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
  // ⚠ ONE "IN STAGE" (2026-10-21, item 7). The rail's heading and its current
  // stage show the same figure -- the SLA age where the type has a rule, else
  // the hours in stage -- computed once, so the two can never disagree.
  const stageAgeText = formatStageAge(
    slaRuleFor(liveOrder) ? slaAgeHours(liveOrder, slaRuleFor(liveOrder)!) : hoursInStage(liveOrder));
  // Who may edit the customer's name, contact and location (2026-10-26, item 8
  // step 3b): ONCE, outside the two layouts -- inside the non-custom one,
  // TypeScript already knows the type is not "custom".
  const canEditCustomer = (liveOrder.type === "custom" || liveOrder.type === "warranty") && canEdit && !readOnly;
  const openFilesAt = (groupId: number | null) => {
    setTab("files");
    setFilesFocus((f) => ({ orderId: liveOrder.id, groupId, n: (f?.n ?? 0) + 1 }));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (aboutOpen) return;   // the purchase on top closes itself
        if (pendingStage) { setPendingStage(null); setAdminPin(""); setPinError(false); }
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pendingStage, aboutOpen]);

  useEffect(() => {
    if (typedWhileSaving.current.customer) { typedWhileSaving.current.customer = false; return; }
    setNotes(liveOrder.notes);
    setNotesChanged(false);
  }, [liveOrder.notes]);

  useEffect(() => {
    if (typedWhileSaving.current.internal) { typedWhileSaving.current.internal = false; return; }
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


  /**
   * Override the delivery gate with a reason.
   *
   * The reason is required and goes into an activity row naming the session
   * user -- the gate is designed as ACCOUNTABILITY, not permission: anyone may
   * override, everyone can see who did and why. That is why this asks rather
   * than offering a plain confirm.
   */
  /**
   * ⚠ THE REASON IS THE POINT. This used to send `override_ack: true` and
   * the row moved with nothing in the trail to say the acknowledgment check
   * had been skipped. Same prompt-and-record shape as overrideDelivery
   * below, because it is the same kind of act.
   *
   * The panel's own confirm has already listed the discrepancies; this asks
   * what the person knows that the reconciliation does not.
   */
  async function overrideAckAdvance() {
    if (liveOrder.stage !== "New") return;
    const reason = window.prompt(
      "The manufacturer acknowledgment has not been reconciled.\n\n"
      + "Move this to Entered anyway? Give a reason — it goes on the order's "
      + "activity trail with your name.",
    );
    if (!reason || !reason.trim()) return;
    const res = await moveStage(
      liveOrder.id, "Entered" as Stage, currentUserId, "", reason.trim(),
    );
    if (res.ok) {
      showToast("Moved to Entered — override recorded", { kind: "success" });
      onStageChange("Entered" as Stage);
    } else {
      showToast(res.error ?? "Could not move to Entered", { kind: "error" });
    }
  }

  async function overrideDelivery(stage: Stage) {
    const reason = window.prompt(
      "No signed delivery receipt is attached.\n\n"
      + "Mark this delivered anyway? Give a reason — it goes on the order's "
      + "activity trail with your name.",
    );
    if (!reason || !reason.trim()) return;
    setDeliveryGate(null);
    const res = await moveStage(
      liveOrder.id, stage, currentUserId, "", undefined, reason.trim(),
    );
    if (res.ok) {
      showToast("Marked delivered — override recorded", { kind: "success" });
      onStageChange(stage);
    } else {
      showToast("Could not move the order", { kind: "error" });
    }
  }

  async function handleMoveStage(stage: Stage) {
    const targetIdx = (stages as string[]).indexOf(stage);
    if (targetIdx === stageIdx) return; // No-op: already there

    // ⚠ THE RAIL IS ADMIN-ONLY. For everyone else it is a read-out.
    //
    // Clicking a dot jumps to ANY stage -- forward, backward, skipping stages
    // entirely. That is the admin override this dialog was built for. Team
    // members advance orders through the tools that enforce the gates: the
    // date editors, the acknowledgment panel's Entry Complete, the row buttons
    // on the stage pages, and the NEXT ACTION button below -- all of which move
    // one step and are refused by the server if the step is not earned.
    //
    // Checked here rather than on each dot because there are TWO call sites
    // (the dot and its label) and any third would be a place to forget. The
    // server is the real gate regardless; this is about not offering an action
    // that will be refused.
    if (!isAdmin) {
      showToast("Only an admin can move an order from the pipeline. Use the actions on this page.", { kind: "warn" });
      return;
    }

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
    // ⚠ THE SERVER PASSES ON A GREEN ACK **OR** AN ATTACHMENT. This ran
    // checkAttachmentGate unconditionally -- a bare count === 0 -- so a green
    // acknowledgment with no separately-attached file was refused here, before
    // the request the server would have allowed. The ack .xlsx lands in
    // order_acknowledgments and is never written as an attachment, so that is
    // the ordinary Waypoint case rather than an edge one.
    if (gateApplies && stage === "Entered" && liveOrder.stage === "New" && !ackSatisfied) {
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
    // ── The delivery gate ────────────────────────────────────────────────
    //
    // At cross dock -> Delivered needs a signed proof_of_delivery. The server
    // enforces it and returns `delivery_proof_required`; the plumbing to
    // override it has existed end to end since August -- moveStage takes
    // `overrideDeliveryProof`, sends it, and the route writes an activity row
    // naming whoever overrode.
    //
    // ⚠ THE MODAL NEVER ASKED. It called moveStage, the server refused, the
    // optimistic update reverted, and the row snapped back with no explanation
    // at all -- the failure went to console.error, under a comment saying "we
    // don't have a toast system". useToast is imported at the top of this file.
    //
    // Same shape as the acknowledgment gate above: refuse, say why, and offer
    // the two ways forward.
    if (!result.ok && result.error === "delivery_proof_required") {
      setPendingStage(null);
      setDeliveryGate(stage);
      return;
    }
    if (!result.ok) {
      // Anything else (network, 422, 500). Say so rather than only logging:
      // a silent bounce is indistinguishable from a broken button.
      console.error("Stage move failed:", result.error);
      showToast(
        result.error === "network_error"
          ? "Network error — the order was not moved"
          : `Could not move to "${stage}"`,
        { kind: "error" },
      );
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

  async function handleSaveNotes() {
    setNotesSaving("customer");
    setNotesError((e) => ({ ...e, customer: undefined }));
    typedWhileSaving.current.customer = false;
    const refused = await updateNotes(liveOrder.id, notes);
    setNotesSaving((s) => (s === "customer" ? null : s));
    if (refused) { setNotesError((e) => ({ ...e, customer: refused })); return; }
    // Saved. Typing since the click stays unsaved; otherwise it is saved even
    // when the stored note did not change (then the reset above never runs).
    if (!typedWhileSaving.current.customer) setNotesChanged(false);
  }

  async function handleSaveInternalNotes() {
    setNotesSaving("internal");
    setNotesError((e) => ({ ...e, internal: undefined }));
    typedWhileSaving.current.internal = false;
    const refused = await updateInternalNotes(liveOrder.id, internalNotes);
    setNotesSaving((s) => (s === "internal" ? null : s));
    if (refused) { setNotesError((e) => ({ ...e, internal: refused })); return; }
    if (!typedWhileSaving.current.internal) setInternalNotesChanged(false);
  }

  function handleDelete() {
    deleteOrder(liveOrder.id);
    onClose();
  }

  /**
   * Archive or restore THIS row on its own -- offered only for a standalone
   * row the viewer can act on (see the button).
   *
   * ⚠ WAITS FOR THE ANSWER BEFORE CLOSING. This closed the modal the moment it
   * fired, so a refusal had nowhere to be said: the row simply came back on
   * the board with no explanation. The store reverts a refusal and returns
   * the server's reason, and the modal stays open to show it.
   */
  async function handleArchive() {
    if (archiveBusy) return;
    const restoring = !!liveOrder.archived;
    setArchiveBusy(true);
    try {
      const result = restoring
        ? await unarchiveOrder(liveOrder.id)
        : await archiveOrder(liveOrder.id);
      if (!result.ok) {
        showToast(
          result.message
            ?? (restoring ? "Could not restore this order" : "Could not archive this order"),
          { kind: "error" },
        );
        return;
      }
      if (!restoring) onClose();
    } finally {
      setArchiveBusy(false);
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

  // ⚠ ONE NOTES CARD (2026-10-26, item 8 step 3d; Garrett's mockup): the
  // customer note and the internal note side by side, each with its text and
  // Add note / Edit, which opens the SAME editor -- the textarea, its Save and
  // its visibility line, moved here word for word from the panes that opened
  // beneath the whole grid. Defined once, used by both layouts. A read-only
  // order shows the text and no button (its textareas were read-only before).
  const notesCard = (
    <div className="glass-sage rounded-panel px-4 py-3.5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={CARD_BADGE} style={CARD_BADGE_STYLE}>
          <StickyNote className="w-3.5 h-3.5" style={{ color: "#d9a888" }} />
        </span>
        <p className={LABEL + " mb-0"}>Notes</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="rounded-brand px-3 py-2.5 min-w-0"
          style={{ background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.10)" }}>
          <div className="flex items-center gap-1.5">
            <p className={LABEL + " mb-0"}>Customer note</p>
            {!readOnly && (
              <button onClick={() => setOpenPane(openPane === "customer" ? null : "customer")} className="ml-auto text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
                {openPane === "customer" ? "Close" : notes.trim() ? "Edit" : "Add note"}
              </button>
            )}
          </div>
          <p className="text-[10px] text-cream/35 mt-0.5 mb-2">
            {/* ⚠ TRUE ONLY WITH A SHOPIFY ORDER (2026-10-05). The note is
                written to Shopify by the PATCH route, and only for a row
                with a shopify_id. A custom job or a warranty claim has
                none, yet this said "written to the Shopify order" on every
                order -- the website asked where a customer could see a
                claim's note, and the answer was nowhere. */}
            {liveOrder.shopify_id
              ? <>Visible to the customer &middot; written to the Shopify order</>
              : <>Kept in the OMS &middot; there is no Shopify order to write it to</>}
          </p>
          {openPane === "customer" ? (
            <>
              {/* ⚠ ONE TEXTAREA, ALWAYS (2026-09-28). A quote job used to render
                  parsed prose here INSTEAD of this field, so the designer who
                  owns the job could not write a customer note on it. What the
                  customer asked for is shown by QuoteSubmissionPanel on the
                  Overview tab, in their own words rather than the form's keys. */}
              <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); setNotesChanged(true); if (notesSaving === "customer") typedWhileSaving.current.customer = true; }}
                  readOnly={readOnly}
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
                <button onClick={() => void handleSaveNotes()} disabled={notesSaving === "customer"}
                  className="mt-2 text-[11px] uppercase tracking-wider font-medium text-terracotta hover:brightness-110 disabled:opacity-60">
                  {notesSaving === "customer" ? "Saving…" : "Save note"}
                </button>
              )}
              {notesError.customer && (
                <p role="alert" className="mt-1 text-[11px] text-red-400">Not saved: {notesError.customer}</p>
              )}
            </>
          ) : (
            <p className="text-[12px] text-cream/80 whitespace-pre-line break-words">
              {notes.trim() || <span className="text-cream/40">No customer note yet</span>}
            </p>
          )}
        </div>
        <div className="rounded-brand px-3 py-2.5 min-w-0"
          style={{ background: "rgba(232,144,144,0.03)", border: "0.5px solid rgba(232,144,144,0.22)" }}>
          <div className="flex items-center gap-1.5">
            <p className={LABEL + " mb-0"}>Internal note</p>
            <span className="text-[8px] uppercase tracking-wider px-1 rounded-full"
              style={{ background: "rgba(232,144,144,0.12)", color: "rgba(232,144,144,0.85)" }}>
              staff
            </span>
            {!readOnly && (
              <button onClick={() => setOpenPane(openPane === "internal" ? null : "internal")} className="ml-auto text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
                {openPane === "internal" ? "Close" : internalNotes.trim() ? "Edit" : "Add note"}
              </button>
            )}
          </div>
          <p className="text-[10px] text-cream/35 mt-0.5 mb-2">
            Visible to staff and on the export PDF. Never sent to Shopify.
          </p>
          {openPane === "internal" ? (
            <>
              <textarea
                value={internalNotes}
                onChange={(e) => { setInternalNotes(e.target.value); setInternalNotesChanged(true); if (notesSaving === "internal") typedWhileSaving.current.internal = true; }}
                readOnly={readOnly}
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
                <button onClick={() => void handleSaveInternalNotes()} disabled={notesSaving === "internal"}
                  className="mt-2 text-[11px] uppercase tracking-wider font-medium text-terracotta hover:brightness-110 disabled:opacity-60">
                  {notesSaving === "internal" ? "Saving…" : "Save internal note"}
                </button>
              )}
              {notesError.internal && (
                <p role="alert" className="mt-1 text-[11px] text-red-400">Not saved: {notesError.internal}</p>
              )}
            </>
          ) : (
            <p className="text-[12px] text-cream/80 whitespace-pre-line break-words">
              {internalNotes.trim() || <span className="text-cream/40">No internal note yet</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );


  return (
    <div
      ref={overlayRef}
      onClick={(e) => e.target === overlayRef.current && onClose()}
      className="fixed inset-0 z-50 flex items-stretch justify-center animate-fade-in p-4 md:p-8"
      style={{ background: "rgba(16,22,26,0.62)", backdropFilter: "blur(8px)" }}
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
              {sourceLabel(liveOrder)}
              <span className="mx-1.5">&middot;</span>
              {orderDate(liveOrder)}
              <ConsentMissingPill project={purchaseOfRow} />
              <ShopifyGonePill project={purchaseOfRow} />
              <ClaimOutcomePill order={liveOrder} />
              {liveOrder.type === "warranty" && liveOrder.about_order_id && (() => {
                const about = allOrdersIncludingArchived.find((o) => o.id === liveOrder.about_order_id);
                return about ? (
                  <button type="button" onClick={() => setAboutOpen(about)}
                    className="ml-2 px-2 py-px rounded-full text-[10px] border border-white/15 text-cream/70 hover:text-cream hover:border-cream/30 transition-colors align-middle">
                    About {displayOrderNumber(about)} ({(GROUP_LABEL[about.type] ?? about.type).toLowerCase()})
                  </button>
                ) : (
                  <span className="ml-2 text-cream/45">About {liveOrder.about_order_id}</span>
                );
              })()}
            </p>
            {/* ⚠ THE TWO FACTS A CONTROL-LESS MODAL OWES THE READER: who worked
                this, and why nothing can be changed. The claim chip is gone
                here -- claiming archived work means nothing -- and the full
                ownership history is on the Activity tab. */}
            {readOnly && (
              <p className="text-[11px] text-cream/45 mt-1">
                Handled by {claimOwnerName || "nobody"}
                <span className="mx-1.5">&middot;</span>
                Archived{archivedOn ? ` ${new Date(archivedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Phoenix" })}` : ""}
                <span className="mx-1.5">&middot;</span>
                restore to make changes
              </p>
            )}
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
            {/* ⚠ THE CHIP IS THE CONTROL NOW. It read the resolved owner and
                said so, while the Team Member cell in the pipeline strip said
                the same thing again and was the only one you could act on.
                One fact, one place, and it is the place the eye goes first. */}
            {!readOnly && (
            <ClaimChip
              claimedBy={resolvedClaimedBy}
              team={team}
              currentUserId={currentUserId}
              busy={claimBusy}
              /* ⚠ A PURCHASE CAN BE CLAIMED AT ANY STAGE; a standalone row --
                 a custom job, a warranty claim -- only at its first, because
                 past that it is being worked by whoever moved it. Same rule
                 the strip cell carried, moved with it rather than rewritten. */
              canClaim={liveOrder.project_id
                ? true
                : (liveOrder.stage === "New" || liveOrder.stage === "New claim")}
              onClaim={() => handleClaim(currentUserId ?? null)}
              onRelease={() => handleClaim(null)}
            />
            )}
            {!readOnly && claimLockedByOther && isAdmin && (
              <button
                onClick={() => setAdminEditing((v) => !v)}
                title={adminEditing
                  ? `Stop editing \u2014 ${claimOwnerName} holds this claim`
                  : `${claimOwnerName} holds this claim. Editing anyway is recorded on the activity trail.`}
                className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-full transition-all flex-shrink-0"
                style={adminEditing
                  ? { background: "rgba(184,130,106,0.22)", border: "0.5px solid rgba(184,130,106,0.60)", color: "#e8bfa4" }
                  : { background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.18)", color: "rgba(232,227,218,0.70)" }}
              >
                {adminEditing ? "Editing" : "Edit order"}
              </button>
            )}
            </div>
            {/* ⚠ STANDALONE ROWS ONLY. A project-linked group is archived with
                its purchase, on /projects -- offering it here is how SHO-1052
                was archived twice over. And only where the viewer can act:
                somebody else's claim refuses this server-side, and the table
                already withholds its archive buttons from those rows. */}
            {/* ⚠ A CLAIM IS CLOSED, NOT ARCHIVED OR DELETED (2026-10-13): Approved
                or Denied, at any stage -- a claim can be denied the day it
                arrives. The only way a claim goes into the archive. */}
            {!readOnly && liveOrder.type === "warranty" && !liveOrder.archived && canEdit && (
              <ClaimCloseButton order={liveOrder} onClosed={onClose} />
            )}
            {!readOnly && liveOrder.type !== "warranty" && isCompleted && archivesAsOrder(liveOrder) && canEdit && (
              <button
                onClick={() => { void handleArchive(); }}
                disabled={archiveBusy}
                title={liveOrder.archived ? "Restore" : "Archive"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider transition-all bg-white/8 border border-white/15 text-cream/70 hover:bg-white/12 hover:text-cream disabled:opacity-50"
              >
                {archiveBusy
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : liveOrder.archived
                    ? <><RotateCcw className="w-3 h-3" /> Restore</>
                    : <><Archive className="w-3 h-3" /> Archive</>}
              </button>
            )}
            {/* Custom jobs only (2026-10-13): a Shopify order is removed in
                Shopify, and a claim is closed, never deleted. */}
            {!readOnly && liveOrder.source === "Manual" && liveOrder.type === "custom" && (
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
              // ⚠ THIS HID THE FIRST STEP OF THE WORKFLOW. The designer pulls
              // this PDF and enters it into the manufacturer's ordering system --
              // and on a project-linked cabinet group at New, which is exactly
              // when it is needed, the raw column is null and the buttons never
              // rendered.
              && (liveOrder.stage !== "New" || !!resolvedClaimedBy)
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
            {!readOnly && isAdmin && (
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
            ["items", "Full Order", null],
            ["files", "Files", null],
            ["activity", "Activity", null],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="px-3 py-2 text-[13px] font-medium transition-all flex items-center gap-1.5"
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
            {/* (2026-10-22, item 8) The "Pipeline details · <type> … SLA target"
                line is gone (Garrett): the type is in the header, and lateness
                still shows as "due" / "overdue" beside the stage below. */}

            {/* No outer border. The rail and the strip below are each their
                own frosted card; wrapping them in a bordered box as well is a
                box inside a box, which is what "disorganised" looks like. */}
            <div>
              <div>
            <div className="glass-sage rounded-panel px-4 py-4">
              {/* ⚠ THE CURRENT STAGE IS THE RAIL'S HEADING, not a cell of its
                  own below. It had a third of the strip to say in words what
                  the rail says in pictures directly above it, and the next
                  action -- the part with the controls -- had to fit in what
                  was left. Here it costs one line and the Overview fits
                  without scrolling. */}
              {/* ⚠ THE MOCKUP'S HEADING (2026-10-22, item 8): an icon tile, the
                  stage large in its colour with its time in stage, and one
                  sentence saying what the stage means -- Garrett's own wording,
                  lib/stageSentences. Today's palette, the mockup's layout. */}
              {(() => {
                const accent = STAGE_ACCENT[liveOrder.stage] ?? "#8a8a8a";
                const StageIcon = STAGE_ICON[liveOrder.stage] ?? CircleDot;
                const sentence = stageSentence(liveOrder);
                return (
                  <div className="flex items-start gap-3 mb-4">
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${accent}1f`, border: `0.5px solid ${accent}55` }}>
                      <StageIcon className="w-[18px] h-[18px]" style={{ color: accent }} />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[17px] font-medium leading-tight" style={{ color: accent }}>
                          {liveOrder.stage}
                        </span>
                        <span className="text-[11px] text-cream/50">
                          &middot; {stageAgeText} in stage
                          {slaTier(liveOrder) === "hard" && <span style={{ color: "#e08585" }}> &middot; overdue</span>}
                          {slaTier(liveOrder) === "soft" && <span style={{ color: "#e8b56a" }}> &middot; due</span>}
                        </span>
                      </div>
                      {sentence && (
                        <p className="text-[12px] text-cream/70 mt-1 leading-snug">
                          {sentence.text}
                          {sentence.link && (
                            <>
                              {" "}
                              <a href={sentence.link.href} target="_blank" rel="noopener noreferrer"
                                className="underline decoration-cream/30 underline-offset-2 hover:text-cream transition-colors">
                                {sentence.link.label}
                              </a>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className="flex items-start">
                {stages.map((s, i) => {
                  const isActive = liveOrder.stage === s;
                  const isPast = stageIdx > i;
                  // A stage behind the current one: the day it was LAST entered.
                  // None recorded (before 2026-10-21, or never) -> nothing.
                  const enteredOn = isPast ? stageDate(lastEnteredAt(liveOrder.stage_events, s)) : "";
                  const color = STAGE_ACCENT[s] ?? "#91a597";
                  const isEnteredGate = s === "Entered" && liveOrder.stage === "New";
                  // ⚠ LINES IN THE STAGES' COLOURS (2026-10-22, item 8): a reached
                  // segment runs from one stage's colour into the next's, as in
                  // the mockup -- this half solid, the next half blending in.
                  const prevColor = i > 0 ? (STAGE_ACCENT[stages[i - 1]] ?? "#91a597") : color;
                  const lineTodo = "rgba(255,255,255,0.12)";
                  return (
                    <div key={s} className="flex-1 flex flex-col items-center min-w-0">
                      <div className="flex items-center w-full">
                        <span className="flex-1 h-[1.5px] rounded-full" style={{ background: i === 0 ? "transparent" : (i <= stageIdx ? `linear-gradient(90deg, ${prevColor}99, ${color}99)` : lineTodo) }} />
                        <button
                          type="button"
                          onClick={() => handleMoveStage(s as Stage)}
                          // ⚠ DISABLED, NOT REMOVED. The rail is how you read
                          // where the work stopped; taking it out of an archived
                          // row would remove the answer along with the action.
                          disabled={readOnly || checkingAttachments || !isAdmin}
                          title={!isAdmin
                            ? s
                            : isEnteredGate ? "Requires a matching acknowledgment or attachment"
                            : isPast ? "Move back (admin PIN)" : s}
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
                        <span className="flex-1 h-[1.5px] rounded-full" style={{ background: i === stages.length - 1 ? "transparent" : (i < stageIdx ? `${color}99` : lineTodo) }} />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleMoveStage(s as Stage)}
                        disabled={readOnly || checkingAttachments}
                        className="mt-1.5 px-0.5 text-[11px] font-medium text-center leading-tight transition-colors disabled:opacity-60"
                        style={{ color: isActive ? color : isPast ? "rgba(240,236,228,0.62)" : "rgba(240,236,228,0.40)" }}
                      >
                        {s}
                      </button>
                      {/* ⚠ WHEN (2026-10-21, item 7; Garrett's mockup): the date
                          under each stage reached, "in stage" under the current
                          one, nothing under stages not reached -- after a move
                          back, the stages ahead of it are not reached. */}
                      {(isActive || enteredOn) && (
                        <span className="mt-0.5 text-[9px] tabular-nums text-center leading-tight"
                          style={{ color: isActive ? color : "rgba(240,236,228,0.45)" }}>
                          {isActive ? `${stageAgeText} in stage` : enteredOn}
                        </span>
                      )}
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
                  Acknowledgment or file <em className="italic-storm">required</em>
                </p>
                <p className="text-[11px] text-cream/65">
                  {/* Vendor by vendor (2026-10-28, item 57): a file never stands in for Waypoint's. */}
                  {ackStatus.hasWaypoint
                    ? "Upload Waypoint's acknowledgment, and it must match this order, before moving to Entered."
                    : "Upload the manufacturer's acknowledgment, or attach any file for this order, before moving to Entered."}
                </p>
              </div>
            )}
            {/* The delivery gate refused.
                Same shape and place as the acknowledgment banner above --
                one gate, one look. The rule, the override and the activity
                trail all existed already; the modal simply never said why the
                row bounced back. */}
            {deliveryGate && (
              <div className="mt-4 rounded-brand px-4 py-3"
                style={{ background: "rgba(184,130,106,0.14)", border: "0.5px solid rgba(184,130,106,0.45)" }}>
                <p className="font-display text-[15px] mb-1" style={{ color: "#d9a888" }}>
                  Signed receipt <em className="italic-storm">required</em>
                </p>
                <p className="text-[11px] text-cream/65 mb-2.5">
                  Upload the signed proof of delivery before marking this Delivered.
                  It is the record behind the 48-hour reporting window, and what a
                  chargeback is answered with.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    // The receipt card, in this click (2026-10-28, 5d).
                    onClick={() => receiptCardRef.current?.pick()}
                    className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all"
                    style={{
                      background: "rgba(184,130,106,0.22)",
                      border: "0.5px solid rgba(184,130,106,0.55)",
                      color: "#d9a888",
                    }}
                  >
                    Upload receipt
                  </button>
                  <button
                    onClick={() => void overrideDelivery(deliveryGate)}
                    className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/20 text-cream/75 hover:bg-white/10"
                  >
                    Manual Push
                  </button>
                  <button
                    onClick={() => setDeliveryGate(null)}
                    className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-cream/40 hover:text-cream/70 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
              </div>

              {/* Same frosted treatment as the rail above it. They were a
                  glass card and a flat outline sitting together, which is
                  what made the pair look unrelated. */}
              {/* ⚠ THE WHOLE WIDTH, ONE CELL. The stage moved up into the rail
                  card as its heading and the claim moved up to the header, so
                  what is left is the next action -- which is the part with the
                  controls, and was the part being squeezed. */}
              <div className="glass-sage rounded-panel overflow-hidden mt-2.5">
                {/* ⚠ GENERATED FROM lib/requirements, NOT WRITTEN PER CASE.
                    This cell was a hand-written branch per gate -- one shape
                    for the acknowledgment, one for tracking, one for the rest
                    -- and each branch was free to disagree with the server
                    gate it stood in for. It did, twice, on 2026-09-08. See
                    NextActionPanel's header for the rules it follows. */}
                <NextActionPanel
                  key={liveOrder.id}
                  // First cell now, so no divider on its left edge.
                  flush
                  readOnly={!canEdit || readOnly}
                  lockedNote={`Claimed by ${claimOwnerName}. Ask them to release it`
                    + `${isAdmin ? ", or use Edit order above" : ""}.`}
                  order={liveOrder}
                  project={liveOrder.project_id ? (projects[liveOrder.project_id] ?? null) : null}
                  enrichment={enrichFor(liveOrder)}
                  remedies={{
                    // The remedy varies where the requirement does not: the
                    // .xlsx picker for a Waypoint order, any file for HCI and
                    // J&K. The pickers are the panels' own, so there is one
                    // upload path rather than two.
                    ack_or_attachment: ackStatus.hasWaypoint
                      ? { label: "Upload acknowledgment",
                          onClick: () => ackPanelRef.current?.openFilePicker() }
                      : { label: "Attach a file",
                          // The card directly below this band (2026-10-27).
                          // ⚠ THE PICKER, IN THIS CLICK (2026-10-28, Garrett): no question --
                          // the file goes in "Acknowledgments"; the card is feedback only.
                          onClick: () => attachCardRef.current?.pick() },
                    proof_of_delivery: {
                      label: "Upload receipt",
                      onClick: () => receiptCardRef.current?.pick(),
                    },
                  }}
                  overrides={{
                    // The same reason-and-activity-row path the refusal
                    // banner offers. Anyone may override; everyone sees who.
                    proof_of_delivery: {
                      // ⚠ THE NAME THE STAGE PAGE USES. The row action has been
                      // Manual Push since it existed; this invented a second
                      // name for the same override, same reason field, same
                      // activity row.
                      label: "Manual Push",
                      onClick: () => {
                        const target = nextStageFor(liveOrder);
                        if (target) void overrideDelivery(target as Stage);
                      },
                    },
                  }}
                  // Empty PIN on purpose: this only ever offers the NEXT stage,
                  // so it is never a backward move. doMoveStage still runs the
                  // client Entered gate and handles the delivery-proof refusal.
                  onMove={(stage) => doMoveStage(stage as Stage, "")}
                  onSaveDates={(patch) => updateOrderDetails(liveOrder.id, patch)}
                  busy={checkingAttachments}
                  trackingSlot={typeCarriesTracking(liveOrder.type) && (
                    <TrackingEntry
                      order={liveOrder}
                      readOnly={readOnly}
                      highlight={trackingHighlight}
                      onSaved={(stage) => {
                        setTrackingHighlight(false);
                        if (stage) onStageChange(stage as Stage);
                      }}
                    />
                  )}
                />

              </div>
            </div>
          </div>

          {/* "Attach a file", sliding open under the band and away again once
              a file is attached (2026-10-27, Garrett). Mounted always, so it
              can slide; inert while closed. */}
          {canEdit && !readOnly && (
            <div className="px-6">
              <AttachFileCard ref={attachCardRef} orderId={liveOrder.id} open={attachCardOpen} onOpenChange={setAttachCardOpen} />
              <AttachFileCard ref={receiptCardRef} purpose="receipt" orderId={liveOrder.id} open={receiptCardOpen} onOpenChange={setReceiptCardOpen} />
            </div>
          )}

          {/* ── ORDER INFO ──────────────────────────────────────────────────
              ⚠ THE MOCKUP'S TWO COLUMNS (2026-10-26, item 8 step 3a; Garrett).
              A CUSTOM JOB: details, Production & Delivery, Files and Notes on
              the left; what the customer chose and asked for on the right.
              EVERY OTHER TYPE: details | Production & Delivery, then Notes |
              Files. LAYOUT ONLY -- each card below is the same element it was,
              moved; their panes still open full width beneath, and the
              Acknowledgments panel stays full width below (Garrett placed the
              four cards; the panel keeps its place).
              summary line. This was two full-height textareas plus the
              attachments panel -- roughly 380px of an Overview that has to fit
              without scrolling.

              ⚠ FILES ARE THE FILES TAB'S (2026-10-28, 5d; Garrett): the Overview
              shows FileGroupTiles, and a tile opens the tab at its group. The
              hidden Files pane, kept mounted for openReceiptPicker(), is gone:
              "Upload receipt" and "Attach a file" are cards under the band. */}
          {liveOrder.type === "custom" ? (
            <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-2.5 items-start">
              <div className="flex flex-col gap-2.5 min-w-0">
                <OrderDetailsCard key="details-custom" order={liveOrder} onSaveCustomer={updateCustomerDetails} canEditCustomer={canEditCustomer} />
                <StageInputsCard
                  readOnly={readOnly}
                  order={liveOrder}
                  updateOrderDetails={updateOrderDetails}
                  onStageChange={onStageChange}
                  canEdit={canEdit}
                />
                <FileGroupTiles orderId={liveOrder.id} onOpen={openFilesAt} />{/* the custom layout */}
                {notesCard}{/* the custom layout */}
              </div>
              <div className="flex flex-col gap-2.5 min-w-0">
                {liveOrder.type === "custom" && (
                  // ⚠ KEYED BY THE JOB. The panel holds drafts, and a panel handed a
                  // different job once saved the last job's rooms onto it (proven
                  // 2026-09-30). A new job is a new panel.
                  <CustomSpecsPanel key={liveOrder.id} order={liveOrder} readOnly={readOnly || !canEdit} />
                )}
                {liveOrder.type === "custom" && <QuoteSubmissionPanel order={liveOrder} />}
              </div>
            </div>
          ) : (
            <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <OrderDetailsCard key="details-other" order={liveOrder} onSaveCustomer={updateCustomerDetails} canEditCustomer={canEditCustomer} />
              <StageInputsCard
                readOnly={readOnly}
                order={liveOrder}
                updateOrderDetails={updateOrderDetails}
                onStageChange={onStageChange}
                canEdit={canEdit}
              />
              {notesCard}{/* the other layout */}
              <FileGroupTiles orderId={liveOrder.id} onOpen={openFilesAt} />{/* the other layout */}
            </div>
          )}

          {/* Expanded pane -- now only Files (2026-10-26, item 8 step 3d): the two
              note panes moved into the Notes card above. */}

          {/* Damage reports */}
          {liveOrder.type === "warranty" && (
            <DamageReportPanel
              orderId={liveOrder.id}
              orderSkus={liveOrder.sku_items?.map((i) => i.sku) ?? (liveOrder.sku ? [liveOrder.sku] : [])}
              orderName={liveOrder.name}
              reporterName={currentUserDisplayName}
              readOnly={readOnly}
            />
          )}

          {/* (The Files pane that stood here is gone: files are the Files tab's, 2026-10-28.) */}

            {/* Acknowledgments: per-vendor .xlsx reconciliation.

                NOT for samples. They ship from JK's own stock, so there is no
                manufacturer acknowledgment to reconcile against -- the server
                already exempts them from the Entered gate (phase 1c), and this
                stops the modal asking for a document that cannot exist.

                Phrased "not sample" so a future order type inherits the panel
                by default: showing it wrongly is cosmetic, hiding it wrongly
                means a missed manufacturer confirmation. */}
          {liveOrder.type !== "sample" && (
            <AcknowledgmentPanel ref={ackPanelRef} orderId={liveOrder.id} orderName={liveOrder.name} eligible={ackEligible} onViewDiscrepancies={() => { setTab("items"); setItemsGroupId(liveOrder.id); }} uploadOfferedElsewhere={requirementsFor(liveOrder).some((r) => r.id === "ack_or_attachment" && r.state(liveOrder, enrichFor(liveOrder)) !== "met")} onAdvanceOverride={() => { void overrideAckAdvance(); }} canAct={canEdit} lockedNote={`Claimed by ${claimOwnerName}. Ask them to release it` + `${isAdmin ? ", or use Edit order above" : ""}.`} />
          )}

          </>)}

          {tab === "items" && (() => {
            // ⚠ WARRANTY IS NO LONGER EXCLUDED. Until 2026-09-01 this read
            // `.filter((g) => g.type !== "warranty")`, with a message saying a
            // claim carries damage reports rather than SKU lines. True when
            // written; false once a claim started recording what needs
            // replacing. sku_items on a claim is the SKU, the quantity
            // affected and the PART -- "Middle Drawer Only" -- which is the
            // whole of what the vendor is asked to supply.
            //
            // Safe because projectGroups returns [self] for a row with no
            // project_id, so a claim resolves to itself and cannot pull in
            // other standalone rows.
            const workGroups = projectGroups;
            if (workGroups.length === 0) {
              return (
                <div className="px-6 py-8 text-center">
                  <p className="text-[12px] text-cream/45">
                    Nothing to show yet.
                  </p>
                </div>
              );
            }
            // A claim before anybody has recorded the parts. Says what is
            // missing and what to do, rather than asserting there is nothing
            // to record -- which is what the old message did, and why this
            // stayed wrong.
            if (liveOrder.type === "warranty" && (liveOrder.sku_items?.length ?? 0) === 0) {
              return (
                <div className="px-6 py-8 text-center">
                  <p className="text-[12px] text-cream/45">
                    No replacement parts recorded on this claim yet.
                  </p>
                  <p className="text-[11px] text-cream/30 mt-1">
                    Add the SKU, the quantity affected and which part it is.
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
                  {/* ⚠ THE PDF'S HEADER, THEN THE LINES WITH THE ACKNOWLEDGMENT'S
                      DISCREPANCIES ON THEM (Garrett, 2026-10-07). FullOrderGroup
                      reads the group's acknowledgment itself: a hook cannot run
                      inside this tab's inline function. */}
                  <FullOrderGroup group={open} team={team} readOnly={readOnly || open.source === "Shopify"} />
                </div>
              );
            }

            return (
              <div className="px-6 py-5">
                <OrderHeaderCards order={liveOrder} team={team} project={purchaseOfRow} />
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
                        <span className="text-[12px] text-cream/85 flex items-center gap-2">
                          {GROUP_LABEL[g.type] ?? g.type}
                          <GroupIssueTag group={g} />
                        </span>
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

          {tab === "files" && (liveOrder.type === "custom"
            // ⚠ A CUSTOM JOB'S FILES TAB IS THE PANEL ITSELF (2026-10-01;
            // Garrett: the same bins wherever files are shown). Same component,
            // same shared list, same bins -- Designer, Customer, one per room --
            // so a label cannot mean two sets of files. ProjectFiles stays for
            // Shopify purchases, whose files span the groups of a project.
            ? <AttachmentsPanel orderId={liveOrder.id} orderType={liveOrder.type} readOnly={readOnly || !canEdit}
                specs={liveOrder.custom_specs}
                focusGroupId={filesFocus?.orderId === liveOrder.id ? filesFocus.groupId : null} focusKey={filesFocus?.n} />
            // ⚠ THE ONE PLACE FOR FILES (2026-10-28, 5d; Garrett). Each group of
            // the purchase, headed, with the WHOLE panel -- file groups, Upload,
            // New group, Move, Rename, Delete, Receipt -- where this was a flat
            // list with Download and Delete. Read-only by each group's own
            // archive and the purchase's claim (the modal's canEdit: the claim
            // is the purchase's).
            : <div>
                {projectGroups.map((g) => (
                  <div key={g.id}>
                    {projectGroups.length > 1 && (
                      <p className="px-6 pt-5 text-[11px] uppercase tracking-[0.16em] text-cream/60">{GROUP_LABEL[g.type] ?? g.id}</p>
                    )}
                    <AttachmentsPanel orderId={g.id} orderType={g.type} readOnly={archivedVia(g, purchaseOfRow) !== null || !canEdit}
                      focusGroupId={filesFocus?.orderId === g.id ? filesFocus.groupId : null} focusKey={filesFocus?.n} />
                  </div>
                ))}
              </div>)}

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
                    <p className="text-[10px] text-cream/40 mt-0.5">{activityStamp(a)}</p>
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
            {!readOnly && (notesChanged || internalNotesChanged) && (
              <button
                onClick={() => {
                  if (notesChanged) void handleSaveNotes();
                  if (internalNotesChanged) void handleSaveInternalNotes();
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
      {aboutOpen && (
        <OrderModal order={aboutOpen} onClose={() => setAboutOpen(null)} onStageChange={() => {}} />
      )}
    </div>
  );
}

/*
 * ⚠ QuoteInfoPanel WAS HERE until 2026-09-28. It read the "QUOTE REQUEST" prose
 * out of `notes` with a regex per label and rendered the form's raw keys --
 * "10k_25k", ["raised_panel"] -- because that is what the flattened notes hold.
 * QuoteSubmissionPanel reads `quote_submission` instead and shows the words the
 * customer actually read. The notes string is still written for continuity and
 * nothing parses it any more.
 */

/**
 * What this group's stages run on, and the control that changes it.
 *
 * ⚠ ITS CONTENTS VARY BY TYPE BECAUSE ITS JOB DOES. Cabinets and custom jobs
 * advance on dates; hardware and samples advance on a tracking number. The
 * section this replaces was called "Production / Delivery" and was written
 * around the date fields, so it returned NULL for hardware and samples --
 * the two types where the tracking number is the whole answer.
 *
 * ⚠ "MODIFY", NEVER "+ ADD", AND ALWAYS PRESENT. The prompts here used to
 * appear only while a field was empty, which meant a date could be entered and
 * never corrected. First entry belongs to the next-action panel, as part of
 * advancing the row; this is the record you come back to, and coming back is
 * the only thing it is for.
 *
 * ⚠ THE TRACKING EDITOR IS TrackingEntry, the same component the next-action
 * slot uses. It owns clearing (a number and its carrier go together), the
 * advance-on-save, and the re-sync when a Shopify fulfilment writes underneath.
 * A second implementation here would be a second set of those rules.
 */
/**
 * Who the order is for and what it is (2026-10-26, item 8 step 3b; Garrett's
 * mockup): one row per fact, each with an icon -- Source, PO / Reference,
 * Order type, Order date, and, new on the Overview, Customer, Contact and
 * Project location (the Full Order tab still flags them against an
 * acknowledgment). ONE component: step 3a had placed the card twice, one per
 * layout, and two copies are where drift starts.
 *
 * ⚠ EDIT ONLY ON WHAT THE OMS MADE -- a custom job or a claim (Garrett). The
 * route refuses the rest; this only declines to offer it. The save waits for
 * the server and shows its refusal (updateCustomerDetails).
 */
/**
 * A card's facts, one row each: icon, label, value (2026-10-26, item 8). ONE
 * helper for the details card and Production & Delivery, so the two read
 * alike and cannot drift apart.
 */
type DetailRow = [typeof FileText, string, React.ReactNode];
function DetailRows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="mt-1">
      {rows.map(([Icon, label, value]) => (
        <div key={label} className="flex items-start gap-3 py-1.5 border-t border-white/[0.06] first:border-t-0">
          <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-cream/45" />
          <dt className="w-32 flex-shrink-0 text-[11.5px] text-cream/55">{label}</dt>
          <dd className={VALUE + " min-w-0 break-words whitespace-pre-line"}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrderDetailsCard({ order, canEditCustomer, onSaveCustomer }: {
  order: Order;
  canEditCustomer: boolean;
  onSaveCustomer: (id: string, d: { name: string; customer_email: string; customer_phone: string; ship_to: string }) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", customer_email: "", customer_phone: "", ship_to: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setDraft({ name: order.name ?? "", customer_email: order.customer_email ?? "", customer_phone: order.customer_phone ?? "", ship_to: order.ship_to ?? "" });
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (!draft.name.trim()) { setError("A name is required."); return; }
    setSaving(true);
    setError(null);
    const refused = await onSaveCustomer(order.id, draft);
    setSaving(false);
    if (refused) { setError(refused); return; }
    setEditing(false);
  };
  const notSet = <span className="text-cream/40">Not set</span>;
  const contact = [order.customer_email, order.customer_phone].map((v) => (v ?? "").trim()).filter(Boolean).join(" \u00b7 ");
  const rows: DetailRow[] = [
    [Layers, "Source", (
      <span className="text-[10px] uppercase tracking-wider px-2 py-px rounded-full font-medium inline-block"
        style={
          order.source === "Shopify"
            ? { background: "rgba(184,130,106,0.15)", color: "#d9a888", border: "0.5px solid rgba(184,130,106,0.40)" }
            : { background: "rgba(145,165,151,0.18)", color: "#b8d0bd", border: "0.5px solid rgba(145,165,151,0.45)" }
        }>
        {sourceLabel(order)}
      </span>
    )],
    // The reference a MANUFACTURER sees. Internal -- never shown to a
    // customer, who knows only the order number.
    [Hash, "PO / Reference", <span className="font-mono">{poReference(order)}</span>],
    [FileText, "Order type", GROUP_LABEL[order.type] ?? order.type],
    [CalendarDays, "Order date", orderDate(order)],
    [User, "Customer", order.name?.trim() ? order.name : notSet],
    [Mail, "Contact", contact || notSet],
    [MapPin, "Project location", order.ship_to?.trim() ? order.ship_to : notSet],
  ];
  const FIELD = "w-full rounded-brand px-2.5 py-1.5 placeholder:text-cream/25";
  const FIELD_STYLE: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.12)", color: "rgba(240,236,228,0.90)", fontSize: "16px" };
  const inputs: [keyof typeof draft, string, string][] = [
    ["name", "Customer", "Full name"], ["customer_email", "Email", "email@example.com"],
    ["customer_phone", "Phone", "(555) 000-0000"], ["ship_to", "Project location", "Street, City, State ZIP"],
  ];
  return (
    <div className="glass-sage rounded-panel px-4 py-3.5">
      <div className="flex items-center gap-2.5 mb-2">
        <span className={CARD_BADGE} style={CARD_BADGE_STYLE}>
          <FileText className="w-3.5 h-3.5" style={{ color: "#d9a888" }} />
        </span>
        <p className={LABEL + " mb-0"}>Customer &amp; order details</p>
        {canEditCustomer && !editing && (
          <button onClick={open}
            className="ml-auto text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream">
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2.5">
          {inputs.map(([key, label, placeholder]) => (
            <label key={key} className="block">
              <span className="block text-[11px] text-cream/55 mb-1">{label}</span>
              {key === "ship_to" ? (
                <textarea rows={2} value={draft[key]} placeholder={placeholder} aria-label={label}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={FIELD + " resize-none"} style={FIELD_STYLE} />
              ) : (
                <input value={draft[key]} placeholder={placeholder} aria-label={label}
                  type={key === "customer_email" ? "email" : key === "customer_phone" ? "tel" : "text"}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={FIELD} style={FIELD_STYLE} />
              )}
            </label>
          ))}
          {error && <p className="text-[11px]" style={{ color: "#e08585" }}>{error}</p>}
          <div className="flex justify-end gap-2.5 pt-1">
            <button type="button" onClick={() => { setEditing(false); setError(null); }} disabled={saving}
              className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all bg-white/6 border border-cream/15 text-cream/75 hover:bg-white/10 hover:text-cream disabled:opacity-40 disabled:cursor-not-allowed">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-full transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? "Saving\u2026" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <DetailRows rows={rows} />
      )}
    </div>
  );
}

function StageInputsCard({
  order, updateOrderDetails, onStageChange, canEdit = true, readOnly = false,
}: {
  order: Order;
  /** Archived: the dates and the tracking show, nothing offers to change them. */
  readOnly?: boolean;
  updateOrderDetails: (id: string, details: DateFields & { delivery_method?: string }) => Promise<string | null>;
  onStageChange: (stage: Stage) => void;
  /** False when another member holds the claim. The fields still show. */
  canEdit?: boolean;
}) {
  const carriesTracking = typeCarriesTracking(order.type);
  const [editing, setEditing] = useState(false);
  const [prodStart, setProdStart] = useState(order.production_start_date ?? "");
  const [prodFinish, setProdFinish] = useState(order.production_est_finish_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(order.scheduled_delivery_date ?? "");
  // Shipping method, editable here since 2026-10-26 (item 8 step 3c; Garrett).
  const [shippingMethod, setShippingMethod] = useState(order.delivery_method ?? "");
  const [saving, setSaving] = useState(false);
  // The server's sentence when it refuses (item 52): Modify stays open on it.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-sync when the row changes underneath: the cron advances rows and a
  // fulfilment can write dates while this is open.
  useEffect(() => {
    setProdStart(order.production_start_date ?? "");
    setProdFinish(order.production_est_finish_date ?? "");
    setDeliveryDate(order.scheduled_delivery_date ?? "");
    setShippingMethod(order.delivery_method ?? "");
  }, [order.production_start_date, order.production_est_finish_date, order.scheduled_delivery_date, order.delivery_method]);

  /**
   * ⚠ A CLAIM RECORDS ITS DATES AND TRACKING NUMBER (Garrett, 2026-10-13).
   * This said a claim had none and hid Modify, so nobody set a field nothing
   * read; the claim's next action now asks for them -- production dates or the
   * ship-from-factory date, then the tracking number or delivery date -- so
   * they are shown and correctable here. A record only: a claim moves by its
   * buttons, never on these.
   */
  const isWarranty = order.type === "warranty";
  const [trackingNum, setTrackingNum] = useState(order.tracking_number ?? "");

  async function saveDates() {
    setSaving(true);
    setSaveError(null);
    try {
      const refused = await updateOrderDetails(order.id, {
        production_start_date: prodStart || null,
        production_est_finish_date: prodFinish || null,
        scheduled_delivery_date: deliveryDate || null,
        delivery_method: shippingMethod.trim(),
        ...(isWarranty ? { tracking_number: trackingNum.trim() || null } : {}),
      });
      if (refused) { setSaveError(refused); return; }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const heading = carriesTracking ? "Carrier & tracking" : "Production & delivery";

  return (
    <div className="glass-sage rounded-panel px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className={CARD_BADGE} style={CARD_BADGE_STYLE}>
            <Truck className="w-3.5 h-3.5" style={{ color: "#d9a888" }} />
          </span>
          <div className="min-w-0">
            <p className={LABEL + " mb-0"}>{heading}</p>
            {/* ⚠ TRUE IN EACH CASE, not one sentence bent to fit three. A
                custom job advances on NOTHING -- its dates are a record, which
                is why the requirement table leaves custom empty -- so the
                stock "what this advances on" was false precisely where
                somebody might act on it. */}
            <p className="text-[10px] text-cream/45">
              {order.type === "custom" || isWarranty
                ? "Recorded for scheduling \u2014 nothing advances on these"
                : "What this group's stages run on"}
            </p>
          </div>
        </div>
        {canEdit && !readOnly && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[10px] uppercase tracking-wider px-3 py-1 rounded-full transition-all flex-shrink-0 bg-white/5 border border-cream/20 text-cream/75 hover:bg-white/10 hover:text-cream"
          >
            {editing ? "Done" : "Modify"}
          </button>
        )}
      </div>

      {/* ⚠ ROWS, AS THE DETAILS CARD (2026-10-26, item 8 step 3c; Garrett's
          mockup): one fact a line, each with an icon -- the same DetailRows.
          Shipping method is new here, and Modify edits it. */}
      {(() => {
        const notSet = <span className="text-cream/40">Not set</span>;
        const tracking: DetailRow = [Hash, "Tracking number",
          order.tracking_number ? <span className="font-mono">{order.tracking_number}</span> : notSet];
        const rows: DetailRow[] = carriesTracking
          ? [tracking, [Truck, "Carrier", order.carrier || notSet]]
          : [
              // Start and estimated finish read as a span, not two facts.
              [Factory, "Production", order.production_start_date || order.production_est_finish_date
                ? `${formatMDY(order.production_start_date) || "?"} \u2192 ${formatMDY(order.production_est_finish_date) || "?"}`
                : notSet],
              // Scheduled, not actual. A date the customer has not been given
              // is not a promise, and this is the internal view.
              [CalendarDays, "Delivery target", formatMDY(order.scheduled_delivery_date || order.delivery_date) || notSet],
              [Truck, "Shipping method", order.delivery_method?.trim() || notSet],
              ...(isWarranty ? [tracking] : []),
            ];
        return <DetailRows rows={rows} />;
      })()}

      {editing && canEdit && (
        <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid rgba(255,255,255,0.10)" }}>
          {carriesTracking ? (
            <TrackingEntry
              order={order}
              readOnly={readOnly}
              onSaved={(stage) => { if (stage) onStageChange(stage as Stage); setEditing(false); }}
            />
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)}
                title="Production starts" aria-label="Production start date" style={CARD_DATE_INPUT} />
              <span className="text-cream/30 text-[11px]">&rarr;</span>
              <input type="date" value={prodFinish} onChange={(e) => setProdFinish(e.target.value)}
                title="Ship from factory" aria-label="Ship from factory date" style={CARD_DATE_INPUT} />
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
                title="Delivery target" aria-label="Delivery target" style={CARD_DATE_INPUT} />
              <input type="text" value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)}
                placeholder="Shipping method" title="Shipping method" aria-label="Shipping method"
                maxLength={100} style={CARD_DATE_INPUT} />
              {isWarranty && (
                <input type="text" value={trackingNum} onChange={(e) => setTrackingNum(e.target.value)}
                  placeholder="Tracking number" title="Tracking number" aria-label="Tracking number"
                  maxLength={100} style={CARD_DATE_INPUT} />
              )}
              <button
                onClick={saveDates}
                disabled={saving}
                title="Save the dates on this order"
                className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-full transition-all bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30 disabled:opacity-40"
              >
                {saving ? "\u2026" : "Save"}
              </button>
              {saveError && (
                <p role="alert" className="w-full text-[11px]" style={{ color: "#e08585" }}>{saveError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CARD_DATE_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.10)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  borderRadius: "999px",
  color: "#e8e3da",
  colorScheme: "dark",
  fontFamily: "inherit",
  fontSize: "11px",
  height: "30px",
  padding: "0 12px",
};

function TrackingEntry({
  order, onSaved, highlight = false, readOnly = false,
}: {
  order: Order;
  onSaved: (advancedTo: string | null) => void;
  /** Opened because a move was refused for want of a number. */
  highlight?: boolean;
  /**
   * Archived: the carrier and the number still show -- they are part of what
   * happened -- and nothing offers to change them.
   */
  readOnly?: boolean;
}) {
  const { showToast } = useToast();
  const numberRef = useRef<HTMLInputElement>(null);

  // Focus the NUMBER, not the carrier. The number is what the gate wants;
  // carrier is optional and often already filled from a fulfilment.
  useEffect(() => {
    if (!highlight) return;
    // One frame, so the modal has mounted and the pipeline card is laid out
    // before focus moves -- otherwise the browser scrolls to a stale position.
    const id = requestAnimationFrame(() => numberRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [highlight]);
  const [carrier, setCarrier] = useState(order.carrier ?? "");
  const [number, setNumber] = useState(order.tracking_number ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sync when the row changes underneath -- a Shopify fulfilment can write
  // these while the modal is open, and a stale input would overwrite it.
  useEffect(() => {
    setCarrier(order.carrier ?? "");
    setNumber(order.tracking_number ?? "");
  }, [order.id, order.carrier, order.tracking_number]);

  const dirty = carrier !== (order.carrier ?? "") || number !== (order.tracking_number ?? "");

  // ⚠ CLEARING IS A REAL ACTION. save() refused every empty submit, so once a
  // number was on the row there was no way to take it off -- and the field
  // itself vanished after the first save, so there was no way to look at it
  // either. A row holding the wrong number is worse than one holding none.
  const stored = (order.tracking_number ?? "").trim();
  const clearing = !number.trim() && !!stored;

  // Whether saving will advance the group. Only true where the flow has a
  // Shipped ahead of it -- at Shipped or Delivered this is a plain edit.
  const willAdvance = !!number.trim() && nextStageFor(order) === "Shipped";

  async function save() {
    if (!number.trim() && !stored) {
      showToast("Add the tracking number \u2014 that is what marks this shipped.", { kind: "warn" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // ⚠ CLEARING TAKES THE CARRIER WITH IT. A carrier describing a parcel
        // whose number has gone is the same contradiction that a tracking
        // number on an unshipped row was. One truth per item.
        body: JSON.stringify({
          carrier: clearing ? "" : carrier.trim(),
          tracking_number: number.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body?.message ?? "Could not save the tracking number", { kind: "error" });
        return;
      }
      const body = await res.json().catch(() => ({}));
      const advanced = (body?.data?.stage as string | undefined) ?? null;
      showToast(
        clearing
          // Clearing does NOT move the row back -- undoing a stage is a
          // PIN-gated act, not a side effect of correcting a typo. Say so,
          // rather than leaving someone to wonder.
          ? "Tracking cleared \u2014 stage unchanged"
          : advanced === "Shipped" ? "Tracking saved \u2014 marked shipped" : "Tracking saved",
        { kind: "success" },
      );
      onSaved(advanced);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <input
        value={carrier}
        onChange={(e) => setCarrier(e.target.value)}
        readOnly={readOnly}
        placeholder="Carrier"
        className="w-[80px] rounded-brand px-2 py-1.5 text-[11px] placeholder:text-cream/25"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "0.5px solid rgba(255,255,255,0.12)",
          color: "rgba(240,236,228,0.90)",
          fontSize: "16px",
        }}
      />
      <input
        ref={numberRef}
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        onKeyDown={(e) => { if (!readOnly && e.key === "Enter") void save(); }}
        readOnly={readOnly}
        placeholder="Tracking number"
        className="w-[150px] rounded-brand px-2 py-1.5 text-[11px] placeholder:text-cream/25 transition-all"
        style={{
          background: highlight ? "rgba(184,130,106,0.12)" : "rgba(255,255,255,0.04)",
          border: `0.5px solid ${highlight ? "rgba(184,130,106,0.75)" : "rgba(255,255,255,0.12)"}`,
          boxShadow: highlight ? "0 0 0 1px rgba(184,130,106,0.25), 0 0 12px rgba(184,130,106,0.45)" : undefined,
          color: "rgba(240,236,228,0.90)",
          fontSize: "16px",
        }}
      />
      {!readOnly && (
      <button
        onClick={() => void save()}
        disabled={saving || !dirty}
        className="px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all flex-shrink-0 disabled:opacity-40"
        style={{
          background: "rgba(184,130,106,0.20)",
          border: "0.5px solid rgba(184,130,106,0.55)",
          color: "#d9a888",
        }}
      >
        {/* It read "Ship" on a group already shipped, which is the same
            class of untruth as a toast that says "saved" on an advance. */}
        {saving ? "\u2026" : clearing ? "Clear" : willAdvance ? "Ship" : "Save"}
      </button>
      )}
    </div>
  );
}

/**
 * Claim, release, or locked -- as one pill in the header.
 *
 * ⚠ THE OWNER COMES IN RESOLVED. For a Shopify group the claim lives on the
 * PROJECT and `orders.claimed_by` is null, so a component that read the row
 * would show every owned purchase as unclaimed. It takes the answer rather
 * than working it out, which is also why it needs no store access.
 *
 * Locked rather than a disabled Claim: a claim held by somebody else is not a
 * button you may press later, it is a fact about who owns the work.
 */
function ClaimChip({
  claimedBy, team, currentUserId, busy, canClaim, onClaim, onRelease,
}: {
  claimedBy: string | null;
  team: TeamMember[];
  currentUserId: string | null | undefined;
  busy: boolean;
  canClaim: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const member = claimedBy ? team.find((m) => m.id === claimedBy) ?? null : null;
  const mine = !!currentUserId && claimedBy === currentUserId;
  const theirs = !!claimedBy && !mine;

  const SHELL = "flex items-center gap-2 pl-1 pr-1 py-1 rounded-full";
  const SHELL_STYLE: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "0.5px solid rgba(255,255,255,0.14)",
  };
  const ACTION = "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full transition-all disabled:opacity-40";

  return (
    <span className={SHELL} style={SHELL_STYLE}>
      {member ? (
        <span className="flex items-center gap-1.5 pl-1">
          <AvatarWithProfile member={member} size="xs" />
          <span className="text-[11px] text-cream/75">{member.name}</span>
        </span>
      ) : (
        <span className="text-[10px] uppercase tracking-wider text-cream/45 pl-2.5">
          {claimedBy ? "Claimed" : "Unclaimed"}
        </span>
      )}

      {mine && canClaim && (
        <button type="button" onClick={onRelease} disabled={busy}
          className={ACTION + " text-cream/55 hover:text-cream hover:bg-white/8"}>
          {busy ? "\u2026" : "Release"}
        </button>
      )}
      {theirs && (
        <span className={ACTION + " text-amber-300/70"}
          title={`Claimed by ${member?.name ?? claimedBy}`}>
          Locked
        </span>
      )}
      {!claimedBy && canClaim && (
        <button type="button" onClick={onClaim} disabled={busy || !currentUserId}
          title={currentUserId ? "Claim this" : "Sign in to claim"}
          className={ACTION + " bg-terracotta/20 border border-terracotta/45 text-terracotta hover:bg-terracotta/30"}>
          {busy ? "\u2026" : "Claim"}
        </button>
      )}
    </span>
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

// (ProjectFiles and ProjectFileRow -- the purchase's flat file list -- were
// replaced by an AttachmentsPanel per group in 5d, 2026-10-28.)
