/**
 * The customer's agreement to our policies, as the website records it on every
 * order (website session, 2026-10-07): four attributes in Shopify's "Additional
 * details" (`note_attributes`), kept on the PROJECT -- one Shopify order, one
 * agreement -- and shown on the order for chargebacks and disputes.
 *
 *   Terms agreed      2026-10-07T21:15:03.120Z  when the box was ticked, UTC
 *   Terms version     1-926                     the Terms of Service then
 *   Consent wording   v1                        which wording, CONSENT_WORDING
 *   Consent source    cart | kitchen designer   where they agreed
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
}

/** The attribute names, exactly as the website writes them; matched without regard to case or spacing. */
export const CONSENT_ATTRIBUTES = {
  terms_agreed: "Terms agreed",
  terms_version: "Terms version",
  consent_wording: "Consent wording",
  consent_source: "Consent source",
} as const;

/** What a customer agreed to, by wording version. A new wording arrives from the website team as v2. */
export const CONSENT_WORDING: Record<string, string> = {
  v1: "I understand that all JK Cabinets 2 You orders are made to order, non-cancellable, and "
    + "non-refundable once production begins. I have verified my measurements, and I have read "
    + "and agree to the Refund Policy, Terms of Service, and Privacy Policy.",
};

/**
 * From when a Shopify order must carry consent. ⚠ 2026-10-07 at midnight in
 * Arizona until the website team says when each route started sending it:
 * an order placed before then cannot have it, and flagging it would be noise.
 */
export const CONSENT_REQUIRED_FROM = "2026-10-07T07:00:00Z";

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
  };
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
