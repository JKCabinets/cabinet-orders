-- 2026-08-27 — acknowledgment line fingerprint
--
-- A green acknowledgment is evidence about a specific set of lines at a
-- specific moment. Until now nothing tied the verdict to what was reconciled,
-- so a Shopify order edit or a re-decode left the green ack standing and still
-- advancing the order -- confirming lines that no longer exist.
--
-- lib/ackFingerprint.ts hashes exactly what reconcileAck's verdict depends on
-- (normalised name, normalised ship-to, and per-SKU quantities and
-- modifications) and stores it here at upload. The stage gate recomputes and
-- compares.
--
-- ⚠ NULLABLE, AND NULL MEANS VALID. Every row that exists today predates
-- fingerprinting. Treating null as stale would invalidate every historical
-- acknowledgment the moment this deploys, which turns a safeguard into an
-- outage. See ackIsStale().
--
-- No backfill: a fingerprint for a past upload cannot be reconstructed, because
-- the order's lines may already have changed -- which is the very thing this
-- column exists to detect. Rows acquire one on their next upload.

alter table order_acknowledgments
  add column if not exists lines_fingerprint text;

comment on column order_acknowledgments.lines_fingerprint is
  'sha256 of the order fields reconcileAck compares, at upload time. NULL = recorded before fingerprinting; treated as valid, never stale.';
