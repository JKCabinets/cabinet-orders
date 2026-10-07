/**
 * Help Scout's Inbox API, as far as the OMS uses it (2026-10-05).
 *
 * Every customer reply goes through Help Scout (Garrett, 2026-10-01), so each
 * claim the website sends becomes a conversation there -- after the OMS has
 * recorded it, never instead (lib/claimHelpScout.ts says why the order is that
 * way round). This file is the client: credentials, the calls, their errors.
 *
 * ⚠ CLIENT CREDENTIALS, from an app under Your Profile > My Apps, acting as the
 * Help Scout user who created it -- who must stay an active user, or every call
 * answers 401. The token lasts two days and is fetched again only when it
 * expires or a call answers 401, as Help Scout asks.
 *
 * Configuration -- all three, or Help Scout is "not configured" and nothing is
 * sent (claims stay `pending` and are sent once it is):
 *   HELPSCOUT_APP_ID, HELPSCOUT_APP_SECRET   secrets, .env.kamal
 *   HELPSCOUT_MAILBOX_ID                     not secret, config/deploy.yml
 */

const API = "https://api.helpscout.net/v2";

export class HelpScoutError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

function config(): { id: string; secret: string; mailbox: number } | null {
  const id = process.env.HELPSCOUT_APP_ID ?? "";
  const secret = process.env.HELPSCOUT_APP_SECRET ?? "";
  const mailbox = Number(process.env.HELPSCOUT_MAILBOX_ID ?? "");
  if (!id || !secret || !Number.isInteger(mailbox) || mailbox <= 0) return null;
  return { id, secret, mailbox };
}

export function helpScoutConfigured(): boolean {
  return config() !== null;
}

function need(): { id: string; secret: string; mailbox: number } {
  const c = config();
  if (!c) throw new HelpScoutError("Help Scout is not configured (HELPSCOUT_APP_ID, HELPSCOUT_APP_SECRET, HELPSCOUT_MAILBOX_ID)");
  return c;
}

export function mailboxId(): number {
  return need().mailbox;
}

let cached: { token: string; expires: number } | null = null;

async function token(fresh: boolean): Promise<string> {
  if (!fresh && cached && cached.expires > Date.now() + 60_000) return cached.token;
  const c = need();
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.id, client_secret: c.secret }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HelpScoutError(`Help Scout refused the app's credentials (${res.status})`, res.status);
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new HelpScoutError("Help Scout's token answer had no access_token");
  }
  cached = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return cached.token;
}

