-- ═══════════════════════════════════════════════════════════════════════
-- 2026-08-04 · orders.reported_at
-- Public claims intake — Phase 1, item 2 of 3
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT
--   When a warranty claim was REPORTED by the customer, as distinct from when
--   this row was created. Set on promotion, from claim_submissions.received_at.
--
-- WHY A SEPARATE COLUMN RATHER THAN WRITING created_at BACKWARDS
--   A claim submitted Thursday 6pm and promoted Monday 10am was reported
--   Thursday. Terms 12.3 makes the reporting windows conditions precedent to
--   a claim, so that timestamp has legal weight — and the warranty New claim
--   SLA rule measures from it, so without this the four days of triage delay
--   would be invisible to the system built to surface delay.
--
--   Forging created_at would make the row lie about when it was inserted, and
--   something will eventually depend on that being true.
--
-- WHY ITS OWN MIGRATION
--   This is the ONLY change to the operational schema in the entire public
--   intake effort. Everything else — the public_api role, claim_submissions,
--   messages, the claims bucket — is additive and self-contained. Keeping this
--   separate means the whole intake effort can be rolled back without touching
--   the table that runs the business.
--
-- INERT ON ARRIVAL
--   Nothing writes this column until promotion is built (Phase 1 item 9).
--   Every existing row is NULL, and hoursSinceReported() falls back to
--   created_at when it is absent — so behaviour is unchanged until then.
--
-- RUN: Supabase SQL editor. Save a copy to ~/cabinet-orders/migrations/.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Before: is `orders` granted column-by-column, or table-wide? ──────
--
-- team_members has column-level SELECT grants (24 columns re-granted,
-- password_hash excluded) from the 2026-07-24 security review. If `orders`
-- were granted the same way, a NEW column would NOT be readable until it was
-- granted explicitly — and the symptom would be the column silently reading
-- null in the app rather than an error.
--
-- Run this FIRST and keep the number.

select
  (select count(*)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'orders')          as total_columns,
  (select count(*)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'orders'
      and grantee = 'authenticated' and privilege_type = 'SELECT')    as granted_to_authenticated;

-- If the two numbers MATCH, the grant is effectively table-wide and the new
-- column is readable automatically — do nothing further.
--
-- If granted_to_authenticated is LOWER, `orders` uses column-level grants and
-- you must run this after the ALTER below:
--
--   grant select (reported_at) on public.orders to authenticated;


-- ── 2. The column ────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists reported_at timestamptz;

comment on column public.orders.reported_at is
  'When a warranty claim was reported by the customer, carried from '
  'claim_submissions.received_at on promotion. NULL on all other flows and on '
  'every row predating the public claims intake. SLA rules using '
  'measureFrom "reported" fall back to created_at when this is NULL.';


-- ── 3. After: confirm ────────────────────────────────────────────────────

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'orders'
   and column_name  = 'reported_at';
-- expect exactly one row: reported_at | timestamp with time zone | YES

select count(*) as rows_with_reported_at
  from public.orders
 where reported_at is not null;
-- expect 0 — nothing writes this column yet


-- ── Not done here, deliberately ──────────────────────────────────────────
--
-- NO INDEX. Nothing filters or sorts on reported_at yet; the SLA rules read it
-- per row from data already loaded in the client. Add one when a query needs
-- it, not before.
--
-- NO public_api GRANT. That role gets a narrow column list on `orders` for the
-- lookup endpoint. reported_at is internal and is not part of it.
--
-- NO BACKFILL. Existing warranty claims were raised in-app, not reported
-- through the website, so created_at already IS the reported time for them.
-- The fallback in hoursSinceReported handles them correctly as-is.
