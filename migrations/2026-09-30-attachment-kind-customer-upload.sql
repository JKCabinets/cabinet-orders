-- 2026-09-30  order_attachments.kind accepts "customer_upload".
--
-- ⚠ THIS SHOULD HAVE SHIPPED WITH THE CODE THAT WRITES THE VALUE. The quote
-- webhook started writing kind = 'customer_upload' on 2026-09-28. The column has
-- a CHECK listing its allowed values, and that list was not extended, so EVERY
-- customer upload after that deploy was rejected: the file reached storage, the
-- order_attachments row did not, and the Files pane showed nothing.
--
-- Caught on 2026-09-30 by a real submission, and named exactly by the webhook's
-- own activity line:
--
--   ".. File "Navy.jpg" uploaded but DB row failed: new row for relation
--    "order_attachments" violates check constraint "order_attachments_kind_check"
--
-- ⚠ THE RULE: a new value in a constrained column is TWO changes -- the writer
-- and the constraint. Before adding one, read what the column actually allows:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.order_attachments'::regclass and contype = 'c';
--
-- Files uploaded while the constraint was narrow are in storage with no row
-- pointing at them. They were test submissions and were deleted rather than
-- reconciled.
--
-- Run before deploying anything that writes a new kind. Idempotent: the
-- constraint is dropped by name and recreated with the full list.

begin;

alter table public.order_attachments
  drop constraint if exists order_attachments_kind_check;

alter table public.order_attachments
  add constraint order_attachments_kind_check
  check (kind = any (array[
    'general'::text,            -- anything staff attach
    'proof_of_delivery'::text,  -- the signed receipt the delivery gate reads
    'customer_upload'::text     -- arrived with a quote request
  ]));

commit;

-- Verify, as a separate statement afterwards:
--
-- select conname, pg_get_constraintdef(oid) as definition
-- from pg_constraint
-- where conrelid = 'public.order_attachments'::regclass and contype = 'c';
