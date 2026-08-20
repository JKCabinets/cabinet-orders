-- ═══════════════════════════════════════════════════════════════════════
-- 2026-08-20 · payment hold acknowledgement
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT THIS IS FOR
--   Shopify's financial_status already reaches the OMS: the webhook writes
--   payment_status on BOTH the create and the orders/updated path, and
--   OrderTable already renders it as a pill. So when a customer refunds, the
--   OMS knows within seconds.
--
--   Nothing acts on it. A refunded order can move through Entered, into
--   production, and out for delivery with nobody noticing -- and the
--   confirmation email tells customers production starts within about 24
--   hours, so the window between "refund issued" and "parts cut" is short.
--
--   From now on a refund state BLOCKS forward stage movement until somebody
--   acknowledges it with a reason.
--
-- WHY TWO COLUMNS AND NOT A BOOLEAN
--   A boolean "acknowledged" would be cleared once and stay cleared. If a
--   partially_refunded order is acknowledged and then goes fully refunded, that
--   is a NEW fact and must block again.
--
--   Storing WHICH status was acknowledged makes the check exact:
--
--       blocked = isHoldStatus(payment_status)
--                 AND payment_hold_cleared_for IS DISTINCT FROM payment_status
--
--   Acknowledging "partially_refunded" therefore does not pre-clear a later
--   "refunded".
--
-- WHO ACKNOWLEDGED IT
--   Not stored here. It goes to order_activity, the same as the
--   delivery-proof override -- an append-only record of who did what and why,
--   rather than a column that only remembers the most recent person.
--
-- INERT ON ARRIVAL
--   Both columns are NULL on every row and nothing reads them until the code
--   lands. Adding them changes no behaviour.
--
-- RUN: Supabase SQL editor. Save a copy to ~/cabinet-orders/migrations/.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Before: are the grants table-wide? ────────────────────────────────
-- Same check as the reported_at and order_attachments.kind migrations.
-- team_members uses column-level grants; if `orders` did too, a new column
-- would read as null in the app rather than erroring.

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='orders')                as total_columns,
  (select count(*) from information_schema.column_privileges
    where table_schema='public' and table_name='orders'
      and grantee='authenticated' and privilege_type='SELECT')          as granted_to_authenticated;

-- MATCH -> table-wide, nothing further.
-- Second LOWER -> run after the ALTER below:
--   grant select (payment_hold_cleared_for, payment_hold_cleared_at)
--     on public.orders to authenticated;


-- ── 2. The columns ───────────────────────────────────────────────────────

alter table public.orders
  add column if not exists payment_hold_cleared_for text,
  add column if not exists payment_hold_cleared_at  timestamptz;

comment on column public.orders.payment_hold_cleared_for is
  'The payment_status value that was acknowledged, letting the order move '
  'forward despite a refund. Compared against the CURRENT payment_status, so '
  'acknowledging partially_refunded does not pre-clear a later full refund. '
  'NULL means nothing has been acknowledged.';

comment on column public.orders.payment_hold_cleared_at is
  'When the acknowledgement was made. Who made it, and why, is in '
  'order_activity -- append-only, unlike a column that only remembers the last '
  'person.';


-- ── 3. After: confirm ────────────────────────────────────────────────────

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='orders'
   and column_name in ('payment_hold_cleared_for','payment_hold_cleared_at')
 order by column_name;
-- expect two rows, both nullable

select count(*) as rows_with_an_acknowledgement
  from public.orders where payment_hold_cleared_for is not null;
-- expect 0 -- nothing writes it yet


-- ── 4. What is out there right now ───────────────────────────────────────
-- Worth knowing BEFORE the block goes live: any order already in a refund
-- state will be blocked the moment the code deploys.

select payment_status, count(*) as orders
  from public.orders
 where archived = false
 group by payment_status
 order by orders desc;

-- The statuses that will block: refunded, partially_refunded, voided.
-- If any active order is already in one of those, expect it to need an
-- acknowledgement before it can move -- which is the point, but better known
-- in advance than discovered by someone trying to advance a stage.


-- ── Not done here, deliberately ──────────────────────────────────────────
--
-- NO INDEX. The check reads one order at a time, already fetched by id.
--
-- NO CHECK CONSTRAINT on payment_hold_cleared_for. It mirrors whatever
-- Shopify put in payment_status, and constraining it would mean chasing
-- Shopify's vocabulary in a migration every time they add a state.
--
-- NO BACKFILL. An existing refunded order SHOULD block: nobody has looked at
-- it yet, and that is precisely the situation this exists to surface.
