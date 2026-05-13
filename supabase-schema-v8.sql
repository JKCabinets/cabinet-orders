-- v8: Track Shopify payment status on each order so the order table can show
-- a "Paid / Partial / Pending / Refunded" column without round-tripping to
-- Shopify on every render. Populated from the order webhook & the manual sync.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT;

-- Shopify financial_status values we care about:
--   paid, partially_paid, pending, refunded, partially_refunded, voided,
--   authorized. Custom orders default to NULL.
COMMENT ON COLUMN orders.payment_status IS
  'Shopify financial_status (paid, partially_paid, pending, refunded, ...) or NULL for non-Shopify orders';
