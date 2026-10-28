-- 2026-10-28  Variants Shopify no longer has are MARKED, not kept as current
-- (item 59). The website team removed HCI's Nano finishes and wrote "a Sync
-- should clear them" -- it did not: the products/update webhook and the Sync
-- only UPSERT what Shopify has, so deleted variants stayed in the product list,
-- shown with their last price.
--
-- ⚠ MARKED, NOT DELETED. Vendor lookup reads this table by variant id for every
-- order, past ones included; a deleted row would leave a past order's line
-- pointing at nothing (a product removed ENTIRELY would lose its base SKU too).
-- removed_at hides a variant from the admin list and nowhere else.
--
-- product_id lets a product's webhook mark ITS variants Shopify dropped; the
-- next full Sync fills it for rows written before this.
--
-- Run BEFORE the deploy. Idempotent. The last statement is the check.

begin;

alter table public.shopify_products
  add column if not exists product_id text,
  add column if not exists removed_at timestamptz;
create index if not exists shopify_products_product on public.shopify_products (product_id);

-- Mark as removed every current variant NOT in p_seen -- across the catalogue
-- (a full Sync), or within one product (its webhook). A function, because the
-- full list (~1,000 ids) is too long for a URL filter. Returns how many it marked.
create or replace function public.shopify_mark_removed(p_seen text[], p_product_id text default null)
returns integer
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  update public.shopify_products
     set removed_at = now()
   where removed_at is null
     and not (id = any (coalesce(p_seen, '{}')))
     and (p_product_id is null or product_id = p_product_id);
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.shopify_mark_removed(text[], text) from public, anon, authenticated;
grant execute on function public.shopify_mark_removed(text[], text) to service_role;

commit;

notify pgrst, 'reload schema';

select json_build_object(
  'product_id_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopify_products' and column_name = 'product_id'),
  'removed_at_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shopify_products' and column_name = 'removed_at'),
  'function', exists (select 1 from pg_proc where proname = 'shopify_mark_removed'),
  'variants', (select count(*) from public.shopify_products),
  'marked_removed_yet', (select count(*) from public.shopify_products where removed_at is not null)
) as after_migration;
