/**
 * The customer's agreement to our policies, as the website records it on every
 * order (website session, 2026-10-07): attributes in Shopify's "Additional
 * details" (`note_attributes`), kept on the PROJECT -- one Shopify order, one
 * agreement -- and shown on the order for chargebacks and disputes.
 *
 *   Terms agreed           2026-10-07T21:15:03.120Z  when the box was ticked, UTC
 *   Terms version          1-926                     the Terms of Service then
 *   Consent wording        v1                        which wording, CONSENT_WORDING
 *   Consent source         cart | kitchen designer   where they agreed
 *   Refund Policy updated  September 24, 2026        the Refund Policy's "Last
 *                                                    updated" date; "unknown" if
 *                                                    the website could not read it
 *
 * ⚠ THE FIFTH SINCE 2026-10-29 (the website team's note of that date; feature 11,
 * 2026-11-03): orders before it do not carry it, and consent staff record by
 * email has none. Beside them, from SHOPIFY rather than the website, the
 * checkout's IP address and browser -- see readCheckout.
 *
 * ⚠ KEPT AS SENT, AS TEXT. For a dispute the evidence is what Shopify sent,
 * and a text column cannot reject an odd value and lose the order with it.
 * The time is formatted for display only.
 *
 * Pure -- no database, no browser -- for the webhook and the screen alike.
 */

export interface TermsConsent {
  terms_agreed: string;
  terms_version: string | null;
  consent_wording: string | null;
  consent_source: string | null;
  refund_policy_updated: string | null;
}

/** The attribute names, exactly as the website writes them; matched without regard to case or spacing. */
export const CONSENT_ATTRIBUTES = {
  terms_agreed: "Terms agreed",
  terms_version: "Terms version",
  consent_wording: "Consent wording",
  consent_source: "Consent source",
  refund_policy_updated: "Refund Policy updated",
} as const;

/** What a customer agreed to, by wording version. A new wording arrives from the website team as v2. */
export const CONSENT_WORDING: Record<string, string> = {
  v1: "I understand that all JK Cabinets 2 You orders are made to order, non-cancellable, and "
    + "non-refundable once production begins. I have verified my measurements, and I have read "
    + "and agree to the Refund Policy, Terms of Service, and Privacy Policy.",
};

/**
 * The wording a customer is asked to agree to TODAY -- what staff send when
 * they obtain consent by email (app/api/projects/[id]/consent), and what is
 * recorded for it. Moves with the website's: v2 arrives from them.
 */
export const CURRENT_CONSENT_WORDING = "v1";

/**
 * From when a Shopify order must carry consent: when the website started
 * sending it. ⚠ SET FROM THE ORDERS THEMSELVES (2026-10-13): SHO-1056 arrived
 * at 21:39:32 UTC on 2026-10-08 without it, placed before the website's update
 * (Garrett), and SHO-1057's customer agreed at 21:56:42 -- so the update went
 * live between the two. An order placed before cannot have consent, and
 * flagging it would be noise. (Until then: midnight 2026-10-07 Arizona.)
 */
export const CONSENT_REQUIRED_FROM = "2026-10-08T21:40:00Z";

const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The consent on a Shopify order payload, or null when it has none. ⚠ "None"
 * means NO `Terms agreed`: the time is the agreement, and the other three only
 * describe it. Blank counts as absent.
 */
export function readConsent(noteAttributes: unknown): TermsConsent | null {
  if (!Array.isArray(noteAttributes)) return null;
  const byName = new Map<string, string>();
  for (const a of noteAttributes) {
    if (!a || typeof a !== "object") continue;
    const { name, value } = a as { name?: unknown; value?: unknown };
    const v = String(value ?? "").trim();
    if (v) byName.set(key(name), v);
  }
  const get = (n: string) => byName.get(key(n)) ?? null;
  const agreed = get(CONSENT_ATTRIBUTES.terms_agreed);
  if (!agreed) return null;
  return {
    terms_agreed: agreed,
    terms_version: get(CONSENT_ATTRIBUTES.terms_version),
    consent_wording: get(CONSENT_ATTRIBUTES.consent_wording),
    consent_source: get(CONSENT_ATTRIBUTES.consent_source),
    refund_policy_updated: get(CONSENT_ATTRIBUTES.refund_policy_updated),
  };
}

/**
 * The checkout's IP address and browser, as SHOPIFY recorded them (2026-11-03,
 * feature 11; asked by the website team, 2026-10-29). Not the website's: they
 * are the order's `client_details`, not its "Additional details". Kept beside
 * the consent on the PROJECT, for disputes (OPERATIONS §13).
 *
 *   checkout_ip          client_details.browser_ip, else the order's browser_ip
 *                        (Shopify sends both; on every order read 2026-11-03
 *                        they were equal)
 *   checkout_user_agent  client_details.user_agent
 *
 * ⚠ AS SENT, AS TEXT, like the consent; blank counts as absent. Null when
 * Shopify recorded neither -- an order made in the admin, say. A Kitchen
 * designer order checks out on Shopify's invoice page: whatever Shopify records
 * there. ⚠ CAPPED, generously (100 and 2,000 characters): a browser string is
 * the buyer's browser's to set, and real ones run to a few hundred (111 on the
 * four orders read).
 */
export interface CheckoutRecord {
  checkout_ip: string | null;
  checkout_user_agent: string | null;
}

export const CHECKOUT_IP_MAX = 100;
export const CHECKOUT_USER_AGENT_MAX = 2000;

export function readCheckout(payload: unknown): CheckoutRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { browser_ip?: unknown; client_details?: unknown };
  const cd = (p.client_details && typeof p.client_details === "object"
    ? p.client_details : {}) as { browser_ip?: unknown; user_agent?: unknown };
  const text = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const ip = text(cd.browser_ip, CHECKOUT_IP_MAX) ?? text(p.browser_ip, CHECKOUT_IP_MAX);
  const ua = text(cd.user_agent, CHECKOUT_USER_AGENT_MAX);
  if (!ip && !ua) return null;
  return { checkout_ip: ip, checkout_user_agent: ua };
}

type ProjectLike = {
  shopify_id?: string | null;
  created_at?: string | null;
  terms_agreed?: string | null;
};

/**
 * Whether this purchase must carry consent: a Shopify checkout placed since
 * CONSENT_REQUIRED_FROM. ⚠ NOT custom jobs or warranty claims -- they have no
 * project; a custom customer signs their own contract, and a claim rests on
 * its original order's consent.
 */
export function consentRequired(p: ProjectLike | null | undefined): boolean {
  if (!p || !p.shopify_id || !p.created_at) return false;
  const t = Date.parse(p.created_at);
  return Number.isFinite(t) && t >= Date.parse(CONSENT_REQUIRED_FROM);
}

/** A purchase that must carry consent and does not: staff get it before production. */
export function consentMissing(p: ProjectLike | null | undefined): boolean {
  return consentRequired(p) && !String(p?.terms_agreed ?? "").trim();
}

/** When they agreed, in Arizona time; the value as sent if it is not a time. */
export function formatAgreed(value: string | null | undefined): string {
  const t = Date.parse(String(value ?? ""));
  if (!Number.isFinite(t)) return String(value ?? "");
  return new Date(t).toLocaleString("en-US", {
    timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
