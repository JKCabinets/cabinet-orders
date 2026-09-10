"use client";

import { useState } from "react";
import { Calendar, Check, Send, Upload, Zap } from "lucide-react";
import { nextStageFor, type Order } from "@/lib/data";
import { requirementsFor, dateControlsFor, type RequirementEnrichment, type RequirementState } from "@/lib/requirements";

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
  onSaveDates: (patch: DateFields) => Promise<void> | void;
  busy?: boolean;
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
  order, enrichment, remedies = {}, overrides = {}, onMove, onSaveDates, busy, flush, trackingSlot,
}: Props) {
  // ⚠ The modal keys this component on the order id, so switching groups
  // remounts it and these never carry one group's typing into another.
  const [prodStart, setProdStart] = useState(order.production_start_date ?? "");
  const [prodFinish, setProdFinish] = useState(order.production_est_finish_date ?? "");
  const [deliveryDate, setDeliveryDate] = useState(order.scheduled_delivery_date ?? "");
  const [saving, setSaving] = useState(false);
  /**
   * ⚠ THE FIELDS OPEN FROM A BUTTON. Two empty date boxes and an arrow sat in
   * the row permanently, so the commonest state of the slot -- nothing to type
   * -- was also its busiest. One button, same size as its neighbours, and the
   * fields replace the row when it is pressed.
   */
  const [openDate, setOpenDate] = useState<null | "production" | "delivery">(null);

  async function save(patch: DateFields) {
    setSaving(true);
    try { await onSaveDates(patch); setOpenDate(null); } finally { setSaving(false); }
  }

  const requirements = requirementsFor(order);
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
    && (prodDemanded
        || (prodIsRecordOnly
            && !(order.production_start_date && order.production_est_finish_date)));

  const deliveryDemanded = outstanding.some((o) => o.req.id === "delivery_date");
  const deliveryIsRecordOnly = !requirements.some((r) => r.id === "delivery_date");
  const needsDeliveryDate = controls.includes("delivery")
    && (deliveryDemanded || (deliveryIsRecordOnly && !order.scheduled_delivery_date));

  /**
   * ⚠ THE FIELD IS THE ACTION on two transitions, and there the button is
   * withheld rather than disabled -- see the header. Shipped never gets one;
   * Entered gets one only once the date is already on the row.
   */
  const recordNote = (needsProdDates && prodIsRecordOnly && RECORD_ONLY_NOTE.production)
    || (needsDeliveryDate && deliveryIsRecordOnly && RECORD_ONLY_NOTE.delivery)
    || null;

  const trackingIsTheAction = next === "Shipped";
  const datesAreTheAction = order.stage === "Entered" && next === "In production";
  const showMoveButton = !!next && !trackingIsTheAction && !(datesAreTheAction && !ready);

  /**
   * Phrased as the GOAL and its condition — "Move to Delivered once a signed
   * proof of delivery is recorded" — rather than as an instruction. The
   * instruction is the remedy, and it sits on the row it belongs to, because
   * with two outstanding requirements there are two instructions and only one
   * headline.
   */
  const headline = !next
    ? "Nothing further \u2014 this is the last stage."
    : trackingIsTheAction
      ? "Enter the tracking number to mark this shipped."
      : datesAreTheAction && !ready
        ? "Set the production dates to move this to In production."
        : ready
          ? `Ready to move to ${next}.`
          : `Move to ${next} once ${listOf(blocking.map((o) => o.req.label))} `
            + `${blocking.length === 1 ? "is" : "are"} recorded.`;

  return (
    <div className="px-5 py-4" style={flush ? undefined : { borderLeft: HAIRLINE }}>
      {/* ⚠ THE OVERRIDE LIVES ON THE TITLE ROW, at the far edge, not stacked on
          the move button. Stacked, the exception had the same size and weight
          as the path and sat directly on top of it, so the pair read as two
          equal choices. Up here it is available without being offered. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(184,130,106,0.18)", border: "0.5px solid rgba(184,130,106,0.40)" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "#d9a888" }} />
          </span>
          <p className={TITLE}>Next action</p>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {showMoveButton && !ready && outstanding.map(({ req }) => {
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

      <p className={BODY + " mt-2"}>{headline}</p>
      {recordNote && (
        <p className={NOTE + " mt-0.5"}>{recordNote}</p>
      )}

      {/* Checklist left, controls right, bottom-aligned so the move button
          sits on the same line as the last requirement. */}
      <div className="mt-3 flex items-end justify-between gap-5 flex-wrap">
      {rows.length > 0 ? (
        <ul className="space-y-1.5 min-w-0">
          {rows.map(({ req, state }) => (
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
      ) : <span />}

      {/* ⚠ A COLUMN OF ROWS, NOT ONE WRAPPING ROW. Five controls in a single
          flex-wrap line broke wherever the width happened to run out, which
          put the override beside the move on one screen and under an upload
          button on the next. The fields take a row of their own while open. */}
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {openDate === "production" && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)}
              title="Production starts" aria-label="Production start date" autoFocus style={DATE_INPUT} />
            <span className="text-cream/30 text-[11px]">&rarr;</span>
            <input type="date" value={prodFinish} onChange={(e) => setProdFinish(e.target.value)}
              title="Estimated finish" aria-label="Estimated finish date" style={DATE_INPUT} />
            {/* ⚠ BOTH DATES, THOUGH ONLY THE START ONE GATES. The start date
                advances the row; the estimated finish is what
                `production-complete` later advances ON, so a row saved with
                only a start date would move to In production and then strand.
                Asking for both here is the difference between one trip and
                two. */}
            <button
              onClick={() => save({ production_start_date: prodStart || null,
                                    production_est_finish_date: prodFinish || null })}
              disabled={saving || !prodStart}
              title={prodStart
                ? (datesAreTheAction ? "Save the dates and move to In production" : "Save the production dates")
                : "A production start date is what advances the order"}
              className={PILL_QUIET}
            >
              {saving ? "\u2026" : "Save"}
            </button>
            <button onClick={() => setOpenDate(null)} disabled={saving}
              className={PILL + " text-cream/45 hover:text-cream/75"}>
              Cancel
            </button>
          </div>
        )}

        {openDate === "delivery" && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
              title="Delivery date" aria-label="Delivery date" autoFocus style={DATE_INPUT} />
            <button
              onClick={() => save({ scheduled_delivery_date: deliveryDate || null })}
              disabled={saving || !deliveryDate}
              className={PILL_QUIET}
            >
              {saving ? "\u2026" : "Save"}
            </button>
            <button onClick={() => setOpenDate(null)} disabled={saving}
              className={PILL + " text-cream/45 hover:text-cream/75"}>
              Cancel
            </button>
          </div>
        )}

        <div className="flex items-end gap-1.5 flex-wrap justify-end">
          {trackingSlot}

          {needsProdDates && openDate !== "production" && (
            <button onClick={() => setOpenDate("production")} className={PILL_QUIET}>
              <Calendar className="w-3 h-3" /> Set production dates
            </button>
          )}

          {needsDeliveryDate && openDate !== "delivery" && (
            <button onClick={() => setOpenDate("delivery")} className={PILL_QUIET}>
              <Calendar className="w-3 h-3" /> Set delivery date
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
              title={ready
                ? `Move to ${next}`
                : blocking.map((o) => capitalise(o.req.label)).join(", ") + " outstanding"}
              className={PILL}
              style={ready ? PILL_MOVE : PILL_MOVE_WAITING}
            >
              <Check className="w-3.5 h-3.5" /> {busy ? "\u2026" : `Move to ${next}`}
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
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
