-- 2026-10-28  Acknowledgment files (Garrett, 2026-10-28).
--
-- 1. An acknowledgment is KEPT AS A FILE, of its own kind, `acknowledgment`, in
--    the order's "Acknowledgments" group -- every submission, pass or fail; a
--    failed one's file is deleted when the next acknowledgment is submitted.
-- 2. "Attach a file" for the acknowledgment-or-attachment requirement files
--    into the same group, made by the OMS and found by ROLE, `acknowledgments`.
--
-- ⚠ TWO NEW VALUES IN TWO CONSTRAINED COLUMNS (2026-09-30's lesson: "a new value
-- in a constrained column is TWO changes -- the writer and the constraint").
-- Both lists are written out in full here, from the live definitions.
--
-- ⚠ WHY A KIND OF ITS OWN. "An acknowledgment or an attachment" is satisfied by
-- ANY file. Kept as an ordinary file, every acknowledgment -- a FAILED one too --
-- would satisfy it and a red acknowledgment would no longer block Entered. The
-- gates count every kind EXCEPT this one (the code, deployed with this).
--
-- Run BEFORE the deploy. Idempotent. The last statement is the check.

begin;

alter table public.order_attachments
  drop constraint if exists order_attachments_kind_check;
alter table public.order_attachments
  add constraint order_attachments_kind_check
  check (kind = any (array[
    'general'::text,            -- anything staff attach
    'proof_of_delivery'::text,  -- the signed receipt the delivery gate reads
    'customer_upload'::text,    -- arrived with a quote request or a claim
    'acknowledgment'::text      -- a manufacturer acknowledgment, as submitted (2026-10-28)
  ]));

alter table public.order_file_groups
  drop constraint if exists order_file_groups_role_check;
alter table public.order_file_groups
  add constraint order_file_groups_role_check
  check (role in ('customer_uploads', 'proof_of_delivery', 'acknowledgments', 'area', 'set'));

-- One per role per order, now three roles. Re-made with the wider predicate;
-- file_group_for_role's ON CONFLICT names exactly this predicate.
drop index if exists public.order_file_groups_one_per_role;
create unique index order_file_groups_one_per_role
  on public.order_file_groups (order_id, role)
  where role in ('customer_uploads', 'proof_of_delivery', 'acknowledgments');

create or replace function public.file_group_for_role(p_order_id text, p_role text, p_name text)
returns bigint
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  gid bigint;
begin
  if p_role not in ('customer_uploads', 'proof_of_delivery', 'acknowledgments') then
    raise exception 'file_group_for_role: % is not a role the OMS makes', p_role;
  end if;
  insert into public.order_file_groups (order_id, name, role)
  values (p_order_id, p_name, p_role)
  on conflict (order_id, role) where role in ('customer_uploads', 'proof_of_delivery', 'acknowledgments') do nothing;
  select id into gid from public.order_file_groups where order_id = p_order_id and role = p_role;
  return gid;
end
$$;
revoke all on function public.file_group_for_role(text, text, text) from public, anon, authenticated;
grant execute on function public.file_group_for_role(text, text, text) to service_role;

-- Each submission's file. SET NULL: deleting the file (a failed one replaced,
-- or by hand) keeps the submission's history row.
alter table public.order_acknowledgments
  add column if not exists attachment_id bigint references public.order_attachments(id) on delete set null;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'kinds', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_attachments_kind_check'),
  'group_roles', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_file_groups_role_check'),
  'one_per_role', (select pg_get_indexdef(indexrelid) from pg_index where indexrelid = 'public.order_file_groups_one_per_role'::regclass),
  'ack_attachment_id', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_acknowledgments' and column_name = 'attachment_id')
) as after_migration;
