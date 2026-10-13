-- 2026-10-13-project-consent-evidence.sql
--
-- Consent STAFF obtained by email (2026-10-13): an order that arrived without
-- the website's terms consent is cleared by recording the customer's agreement
-- in their Help Scout conversation -- the conversation is the record. These
-- say where it is and who recorded it; the agreement itself lands in the four
-- terms_* columns (2026-10-07-project-terms-consent.sql) with source 'email'.
-- NULL on consent the website sent.
--
-- Safe to run twice. Run it BEFORE deploying. The LAST statement is the check.

begin;

alter table public.projects add column if not exists consent_evidence text;
alter table public.projects add column if not exists consent_recorded_by text;
alter table public.projects add column if not exists consent_recorded_at timestamptz;

comment on column public.projects.consent_evidence is
  'Consent recorded by staff: the Help Scout conversation where the customer agreed. NULL for consent the website sent.';

commit;

-- after_migration: expect 3.
select count(*) as consent_evidence_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('consent_evidence', 'consent_recorded_by', 'consent_recorded_at');
