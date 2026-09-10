"use client";

import { useState } from "react";
import { Check, Upload } from "lucide-react";
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
const LABEL = "text-[10px] uppercase tracking-widest text-cream/45";

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
const RECORD_ONLY_CAPTION = "Recorded for scheduling \u2014 this will not move the order.";

const DATE_INPUT: React.CSSProperties = {
  background: "rgba(255,255,255,0.10)",
  border: "0.5px solid rgba(255,255,255,0.18)",
  borderRadius: "999px",
  color: "#e8e3da",
  colorScheme: "dark",
  fontFamily: "inherit",
  fontSize: "11px",
  padding: "5px 10px",
};

const PILL = "px-3 py-1.5 rounded-full text-[10px] uppercase tracking-wider font-medium transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed";
const PILL_QUIET = PILL + " bg-white/4 border border-cream/18 text-cream/85 hover:bg-white/8";
const PILL_MOVE: React.CSSProperties = {
  background: "rgba(184,130,106,0.20)",
  border: "0.5px solid rgba(184,130,106,0.55)",
  color: "#d9a888",
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

  async function save(patch: DateFields) {
    setSaving(true);
    try { await onSaveDates(patch); } finally { setSaving(false); }
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
    <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap"
      style={flush ? undefined : { borderLeft: HAIRLINE }}>
      {/* Text and checklist on the left, controls on the right -- the shape of
          the mockup and of the cell this replaced. The control column wraps
          under the text when the date fields need the width. */}
      <div className="min-w-0 flex-1">
      <p className={LABEL + " mb-1"}>Next action</p>
      <p className="text-[11px] text-cream/65 leading-snug">{headline}</p>

      {rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map(({ req, state }) => (
            <li key={req.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0 mt-[1px] flex items-center justify-center"
                style={state === "met"
                  ? { background: "rgba(160,204,122,0.20)", border: "0.5px solid #a0cc7a" }
                  : { border: "0.5px solid rgba(232,227,218,0.30)" }}
              >
                {state === "met" && <Check className="w-2 h-2" style={{ color: "#a0cc7a" }} />}
              </span>
              <span style={{ color: state === "met" ? "#a0cc7a" : "rgba(232,227,218,0.65)" }}>
                {capitalise(req.label)}
                {state !== "met" && (
                  <span className="block text-cream/35">{req.remedy}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      </div>

      <div className="flex items-center gap-1.5 flex-wrap justify-end flex-shrink-0 max-w-full">
        {trackingSlot}

        {/* ⚠ BOTH DATES, THOUGH ONLY THE START ONE GATES. The start date
            advances the row; the estimated finish is what `production-complete`
            later advances ON, so a row saved with only a start date would move
            to In production and then strand. Asking for both here is the
            difference between one trip and two. Rendered at In production too,
            for the row that got there by an admin move without them. */}
        {needsProdDates && (
          <div className="flex flex-col gap-1 items-end">
            {prodIsRecordOnly && (
              <span className="text-[10px] text-cream/40 leading-snug">{RECORD_ONLY_CAPTION}</span>
            )}
          <div className="flex items-center gap-1.5 flex-wrap">
            <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)}
              title="Production starts" style={DATE_INPUT} />
            <span className="text-cream/30 text-[11px]">&rarr;</span>
            <input type="date" value={prodFinish} onChange={(e) => setProdFinish(e.target.value)}
              title="Estimated finish" style={DATE_INPUT} />
            <button
              onClick={() => save({ production_start_date: prodStart || null,
                                    production_est_finish_date: prodFinish || null })}
              disabled={saving || !prodStart}
              title={!prodStart
                ? "A production start date is what advances the order"
                : datesAreTheAction
                  ? "Save the dates and move to In production"
                  : "Save the production dates"}
              className={PILL_QUIET}
            >
              {saving ? "\u2026" : "Set dates"}
            </button>
          </div>
          </div>
        )}

        {needsDeliveryDate && (
          <div className="flex flex-col gap-1 items-end">
            {deliveryIsRecordOnly && (
              <span className="text-[10px] text-cream/40 leading-snug">{RECORD_ONLY_CAPTION}</span>
            )}
          <div className="flex items-center gap-1.5">
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)}
              title="Delivery date" style={DATE_INPUT} />
            <button
              onClick={() => save({ scheduled_delivery_date: deliveryDate || null })}
              disabled={saving || !deliveryDate}
              className={PILL_QUIET}
            >
              {saving ? "\u2026" : "Set delivery date"}
            </button>
          </div>
          </div>
        )}

        {outstanding.map(({ req }) => {
          const remedy = remedies[req.id];
          if (!remedy) return null;
          return (
            <button
              key={req.id}
              onClick={remedy.onClick}
              title={req.remedy}
              className={PILL_QUIET + " flex items-center gap-1.5 hover:border-terracotta/40"}
            >
              <Upload className="w-3 h-3" /> {remedy.label}
            </button>
          );
        })}

        {/* ⚠ DISABLED UNTIL EVERY GATING REQUIREMENT IS MET, and every gating
            requirement is one the SERVER also checks. A button that fails on
            click is a requirement nobody was told about -- which is how the
            Entered gate spent a day refusing the request that satisfied it. */}
        {showMoveButton && (
          <button
            onClick={() => onMove(next!)}
            disabled={busy || !ready}
            title={ready
              ? `Move to ${next}`
              : blocking.map((o) => capitalise(o.req.label)).join(", ") + " outstanding"}
            className={PILL}
            style={PILL_MOVE}
          >
            {busy ? "\u2026" : `Move to ${next}`}
          </button>
        )}

        {/* The override sits AFTER the move it overrides, and only while the
            gate is closed. Quiet styling: it is the exception, not the path. */}
        {showMoveButton && !ready && outstanding.map(({ req }) => {
          const override = overrides[req.id];
          if (!override) return null;
          return (
            <button
              key={"override:" + req.id}
              onClick={override.onClick}
              disabled={busy}
              className={PILL + " bg-white/6 border border-cream/20 text-cream/75 hover:bg-white/10"}
            >
              {override.label}
            </button>
          );
        })}
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
