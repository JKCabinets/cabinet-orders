/**
 * Every cabinet line its own signed proof of delivery (2026-11-02, feature 10,
 * Garrett's decision C: "At cross dock -> Delivered: every line's signed proof
 * of delivery"; the three cabinet lines deliver separately). ONE RULE, asked by
 * the order route's Delivered gate, the enrichment (and through it the band and
 * the client gate). Pure.
 *
 *   one line, or none named   ANY receipt counts -- as before feature 10, so a
 *                             single-vendor order is unchanged, and so is a
 *                             receipt uploaded before receipts named a line
 *   two lines or more         each line needs a receipt that NAMES it
 *                             (order_attachments.vendor, 2026-11-02)
 */
export interface ProofFile { vendor: string | null }

export function proofLineStates(vendors: string[], proofs: ProofFile[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (vendors.length <= 1) {
    for (const v of vendors) out[v] = proofs.length > 0;
    return out;
  }
  for (const v of vendors) out[v] = proofs.some((p) => (p.vendor ?? "").trim() === v);
  return out;
}

export function proofRequirementMet(vendors: string[], proofs: ProofFile[]): boolean {
  if (vendors.length === 0) return proofs.length > 0;
  const states = proofLineStates(vendors, proofs);
  return vendors.every((v) => states[v]);
}
