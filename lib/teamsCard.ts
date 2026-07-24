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
  | { ok: false; skipped: false; reason: string };

export async function postTeamsCard(card: unknown): Promise<TeamsPostResult> {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return { ok: false, skipped: true, reason: "TEAMS_WEBHOOK_URL not set" };

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return { ok: false, skipped: false, reason: "Invalid TEAMS_WEBHOOK_URL" };
  }
  if (!ALLOWED_HOST_SUFFIXES.some((s) => parsed.host.endsWith(s))) {
    return { ok: false, skipped: false, reason: `Host not allowed: ${parsed.host}` };
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
      return { ok: false, skipped: false, reason: `Teams ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
