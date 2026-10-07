-- 2026-10-06  Claims that arrive by email, entered by staff.
--
-- A customer who cannot use the claim form -- or whose send failed, and who was
-- told by the page to email instead -- emails the claim to info@, where it
-- lands in Help Scout. Staff now enter it in the OMS as a submission like any
-- other (Garrett, 2026-10-06):
--
--   - by hand: the details, the photos, and WHEN THE EMAIL ARRIVED, which is
--     the report date the claim is judged against (Terms 12.3; the Refund
--     Policy and the Terms both say an email inside the window counts);
--   - with the Help Scout conversation the email started, so the push ADOPTS
--     it -- `oms-claim` added to its tags, its subject set -- and the website's
--     workflow confirms in the customer's own thread, instead of opening a
--     second one (the website's note of 2026-10-05, item 7).
--
-- ⚠ ONE CLAIM PER CONVERSATION (Garrett): a customer may make several claims,
-- but one email thread is one claim. A unique index, so the second entry of
-- the same email is refused by the database, not by a check that can race.
--
-- Idempotent and DROP-free. The LAST statement is the check.

begin;

alter table public.claim_submissions
  add column if not exists source text not null default 'website';
alter table public.claim_submissions add column if not exists entered_by text;
alter table public.claim_submissions add column if not exists email_conversation_id bigint;

create unique index if not exists claim_submissions_email_conversation_idx
  on public.claim_submissions (email_conversation_id)
  where email_conversation_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_source_check') then
    alter table public.claim_submissions
      add constraint claim_submissions_source_check check (source in ('website', 'email'));
  end if;
  -- An emailed claim has its conversation and the person who entered it; a
  -- website claim has neither. Both sides are NOT NULL booleans.
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_email_has_conversation') then
    alter table public.claim_submissions
      add constraint claim_submissions_email_has_conversation
      check ((source = 'email') = (email_conversation_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'claim_submissions_email_has_enterer') then
    alter table public.claim_submissions
      add constraint claim_submissions_email_has_enterer
      check (source <> 'email' or entered_by is not null);
  end if;
end
$$;

comment on column public.claim_submissions.source is
  'website: sent by the claim form. email: entered by staff from a customer''s email (2026-10-06).';
comment on column public.claim_submissions.email_conversation_id is
  'For an emailed claim, the Help Scout conversation the customer''s email started. The push adopts it rather than creating one. One claim per conversation.';

commit;

select json_build_object(
  'columns', (select json_agg(column_name order by column_name) from information_schema.columns
               where table_schema = 'public' and table_name = 'claim_submissions'
                 and column_name in ('source', 'entered_by', 'email_conversation_id')),
  'sources', (select coalesce(json_object_agg(source, n), '{}') from
               (select source, count(*) n from public.claim_submissions group by 1) t),
  'constraints', (select json_agg(conname order by conname) from pg_constraint
                   where conrelid = 'public.claim_submissions'::regclass
                     and conname in ('claim_submissions_source_check', 'claim_submissions_email_has_conversation',
                                     'claim_submissions_email_has_enterer')),
  'one_per_conversation', (select indexdef from pg_indexes where indexname = 'claim_submissions_email_conversation_idx')
) as after_migration;
-- Expect: three columns; every existing row a website claim; three constraints;
-- the unique index.
