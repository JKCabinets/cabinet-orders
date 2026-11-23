import type { ReviewReason } from "@/lib/data";

/**
 * What a line's review flag means, in words: the label on the line and the
 * vendor PDF, and the help behind it on screen.
 *
 * ⚠ ONE MAP, TYPED BY THE REASON (2026-11-23, item 6). OrderDetails and the
 * export route each kept a copy, both written before `missing_mod_value`
 * existed, so a line flagged for a missing modification value read "Review" on
 * screen and "review" on the PDF sent to the manufacturer. Keyed by
 * ReviewReason, a reason added to lib/data without words here fails the
 * typecheck rather than reaching a screen as "Review".
 *
 * Pure: the client component and the server route both import it.
 */
export const REVIEW_REASONS: Record<ReviewReason, { label: string; help: string }> = {
  unmapped_value: {
    label: "Unmapped value",
    help: "A door or color name has no SKU code yet. Add the code in the mappings admin, then re-decode this order.",
  },
  decoder_unavailable: {
    label: "Decoder unavailable",
    help: "The SKU mapping table couldn't be read when this order arrived, so the raw SKU was kept. Re-decode once mappings are available.",
  },
  sku_mismatch: {
    label: "SKU mismatch",
    help: "A submitted _sku didn't derive from the variant's real SKU. The real SKU was used instead.",
  },
  missing_sku: {
    label: "Missing SKU",
    help: "This Shopify line had no SKU; a placeholder was kept so the line wasn't dropped.",
  },
  missing_mod_value: {
    label: "Missing modification value",
    help: "A modification on this line is missing its depth value. Confirm it with the customer before the order is placed.",
  },
};

/**
 * The words for a stored reason, or undefined for one this code does not know
 * -- a value no longer written, on an old row. Callers keep their own fallback
 * for that ("Review" on screen, "review" on the PDF).
 */
export function reviewReasonWords(
  reason: string | null | undefined,
): { label: string; help: string } | undefined {
  if (!reason || !Object.prototype.hasOwnProperty.call(REVIEW_REASONS, reason)) return undefined;
  return REVIEW_REASONS[reason as ReviewReason];
}
