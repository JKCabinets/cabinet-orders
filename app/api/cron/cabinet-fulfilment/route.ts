import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { verifyCronAuth } from "@/lib/cronAuth";
import { activityDate, type Order, type SkuItem } from "@/lib/data";
import { formatMDY, arizonaToday } from "@/lib/dates";
import { productionAutoAdvanceSkip } from "@/lib/autoAdvance";
import { dueFulfilments, FULFIL_STAGES, lineVendor, lineShipped, lineKeyOf, type DueUnit, type ShipGroup } from "@/lib/shipDates";
import { readFulfilmentOrders, planFulfilment, createFulfilment, type FoLine, type PlanLine } from "@/lib/shopifyFulfil";

/**
 * GET /api/cron/cabinet-fulfilment -- 15:00 UTC (8:00 a.m. Arizona) daily.
 *
 * Feature 9 phase 1 (2026-10-29): marks each cabinet vendor's lines fulfilled
 * in Shopify on its ship date, and each backordered line on its own, so
 * Shopify sends its shipping confirmation. Production-complete has moved the
 * group to At cross dock at 1 a.m.; this runs after it.
 *
 * Garrett's rules (docs/SESSION-HANDOFF-2026-10-29.md §4; rulings 2026-10-29):
 *   - due when the ship date is today or earlier, ARIZONA'S day, and on or
 *     after the start day the migration recorded -- nothing earlier;
 *   - only at In production and At cross dock, an allowlist; any other stage,
 *     and a purchase on hold or archived, is SKIPPED and the skip recorded once
 *     per group and reason -- a record of the note, never a block: the day the
 *     group qualifies, the next run marks it;
 *   - by Shopify line id; by variant id only where unambiguous, else that
 *     vendor is skipped for the order and why is recorded;
 *   - NEVER TWICE: an attempt is claimed in shopify_fulfilments before
 *     Shopify is asked, and an unsettled one is settled from what Shopify
 *     holds, never by sending again.
 *
 * ⚠ IT DOES NOT LIE (OPERATIONS §6): any failure, and any work left unstarted
 * near run-cron.sh's 60 s limit, answers 500 -- the check alarms.
 */

const BUDGET_MS = 40_000;

type Rec = { id: number; order_id: string; scope: string; scope_key: string; outcome: string; attempts: number };
type Row = Order & { project_id: string | null };

const STAGE_SENTENCE = "Once it reaches In production with the date passed, the next run marks it shipped, so set the real ship date when moving it.";

