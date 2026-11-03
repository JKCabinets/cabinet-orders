"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Calendar, Check, Send, Upload, X, Zap } from "lucide-react";
import { nextStageFor, type Order, type PaymentFields, type SkuItem } from "@/lib/data";
import { requirementsFor, dateControlsFor, type RequirementEnrichment, type RequirementState } from "@/lib/requirements";
import { productionAutoAdvance, productionAutoAdvanceSkip } from "@/lib/autoAdvance";
import { typeCarriesTracking } from "@/lib/categories";
import { formatMDY, weekdayMonthDay, monthDay } from "@/lib/dates";
import { cabinetVendorsOf, vendorShipDate, dueShipChecks, type DueCheck } from "@/lib/shipDates";

/**
 * What this row needs before it can move, and the controls that do it.
 *
 * ⚠ THE CHECKLIST IS GENERATED, NOT WRITTEN PER STAGE. Every row comes from
 * `requirementsFor(order)` — the same table the server gate, sla.ts and the
 * work queue read. Before this, the slot was a hand-written branch per case:
 * one shape for the acknowledgment gate, one for tracking, one for everything
 * else. Each new gate meant another branch, and the branch and the gate were
 * free to disagree — which is exactly what happened twice on 2026-09-08, once
 * in each direction.
 *
 * ⚠ "NEXT ACTION" IS NOT JUST THE MOVE. It is the move AND the steps the
 * current stage is waiting on. A row that cannot advance says which step is
 * outstanding, rather than presenting a disabled button and leaving the reason
 * to a tooltip.
 *
 * ⚠ ONLY A `gates` REQUIREMENT DISABLES THE MOVE. The table carries two kinds
 * of requirement: ones the SERVER refuses the transition without (the
 * acknowledgment, the production start date, the signed receipt, the tracking
 * number) and ones that merely keep an SLA clock running (a delivery date at
 * At cross dock, both production dates at In production). The first draft of
 * this panel disabled on every unmet row, which would have refused a move the
 * PATCH route allows -- the "client gate stricter than its server" failure
 * this codebase keeps having. Now the clock-only ones are LISTED as
 * outstanding, with their field beside them, and the button stays live.
 *
 * ⚠ UNKNOWN RENDERS AS UNMET, AND A GATING UNKNOWN DISABLES THE MOVE. A
 * join-backed requirement whose fetch has not landed shows as an open circle,
 * not a tick. That is the opposite of the rule in lib/attention.ts, and
 * deliberately: a QUEUE that guesses sends somebody to redo finished work,
 * while a MODAL that guesses is corrected a fraction of a second later by the
 * person looking straight at it. A premature tick beside an enabled button is
 * the worse error here.
 *
 * ⚠ WHERE THE FIELD IS THE ACTION, THERE IS NO BUTTON. A tracking number is
 * what makes a group Shipped, and a production start date is what moves a
 * cabinet order out of Entered -- the server advances on the save. A button
 * beside either would bypass that rule or refuse and explain why. The move
 * button appears at Entered only once the date is on the row and the server
 * did not advance it, which today means somebody edited the database.
 */

const HAIRLINE = "0.5px solid rgba(255,255,255,0.10)";
/**
 * ⚠ THE CARD TITLES THE CARD. This was a 10px uppercase tracking-widest label
 * at 45% opacity -- the treatment of a field name inside a table cell -- on the
 * one panel of the modal that asks somebody to do something. The checklist and
 * its instructions sat at 65% and 35% under it, so the whole card read as
 * caption text and the words got lost. Sizes and weights follow the mockup.
 */
const TITLE = "text-[14px] font-medium text-cream";
const BODY = "text-[12px] text-cream/80 leading-snug";
const NOTE = "text-[11px] text-cream/50 leading-snug";

/**
 * A control the modal supplies for a requirement, keyed by requirement id.
 *
 * The LABEL comes from the modal because the remedy varies where the
 * requirement does not: the same `ack_or_attachment` row reads "Upload
 * acknowledgment" on a Waypoint order and "Attach a file" on HCI or J&K, and
 * only the modal knows which picker it is about to open.
 */
export interface RemedyAction {
  label: string;
  onClick: () => void;
}

