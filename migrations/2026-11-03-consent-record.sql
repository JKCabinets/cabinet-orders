-- 2026-11-03-consent-record.sql -- feature 11 (SESSION-HANDOFF-2026-11-03.md §6.2)
--
-- The customer's consent record, completed as the website team asked
-- ("Website to OMS: consent record, 2026-10-29"): the Refund Policy's date beside
-- the four terms_* values, and the checkout's IP address and browser as Shopify
-- records them. On the PROJECT -- one Shopify order, one agreement. See
-- lib/consent.ts.
--
-- ⚠ TEXT, AS SENT, like the four (2026-10-07): for a dispute the evidence is
-- what Shopify sent, and a typed column could reject an odd value ("unknown")
-- and fail the insert of the whole order.
--
-- ⚠ WHO CAN SEE THEM: `projects` is in supabase_realtime with no column list,
-- and authenticated_read_all_projects reads every column -- so these reach staff
-- screens, as the customer's email and phone do, and nothing public (the public
-- lookup names its columns). Checked 2026-11-03.
--
-- Safe to run twice. Run it BEFORE deploying: the webhook writes these columns.
-- The LAST statement is the check.

begin;

alter table public.projects add column if not exists refund_policy_updated text;
alter table public.projects add column if not exists checkout_ip text;
alter table public.projects add column if not exists checkout_user_agent text;

comment on column public.projects.refund_policy_updated is
  'The "Last updated" date of the Refund Policy the customer agreed to, as the website sent it (Shopify "Refund Policy updated"; "unknown" if the website could not read it). NULL: not sent (orders before 2026-10-29) or consent recorded by email.';
comment on column public.projects.checkout_ip is
  'The checkout''s IP address as Shopify recorded it (client_details.browser_ip). NULL: Shopify recorded none.';
comment on column public.projects.checkout_user_agent is
  'The checkout''s browser as Shopify recorded it (client_details.user_agent). NULL: Shopify recorded none.';

commit;

-- after_migration: expect new_columns 3, all_text_nullable true, published true.
select
  count(*)                                                    as new_columns,
  bool_and(data_type = 'text' and is_nullable = 'YES')        as all_text_nullable,
  (select array['refund_policy_updated', 'checkout_ip', 'checkout_user_agent']::name[] <@ attnames
     from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects')
                                                              as published
from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('refund_policy_updated', 'checkout_ip', 'checkout_user_agent');