function what(u: DueUnit, g: ShipGroup): string {
  return u.scope === "vendor" ? `${u.vendor}'s lines` : `${(g.sku_items ?? [])[u.index]?.sku || "A backordered line"} (${u.vendor})`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const today = arizonaToday();
  const report = {
    today, starts_on: null as string | null,
    fulfilled: [] as string[], already_in_shopify: [] as string[], skipped: [] as string[],
    failed: [] as string[], not_started: [] as string[], warnings: [] as string[],
  };
  const fail = (msg: string) => NextResponse.json({ ...report, error: msg }, { status: 500 });

  // ── The start day: without one, nothing is marked (the migration writes it) ──
  const { data: start, error: startErr } = await supabase.from("cabinet_fulfilment_start").select("starts_on").maybeSingle();
  if (startErr) return fail(`could not read the start day: ${startErr.message}`);
  if (!start?.starts_on) return fail("no start day recorded (cabinet_fulfilment_start): nothing was marked");
  report.starts_on = String(start.starts_on);

  // ── Every cabinet group with a ship date. Not filtered by date: a mixed
  // group's FIRST vendor ships before the group's (latest) date. ──
  const groups: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from("orders").select("*")
      .eq("type", "order").not("production_est_finish_date", "is", null)
      .order("id", { ascending: true }).range(from, from + 499);
    if (error) return fail(`could not read the orders: ${error.message}`);
    groups.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 500) break;
  }
  const work = groups.map((g) => ({ g, units: dueFulfilments(g, today) })).filter((w) => w.units.length > 0);
  if (work.length === 0) return NextResponse.json(report);

  const projectIds = [...new Set(work.map((w) => w.g.project_id).filter((x): x is string => !!x))];
  const projects = new Map<string, Record<string, unknown>>();
  if (projectIds.length) {
    const { data, error } = await supabase.from("projects").select("*").in("id", projectIds);
    if (error) return fail(`could not read the purchases: ${error.message}`);
    for (const p of data ?? []) projects.set(String(p.id), p);
  }
  const { data: recRows, error: recErr } = await supabase.from("shopify_fulfilments")
    .select("id, order_id, scope, scope_key, outcome, attempts").in("order_id", work.map((w) => w.g.id));
  if (recErr) return fail(`could not read the fulfilment record: ${recErr.message}`);
  const records = (recRows ?? []) as Rec[];
  const recordOf = (orderId: string, scope: string, key: string) =>
    records.find((r) => r.order_id === orderId && r.scope === scope && r.scope_key === key);

  const note = async (orderId: string, text: string) => {
    const { error } = await supabase.from("order_activity").insert({ order_id: orderId, text, time: activityDate() });
    if (error) report.warnings.push(`${orderId}: the activity line was not written (${error.message})`);
  };
  /** A skip, recorded ONCE per group and reason; its note written the first time only. */
  const skipOnce = async (g: Row, reason: string, date: string, text: string) => {
    report.skipped.push(`${g.id}: ${reason}`);
    if (recordOf(g.id, "skip", reason)) return;
    const { error } = await supabase.from("shopify_fulfilments").insert({
      order_id: g.id, scope: "skip", scope_key: reason, ship_date: date, outcome: "skipped",
      reason: text, settled_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") { report.failed.push(`${g.id}: could not record the skip ${reason} (${error.message})`); return; }
    if (!error) await note(g.id, text);
  };

  for (const { g, units: allUnits } of work) {
    if (Date.now() - started > BUDGET_MS) { report.not_started.push(g.id); continue; }

    // ── Before the start day: never marked (Garrett), said once ──
    const early = allUnits.filter((u) => u.date < report.starts_on!);
    const units = allUnits.filter((u) => u.date >= report.starts_on!);
    if (early.length) {
      await skipOnce(g, "before_start", early[0].date,
        `Not marked shipped in Shopify: ${what(early[0], g)} came due on ${formatMDY(early[0].date)}, before the OMS began marking shipments (${formatMDY(report.starts_on)}). If it has not shipped, set the real ship date.`);
    }
    if (units.length === 0) continue;

    // ── The stage: an allowlist ──
    if (!FULFIL_STAGES.includes(g.stage)) {
      await skipOnce(g, `stage:${g.stage}`, units[0].date,
        `Not marked shipped in Shopify: ${what(units[0], g)} came due on ${formatMDY(units[0].date)} with the order at ${g.stage}. ${STAGE_SENTENCE}`);
      continue;
    }
    // ── The purchase: lib/autoAdvance's rule, as production-complete's ──
    const project = g.project_id ? (projects.get(g.project_id) ?? null) : null;
    const stop = productionAutoAdvanceSkip(g, project as Parameters<typeof productionAutoAdvanceSkip>[1]);
    if (stop === "project_unavailable" || !project?.shopify_id) {
      report.failed.push(`${g.id}: its purchase or Shopify order could not be found`); continue;
    }
    if (stop) {
      await skipOnce(g, stop, units[0].date, stop === "payment_hold"
        ? `Not marked shipped in Shopify: the purchase is on payment hold. Once the hold is cleared, the next run marks it shipped.`
        : `Not marked shipped in Shopify: the purchase is archived.`);
      continue;
    }

    // ── What Shopify holds: read once per group ──
    let fo: FoLine[];
    try { fo = await readFulfilmentOrders(String(project.shopify_id)); }
    catch (e) { report.failed.push(`${g.id}: could not read Shopify (${e instanceof Error ? e.message : String(e)})`); continue; }

    const items: SkuItem[] = g.sku_items ?? [];
    for (const u of units) {
      if (Date.now() - started > BUDGET_MS) { report.not_started.push(`${g.id} ${u.scope === "vendor" ? u.vendor : u.key}`); continue; }
      const scopeKey = u.scope === "vendor" ? u.vendor : u.key;
      if (!scopeKey) {
        await skipOnce(g, `unnamed:${u.scope === "line" ? u.index : u.vendor}`, u.date,
          `Not marked shipped in Shopify: ${what(u, g)} has no Shopify line id or variant to find it by. Mark it shipped in Shopify by hand.`);
        continue;
      }
      const label = `${g.id} ${what(u, g)}`;
      const unitLines: PlanLine[] = (u.scope === "vendor" ? u.lines : [{ index: u.index, key: u.key }])
        .map(({ index, key }) => ({ index, key, line: items[index] }));
      const vendorOpen: PlanLine[] = items.map((line, index) => ({ index, key: lineKeyOf(line), line }))
        .filter((p) => lineVendor(p.line, g) === u.vendor && !lineShipped(g, p.line));
      const plan = planFulfilment(u.vendor, unitLines, vendorOpen, fo);
      if (!plan.ok) {
        if (plan.kind === "ambiguous") {
          await skipOnce(g, `ambiguous:${u.vendor}`, u.date,
            `Not marked shipped in Shopify: ${plan.reason}. ${u.vendor}'s lines are left for now; they are marked once Shopify's next update gives them their line ids, or mark them shipped in Shopify by hand.`);
        } else {
          // ⚠ ON THE ORDER, ONCE (2026-11-02): a line missing from Shopify, or a
          // fulfilment order Shopify will not take (on hold there), needs a person
          // -- recorded as the unit's failure, said once; the next run retries.
          report.failed.push(`${label}: ${plan.reason}`);
          if (!recordOf(g.id, u.scope, scopeKey)) {
            const { error } = await supabase.from("shopify_fulfilments").insert({
              order_id: g.id, scope: u.scope, scope_key: scopeKey, ship_date: u.date, outcome: "failed",
              reason: plan.reason, settled_at: new Date().toISOString(),
            });
            if (error && error.code !== "23505") report.warnings.push(`${label}: the failure was not recorded (${error.message})`);
            if (!error) await note(g.id, `${what(u, g)} could not be marked shipped in Shopify: ${plan.reason}. The next run tries again.`);
          }
        }
        continue;
      }

      // ── Claim the attempt BEFORE asking Shopify ──
      const prior = recordOf(g.id, u.scope, scopeKey);
      let recId: number;
      if (!prior) {
        const { data: ins, error } = await supabase.from("shopify_fulfilments").insert({
          order_id: g.id, scope: u.scope, scope_key: scopeKey, ship_date: u.date, outcome: "pending", lines: plan.lines,
        }).select("id").single();
        if (error) {
          if (error.code === "23505") { report.skipped.push(`${label}: another run has it`); continue; }
          report.failed.push(`${label}: could not record the attempt (${error.message})`); continue;
        }
        recId = Number(ins.id);
      } else if (prior.outcome === "fulfilled") {
        // Recorded but not on the row: the copy is the database's own, so this
        // cannot happen without a fault worth seeing.
        report.failed.push(`${label}: recorded fulfilled, yet due again -- check shipped_in_shopify`); continue;
      } else {
        const { data: claimed, error } = await supabase.from("shopify_fulfilments")
          .update({ outcome: "pending", settled_at: null, attempts: prior.attempts + 1, lines: plan.lines })
          .eq("id", prior.id).eq("outcome", prior.outcome).eq("attempts", prior.attempts).select("id");
        if (error) { report.failed.push(`${label}: could not claim the retry (${error.message})`); continue; }
        if ((claimed ?? []).length !== 1) { report.skipped.push(`${label}: another run has it`); continue; }
        recId = prior.id;
      }

      // ── Already fulfilled in Shopify (by hand, or an earlier answer lost) ──
      if (plan.pairs.length === 0) {
        // An attempt left pending was OURS, its answer lost: settled from Shopify.
        const ours = prior?.outcome === "pending";
        const { error } = await supabase.from("shopify_fulfilments").update({
          outcome: "fulfilled", fulfilled_by: ours ? "run" : "shopify", settled_at: new Date().toISOString(),
          reason: ours ? "settled from Shopify: the lines were fulfilled (the earlier attempt's answer was lost)"
                       : "Shopify already showed these lines fulfilled; nothing was sent",
        }).eq("id", recId);
        if (error) { report.failed.push(`${label}: could not record it (${error.message})`); continue; }
        report.already_in_shopify.push(label);
        await note(g.id, ours
          ? `${what(u, g)} marked shipped in Shopify (confirmed from Shopify after an earlier answer was lost).`
          : `${what(u, g)}: Shopify already showed them fulfilled, so the OMS sent nothing; recorded as shipped.`);
        continue;
      }

      const res = await createFulfilment(plan.pairs);
      if (res.ok) {
        const { error } = await supabase.from("shopify_fulfilments").update({
          outcome: "fulfilled", shopify_fulfillment_id: res.fulfillmentId, settled_at: new Date().toISOString(),
        }).eq("id", recId);
        if (error) { report.failed.push(`${label}: FULFILLED in Shopify (${res.fulfillmentId}) but not recorded (${error.message}) -- the next run settles it from Shopify`); continue; }
        report.fulfilled.push(label);
        await note(g.id, u.scope === "vendor"
          ? `${u.vendor}'s lines marked shipped in Shopify; Shopify emailed the customer its shipping confirmation.`
          : `${what(u, g)} marked shipped in Shopify (it was backordered); Shopify emailed the customer.`);
      } else if (res.definite) {
        const { error } = await supabase.from("shopify_fulfilments").update({ outcome: "failed", reason: res.reason, settled_at: new Date().toISOString() }).eq("id", recId);
        if (error) report.warnings.push(`${label}: the failure was not recorded (${error.message}); the attempt stays pending`);
        report.failed.push(`${label}: ${res.reason}`);
        if (!prior) await note(g.id, `${what(u, g)} could not be marked shipped in Shopify: ${res.reason}. The next run tries again.`);
      } else {
        // No answer: it may have been made. Left PENDING, settled next run from Shopify.
        report.failed.push(`${label}: no answer from Shopify (${res.reason}); left pending, settled from Shopify next run`);
      }
    }
  }

  const status = report.failed.length || report.not_started.length || report.warnings.length ? 500 : 200;
  return NextResponse.json(report, { status });
}