/**
 * ⚠ DATES ARE ENTERED HERE, NOT LOWER DOWN. Setting the production dates IS
 * the next action at Entered — the server auto-advances the row to In
 * production the moment a start date lands, and `production-complete` then
 * advances it to At cross dock when the estimated finish date arrives. So the
 * field is the action, exactly as a tracking number is for a sample.
 *
 * The Production / Delivery card lower down keeps its own Edit control for
 * CHANGING dates afterwards. That is a different job: this is the step that is
 * outstanding, that is the record you correct.
 *
 * ⚠ `scheduled_delivery_date`, NOT `delivery_date`. The first draft patched
 * `delivery_date`; DateEditor, the Order-info cell and the requirement itself
 * all read `scheduled_delivery_date` first. One field, same as the rest of
 * the modal.
 */
export type DateFields = {
  production_start_date?: string | null;
  production_est_finish_date?: string | null;
  scheduled_delivery_date?: string | null;
  /** A claim's, saved with its delivery date (2026-10-13). */
  tracking_number?: string | null;
  /** A mixed cabinet group's ship date per vendor (2026-11-02, feature 9). */
  vendor_ship_dates?: Record<string, string> | null;
  /** "Still on schedule?" answered "On schedule" (the server stamps who and when). */
  ship_check?: { vendor: string; date: string } | { line_key: string; date: string };
  /** A backordered line's "Delayed: new date": the lines with its ready date moved. */
  sku_items?: SkuItem[];
};

/** Requirements the production-date pair satisfies, at either stage. */
const PRODUCTION_DATE_IDS = new Set(["production_start_date", "production_dates"]);

/**
 * ⚠ THE FIELD APPEARS WHERE THE DATE IS THE THING TO TYPE, WHICH IS NOT THE
 * SAME AS WHERE ONE IS REQUIRED. This asked `outstanding` alone, so a custom
 * job -- no requirements at all, by decision -- got no field, and the prompt
 * fell through to a full-width card below the fold. `dateControlsFor` says the
 * date belongs here; the requirement, if there is one, says whether it is also
 * a demand. Where there is none the field is captioned as a record, because a
 * custom job's dates gate nothing and the caption is the only thing keeping
 * the control honest about that.
 */
const RECORD_ONLY_NOTE: Record<string, string> = {
  production: "Production dates here are a record \u2014 they will not move the order.",
  delivery: "The delivery date here is a record \u2014 it will not move the order.",
};

const DATE_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.10)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  borderRadius: "999px",
  color: "#e8e3da",
  colorScheme: "dark",
  fontFamily: "inherit",
  fontSize: "11px",
  height: "32px",
  padding: "0 12px",
};

/**
 * ⚠ ONE SIZE FOR EVERY CONTROL IN THE SLOT. The date inputs were 5px-padded
 * boxes sitting beside 6px-padded pills, so no two edges in the row lined up.
 * Everything here is this height, including the inputs when they open.
 */
const PILL = "h-9 px-4 rounded-full text-[11px] font-medium transition-all flex-shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed";
const PILL_QUIET = PILL + " bg-white/4 border border-cream/25 text-cream hover:bg-white/8 disabled:opacity-40";
const PILL_MOVE: React.CSSProperties = {
  background: "rgba(184,130,106,0.22)",
  border: "0.5px solid rgba(184,130,106,0.60)",
  color: "#e8bfa4",
};

/**
 * ⚠ WAITING, NOT BROKEN. `disabled:opacity-40` on a terracotta pill produced a
 * smear that reads as a rendering fault rather than as a button with a
 * condition on it. Legible, quiet, and clearly not pressable: a move that is
 * waiting on a requirement is the normal state and should look like one.
 */
const PILL_MOVE_WAITING: React.CSSProperties = {
  background: "rgba(160,204,122,0.08)",
  border: "0.5px solid rgba(160,204,122,0.22)",
  color: "rgba(240,236,228,0.40)",
};

