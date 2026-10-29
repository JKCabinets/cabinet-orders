-- 2026-10-28  A colour Shopify no longer sells is DISCONTINUED, not deleted
-- (item 60; Garrett: "when a color is removed from shopify, the oms should keep
-- it but mark it as discontinued and grey it out").
--
-- ⚠ ITS OWN MARK, NOT `active`. active is the admin's switch; the Sync must not
-- overturn a mapping someone deactivated on purpose. discontinued_at is set and
-- cleared ONLY by sku_judge_discontinued() below.
--
-- ⚠ A DISCONTINUED COLOUR STILL DECODES. The decoder loads every mapping, so a
-- past order keeps its finish's name; the mark greys it on the Mappings page
-- and keeps it out of the specs panel's suggestions.
--
-- HOW EACH VENDOR SHOWS ITS FINISHES (checked against production, 2026-10-28):
--   J&K   in the SKU: it ENDS with the finish code (W2130-S5) -- judged by code
--   HCI   in the COLOR OPTION: its SKUs carry no finish (B30) -- judged by name
--   Waypoint's colours come from Avis, not Shopify variants: never judged.
-- shopify_products.color_option holds each variant's Color option, written by
-- the Sync and the product webhook; options_at says it was recorded.
--
-- Run BEFORE the deploy. Idempotent. The last statement is the check.

begin;

alter table public.shopify_products
  add column if not exists color_option text,
  add column if not exists options_at timestamptz;
alter table public.sku_mappings
  add column if not exists discontinued_at timestamptz;

create or replace function public.sku_judge_discontinued()
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  hci_ready boolean;
  jk_ready boolean;
  marked integer := 0;
  restored integer := 0;
  n integer;
begin
  -- ⚠ NEVER ON PARTIAL DATA. HCI is judged by name only once EVERY current HCI
  -- variant has had its options recorded (the first full Sync after this
  -- migration does that); judged before, every HCI colour would read as gone.
  -- A vendor with no current variants at all is never judged.
  select count(*) > 0 and bool_and(options_at is not null) into hci_ready
    from public.shopify_products where removed_at is null and vendor = 'HCI Cabinetry';
  select count(*) > 0 into jk_ready
    from public.shopify_products where removed_at is null and vendor = 'J&K Cabinetry';

  if hci_ready then
    update public.sku_mappings m set discontinued_at = now()
     where m.vendor = 'HCI Cabinetry' and m.kind = 'color' and m.discontinued_at is null
       and not exists (select 1 from public.shopify_products p
                        where p.removed_at is null and p.vendor = m.vendor
                          and lower(btrim(p.color_option)) = lower(btrim(m.avis_name)));
    get diagnostics n = row_count; marked := marked + n;
    update public.sku_mappings m set discontinued_at = null
     where m.vendor = 'HCI Cabinetry' and m.kind = 'color' and m.discontinued_at is not null
       and exists (select 1 from public.shopify_products p
                    where p.removed_at is null and p.vendor = m.vendor
                      and lower(btrim(p.color_option)) = lower(btrim(m.avis_name)));
    get diagnostics n = row_count; restored := restored + n;
  end if;

  if jk_ready then
    -- A name seen but not yet coded has no code to look for: not judged.
    update public.sku_mappings m set discontinued_at = now()
     where m.vendor = 'J&K Cabinetry' and m.kind = 'color' and m.discontinued_at is null and m.sku_code is not null
       and not exists (select 1 from public.shopify_products p
                        where p.removed_at is null and p.vendor = m.vendor and p.sku like '%-%'
                          and upper(regexp_replace(p.sku, '^.*-', '')) = upper(btrim(m.sku_code)));
    get diagnostics n = row_count; marked := marked + n;
    update public.sku_mappings m set discontinued_at = null
     where m.vendor = 'J&K Cabinetry' and m.kind = 'color' and m.discontinued_at is not null and m.sku_code is not null
       and exists (select 1 from public.shopify_products p
                    where p.removed_at is null and p.vendor = m.vendor and p.sku like '%-%'
                      and upper(regexp_replace(p.sku, '^.*-', '')) = upper(btrim(m.sku_code)));
    get diagnostics n = row_count; restored := restored + n;
  end if;

  return jsonb_build_object('marked', marked, 'restored', restored, 'hci_judged', hci_ready, 'jk_judged', jk_ready);
end
$$;
revoke all on function public.sku_judge_discontinued() from public, anon, authenticated;
grant execute on function public.sku_judge_discontinued() to service_role;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'color_option_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopify_products' and column_name = 'color_option'),
  'discontinued_at_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sku_mappings' and column_name = 'discontinued_at'),
  'judge', exists (select 1 from pg_proc where proname = 'sku_judge_discontinued'),
  'discontinued_yet', (select count(*) from public.sku_mappings where discontinued_at is not null)
) as after_migration;
