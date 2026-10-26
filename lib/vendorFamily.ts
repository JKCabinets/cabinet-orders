/**
 * Which vendor family a vendor string belongs to (2026-10-22).
 *
 * ⚠ ONE TEST. The Waypoint question was answered inline in the acknowledgment
 * matcher (lib/ackFingerprint), which had itself taken it from the upload
 * route; the stage panel's Woodmark link (lib/stageSentences) asks it too.
 * Kept in its own module because ackFingerprint also hashes with `crypto` and
 * cannot be imported into the browser.
 */

/**
 * The Waypoint family. "Select Cabinetry" is the storefront alias; Shopify's
 * product vendor is "Waypoint Cabinetry" (verified 2026-08-27), but the alias
 * is accepted in case a line ever carries it.
 */
export function isWaypointVendor(vendor: string | null | undefined): boolean {
  const v = (vendor ?? "").trim().toLowerCase();
  return v === "waypoint cabinetry" || v === "waypoint" || v === "select cabinetry";
}
