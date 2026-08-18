-- ═══════════════════════════════════════════════════════════════════════
-- 2026-08-18 · order_attachments.kind
-- Proof-of-delivery gate — step 1 of 2 (the column)
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY
--   At cross dock → Delivered is going to require a signed delivery receipt,
--   mirroring the New → Entered attachment gate. But a plain "does this order
--   have an attachment" check is useless here: every order at cross dock
--   already carries the manufacturer acknowledgment PDFs uploaded back at the
--   Entered stage, so the gate would pass immediately and enforce nothing.
--
--   The attachment has to be identifiable as proof of delivery specifically.
--
-- WHAT IT UNLOCKS
--   The Liquid on the order confirmation already tells every customer:
--     "You or another adult will need to be there to sign the delivery
--      receipt. Please inspect everything before you sign... Visible shipping
--      damage must be reported to us within 48 hours of delivery."
--   That 48-hour window is Terms 12.3, and it runs from delivery. Right now
--   nothing records that a receipt was signed, so the promise and the record
--   do not match. This is also what makes the planned "delivered and signed
--   for" customer notification honest rather than aspirational.
--
--   It is also on the chargeback evidence list as signed proof of delivery.
--
-- INERT ON ARRIVAL
--   Every existing row becomes 'general'. Nothing reads this column until
--   step 2 adds the gate, and no upload sets anything but the default until
--   the route patch lands alongside this.
--
-- RUN: Supabase SQL editor. Save a copy to ~/cabinet-orders/migrations/.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Before: table-wide grants, or column-by-column? ───────────────────
--
-- Same check as the reported_at migration. team_members uses column-level
-- SELECT grants (24 columns re-granted, password_hash excluded) from the
-- 2026-07-24 security review. If order_attachments were granted the same way,
-- a new column would be invisible to the app — reading as null rather than
-- erroring, which is the hard kind of bug to spot.

select
  (select count(*)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'order_attachments')   as total_columns,
  (select count(*)
     from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'order_attachments'
      and grantee = 'authenticated' and privilege_type = 'SELECT')        as granted_to_authenticated;

-- Numbers MATCH  → grant is table-wide, nothing further to do.
-- Second is LOWER → column-level grants; after the ALTER below, run:
--
--   grant select (kind) on public.order_attachments to authenticated;


-- ── 2. The column ────────────────────────────────────────────────────────
--
-- NOT NULL DEFAULT is safe here: Postgres 11+ adds a defaulted column without
-- rewriting the table, so this is a metadata-only change even on a large one.

alter table public.order_attachments
  add column if not exists kind text not null default 'general';

comment on column public.order_attachments.kind is
  'What this attachment IS, not what type of file it is (that is file_type). '
  '''general'' covers manufacturer acknowledgments, exports and anything else. '
  '''proof_of_delivery'' is a signed delivery receipt and is what gates the '
  'At cross dock -> Delivered transition.';


-- ── 3. Constrain the values ──────────────────────────────────────────────
--
-- A whitelist rather than free text. Without it a typo in the upload route
-- ('proof-of-delivery' with hyphens, say) would insert happily and the gate
-- would never see it — failing closed in the most confusing way possible:
-- the file is visibly attached, and the button still refuses.
--
-- NOT VALID then VALIDATE would let this skip the existing-row scan, but the
-- table is small and every row is 'general' by construction, so validate now.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_attachments_kind_check'
  ) then
    alter table public.order_attachments
      add constraint order_attachments_kind_check
      check (kind in ('general', 'proof_of_delivery'));
  end if;
end $$;


-- ── 4. After: confirm ────────────────────────────────────────────────────

select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'order_attachments'
   and column_name  = 'kind';
-- expect: kind | text | NO | 'general'::text

select kind, count(*) as rows
  from public.order_attachments
 group by kind
 order by kind;
-- expect a single row: general | <all existing attachments>

select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.order_attachments'::regclass
   and conname = 'order_attachments_kind_check';
-- expect the CHECK with both allowed values


-- ── Not done here, deliberately ──────────────────────────────────────────
--
-- NO INDEX. The gate looks up attachments for ONE order at a time, already
-- filtered by order_id. Adding an index on a two-value column of a small
-- table would earn nothing.
--
-- NO BACKFILL of proof_of_delivery. There is no way to know retrospectively
-- which historical file was a signed receipt, and guessing would put false
-- evidence into a table the chargeback process is meant to rely on. Orders
-- already Delivered are past the gate regardless; it only applies going
-- forward.
--
-- NO CHANGE to the storage bucket. Proof-of-delivery files are internal
-- documents uploaded by staff, so order-attachments is the right home. This
-- is NOT the claims bucket from the public intake plan, which holds anonymous
-- customer uploads and is deliberately separate.
