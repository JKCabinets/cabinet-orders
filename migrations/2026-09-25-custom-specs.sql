-- 2026-09-25  Custom job specifications, and files that belong to one.
--
-- ⚠ RUN BEFORE DEPLOYING the commit that reads these. Nothing writes them yet:
-- this is the shape the custom-job modal will fill (handoff item 24).
--
-- WHAT A CUSTOM JOB IS. Specs and files, not SKUs. A designer owns it end to
-- end. The customer's request lives in quote_submission, untouched; what the
-- customer actually CHOSE lives here.
--
--   orders.custom_specs  jsonb
--
--     { "v": 1, "areas": [
--         { "id": "a_k3f9", "name": "Kitchen", "sets": [
--             { "id": "s_8b21", "name": "Perimeter",
--               "manufacturer": "...", "door_style": "Shaker",
--               "color": "Painted Blue", "notes": "" },
--             { "id": "s_5c07", "name": "Island", ... } ] },
--         { "id": "a_p2d8", "name": "Master Bath", "sets": [ ... ] } ] }
--
--     ⚠ ONE SET IS ONE COMBINATION of manufacturer, door style and colour. A
--     kitchen whose island differs from its perimeter is TWO SETS under one
--     area, not one set with two styles. That is the whole reason the shape is
--     nested rather than flat.
--
--     ⚠ "v" IS THE SHAPE'S VERSION. The website's payload carries form_version
--     and it has already saved us guessing once. This shape is ours and it will
--     grow; a reader should be able to tell which version it is holding without
--     inferring it from which keys happen to exist.
--
--     ⚠ IDS ARE GENERATED AT CREATION AND NEVER REUSED. Renaming an area or a
--     set must not break the files attached to it, so nothing links by name.
--
--   order_attachments.spec_ref  text
--
--     The id of the area or set a file belongs to, or NULL for a file that
--     belongs to the job as a whole. No foreign key: the target lives inside a
--     JSON document, and a constraint cannot follow it there. Deleting an area
--     or a set therefore CLEARS this pointer in application code rather than
--     deleting the file -- decided 2026-09-24, because files change often and
--     losing a drawing to a renamed room would be the worse failure.
--
-- Both columns are nullable with no default: absent means "none yet", which is
-- what every row created any other way means.
--
-- ⚠ NOT CHANGED, DELIBERATELY: orders.door_style and orders.color stay
-- NOT NULL DEFAULT ''. They are the designer's single selection, and '' already
-- means unset everywhere. Making them nullable would create a SECOND way to say
-- unset, which is the shape this project keeps removing.
--
-- Idempotent: columns and index are added only if absent.

begin;

alter table public.orders            add column if not exists custom_specs jsonb;
alter table public.order_attachments add column if not exists spec_ref     text;

-- The modal groups a job's files by area and set on every open.
create index if not exists order_attachments_order_spec
  on public.order_attachments (order_id, spec_ref);

commit;

-- Verify, as separate statements afterwards:
--
-- select table_name, column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and (table_name, column_name) in (('orders','custom_specs'), ('order_attachments','spec_ref'));
--
-- select indexname from pg_indexes
-- where schemaname = 'public' and indexname = 'order_attachments_order_spec';
