-- 2026-10-01  Claim submissions get a reference a customer can read out, and the
-- spam checks flag a submission instead of throwing it away.
--
-- ⚠ THE REFERENCE. The website's received page shows the customer a reference
-- of at most 32 letters, digits and hyphens. The submission id is a uuid, 36
-- characters, and nobody can read one down a phone. So each submission gets
-- `ref`: CR-1001, CR-1002, ... from an identity column, generated in the table
-- so the route, the triage screen and the SQL editor all show the same thing.
-- "CR" -- claim report -- and not a WAR- number on purpose: no warranty claim
-- exists until a person promotes the submission, and a reference that looked
-- like one would be a promise not yet made. Existing rows get theirs now.
--
-- ⚠ THE SCREENING FLAG (decided by Garrett 2026-10-01). The endpoint used to
-- drop a submission that filled the hidden `website` field, or arrived within
-- two seconds, behind a fake success. But some browsers autofill a field named
-- "website" despite autocomplete="off", and the endpoint's own principle is that
-- a lost claim is worse than spam: a customer told "received" whose claim was
-- binned has lost their reporting window. Turnstile now runs FIRST, so anything
-- reaching these checks has already proven itself to Cloudflare. It is kept, at
-- `new` like any other, with `screening` saying why to look twice.
--
-- ⚠ STEP 5's DATA FIX. Promotion copied a customer's claim photos into the
-- claim as `general`, so they sat under Designer and the Customer bin said the
-- customer attached nothing. The route now writes `customer_upload`; this moves
-- the rows it already wrote. `uploaded_by = 'Customer (claim form)'` is written
-- by that route alone, so it names exactly those rows and nothing else.
--
-- Idempotent and DROP-free: a second run changes nothing. The LAST statement is
-- the check, so one run in the SQL editor shows its own result -- "Success. No
-- rows returned" would mean it did not run to the end.

begin;

alter table public.claim_submissions
  add column if not exists ref_no bigint generated always as identity (start with 1001);

alter table public.claim_submissions
  add column if not exists ref text generated always as ('CR-' || ref_no::text) stored;

create unique index if not exists claim_submissions_ref_idx
  on public.claim_submissions (ref);

alter table public.claim_submissions
  add column if not exists screening text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_screening_check') then
    alter table public.claim_submissions
      add constraint claim_submissions_screening_check
      check (screening is null or screening in ('honeypot', 'too_fast'));
  end if;
end
$$;

comment on column public.claim_submissions.ref is
  'What the customer is told: CR- and ref_no. Not a claim number -- no warranty row exists until promotion.';
comment on column public.claim_submissions.screening is
  'Why the spam checks flagged it, or null. honeypot: the hidden website field was filled. too_fast: sent within 2 s. Kept, not dropped (2026-10-01).';

update public.order_attachments
   set kind = 'customer_upload'
 where uploaded_by = 'Customer (claim form)'
   and kind = 'general';

commit;

select json_build_object(
  'columns', (select json_agg(column_name order by column_name) from information_schema.columns
               where table_schema = 'public' and table_name = 'claim_submissions'
                 and column_name in ('ref_no', 'ref', 'screening')),
  'submissions', (select count(*) from public.claim_submissions),
  'without_ref', (select count(*) from public.claim_submissions where ref is null),
  'refs', (select coalesce(json_agg(ref order by ref_no), '[]') from public.claim_submissions),
  'screening_check', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'claim_submissions_screening_check'),
  'claim_photos_still_general', (select count(*) from public.order_attachments
                                  where uploaded_by = 'Customer (claim form)' and kind = 'general')
) as after_migration;
-- Expect: columns [ref, ref_no, screening]; without_ref 0; refs CR-1001 upward;
-- the screening check; claim_photos_still_general 0.
