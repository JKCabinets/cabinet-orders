/**
 * Carrier tracking URLs.
 *
 * ⚠ THE OMS OWNS THE URL, decided 2026-09-01. The alternative was sending the
 * carrier name to the storefront and letting the theme build the link, which
 * would have put this table in a place we cannot correct without a theme
 * deploy.
 *
 * ⚠ AN UNKNOWN CARRIER RETURNS null, NEVER A GUESS. That is what contains the
 * cost of this table going stale: a carrier we do not recognise, or one that
 * changes its URL format, degrades to the tracking number as plain text --
 * exactly where we would have been with no table at all. A wrong link is worse
 * than no link, because the customer believes it.
 *
 * ⚠ MATCHING IS EXACT AGAINST AN ALIAS LIST, NOT `includes`. "usps" CONTAINS
 * "ups". A substring match would route every USPS sample to UPS's tracking
 * page, which resolves to a "not found" the customer reads as "we lost it".
 */

/** Reduce a free-text carrier to a comparable token: lowercase, alphanumeric. */
function normalise(carrier: string): string {
  return carrier.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface CarrierEntry {
  /** What we call it back to the customer. */
  readonly name: string;
  /**
   * Every spelling seen or plausibly seen, ALREADY NORMALISED.
   *
   * `orders.carrier` is free text from two doors: Shopify's `tracking_company`
   * on a fulfilment, or somebody typing it into the modal. Neither is
   * validated, so this list is forgiving on purpose.
   */
  readonly aliases: readonly string[];
  readonly url: (trackingNumber: string) => string;
}

const CARRIERS: readonly CarrierEntry[] = [
  {
    name: "UPS",
    aliases: ["ups", "unitedparcelservice", "unitedparcel"],
    url: (n) => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
  },
  {
    name: "USPS",
    aliases: ["usps", "unitedstatespostalservice", "uspostalservice", "postalservice", "uspost"],
    url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`,
  },
  {
    name: "FedEx",
    aliases: ["fedex", "federalexpress", "fedexground", "fedexexpress", "fedexhomedelivery"],
    url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
  },
];

/**
 * ⚠ FAILS AT BOOT, NOT IN FRONT OF A CUSTOMER.
 *
 * Two ways this table can rot silently: a URL template that stops
 * interpolating the number (producing a link to the carrier's homepage, which
 * looks like it worked), and two carriers claiming the same alias (so one
 * shadows the other depending on declaration order). Both are cheap to assert
 * and neither is visible in review.
 */
{
  const PROBE = "PROBE1234567890";
  const seen = new Map<string, string>();
  for (const c of CARRIERS) {
    if (!c.url(PROBE).includes(PROBE)) {
      throw new Error(
        `[carriers] ${c.name} builds a URL that does not contain the tracking `
        + `number. A link to a carrier's homepage reads as a broken order.`,
      );
    }
    for (const alias of c.aliases) {
      const owner = seen.get(alias);
      if (owner) {
        throw new Error(
          `[carriers] alias "${alias}" is claimed by both ${owner} and ${c.name}. `
          + `Whichever is declared first wins, silently.`,
        );
      }
      seen.set(alias, c.name);
    }
  }
}

export interface CarrierLink {
  /** Canonical display name, or the raw string when unrecognised. */
  carrier: string;
  /** Null when the carrier is unknown. The caller shows the number as text. */
  url: string | null;
}

/**
 * Resolve a free-text carrier and a tracking number to a display name and a
 * link.
 *
 * Returns null ONLY when there is no tracking number at all -- a row with a
 * number and an unrecognised carrier is still worth showing, because the
 * number is the useful part and the customer can search it.
 */
export function trackingLinkFor(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): CarrierLink | null {
  const number = String(trackingNumber ?? "").trim();
  if (!number) return null;

  const raw = String(carrier ?? "").trim();
  const key = normalise(raw);
  const match = key ? CARRIERS.find((c) => c.aliases.includes(key)) : undefined;

  if (!match) {
    // Unknown or absent carrier. Show what we have; link nothing.
    return { carrier: raw, url: null };
  }
  return { carrier: match.name, url: match.url(number) };
}
