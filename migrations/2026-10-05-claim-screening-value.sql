-- 2026-10-05  Keep what the honeypot field contained, so a flag can be judged.
--
-- ⚠ WHY. The first genuine claim from the live page (CR-1003, 2026-10-05) came
-- in flagged `honeypot`: Garrett filled the form with Chrome's autofill, and the
-- hidden field -- labelled "Company website" -- was filled with it. The claim was
-- kept, as decided on 2026-10-01. But the flag recorded only THAT the field was
-- filled, not WITH WHAT, so nothing could tell an autofilled company name from
-- a bot's junk. `screening_value` keeps the first 100 characters, for honeypot
-- flags only, shown on the triage card.
--
-- Idempotent and DROP-free. The LAST statement is the check.

begin;

alter table public.claim_submissions
  add column if not exists screening_value text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_screening_value_check') then
    alter table public.claim_submissions
      add constraint claim_submissions_screening_value_check
      -- ⚠ `is not distinct from`, NOT `=`: with screening null, `screening = 'honeypot'`
      -- is NULL, and a CHECK passes on NULL -- the first version let a value in
      -- with no flag at all (caught in testing, 2026-10-05).
      check (screening_value is null or (screening is not distinct from 'honeypot' and char_length(screening_value) <= 100));
  end if;
end
$$;

comment on column public.claim_submissions.screening_value is
  'What the honeypot field contained (first 100 characters), for honeypot flags only. An autofilled company name says "person"; junk says "bot". Added 2026-10-05.';

commit;

select json_build_object(
  'column', (select data_type from information_schema.columns
              where table_schema = 'public' and table_name = 'claim_submissions' and column_name = 'screening_value'),
  'check', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'claim_submissions_screening_value_check'),
  'honeypot_flags_so_far', (select count(*) from public.claim_submissions where screening = 'honeypot')
) as after_migration;
-- Expect: column text; the check; honeypot_flags_so_far 1 or more (CR-1003).
