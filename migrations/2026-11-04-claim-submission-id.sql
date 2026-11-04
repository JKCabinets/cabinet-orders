-- 2026-11-04-claim-submission-id.sql -- feature 12 (SESSION-HANDOFF-2026-11-03.md §7.3)
--
-- Two columns on claim_submissions, for the claims form:
--
--   submission_id  the form's own id for ONE submission, the same on every
--                  resubmit until one succeeds (the website team, 2026-11-04; the
--                  quote form has had it since 2026-09-24). Partially unique: a
--                  repeat -- or twenty at once -- is ONE claim, and the route
--                  answers each with the reference already issued.
--   photos_sent    the names of the photos the form sent, recorded when the claim
--                  is saved -- feature 12 stores the photos AFTER answering.
--                  photo_paths holds the ones stored; a name here with none
--                  stored never arrived, and the claim's Help Scout conversation
--                  says so. '[]' on every claim saved before.
--
-- ⚠ AS SENT, capped as the route caps it (100 characters, as the quote form's).
-- Nothing writes either until feature 12's code, so it runs first. Safe to run
-- twice. The LAST statement is the check.

begin;

alter table public.claim_submissions add column if not exists submission_id text;
alter table public.claim_submissions add column if not exists photos_sent jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_submission_id_check') then
    alter table public.claim_submissions add constraint claim_submissions_submission_id_check
      check (submission_id is null or char_length(submission_id) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_photos_sent_check') then
    alter table public.claim_submissions add constraint claim_submissions_photos_sent_check
      check (jsonb_typeof(photos_sent) = 'array');
  end if;
end $$;

create unique index if not exists claim_submissions_submission_id_unique
  on public.claim_submissions (submission_id) where submission_id is not null;

comment on column public.claim_submissions.submission_id is
  'The claims form''s own id for one submission, the same on every resubmit until one succeeds. Unique where present: a repeat is the same claim. NULL: the form sent none, or staff entered the claim.';
comment on column public.claim_submissions.photos_sent is
  'The names of the photos the form sent, recorded when the claim was saved (feature 12 stores the photos after answering). photo_paths holds those stored; a name here with none stored never arrived. [] on claims saved before 2026-11-04.';

commit;

-- after_migration: expect new_columns 2, unique_index 1, checks 2, and every
-- existing claim untouched (claims_untouched = claims).
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'claim_submissions'
      and column_name in ('submission_id', 'photos_sent'))                         as new_columns,
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'claim_submissions_submission_id_unique'
      and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (submission_id IS NOT NULL)%') as unique_index,
  (select count(*) from pg_constraint
    where conrelid = 'public.claim_submissions'::regclass
      and conname in ('claim_submissions_submission_id_check', 'claim_submissions_photos_sent_check')) as checks,
  (select count(*) from public.claim_submissions)                                  as claims,
  (select count(*) from public.claim_submissions
    where submission_id is null and photos_sent = '[]'::jsonb)                     as claims_untouched;
