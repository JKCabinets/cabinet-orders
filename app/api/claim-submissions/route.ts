import { NextRequest, NextResponse } from "next/server";
import { requireAuth, rateLimitOr429, cleanInput } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { CLAIM_TYPES, checkClaimPhotos, normaliseOrderNumber, storeClaimPhotos } from "@/lib/claimIntake";
import { getConversation, helpScoutConfigured, mailboxId } from "@/lib/helpscout";
import { pushClaims } from "@/lib/claimHelpScout";

/**
 * GET /api/claim-submissions — the triage queue.
 *
 * ⚠ ITS OWN FETCH, NOT PART OF THE STORE. claim_submissions is not a view over
 *   `orders`, so it cannot ride the store's realtime channel or its shape.
 *   These are reports awaiting a decision, not rows in a flow.
 *
 * Until this existed, POST /api/public/claims wrote to a table nothing read.
 */

const STATUSES = new Set(["new", "promoted", "rejected"]);

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 60, 60_000, "claim-submissions:get");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "new";
  if (!STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 422 },
    );
  }

  // ⚠ EXPLICIT COLUMNS, NOT `*`. Every route on this box runs as the service
  // role, so the select list is the only thing deciding what leaves the
  // database. `*` would also survive a future column being added without
  // anyone deciding it should be readable here.
  const { data, error } = await supabase
    .from("claim_submissions")
    .select(
      // ref and screening added 2026-10-01 -- by name, like everything else here.
      // helpscout_* added 2026-10-05, by name like everything else here.
      // claimed_by and claimed_at added 2026-10-06.
      // source, entered_by and email_conversation_id added 2026-10-06.
      "id, ref, source, entered_by, email_conversation_id, claimed_by, claimed_at, screening, screening_value, received_at, order_number_raw, order_number, delivered_on, claim_type, claimant_name, claimant_email, claimant_phone, message, policy_version, photo_paths, status, promoted_to_order_id, promoted_at, promoted_by, review_notes, helpscout_state, helpscout_conversation_id, helpscout_url, helpscout_attempts, helpscout_last_error",
    )
    .eq("status", status)
    .order("received_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Which groups could each submission be about? The customer typed an order
  // number, which resolves to a PROJECT; a claim is about a GROUP. Resolving
  // the candidates here means the triage screen can offer a choice rather than
  // making the person look each one up by hand.
  const references = [...new Set(
    rows.map((r) => r.order_number).filter((v): v is string => !!v),
  )];

  let groupsByProject: Record<string, { id: string; type: string; stage: string; delivery_date: string | null }[]> = {};
  if (references.length > 0) {
    const { data: groups } = await supabase
      .from("orders")
      .select("id, type, stage, delivery_date, project_id")
      .in("project_id", references);

    groupsByProject = (groups ?? []).reduce((acc, g) => {
      const key = g.project_id as string;
      (acc[key] ??= []).push({
        id: g.id as string,
        type: g.type as string,
        stage: g.stage as string,
        delivery_date: (g.delivery_date as string | null) ?? null,
      });
      return acc;
    }, {} as typeof groupsByProject);
  }

  // ── Photos ───────────────────────────────────────────────────────────────
  //
  // ⚠ SIGNED URLS, MINTED HERE. The claim-photos bucket is private and has no
  // storage policies, so only the service role can read it -- which is the
  // point: these are photographs of somebody's home, submitted before anyone
  // has verified who they are. A raw path is useless to the browser, so the
  // review screen would show nothing and the person completing a damage claim
  // would be judging it blind.
  //
  // One hour. Long enough to work a queue, short enough that a URL pasted into
  // a chat stops working.
  const signedByPath = new Map<string, string>();
  const allPaths = rows.flatMap((r) => (Array.isArray(r.photo_paths) ? r.photo_paths : []));
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("claim-photos")
      .createSignedUrls(allPaths as string[], 3600);
    for (const entry of signed ?? []) {
      // A failed entry carries an error and no signedUrl. Skipped rather than
      // faked: a broken image is clearer than a link that goes nowhere.
      if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
    }
  }

  return NextResponse.json({
    data: rows.map((r) => ({
      ...r,
      photos: (Array.isArray(r.photo_paths) ? r.photo_paths : [])
        .map((path: string) => ({ path, url: signedByPath.get(path) ?? null })),
      // Empty when the typed number matched nothing. That is a real state, not
      // an error: the person promoting picks the group by hand and the raw
      // string is right there to work from.
      candidate_groups: r.order_number ? (groupsByProject[r.order_number] ?? []) : [],
    })),
  });
}

