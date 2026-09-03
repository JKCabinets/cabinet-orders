-- ═══════════════════════════════════════════════════════════════════════
-- 2026-09-01 · claim_submissions + the claim-photos bucket
-- Public claims intake — the staging table
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHAT
--   Where POST /api/public/claims lands. A customer submission, NOT a warranty
--   claim. A human reads it and promotes it to a `warranty` row in `orders`.
--
-- WHY A STAGING TABLE RATHER THAN INSERTING A WARRANTY ROW DIRECTLY
--   The order number is whatever the customer typed. It may be wrong, may be a
--   quote reference, may be an order that is not theirs. Inserting straight
--   into `orders` would mean either a foreign key that REJECTS a real claim
--   because somebody mistyped their own order number -- inside a 48-hour
--   window that Terms 12.3 makes a condition precedent -- or an orders table
--   accumulating rows that point at nothing.
--
--   So: accept everything, resolve nothing, let a person match it up.
--
-- ⚠ RLS IS ENABLED IN THE SAME TRANSACTION AS THE CREATE, BEFORE A ROW EXISTS.
--   On 2026-09-01 the `projects` table was found readable AND writable by the
--   public anon key: it had been created by hand, Supabase's default
--   privileges granted ALL to anon, and RLS was never switched on. This table
--   holds names, emails, phone numbers and photographs of people's homes, and
--   it is created the same way. The window between `create table` and `enable
--   row level security` is the entire vulnerability, so there isn't one.
--
-- RUN: Supabase SQL editor. Save a copy to ~/cabinet-orders/migrations/.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Before: confirm it does not already exist ─────────────────────────

select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name = 'claim_submissions';
-- expect ZERO rows. If one comes back, stop and read it first.


-- ── 2. The table, its policies and its bucket, atomically ────────────────

begin;

create table public.claim_submissions (
  id            uuid primary key default gen_random_uuid(),

  -- ⚠ WHEN THE CUSTOMER SENT IT, and the reason this table has legal weight.
  -- Terms 12.3 makes the reporting windows conditions precedent, so a claim
  -- submitted Thursday 6pm and promoted Monday 10am was reported THURSDAY.
  -- orders.reported_at is copied from this column on promotion; see the
  -- 2026-08-04 migration for why that is a separate column from created_at.
  received_at   timestamptz not null default now(),

  -- What the customer typed, character for character. Kept because it is the
  -- evidence of what they actually reported, and because a normalisation bug
  -- must never be able to destroy the original.
  order_number_raw text not null,
  -- Best-effort normalisation. NOT a foreign key and NOT validated: a claim
  -- with an unrecognisable order number is still a claim, and refusing it
  -- would refuse it inside the window that decides whether it is valid.
  order_number     text,

  delivered_on  date,
  claim_type    text not null
                  check (claim_type in ('visible', 'shortage', 'concealed', 'defect')),

  claimant_name  text not null,
  claimant_email text not null,
  claimant_phone text,
  message        text,

  -- ⚠ THE TERMS IN FORCE WHEN THE CLAIM WAS MADE, not when it is read. Stored
  -- as sent by the form so a claim is judged against what the customer
  -- actually agreed to.
  policy_version text,

  -- Storage paths in the claim-photos bucket. Paths only: the objects live in
  -- storage and the bucket is private, so these are useless without a signed
  -- URL minted by the OMS.
  photo_paths   jsonb not null default '[]'::jsonb,

  -- new → promoted | rejected. A human decides; nothing automated moves this.
  status        text not null default 'new'
                  check (status in ('new', 'promoted', 'rejected')),

  -- Set on promotion. The WAR-1033-1 row this became, if it became one.
  promoted_to_order_id text,
  promoted_at   timestamptz,
  promoted_by   text,
  review_notes  text
);

comment on table public.claim_submissions is
  'Raw public warranty-claim submissions awaiting human promotion to a '
  'warranty row in orders. received_at carries to orders.reported_at and has '
  'legal weight under Terms 12.3. Never written to by anything but '
  'POST /api/public/claims, and only ever read by staff through the OMS.';

-- The triage queue reads unpromoted submissions, newest first.
create index claim_submissions_status_received_idx
  on public.claim_submissions (status, received_at desc);

-- Matching a submission to an order during promotion.
create index claim_submissions_order_number_idx
  on public.claim_submissions (order_number)
  where order_number is not null;

-- ⚠ RLS ON, IN THIS TRANSACTION, BEFORE ANY ROW EXISTS.
alter table public.claim_submissions enable row level security;

-- Mirrors the orders and projects policy set. `authenticated` is a staff
-- member holding a token minted by /api/realtime-token; there is no
-- customer-facing Supabase login. `anon` matches nothing and gets nothing.
create policy "authenticated_read_all_claim_submissions"
  on public.claim_submissions for select
  to authenticated
  using (true);

create policy "no_direct_insert"
  on public.claim_submissions for insert
  to public
  with check (false);

create policy "no_direct_update"
  on public.claim_submissions for update
  to public
  using (false);

create policy "no_direct_delete"
  on public.claim_submissions for delete
  to public
  using (false);

-- ── The bucket ───────────────────────────────────────────────────────────
--
-- ⚠ PRIVATE, AND SEPARATE FROM order-attachments. Two reasons. Customer-
-- submitted files should not sit in the bucket the delivery-proof gate counts.
-- And a claim photo is a photograph of somebody's home, submitted before
-- anyone has verified who they are.
--
-- public = false means no object is readable without a signed URL, which only
-- the service role can mint.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-photos', 'claim-photos', false,
  10485760,                                   -- 10 MB, matching the form
  array['image/jpeg', 'image/png']            -- matching the form's accept
)
on conflict (id) do nothing;

-- No storage.objects policies. Without any, only the service role can read or
-- write, which is exactly the intent: uploads go through the route, reads go
-- through a signed URL the OMS mints for a logged-in staff member.

commit;


-- ── 3. After: confirm ────────────────────────────────────────────────────

select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace and relname = 'claim_submissions';
-- expect: claim_submissions | true

select policyname, roles, cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'claim_submissions'
 order by policyname;
-- expect 4 rows

select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'claim-photos';
-- expect: claim-photos | false | 10485760 | {image/jpeg,image/png}

select count(*) as submissions from public.claim_submissions;
-- expect 0

-- ⚠ THE REAL CONFIRMATION IS FROM OUTSIDE. This editor runs as postgres and
-- bypasses RLS. Re-run the container probe with claim_submissions added to the
-- list; expect HTTP 200 [] for it, the same as projects and orders.


-- ── Not done here, deliberately ──────────────────────────────────────────
--
-- NO FOREIGN KEY to projects or orders. See above: a customer mistyping their
-- own order number must not lose their claim.
--
-- NO orders ROW. Promotion is a separate, human step and is not built yet.
-- Nothing reads this table until the triage queue exists, so it is inert on
-- arrival.
--
-- NO ip OR user_agent COLUMN. They would be the only fields here that the
-- customer did not choose to give us, and nothing in the triage flow needs
-- them. Bot submissions are refused at the route and never reach this table.
