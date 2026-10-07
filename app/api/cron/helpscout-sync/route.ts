import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cronAuth";
import { supabase } from "@/lib/supabase";
import { helpScoutConfigured } from "@/lib/helpscout";
import { pushClaims, pushClaimNotes } from "@/lib/claimHelpScout";

/**
 * GET /api/cron/helpscout-sync -- every 15 minutes, from the box's crontab
 * through run-cron.sh, monitored by the healthchecks.io check `helpscout-sync`
 * (2026-10-05).
 *
 * The claims route sends each claim to Help Scout the moment it is recorded.
 * This sends whatever that did not: Help Scout was down, the container
 * restarted mid-send, a call timed out. Without it, a claim that missed Help
 * Scout would stay missing until someone noticed.
 *
 * ⚠ IT FAILS (500, so the check alarms) WHEN A HUMAN IS NEEDED, NOT ON EVERY
 * HICCUP. One failed attempt is retried quietly. A claim still unsent after
 * four attempts -- about an hour -- is named in the answer, with the reason
 * Help Scout gave. So is Help Scout not being configured at all.
 */

const ALARM_AFTER_ATTEMPTS = 4;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!helpScoutConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Help Scout is not configured: HELPSCOUT_APP_ID, HELPSCOUT_APP_SECRET and HELPSCOUT_MAILBOX_ID must all be set. Claims are kept, pending." },
      { status: 500 },
    );
  }

  const results = await pushClaims({ limit: 20 });
  // A claim's progress (Help Scout part 2, 2026-10-07): every queued note --
  // any a stage move or a promotion did not send at once.
  const notes = await pushClaimNotes();
  const { data: stuckNotes } = await supabase
    .from("claim_helpscout_notes")
    .select("order_id, to_stage, attempts, last_error")
    .eq("state", "pending")
    .gte("attempts", ALARM_AFTER_ATTEMPTS);

  const { data: stuck, error } = await supabase
    .from("claim_submissions")
    .select("ref, helpscout_attempts, helpscout_last_error")
    .eq("helpscout_state", "pending")
    .gte("helpscout_attempts", ALARM_AFTER_ATTEMPTS);
  if (error) {
    return NextResponse.json({ ok: false, error: `could not read pending claims: ${error.message}` }, { status: 500 });
  }

  const detail = {
    sent: results.filter((r) => r.sent).map((r) => r.ref),
    retrying: results.filter((r) => !r.sent).map((r) => ({ ref: r.ref, error: r.error })),
    notes_sent: notes.filter((n) => n.outcome === "sent").map((n) => `${n.order_id} -> ${n.to_stage}`),
    notes_retrying: notes.filter((n) => n.outcome === "failed").map((n) => ({ claim: n.order_id, error: n.error })),
  };
  const problems = [
    ...(stuck ?? []).map((s) => `${s.ref}: not in Help Scout after ${s.helpscout_attempts} attempts. Last: ${s.helpscout_last_error ?? "no reason recorded"}`),
    ...(stuckNotes ?? []).map((s) => `${s.order_id}: the note for "${s.to_stage}" not in Help Scout after ${s.attempts} attempts. Last: ${s.last_error ?? "no reason recorded"}`),
  ];
  if (problems.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        problems,
        ...detail,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, ...detail });
}