/** One call, with the token; on a 401, once more with a fresh one. */
async function call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${await token(attempt > 0)}`,
        ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) { cached = null; continue; }
    return res;
  }
}

async function refused(res: Response, what: string): Promise<never> {
  let detail = "";
  try { detail = (await res.text()).replace(/\s+/g, " ").slice(0, 300); } catch { /* the status is enough */ }
  throw new HelpScoutError(`Help Scout answered ${res.status} ${what}${detail ? `: ${detail}` : ""}`, res.status);
}

export interface Conversation { id: number; url: string | null }

/**
 * The conversation in our inbox, of ANY status, whose subject carries `ref`
 * as a whole reference -- CR-1003 and never CR-10030. Help Scout's search is
 * by words, so it narrows and this decides.
 */
export async function findConversationByRef(ref: string): Promise<Conversation | null> {
  const query = encodeURIComponent(`(subject:"${ref}")`);
  const res = await call(`/conversations?mailbox=${mailboxId()}&status=all&query=${query}`);
  if (!res.ok) await refused(res, "to a search");
  const body = (await res.json()) as { _embedded?: { conversations?: Array<{ id?: unknown; subject?: unknown; _links?: { web?: { href?: unknown } } }> } };
  const whole = new RegExp(`(^|[^A-Za-z0-9-])${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9A-Za-z])`);
  const hit = (body._embedded?.conversations ?? []).find((c) => typeof c.subject === "string" && whole.test(c.subject));
  if (!hit) return null;
  const href = hit._links?.web?.href;
  return { id: Number(hit.id), url: typeof href === "string" ? href : null };
}

/** POST /v2/conversations. The id comes back in Resource-ID, the page in Web-Location. */
export async function createConversation(payload: Record<string, unknown>): Promise<Conversation> {
  const res = await call("/conversations", { method: "POST", json: payload });
  if (res.status !== 201) await refused(res, "creating the conversation");
  const id = Number(res.headers.get("Resource-ID"));
  if (!Number.isInteger(id) || id <= 0) throw new HelpScoutError("Help Scout created the conversation but sent no Resource-ID");
  return { id, url: res.headers.get("Web-Location") };
}

/** The id of the conversation's first customer thread -- where its photos belong. */
export async function customerThreadId(conversationId: number): Promise<number> {
  const res = await call(`/conversations/${conversationId}?embed=threads`);
  if (!res.ok) await refused(res, "reading the conversation");
  const body = (await res.json()) as { _embedded?: { threads?: Array<{ id?: unknown; type?: unknown }> } };
  const threads = body._embedded?.threads ?? [];
  const customer = threads.filter((t) => t.type === "customer");
  const first = customer[customer.length - 1] ?? customer[0];   // newest first; the claim is the oldest
  if (!first) throw new HelpScoutError("the conversation has no customer thread to attach photos to");
  return Number(first.id);
}

export async function uploadAttachment(
  conversationId: number, threadId: number, fileName: string, mimeType: string, bytes: ArrayBuffer,
): Promise<void> {
  const res = await call(`/conversations/${conversationId}/threads/${threadId}/attachments`, {
    method: "POST",
    json: { fileName, mimeType, data: Buffer.from(bytes).toString("base64") },
  });
  if (!res.ok) await refused(res, `attaching ${fileName}`);
}

export interface ConversationInfo { id: number; mailboxId: number; tags: string[]; url: string | null }

/**
 * GET /v2/conversations/{id}, or null if Help Scout has no such conversation.
 * A conversation merged into another answers 301 for 60 days, which fetch
 * follows -- so `id` here is the conversation AS IT IS NOW, perhaps not the
 * one asked for.
 */
export async function getConversation(id: number): Promise<ConversationInfo | null> {
  const res = await call(`/conversations/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) await refused(res, "reading the conversation");
  const body = (await res.json()) as {
    id?: unknown; mailboxId?: unknown; tags?: Array<{ tag?: unknown } | string>; _links?: { web?: { href?: unknown } };
  };
  const tags = (body.tags ?? [])
    .map((t) => (typeof t === "string" ? t : typeof t?.tag === "string" ? t.tag : ""))
    .filter(Boolean);
  const href = body._links?.web?.href;
  return { id: Number(body.id), mailboxId: Number(body.mailboxId), tags, url: typeof href === "string" ? href : null };
}

/** PATCH /v2/conversations/{id}: replace the subject. */
export async function setSubject(id: number, subject: string): Promise<void> {
  const res = await call(`/conversations/${id}`, { method: "PATCH", json: { op: "replace", path: "/subject", value: subject } });
  if (!res.ok) await refused(res, "changing the subject");
}

/**
 * PUT /v2/conversations/{id}/tags. ⚠ THE WHOLE LIST: any tag not sent is
 * removed. Callers send the tags the conversation already has plus the new
 * one; a tag an agent adds in the instant between that read and this write is
 * lost -- the API offers no add-one-tag call.
 */
export async function setTags(id: number, tags: string[]): Promise<void> {
  const res = await call(`/conversations/${id}/tags`, { method: "PUT", json: { tags } });
  if (!res.ok) await refused(res, "setting the tags");
}

/** POST /v2/conversations/{id}/notes: an internal note, never seen by the customer. */
export async function addNote(id: number, text: string): Promise<void> {
  const res = await call(`/conversations/${id}/notes`, { method: "POST", json: { text } });
  if (!res.ok) await refused(res, "adding the note");
}

/**
 * PATCH /v2/conversations/{id}: replace the status (2026-10-07). The OMS only
 * ever CLOSES -- when a claim is deleted -- and never deletes a conversation.
 */
export async function setStatus(id: number, status: "active" | "pending" | "closed"): Promise<void> {
  const res = await call(`/conversations/${id}`, { method: "PATCH", json: { op: "replace", path: "/status", value: status } });
  if (!res.ok) await refused(res, "changing the status");
}

/** For tests: forget the cached token. */
export function _forgetToken(): void { cached = null; }
