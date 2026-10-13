import { NextRequest, NextResponse } from "next/server";
import { requireAuth, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { activityDate } from "@/lib/data";
import { CURRENT_CONSENT_WORDING } from "@/lib/consent";
import { conversationIdFrom, conversationUrl, arizonaToUtc } from "@/lib/helpscoutLinks";
import { getConversation, helpScoutConfigured, mailboxId } from "@/lib/helpscout";

/**
 * POST /api/projects/[id]/consent -- consent STAFF obtained by email (2026-10-13).
 *
 *   { "conversation": "<the Help Scout link>", "agreed_at": "2026-10-13T15:05" }
 *
 * An order that arrived without the website's terms consent is cleared here,
 * once the customer has agreed in writing in their Help Scout conversation --
 * the conversation IS the record (OPERATIONS). Recorded as source "email", the
 * current wording, with the conversation, who recorded it and when.
 *
 * ⚠ NEVER OVER CONSENT ALREADY THERE. The website's is the better evidence; a
 * purchase that has consent is refused, and the write is conditional on none.
 * ⚠ THE LINK IS CHECKED: a real conversation, in our inbox -- the same check an
 * emailed claim makes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const refuse = (message: string, status = 422, error = "invalid") => NextResponse.json({ error, message }, { status });

  let body: { conversation?: unknown; agreed_at?: unknown };
  try { body = await req.json(); } catch { return refuse("Send the conversation and when they agreed.", 400, "invalid_json"); }
  const conversationId = conversationIdFrom(cleanInput(String(body.conversation ?? "").slice(0, 300)));
  if (!conversationId) return refuse("Paste the conversation's link from Help Scout's address bar (https://secure.helpscout.net/conversation/...).");
  const agreed = arizonaToUtc(cleanInput(String(body.agreed_at ?? "").slice(0, 32)));
  if (!agreed) return refuse("Give the date and time the customer's reply arrived (Arizona time).");
  if (agreed.getTime() > Date.now() + 5 * 60_000) return refuse("When they agreed cannot be in the future.");
  if (agreed.getUTCFullYear() < 2020) return refuse("When they agreed looks wrong: check the year.");

  const { data: project } = await supabase
    .from("projects").select("id, terms_agreed").eq("id", id).maybeSingle();
  if (!project) return refuse("Purchase not found", 404, "not_found");
  if (project.terms_agreed) return refuse("This purchase already has its customer's consent.", 409, "already_recorded");

  if (!helpScoutConfigured()) return refuse("Help Scout is not configured, so the conversation cannot be checked.", 503, "helpscout_unavailable");
  let conv;
  try { conv = await getConversation(conversationId); }
  catch (e) { return refuse(`Help Scout did not answer: ${(e as Error).message}. Try again in a minute.`, 502, "helpscout_unavailable"); }
  if (!conv) return refuse("Help Scout has no conversation at that link.");
  if (conv.mailboxId !== mailboxId()) return refuse("That conversation is not in the JK Cabinets 2 You inbox.");

  const who = auth.session.user.name || auth.session.user.username;
  const evidence = conversationUrl(conversationId);
  const { data: rows, error } = await supabase
    .from("projects")
    .update({
      terms_agreed: agreed.toISOString(),
      terms_version: null,
      consent_wording: CURRENT_CONSENT_WORDING,
      consent_source: "email",
      consent_evidence: evidence,
      consent_recorded_by: who,
      consent_recorded_at: new Date().toISOString(),
    })
    .eq("id", id).is("terms_agreed", null)
    .select("*");
  if (error) return refuse(error.message, 500, "save_failed");
  if (!rows || rows.length === 0) return refuse("Consent was recorded for this purchase a moment ago.", 409, "already_recorded");

  // On every group of the purchase, so whichever one is opened shows it.
  const { data: groups } = await supabase.from("orders").select("id").eq("project_id", id);
  if (groups && groups.length > 0) {
    await supabase.from("order_activity").insert(groups.map((g) => ({
      order_id: g.id,
      text: `Terms consent recorded by ${who}: the customer agreed by email (${evidence})`,
      time: activityDate(),
    })));
  }
  try {
    await supabase.from("audit_log").insert({
      event: "consent_recorded", username: auth.session.user.username,
      details: { project_id: id, conversation_id: conversationId, agreed_at: agreed.toISOString() },
    });
  } catch { /* non-critical */ }

  return NextResponse.json({ ok: true, data: rows[0] });
}
