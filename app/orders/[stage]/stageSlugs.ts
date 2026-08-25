/**
 * URL slug helpers for the Shopify order pages.
 *
 * Lives in its own module (not "use client") so that server components like
 * app/orders/[stage]/page.tsx can import the slug list for both the runtime
 * check AND generateStaticParams without going through a client bundle
 * boundary — which can break plain-value exports.
 *
 * ⚠ TWO KINDS OF SLUG, ONE PAGE.
 *
 *   cabinets, hardware   the TYPE hub, opening on All
 *   new, entered, …      LEGACY per-stage URLs. They resolve to the same hub
 *                        with that stage preselected — not to a separate page.
 *                        Nothing that links to them breaks, and retiring them
 *                        later is deleting entries from this file, because they
 *                        were never separate pages to begin with.
 *   archived             archive mode: archived rows, no stage cards.
 */

import type { OrderStage, OrderType } from "@/lib/data";

/** Type hubs. */
const TYPE_SLUGS: Record<string, OrderType> = {
  cabinets: "order",
  hardware: "hardware",
};

/** Legacy per-stage slugs. All cabinet-flow, which is where they came from. */
const STAGE_SLUGS: Record<string, OrderStage> = {
  "new": "New",
  "entered": "Entered",
  "in-production": "In production",
  "at-cross-dock": "At cross dock",
  "delivered": "Delivered",
};

export const VALID_STAGE_SLUGS = [
  ...Object.keys(TYPE_SLUGS),
  ...Object.keys(STAGE_SLUGS),
  "archived",
] as const;

export interface ResolvedSlug {
  type: OrderType;
  /** null means open on "All". */
  initialStage: OrderStage | null;
  archive: boolean;
}

/**
 * Resolve a slug to what the hub should render.
 *
 * Returns null for an unknown slug so the route can 404 rather than guessing.
 * The old helper returned "New" for anything unrecognised, which was safe only
 * because the route checked the list first — a fallback that hides a typo is a
 * fallback that hides a bug.
 */
export function resolveOrdersSlug(slug: string): ResolvedSlug | null {
  if (slug === "archived") {
    return { type: "order", initialStage: null, archive: true };
  }
  const type = TYPE_SLUGS[slug];
  if (type) return { type, initialStage: null, archive: false };
  const stage = STAGE_SLUGS[slug];
  if (stage) return { type: "order", initialStage: stage, archive: false };
  return null;
}
