import { supabase } from "@/lib/supabase";
import { CLAIM_TYPE_LABEL } from "@/lib/customerFacing";
import {
  addNote, createConversation, customerThreadId, findConversationByRef, getConversation,
  helpScoutConfigured, HelpScoutError, mailboxId, setSubject, setTags, uploadAttachment,
  type Conversation,
} from "@/lib/helpscout";

/**
 * A recorded claim, sent to Help Scout as a conversation (2026-10-05).
 *
 * ⚠ THE OMS FIRST, THEN HELP SCOUT -- never the other way round (Garrett,
 * 2026-10-05). The OMS is where a claim is checked by Turnstile, scrubbed of
 * location, stamped with the time it arrived (which the reporting windows run
 * from) and given its reference. Only then is it sent on. If Help Scout is
 * down, the claim is already safe; it waits here as `pending` and the retry
 * job (/api/cron/helpscout-sync) sends it.
 *
 * ⚠ THE CONVERSATION IS BUILT TO THE WEBSITE'S SPECIFICATION (their note of
 * 2026-10-05, items 3 to 6 and 8). Their Help Scout workflow sends the
 * customer's confirmation email -- the OMS sends nothing -- and it finds claim
 * conversations by one tag and replies once per conversation. So:
 *   - the tag `oms-claim`, on these conversations and no others
 *   - the subject `Claim received, reference CR-1003`; their confirmation tells
 *     the customer the reference is in the subject line
 *   - the customer as the conversation's customer, and the type `email`, so
 *     the reply goes to them
 *   - autoReply left off, or the inbox's own auto reply would be a second email
 *   - the form's own labels and plain punctuation wherever the customer can
 *     read claim text -- the first thread
 *
 * ⚠ NEVER TWO CONVERSATIONS FOR ONE CLAIM. A sender gets a claim only through
 * claim_helpscout_lease() (see the 2026-10-05 migration), and before creating
 * anything it searches the inbox for the reference: a conversation created by
 * an attempt that died before it could record the id is found, not repeated.
 */

export const CLAIM_TAG = "oms-claim";

export function claimSubject(ref: string): string {
  return `Claim received, reference ${ref}`;
}