interface Props {
  order: Order;
  /**
   * The row's project, or null for a standalone row. REQUIRED: whether this
   * row moves on its own depends on the PURCHASE -- a refunded or archived one
   * is not advanced by the cron -- so the promise below cannot be made without
   * it. See productionAutoAdvanceSkip.
   */
  project: (PaymentFields & { archived?: boolean | null }) | null;
  /** From useOrderEnrichment, so the modal and the queue cannot disagree. */
  enrichment?: RequirementEnrichment;
  /** Upload-style remedies, one per requirement id that has one. */
  remedies?: Partial<Record<string, RemedyAction>>;
  /**
   * Overrides, one per requirement id the server lets a person override with a
   * reason. Rendered only while that requirement is outstanding. Today that is
   * the signed receipt; `override_ack` is deliberately NOT here because it is
   * unlogged and known-wrong (OMS-STATE §3).
   */
  overrides?: Partial<Record<string, RemedyAction>>;
  onMove: (stage: string) => void;
  /** PATCHes the row. Setting a start date at Entered auto-advances it. */
  onSaveDates: (patch: DateFields) => Promise<string | null | void> | void;
  busy?: boolean;
  /**
   * Somebody else holds the claim and the viewer is not an admin, so the server
   * will refuse every one of these actions with 409 `claimed_by_other`.
   *
   * ⚠ THE CHECKLIST STILL RENDERS. Read-only is not blank: knowing what this
   * row is waiting on is exactly what a person who cannot act on it needs, so
   * they can tell the owner rather than open a second copy of the work. Only
   * the controls go.
   */
  readOnly?: boolean;
  /** Why the controls are absent. Shown in their place. */
  lockedNote?: string;
  /** First cell of its container: drop the left divider that separates cells. */
  flush?: boolean;
  /**
   * The tracking field, when the type carries one. Passed in rather than
   * rendered here: ⚠ A TRACKING NUMBER IS WHAT MAKES A GROUP SHIPPED, so the
   * field IS the action and it belongs to the type rather than to one stage.
   */
  trackingSlot?: React.ReactNode;
}