/** The conversation's id from its Help Scout link: .../conversation/{id}/{number}. */
function conversationIdFrom(link: string): number | null {
  const m = /helpscout\.net\/conversation\/(\d{1,18})(?:[/?#]|$)/.exec(link.trim());
  const id = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * "2026-10-06T14:05", read as ARIZONA time. Arizona keeps no daylight saving,
 * so it is UTC-7 every day of the year and the conversion is exact.
 */
function arizonaToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h + 7, mi));
  // Rejects a date that rolled over (Feb 30) by checking it reads back the same.
  const back = new Date(t.getTime() - 7 * 3600_000);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

/**
 * POST /api/claim-submissions -- a claim that arrived by EMAIL, entered by staff
 * (2026-10-06). Multipart: conversation (its Help Scout link), name, email,
 * phone, order_number, claim_type, delivered_on, email_received (Arizona time,
 * "YYYY-MM-DDTHH:MM"), message, photos.
 *
 * ⚠ ENTERED BY HAND, ON PURPOSE (Garrett, 2026-10-06): nothing is read out of
 * the email. Help Scout is asked one thing -- is this a real conversation in
 * our inbox -- because the push will adopt it.
 *
 * ⚠ THE REPORT DATE IS WHEN THE EMAIL ARRIVED, AS ENTERED. The claim is judged
 * against it (Terms 12.3; an email inside the window counts). It cannot be in
 * the future, and the submission records who entered it.
 *
 * ⚠ ONE CLAIM PER CONVERSATION -- a unique index, so a second entry of the same
 * email is refused by the database. Photos: JPEG or PNG, checked and scrubbed
 * exactly as the public form's (lib/claimIntake). The entry is claimed by
 * whoever made it, through claim_submission(), as any claim is.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const limited = await rateLimitOr429(req, 20, 60_000, "claim-submissions:enter");
  if (limited) return limited;

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Invalid form" }, { status: 400 }); }
  const field = (k: string, max = 200) => {
    const v = form.get(k);
    return typeof v === "string" ? cleanInput(v.slice(0, max)) : "";
  };
  const refuse = (message: string, status = 422) => NextResponse.json({ error: message }, { status });

  const conversationId = conversationIdFrom(field("conversation", 300));
  if (!conversationId) return refuse("Paste the conversation's link from Help Scout's address bar (https://secure.helpscout.net/conversation/...).");
  const name = field("name");
  const email = field("email");
  const claimType = field("claim_type", 32).toLowerCase();
  const orderNumberRaw = field("order_number");
  if (!name || !email || !orderNumberRaw || !CLAIM_TYPES.has(claimType)) {
    return refuse("Give the customer's name, their email, the order number and the type of claim.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refuse("That email address does not look complete.");
  const received = arizonaToUtc(field("email_received", 32));
  if (!received) return refuse("Give the date and time the customer's email arrived (Arizona time).");
  if (received.getTime() > Date.now() + 5 * 60_000) return refuse("When the email arrived cannot be in the future.");
  if (received.getUTCFullYear() < 2020) return refuse("When the email arrived looks wrong: check the year.");
  const deliveredOnRaw = field("delivered_on", 32);
  const deliveredOn = /^\d{4}-\d{2}-\d{2}$/.test(deliveredOnRaw) ? deliveredOnRaw : null;
  const message = field("message", 1000);
  const phone = field("phone");

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const checked = await checkClaimPhotos(files);
  if (!checked.ok) return refuse(checked.error, checked.status);

  // The one thing asked of Help Scout: is it a real conversation, in our inbox.
  if (!helpScoutConfigured()) return refuse("Help Scout is not configured, so the conversation cannot be checked.", 503);
  let conv;
  try { conv = await getConversation(conversationId); }
  catch (e) { return refuse(`Help Scout did not answer: ${(e as Error).message}. Try again in a minute.`, 502); }
  if (!conv) return refuse("Help Scout has no conversation at that link.");
  if (conv.mailboxId !== mailboxId()) return refuse("That conversation is not in the JK Cabinets 2 You inbox.");

  const { data: existing } = await supabase
    .from("claim_submissions").select("ref").eq("email_conversation_id", conv.id).maybeSingle();
  if (existing) return refuse(`That email already has a claim: ${existing.ref}.`, 409);

  const { data: row, error } = await supabase
    .from("claim_submissions")
    .insert({
      order_number_raw: orderNumberRaw,
      order_number: normaliseOrderNumber(orderNumberRaw),
      delivered_on: deliveredOn,
      claim_type: claimType,
      claimant_name: name,
      claimant_email: email,
      claimant_phone: phone || null,
      message: message || null,
      received_at: received.toISOString(),
      source: "email",
      entered_by: auth.session.user.username,
      // As it is NOW in Help Scout -- a merged conversation answers with its new id.
      email_conversation_id: conv.id,
    })
    .select("id, ref")
    .single();
  if (error || !row) {
    // The unique index: another entry of this email won the race.
    if ((error as { code?: string } | null)?.code === "23505") return refuse("That email already has a claim.", 409);
    return refuse(`The claim could not be recorded: ${error?.message ?? "no row"}`, 500);
  }

  await supabase.rpc("claim_submission", { p_id: row.id, p_user: auth.session.user.id });
  const { failed } = await storeClaimPhotos(row.id, checked.photos);
  // Adopt the conversation, without holding the person entering it.
  pushClaims({ id: row.id }).catch((e) => console.error(`[helpscout] ${row.ref}: ${(e as Error).message}`));

  return NextResponse.json({ ref: row.ref, photos_failed: failed }, { status: 201 });
}
