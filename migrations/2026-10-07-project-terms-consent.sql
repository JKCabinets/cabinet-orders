-- 2026-10-07-project-terms-consent.sql
--
-- The customer's agreement to our policies, as the website records it on every
-- order (website session, 2026-10-07). Four values from Shopify's "Additional
-- details", kept on the PROJECT -- one Shopify order, one agreement. See
-- lib/consent.ts.
--
-- ⚠ TEXT, AS SENT. For a chargeback the evidence is what Shopify sent; a typed
-- column could reject an odd value and fail the insert of the whole order.
--
-- Safe to run twice. Run it BEFORE deploying: the webhook writes these columns.

begin;

alter table public.projects add column if not exists terms_agreed text;
alter table public.projects add column if not exists terms_version text;
alter table public.projects add column if not exists consent_wording text;
alter table public.projects add column if not exists consent_source text;

comment on column public.projects.terms_agreed is
  'When the customer ticked the policies box, UTC, as the website sent it (Shopify "Terms agreed"). NULL: no consent recorded.';
comment on column public.projects.terms_version is
  'The Terms of Service version at that moment (Shopify "Terms version").';
comment on column public.projects.consent_wording is
  'Which wording they agreed to (Shopify "Consent wording"); the text is in lib/consent.ts.';
comment on column public.projects.consent_source is
  'Where they agreed: cart or kitchen designer (Shopify "Consent source").';

commit;

-- after_migration: expect four rows, all text, all nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('terms_agreed', 'terms_version', 'consent_wording', 'consent_source')
order by column_name;