export function NextActionPanel({
  order, project, enrichment, remedies = {}, overrides = {}, onMove, onSaveDates, busy,
  readOnly = false, lockedNote, flush, trackingSlot,
}: Props) {
  // ⚠ The modal keys this component on the order id, so switching groups
  // remounts it and these never carry one group's typing into another.
  const [prodStart, setProdStart] = useState(order.production_start_date ?? "");
  const [prodFinish, setProdFinish] = useState(order.production_est_finish_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(order.scheduled_delivery_date ?? "");
  const [trackingNum, setTrackingNum] = useState(order.tracking_number ?? "");
  const [saving, setSaving] = useState(false);
  /**
   * ⚠ A CLAIM KEEPS ITS OWN RULES (Garrett, 2026-10-13). Its dates and its
   * tracking number are a RECORD -- either one of a pair is enough -- and it
   * moves only by the move button; the tracking number never moves it.
   */
  const isClaim = order.type === "warranty";
  /**
   * ⚠ THE FIELDS OPEN FROM A BUTTON. Two empty date boxes and an arrow sat in
   * the row permanently, so the commonest state of the slot -- nothing to type
   * -- was also its busiest. One button, same size as its neighbours, and the
   * fields replace the row when it is pressed.
   */
  const [openDate, setOpenDate] = useState<null | "production" | "delivery">(null);
  // The server's sentence when it refuses the dates (2026-10-26, item 52):
  // the editor stays open on it, rather than closing as if they had saved.
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { setSaveError(null); }, [openDate]);

  // ⚠ A MIXED CABINET GROUP SHIPS PER VENDOR (2026-11-02, feature 9 phase 1):
  // one "ships from the factory" date each; the server makes the latest the
  // group's (lib/shipDateEdits), so the band sends no group date of its own.
  const vendors = cabinetVendorsOf(order);
  const perVendor = vendors.length > 1;
  const [vendorDates, setVendorDates] = useState<Record<string, string>>(
    () => Object.fromEntries(vendors.map((v) => [v, vendorShipDate(order, v) ?? ""])));
  // "Still on schedule?" -- which check is open on "Delayed: new date", and its date.
  const [delayFor, setDelayFor] = useState<string | null>(null);
  const [delayDate, setDelayDate] = useState("");
  const [checkSaving, setCheckSaving] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<{ key: string; text: string } | null>(null);
  // Every vendor's date, or none: a partial set cannot be saved (the server
  // refuses it), and none at all leaves the group's ship date unset.
  const vendorsFilled = vendors.filter((v) => vendorDates[v]).length;
  const prodBlocked: string | null =
    !isClaim && !prodStart ? "Set the production start date to save."
    : isClaim && !(prodStart || prodFinish) ? "Set a date to save."
    : perVendor && vendorsFilled > 0 && vendorsFilled < vendors.length ? "Set a date for each vendor, or none."
    : null;

  async function save(patch: DateFields) {
    setSaving(true);
    setSaveError(null);
    try {
      const refused = await onSaveDates(patch);
      if (typeof refused === "string") { setSaveError(refused); return; }
      setOpenDate(null);
    } finally { setSaving(false); }
  }

  const requirements = requirementsFor(order);
  // Each cabinet line's acknowledgment (2026-11-02, feature 10), from the enrichment.
  const ackLineRows = Object.entries(enrichment?.ackLines ?? {}).map(([vendor, state]) => ({ vendor, state }));
  const next = nextStageFor(order);

  const rows = requirements.map((r) => ({
    req: r,
    state: r.state(order, enrichment) as RequirementState,
  }));

  // Unknown counts as outstanding here. See the header.
  const outstanding = rows.filter((r) => r.state !== "met");
  const blocking = outstanding.filter((r) => r.req.gates === true);
  const ready = blocking.length === 0;

  const controls = dateControlsFor(order);

  const prodDemanded = outstanding.some((o) => PRODUCTION_DATE_IDS.has(o.req.id));
  const prodIsRecordOnly = !requirements.some((r) => PRODUCTION_DATE_IDS.has(r.id));
  const needsProdDates = controls.includes("production")
    && (isClaim
        ? !(order.production_start_date || order.production_est_finish_date)
        : (prodDemanded
            || (prodIsRecordOnly
                && !(order.production_start_date && order.production_est_finish_date))));

  const deliveryDemanded = outstanding.some((o) => o.req.id === "delivery_date");
  const deliveryIsRecordOnly = !requirements.some((r) => r.id === "delivery_date");
  const needsDeliveryDate = controls.includes("delivery")
    && (isClaim
        ? !(order.scheduled_delivery_date || order.tracking_number)
        : (deliveryDemanded || (deliveryIsRecordOnly && !order.scheduled_delivery_date)));

  /**
   * ⚠ THE FIELD IS THE ACTION on two transitions, and there the button is
   * withheld rather than disabled -- see the header. Shipped never gets one;
   * Entered gets one only once the date is already on the row.
   */
  const recordNote = (needsProdDates && prodIsRecordOnly && RECORD_ONLY_NOTE.production)
    || (needsDeliveryDate && deliveryIsRecordOnly && RECORD_ONLY_NOTE.delivery)
    || null;

  /**
   * ⚠ THIS STAGE MOVES ITSELF, so the move button is an EARLY push rather
   * than the only way forward. Null unless the cron will actually act --
   * see lib/autoAdvance -- because a row with no estimated finish date
   * sits here indefinitely and must not be told otherwise.
   */
  const autoAdvance = productionAutoAdvance(order, project);

  // ⚠ ONLY WHERE A TRACKING NUMBER IS THE SHIPMENT (samples, hardware). A
  // claim's next stage is also called Shipped, and this said "enter the
  // tracking number" to a claim that had no tracking field and no button --
  // a dead end (Garrett, 2026-10-13).
  const trackingIsTheAction = next === "Shipped" && typeCarriesTracking(order.type);
  const datesAreTheAction = order.stage === "Entered" && next === "In production";
  const showMoveButton = !!next && !trackingIsTheAction && !(datesAreTheAction && !ready);

  /**
   * Phrased as the GOAL and its condition — "Move to Delivered once a signed
   * proof of delivery is recorded" — rather than as an instruction. The
   * instruction is the remedy, and it sits on the row it belongs to, because
   * with two outstanding requirements there are two instructions and only one
   * headline.
   */
  const claimHeadline = !isClaim ? null
    : needsProdDates ? "Enter the production dates or ship-from-factory date."
    : needsDeliveryDate ? "Enter the tracking number or delivery date."
    : null;
  const headline = !next
    ? "Nothing further \u2014 this is the last stage."
    : claimHeadline
    ? claimHeadline
    : trackingIsTheAction
      ? "Enter the tracking number to mark this shipped."
      : datesAreTheAction && !ready
        ? "Set the production dates to move this to In production."
        : ready
          ? (autoAdvance
              ? `Moves to ${autoAdvance.to} on ${formatMDY(autoAdvance.on)}, when production ends.`
                // (2026-11-02, §4.2 item 9) A cabinet order's lines are marked
                // shipped in Shopify on the date, and Shopify emails the customer.
                + (order.type === "order" ? " Shopify then emails the customer that it shipped." : "")
              : `Ready to move to ${next}.`)
          : `Move to ${next} once ${listOf(blocking.map((o) => o.req.label))} `
            + `${blocking.length === 1 ? "is" : "are"} recorded.`;

  // ⚠ "STILL ON SCHEDULE?" (2026-11-02, feature 9 phase 1). The run's own rule
  // (lib/shipDates), asked of the purchase as production-complete asks it: the
  // band never asks about a date the run will not act on. The wording is the
  // approved staff check (docs/SESSION-HANDOFF-2026-10-29.md §4.4), exactly.
  // "On schedule" is recorded (the server stamps who and when); "Delayed: new
  // date" saves the new date -- the vendor's own on a mixed group, the group's
  // on a single vendor, the ready date on a backordered line -- and the run
  // follows it. Unanswered, the run marks it shipped on the date all the same.
  const checks: DueCheck[] = dueShipChecks(order, Date.now(), !!productionAutoAdvanceSkip(order, project));
  const checkKey = (c: DueCheck) => (c.scope === "vendor" ? `vendor:${c.vendor}` : `line:${c.key ?? c.index}`);
  async function answer(c: DueCheck, delayed: string | null) {
    const k = checkKey(c);
    setCheckSaving(k);
    setCheckError(null);
    const patch: DateFields = !delayed
      ? { ship_check: c.scope === "vendor" ? { vendor: c.vendor, date: c.date } : { line_key: c.key ?? "", date: c.date } }
      : c.scope === "vendor"
        ? (perVendor
            ? { vendor_ship_dates: Object.fromEntries(vendors.map((v) => [v, v === c.vendor ? delayed : (vendorShipDate(order, v) ?? delayed)])) }
            : { production_est_finish_date: delayed })
        : { sku_items: (order.sku_items ?? []).map((l, i) => (i === c.index ? { ...l, expected_ready_date: delayed } : l)) };
    try {
      const refused = await onSaveDates(patch);
      if (typeof refused === "string") { setCheckError({ key: k, text: refused }); return; }
      setDelayFor(null);
    } finally {
      setCheckSaving(null);
    }
  }

  return (
    <div className="px-5 py-4" style={flush ? undefined : { borderLeft: HAIRLINE }}>
      {/* ⚠ THE MOCKUP'S BAND (2026-10-26, item 8 step 2; Garrett): a large icon
          tile, then what is needed -- the title, the headline, the record note
          and the checklist -- then the actions on the far right, centred on
          the band. LAYOUT ONLY: every control below is the same element it was,
          moved, not rewritten; the main button keeps the OMS pill (Garrett).
          ⚠ THE OVERRIDE STAYS ON THE TITLE ROW, at its far edge, small: stacked
          on the move button, the exception read as an equal choice. */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(184,130,106,0.18)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
          <Zap className="w-[18px] h-[18px]" style={{ color: "#d9a888" }} />
        </span>

        <div className="flex-1 min-w-[16rem]">
          <div className="flex items-start justify-between gap-3">
            <p className={TITLE}>Next action</p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {!readOnly && showMoveButton && !ready && outstanding.map(({ req }) => {
                const override = overrides[req.id];
                if (!override) return null;
                return (
                  <button
                    key={"override:" + req.id}
                    onClick={override.onClick}
                    disabled={busy}
                    className={PILL + " bg-white/6 border border-cream/20 text-cream/75 hover:bg-white/10 disabled:opacity-40"}
                  >
                    <Send className="w-3 h-3" /> {override.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className={BODY + " mt-1"}>{headline}</p>
          {recordNote && (
            <p className={NOTE + " mt-0.5"}>{recordNote}</p>
          )}

          {rows.length > 0 && (
            <ul className="mt-3 space-y-1.5 min-w-0">
              {rows.map(({ req, state }) => (req.id === "ack_or_attachment" && ackLineRows.length > 0)
                // ⚠ A ROW PER CABINET LINE (2026-11-02, feature 10; Garrett: "Waypoint
                // Ack (Upload Ack) … J&K Ack (Upload Ack) … (Move to Entered)").
                ? ackLineRows.map(({ vendor, state: ls }) => {
                    const remedy = remedies[`ack_or_attachment:${vendor}`];
                    return (
                      <li key={`ack:${vendor}`} data-ack-line={vendor} data-state={ls} className="flex items-start gap-2 text-[12px] leading-snug">
                        <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-[2px] flex items-center justify-center"
                          style={ls === "met" ? { background: "rgba(160,204,122,0.20)", border: "0.5px solid #a0cc7a" }
                            : ls === "failed" ? { background: "rgba(232,144,144,0.18)", border: "0.5px solid #e89090" }
                            : ls === "stale" ? { background: "rgba(232,181,106,0.18)", border: "0.5px solid #e8b56a" }
                            : { border: "0.5px solid rgba(232,227,218,0.30)" }}>
                          {ls === "met" && <Check className="w-2 h-2" style={{ color: "#a0cc7a" }} />}
                          {ls === "failed" && <X className="w-2 h-2" style={{ color: "#e89090" }} />}
                          {ls === "stale" && <AlertTriangle className="w-2 h-2" style={{ color: "#e8b56a" }} />}
                        </span>
                        <span className="min-w-0" style={{ color: ls === "met" ? "#a0cc7a" : "rgba(240,236,228,0.92)" }}>
                          {vendor}: acknowledgment
                          {ls !== "met" && <span className={"block " + NOTE}>{ackLineNote(vendor, ls)}</span>}
                        </span>
                        {ls !== "met" && remedy && !readOnly && (
                          <button onClick={remedy.onClick} className={PILL_QUIET + " ml-auto flex-shrink-0"}>
                            <Upload className="w-3 h-3" /> {remedy.label}
                          </button>
                        )}
                      </li>
                    );
                  })
                : (
                <li key={req.id} className="flex items-start gap-2 text-[12px] leading-snug">
                  <span
                    className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-[2px] flex items-center justify-center"
                    style={state === "met"
                      ? { background: "rgba(160,204,122,0.20)", border: "0.5px solid #a0cc7a" }
                      : { border: "0.5px solid rgba(232,227,218,0.30)" }}
                  >
                    {state === "met" && <Check className="w-2 h-2" style={{ color: "#a0cc7a" }} />}
                  </span>
                  <span style={{ color: state === "met" ? "#a0cc7a" : "rgba(240,236,228,0.92)" }}>
                    {capitalise(req.label)}
                    {state !== "met" && (
                      <span className={"block " + NOTE}>{req.remedy}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ⚠ LEVEL WITH THE LAST LINE'S UPLOAD (2026-11-03, Garrett: "line up with the
            bottom upload button"). The row centres its columns, which put Move to
            Entered beside the MIDDLE line; with a row per line it sits at the bottom. */}
        <div className={"flex-shrink-0 ml-auto" + (ackLineRows.length > 0 && rows.some((r) => r.req.id === "ack_or_attachment") ? " self-end" : "")}>
          {readOnly ? (
            <p className={NOTE + " flex-shrink-0 text-right max-w-[16rem]"}>{lockedNote}</p>
          ) : (
          <>
          {/* ⚠ A COLUMN OF ROWS, NOT ONE WRAPPING ROW. Five controls in a single
              flex-wrap line broke wherever the width happened to run out, which
              put the override beside the move on one screen and under an upload
              button on the next. The fields take a row of their own while open. */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {saveError && openDate && (
              <p role="alert" className="text-[11px] max-w-[22rem] text-right" style={{ color: "#e08585" }}>{saveError}</p>
            )}
            {/* ⚠ A LABEL ON EVERY BOX (2026-11-02, Garrett: one field, "and doesn't
                label which its even for"). One labelled row per box, the boxes
                aligned at the right; the buttons beneath, and when Save cannot
                be used, why -- in words, not a tooltip. */}
            {openDate === "production" && (
              <div className="flex flex-col items-end gap-1.5">
                <BandField label="Production starts">
                  <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)}
                    aria-label="Production start date" autoFocus style={DATE_INPUT} />
                </BandField>
                {perVendor ? vendors.map((v) => (
                  <BandField key={v} label={`${v} ships from the factory`}>
                    <input type="date" value={vendorDates[v] ?? ""}
                      onChange={(e) => setVendorDates((d) => ({ ...d, [v]: e.target.value }))}
                      aria-label={`${v} ship from factory date`} style={DATE_INPUT} />
                  </BandField>
                )) : (
                  <BandField label="Ships from the factory">
                    <input type="date" value={prodFinish} onChange={(e) => setProdFinish(e.target.value)}
                      aria-label="Ship from factory date" style={DATE_INPUT} />
                  </BandField>
                )}
                {/* ⚠ BOTH DATES, THOUGH ONLY THE START ONE GATES. The start date
                    advances the row; the estimated finish is what
                    `production-complete` later advances ON, so a row saved with
                    only a start date would move to In production and then strand.
                    Asking for both here is the difference between one trip and
                    two. On a mixed group: every vendor's date, or none. */}
                <div className="flex items-center gap-1.5">
                  {prodBlocked && <span className="text-[10.5px] text-cream/45">{prodBlocked}</span>}
                  <button
                    onClick={() => save(perVendor && vendorsFilled === vendors.length
                      ? { production_start_date: prodStart || null, vendor_ship_dates: vendorDates }
                      : { production_start_date: prodStart || null, production_est_finish_date: perVendor ? null : (prodFinish || null) })}
                    disabled={saving || !!prodBlocked}
                    title={isClaim
                      ? "Save the dates on this claim"
                      : datesAreTheAction ? "Save the dates and move to In production" : "Save the production dates"}
                    className={PILL_QUIET}
                  >
                    {saving ? "\u2026" : "Save"}
                  </button>
                  <button onClick={() => setOpenDate(null)} disabled={saving}
                    className={PILL + " text-cream/45 hover:text-cream/75"}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {openDate === "delivery" && (
              <div className="flex flex-col items-end gap-1.5">
                {isClaim && (
                  <BandField label="Tracking number">
                    <input type="text" value={trackingNum} onChange={(e) => setTrackingNum(e.target.value)}
                      placeholder="Tracking number" aria-label="Tracking number"
                      autoFocus maxLength={100} style={DATE_INPUT} />
                  </BandField>
                )}
                <BandField label="Delivery date">
                  <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
                    aria-label="Delivery date" autoFocus={!isClaim} style={DATE_INPUT} />
                </BandField>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => save({
                      scheduled_delivery_date: deliveryDate || null,
                      ...(isClaim ? { tracking_number: trackingNum.trim() || null } : {}),
                    })}
                    disabled={saving || (isClaim ? !(deliveryDate || trackingNum.trim()) : !deliveryDate)}
                    className={PILL_QUIET}
                  >
                    {saving ? "\u2026" : "Save"}
                  </button>
                  <button onClick={() => setOpenDate(null)} disabled={saving}
                    className={PILL + " text-cream/45 hover:text-cream/75"}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-end gap-1.5 flex-wrap justify-end">
              {trackingSlot}

              {needsProdDates && openDate !== "production" && (
                <button onClick={() => setOpenDate("production")} className={PILL_QUIET}>
                  <Calendar className="w-3 h-3" /> {isClaim ? "Enter dates" : "Set production dates"}
                </button>
              )}

              {needsDeliveryDate && openDate !== "delivery" && (
                <button onClick={() => setOpenDate("delivery")} className={PILL_QUIET}>
                  <Calendar className="w-3 h-3" /> {isClaim ? "Enter dates" : "Set delivery date"}
                </button>
              )}

              {outstanding.map(({ req }) => {
                const remedy = remedies[req.id];
                if (!remedy) return null;
                return (
                  <button
                    key={req.id}
                    onClick={remedy.onClick}
                    title={req.remedy}
                    className={PILL_QUIET + " hover:border-terracotta/40"}
                  >
                    <Upload className="w-3 h-3" /> {remedy.label}
                  </button>
                );
              })}

              {/*
                ⚠ ONE STRETCHED COLUMN, so the override and the move share an edge
                and a width. Right-aligning two pills of different label lengths
                left a ragged step: `items-stretch` sizes both to the wider, which
                is the move button, and the override sits directly on top of the
                thing it overrides.

                ⚠ DISABLED UNTIL EVERY GATING REQUIREMENT IS MET, and every gating
                requirement is one the SERVER also checks. A button that fails on
                click is a requirement nobody was told about -- which is how the
                Entered gate spent a day refusing the request that satisfied it.
              */}
              {showMoveButton && (
                <button
                  onClick={() => onMove(next!)}
                  disabled={busy || !ready}
                  title={!ready
                    ? blocking.map((o) => capitalise(o.req.label)).join(", ") + " outstanding"
                    : autoAdvance
                      ? `Move to ${autoAdvance.to} now, rather than waiting for ${formatMDY(autoAdvance.on)}`
                      : `Move to ${next}`}
                  className={PILL}
                  style={ready ? PILL_MOVE : PILL_MOVE_WAITING}
                >
                  {/* ⚠ "Manual Push" ONLY WHERE SOMETHING AUTOMATIC IS BEING
                      pre-empted. Elsewhere this button is the only way the row
                      moves, and calling that a push would imply a normal path
                      that does not exist. */}
                  <Check className="w-3.5 h-3.5" />{" "}
                  {busy ? "\u2026" : autoAdvance ? "Manual Push" : `Move to ${next}`}
                </button>
              )}
            </div>
          </div>
          </>
          )}
        </div>
      </div>
      {checks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {checks.map((c) => {
            const k = checkKey(c);
            const subject = c.scope === "vendor" ? c.vendor : `${c.sku} (backordered)`;
            return (
              <div key={k} role="group" aria-label="Still on schedule?"
                className="rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap"
                style={{ border: HAIRLINE, background: "rgba(255,255,255,0.03)" }}>
                <div className="flex-1 min-w-[16rem]">
                  <p className="text-[12px] text-cream/85">
                    <strong>{subject} ships from the factory on {weekdayMonthDay(c.date)}.</strong> Still on schedule?
                  </p>
                  <p className="text-[11px] text-cream/50 italic">
                    If nobody answers, it&apos;s marked shipped on {monthDay(c.date)}, and Shopify emails the customer.
                  </p>
                  {checkError?.key === k && (
                    <p role="alert" className="text-[11px] mt-1" style={{ color: "#e08585" }}>{checkError.text}</p>
                  )}
                </div>
                {!readOnly && (delayFor === k ? (
                  <div className="flex items-center gap-1.5">
                    <input type="date" value={delayDate} onChange={(e) => setDelayDate(e.target.value)}
                      aria-label={`New date for ${subject}`} autoFocus style={DATE_INPUT} />
                    <button onClick={() => answer(c, delayDate)}
                      disabled={!!checkSaving || !delayDate || delayDate === c.date} className={PILL_QUIET}>
                      {checkSaving === k ? "\u2026" : "Save"}
                    </button>
                    <button onClick={() => setDelayFor(null)} disabled={!!checkSaving}
                      className={PILL + " text-cream/45 hover:text-cream/75"}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => answer(c, null)} disabled={!!checkSaving} className={PILL_QUIET}>
                      {checkSaving === k ? "\u2026" : "On schedule"}
                    </button>
                    <button onClick={() => { setDelayFor(k); setDelayDate(c.date); setCheckError(null); }}
                      disabled={!!checkSaving} className={PILL_QUIET}>
                      Delayed: new date
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** What a cabinet line's acknowledgment needs, said for its state (2026-11-02, feature 10). */
function ackLineNote(vendor: string, state: string): string {
  const waypoint = /^(waypoint|select)( cabinetry)?$/i.test(vendor.trim());
  if (state === "failed") return "It did not match the order. See the acknowledgment panel, then upload it again";
  if (state === "stale") return "The order changed since it was acknowledged. Upload it again";
  return waypoint ? "Upload its acknowledgment spreadsheet; it must match the order" : "Upload theirs, a PDF or Excel file";
}

/** A box in the band with its label beside it (2026-11-02): one row, label then box. */
function BandField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[10.5px] text-cream/55">
      <span className="text-right">{label}</span>
      {children}
    </label>
  );
}

/** "a and b", "a, b and c" — an English list, not a comma join. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