/** The fields a push reads. claim_helpscout_lease() returns whole rows. */
export interface ClaimToSend {
  id: string;
  ref: string;
  received_at: string;
  order_number_raw: string;
  delivered_on: string | null;
  claim_type: string;
  claimant_name: string;
  claimant_email: string;
  claimant_phone: string | null;
  message: string | null;
  photo_paths: string[] | null;
  screening: string | null;
  screening_value: string | null;
  /** website | email (2026-10-06). An emailed claim adopts its conversation. */
  source?: string | null;
  entered_by?: string | null;
  email_conversation_id?: number | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Help Scout takes 1 to 40 characters for each, or neither. */
export function nameParts(full: string): { firstName?: string; lastName?: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  const first = words[0].slice(0, 40);
  const last = words.slice(1).join(" ").slice(0, 40);
  return last ? { firstName: first, lastName: last } : { firstName: first };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/** 2026-10-05 -> October 5, 2026. Read from the string: a date has no time zone. */
export function deliveredOnText(d: string | null): string | null {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * The first thread: the customer's own words, then what they told the form, in
 * the form's labels. The customer may read this, so plain punctuation only.
 */
export function claimThreadHtml(c: ClaimToSend): string {
  const lines: string[] = [];
  lines.push(`Claim type: ${CLAIM_TYPE_LABEL[c.claim_type] ?? c.claim_type}`);
  lines.push(`Order number: ${c.order_number_raw}`);
  const delivered = deliveredOnText(c.delivered_on);
  if (delivered) lines.push(`Delivered on: ${delivered}`);
  if (c.claimant_phone) lines.push(`Phone: ${c.claimant_phone}`);
  lines.push(`Reference: ${c.ref}`);
  const message = (c.message ?? "").trim() || "No description given.";
  return `<p>${esc(message).replace(/\r?\n/g, "<br>")}</p>\n<p>${lines.map(esc).join("<br>")}</p>`;
}

/** An internal note: the team sees it, the customer never does. */
export function claimNoteHtml(c: ClaimToSend): string {
  const parts = [`From the OMS: claim report ${esc(c.ref)}. Triage it at https://www.ordersjkcabinets2you.com/warranty.`];
  if (c.source === "email") {
    parts.push(`Entered from this email by ${esc(c.entered_by ?? "a team member")}. Its report date is when this email arrived, as entered.`);
  }
  if (c.screening === "honeypot") {
    parts.push(`Flagged by the spam check: the hidden field was filled${c.screening_value ? ` with "${esc(c.screening_value)}"` : ""}. A company name or an address usually means a browser's autofill.`);
  } else if (c.screening === "too_fast") {
    parts.push("Flagged by the spam check: sent within two seconds of the page opening.");
  }
  return parts.map((p) => `<p>${p}</p>`).join("\n");
}

/** createdAt without milliseconds, as Help Scout's own examples write it. */
function isoSeconds(t: string): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().replace(/\.\d{3}Z$/, "Z") : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function conversationPayload(c: ClaimToSend): Record<string, unknown> {
  return {
    subject: claimSubject(c.ref),
    customer: { email: c.claimant_email, ...nameParts(c.claimant_name) },
    mailboxId: mailboxId(),
    type: "email",
    status: "active",
    // When the claim ARRIVED, not when Help Scout heard of it -- a retry hours
    // later still shows the customer's own time.
    createdAt: isoSeconds(c.received_at),
    // autoReply and imported are deliberately absent: both default to false.
    // autoReply would send the inbox's own auto reply as a second email;
    // imported would suppress the team's notification, and the website's
    // workflow may not see an imported conversation at all.
    threads: [
      { type: "customer", customer: { email: c.claimant_email }, text: claimThreadHtml(c) },
      { type: "note", text: claimNoteHtml(c) },
    ],
    tags: [CLAIM_TAG],
  };
}

const PHOTO_BUCKET = "claim-photos";

/** Sends one claim. Returns the conversation, and what could not be attached. */
/**
 * ⚠ AN EMAILED CLAIM ADOPTS ITS CONVERSATION; IT NEVER GETS A NEW ONE (the
 * website's note of 2026-10-05, item 7). The customer's own email started a
 * conversation; a second would give them a second thread and a second
 * confirmation. So: the subject set to the claim form's, `oms-claim` added to
 * the tags it already has, and the internal note. The website's workflow,
 * which acts the first time a conversation matches, then confirms in that
 * thread. Every step can safely run again, so a retry after a partial failure
 * converges; the note goes last, so only a failure in recording the result
 * could ever add it twice. No photos are sent: they came in the email.
 */
async function adopt(c: ClaimToSend, conversationId: number): Promise<{ conversation: Conversation; notes: string[] }> {
  const conv = await getConversation(conversationId);
  if (!conv) throw new HelpScoutError(`conversation ${conversationId} is not in Help Scout any more (deleted, or merged over 60 days ago)`);
  if (conv.mailboxId !== mailboxId()) throw new HelpScoutError(`conversation ${conversationId} is no longer in the JK Cabinets 2 You inbox`);
  await setSubject(conv.id, claimSubject(c.ref));
  if (!conv.tags.includes(CLAIM_TAG)) await setTags(conv.id, [...conv.tags, CLAIM_TAG]);
  await addNote(conv.id, claimNoteHtml(c));
  return { conversation: { id: conv.id, url: conv.url }, notes: [] };
}

async function send(c: ClaimToSend): Promise<{ conversation: Conversation; notes: string[] }> {
  if (c.email_conversation_id) return adopt(c, Number(c.email_conversation_id));
  const found = await findConversationByRef(c.ref);
  if (found) {
    // An earlier attempt created it and died before recording the id. Its
    // photos may or may not have gone; sending them again could double them.
    return { conversation: found, notes: (c.photo_paths ?? []).length
      ? ["Found the conversation from an earlier attempt; its photos were not sent again. They are in the OMS."]
      : [] };
  }
  const conversation = await createConversation(conversationPayload(c));
  const notes: string[] = [];
  const paths = c.photo_paths ?? [];
  if (paths.length > 0) {
    // ⚠ A PHOTO THAT DOES NOT ATTACH NEVER UNDOES THE CONVERSATION. The claim is
    // in Help Scout and the photo is still in the OMS; the card says which.
    try {
      const threadId = await customerThreadId(conversation.id);
      for (const path of paths) {
        const name = path.split("/").pop() ?? "photo";
        try {
          const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(path);
          if (error || !data) throw new Error(error?.message ?? "not found");
          const mime = data.type || (name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
          // Already scrubbed of location: the claims route strips it before storing.
          await uploadAttachment(conversation.id, threadId, name, mime, await data.arrayBuffer());
        } catch (e) {
          notes.push(`${name} was not attached: ${(e as Error).message}`.slice(0, 300));
        }
      }
    } catch (e) {
      notes.push(`No photos were attached: ${(e as Error).message}`.slice(0, 300));
    }
  }
  return { conversation, notes };
}

export interface PushResult { ref: string; sent: boolean; conversation?: Conversation; error?: string }

/**
 * Sends what is due: the claim named by `id`, or up to `limit` pending claims,
 * each leased first so no two senders ever hold one. Records the outcome on
 * the submission. Never throws -- a failure is recorded and retried.
 */
export async function pushClaims(opts: { id?: string; limit?: number } = {}): Promise<PushResult[]> {
  if (!helpScoutConfigured()) return [];
  const { data, error } = await supabase.rpc("claim_helpscout_lease", { p_id: opts.id ?? null, p_limit: opts.limit ?? 10 });
  if (error || !Array.isArray(data)) {
    console.error(`[helpscout] could not lease claims: ${error?.message ?? "no rows array"}`);
    return [];
  }
  const results: PushResult[] = [];
  for (const c of data as ClaimToSend[]) {
    try {
      const { conversation, notes } = await send(c);
      const { error: saveError } = await supabase
        .from("claim_submissions")
        .update({
          helpscout_state: "sent",
          helpscout_conversation_id: conversation.id,
          helpscout_url: conversation.url,
          helpscout_sent_at: new Date().toISOString(),
          helpscout_leased_at: null,
          helpscout_last_error: notes.length ? notes.join(" ") : null,
        })
        .eq("id", c.id);
      // If the save fails the lease expires, the next sweep searches, finds
      // this conversation and records it: no second one is created.
      if (saveError) throw new Error(`sent as conversation ${conversation.id}, but recording it failed: ${saveError.message}`);
      results.push({ ref: c.ref, sent: true, conversation });
    } catch (e) {
      const message = ((e as Error).message || "unknown error").slice(0, 500);
      console.error(`[helpscout] ${c.ref} not sent: ${message}`);
      await supabase
        .from("claim_submissions")
        .update({ helpscout_leased_at: null, helpscout_last_error: message })
        .eq("id", c.id);
      results.push({ ref: c.ref, sent: false, error: message });
    }
  }
  return results;
}
