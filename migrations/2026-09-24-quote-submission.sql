-- 2026-09-24  The quote form's submission, kept as it arrived.
--
-- ⚠ RUN THIS BEFORE DEPLOYING THE COMMIT THAT ADDS IT. The route writes both
-- columns; against a table without them PostgREST rejects the whole insert and
-- every quote request is lost. Columns nothing writes yet are harmless.
--
-- WHY. The form sends 32 fields: stable keys with matching _label text, two
-- multi-select arrays, a version, a submission id, and file metadata. The route
-- flattened all of it into one `notes` string, so the OMS could not show the
-- customer's answers as fields, could not tell them from a designer's own
-- notes, and stored "Budget: 5k_10k" where the customer had read
-- "$5,000 to $10,000". Verified on the first real submission, 2026-09-24.
--
--   quote_submission  jsonb  the payload as it arrived, keys and labels together.
--                            The designer's own selections live in the ordinary
--                            columns; this is the customer's request, and
--                            nothing in the OMS writes to it after ingest.
--   submission_id     text   the form's own id, stable across ITS retries.
--                            Unique where present, so a retried submission
--                            cannot open a second job.
--
-- The unique index is partial: every row created any other way has NULL here,
-- and NULLs do not collide.
--
-- Idempotent: both columns and the index are added only if absent.

begin;

alter table public.orders add column if not exists quote_submission jsonb;
alter table public.orders add column if not exists submission_id text;

create unique index if not exists orders_submission_id_unique
  on public.orders (submission_id)
  where submission_id is not null;

commit;

-- Verify, as a separate statement afterwards:
--
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'orders'
--   and column_name in ('quote_submission', 'submission_id');
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and indexname = 'orders_submission_id_unique';
