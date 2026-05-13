/**
 * URL slug helpers for the per-stage order pages.
 *
 * Lives in its own module (not "use client") so that server components like
 * app/orders/[stage]/page.tsx can import VALID_STAGE_SLUGS for both the
 * runtime check AND generateStaticParams without going through a client
 * bundle boundary — which can break plain-value exports.
 */

import type { OrderStage } from "@/lib/data";

export const VALID_STAGE_SLUGS = [
  "new", "entered", "in-production", "at-cross-dock", "delivered", "archived",
] as const;

export function slugToStage(slug: string): OrderStage | "Archived" {
  switch (slug) {
    case "new":            return "New";
    case "entered":        return "Entered";
    case "in-production":  return "In production";
    case "at-cross-dock":  return "At cross dock";
    case "delivered":      return "Delivered";
    case "archived":       return "Archived";
    default:               return "New"; // unreachable; guarded by VALID_STAGE_SLUGS
  }
}
