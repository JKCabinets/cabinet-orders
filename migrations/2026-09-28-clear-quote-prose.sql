-- 2026-09-28  Clear the quote prose out of the customer note.
--
-- The webhook wrote the whole submission into `notes` -- the field the modal
-- shows as "visible to the customer, written to the Shopify order". It stopped
-- doing that in the commit beside this file. These are the rows written before.
--
-- ⚠ NOTHING IS LOST. Every line of that prose is in `quote_submission`, and the
-- preferences panel renders it in the words the customer read. Only rows that
-- HAVE the column are touched, so a row from before the capture patch keeps its
-- prose -- for those it is the only copy.
--
-- What the customer typed in their own message survives: it was appended as
-- "Notes: ...", and is kept as the whole note.

begin;

update public.orders
set notes = coalesce(
      nullif(trim(both from (regexp_match(notes, '^Notes: (.*)$', 'm'))[1]), ''),
      '')
where quote_submission is not null
  and notes like '%QUOTE REQUEST%';

commit;

-- Verify, as separate statements afterwards:
--
-- select id, left(notes, 60) as note, quote_submission->'text'->>'notes' as their_message
-- from orders where quote_submission is not null order by created_at desc;
--
-- select count(*) as prose_left from orders where notes like '%QUOTE REQUEST%';
