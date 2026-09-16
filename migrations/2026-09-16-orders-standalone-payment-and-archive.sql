-- 2026-09-16  A Shopify group carries no payment fields and is never archived
--             on its own. Handoff items 19 and 11.
--
-- ⚠ RUN ONLY AFTER THE COMMIT THAT ADDS THIS FILE IS DEPLOYED.
-- Before that commit, the Shopify webhook writes payment_status onto every
-- group -- at ingest and on every orders/updated. With this constraint in
-- place those writes fail: group updates (notes, SKUs, tracking) stop landing,
-- and a new checkout's group insert fails and takes its project with it.
--
-- WHAT IT DOES, in one transaction:
--
--   1. Blanks payment_status, payment_hold_cleared_for and
--      payment_hold_cleared_at on project-linked rows. Nothing reads them
--      there since patch_payment_through_project.py (a58f7e0): a checkout's
--      payment lives on its project, and the hold, its acknowledgement, the
--      refund banner and the production-complete cron all read it there.
--
--   2. orders_payment_standalone_only -- a project-linked row carries none of
--      the three. Same form as orders_total_price_standalone_only. All three,
--      because a status and its acknowledgement are one fact: an
--      acknowledgement left on a group would compare against a status that
--      lives somewhere else.
--
--   3. orders_archived_standalone_only -- a project-linked row is never
--      archived on its own; its PROJECT is (decided 2026-09-15, refused by
--      both order routes since 76115c7). The routes keep their 422 so a caller
--      is told why; this is what makes every other writer -- a script, the
--      SQL editor, a future route -- unable to create the SHO-1052 state.
--
-- Custom jobs and warranty claims (project_id NULL) are untouched by all
-- three. Idempotent: the update matches nothing on a second run, and each
-- constraint is added only if absent. Checked before writing, on 2026-09-16:
-- 2 project-linked rows with a payment_status, 0 with an acknowledgement,
-- 0 archived; the only triggers on orders are orders_updated_at and
-- trg_orders_bump_stage_entered_at, and no function mentions these columns.

begin;

update public.orders
set payment_status = null,
    payment_hold_cleared_for = null,
    payment_hold_cleared_at = null
where project_id is not null
  and (payment_status is not null
    or payment_hold_cleared_for is not null
    or payment_hold_cleared_at is not null);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_payment_standalone_only'
  ) then
    alter table public.orders add constraint orders_payment_standalone_only
      check (project_id is null or (payment_status is null
                                    and payment_hold_cleared_for is null
                                    and payment_hold_cleared_at is null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_archived_standalone_only'
  ) then
    alter table public.orders add constraint orders_archived_standalone_only
      check (archived = false or project_id is null);
  end if;
end $$;

commit;

-- Verify, as a separate statement afterwards:
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.orders'::regclass and contype = 'c'
-- order by conname;
