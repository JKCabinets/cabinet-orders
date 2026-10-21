/**
 * Post an Adaptive Card to the Teams webhook in TEAMS_WEBHOOK_URL.
 *
 * Carries the same SSRF guard as the teams-digest route: only Microsoft-owned
 * hosts are accepted, so a misconfigured env var cannot be used to make the
 * server POST at an internal address. Duplicating a security control is worse
 * than duplicating a message format, which is why this lives in one place.
 *
 * Returns a reason instead of throwing — a notification failing must never take
 * the job that produced it down with it.
 */

const ALLOWED_HOST_SUFFIXES = [
  ".logic.azure.com", // Power Automate workflow URLs (older format)
  ".webhook.office.com", // Legacy O365 connector webhooks
  ".azure-apim.net", // Some Power Automate regional endpoints
  ".api.powerplatform.com", // Current Power Platform workflow URLs
];

export type TeamsPostResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  // `where` (2026-10-21): "config" is ours -- the URL is unparseable or not a
  // Microsoft host; "teams" is theirs -- refused, or unreachable. The digest
  // answers its cron 500 and 502 by it, as it did before using this.
  | { ok: false; skipped: false; where: "config" | "teams"; reason: string };

export async function postTeamsCard(card: unknown): Promise<TeamsPostResult> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return { ok: false, skipped: true, reason: "TEAMS_WEBHOOK_URL not set" };

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return { ok: false, skipped: false, where: "config", reason: "Invalid TEAMS_WEBHOOK_URL" };
  }
  if (!ALLOWED_HOST_SUFFIXES.some((s) => parsed.host.endsWith(s))) {
    return { ok: false, skipped: false, where: "config", reason: `Host not allowed: ${parsed.host}` };
  }

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, skipped: false, where: "teams", reason: `Teams ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: false, where: "teams", reason: `Could not reach Teams: ${e instanceof Error ? e.message : String(e)}` };
  }
}
