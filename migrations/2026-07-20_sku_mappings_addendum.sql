-- ============================================================================
-- Migration: sku_mappings addendum + orders.needs_review  (Step 2a)
-- Project: cabinet-orders (OMS)
-- Apply:  Supabase Dashboard -> SQL Editor -> paste ALL -> Run
-- Save:   commit to cabinet-orders/migrations/
-- Depends on: 2026-07-17_sku_mappings.sql (must be applied first)
-- Date:   2026-07-20
--
-- 1. Adds `role` to sku_mappings: 'build' (name->code builds a composite) vs
--    'classify' (code only tells us the vendor; J&K SKUs arrive complete).
-- 2. Adds the 7 J&K color rows as role='classify' so ALL vendor knowledge is
--    table-backed (vendorLookup's HCI-vs-J&K test derives from these).
-- 3. Adds orders.needs_review (derived rollup for the list filter + badge).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. role column ──────────────────────────────────────────────────────────
alter table public.sku_mappings
  add column if not exists role text not null default 'build'
    check (role in ('build', 'classify'));

-- Existing 25 rows are all build-inputs; the default already set them, but be explicit.
update public.sku_mappings set role = 'build' where role is null;

-- ── 2. J&K color rows — classification keys, not build inputs ────────────────
-- avis_name = color name, sku_code = the code vendorLookup matches on the SKU's
-- trailing segment (…-E1 -> J&K). source 'shopify_title' (J&K SKUs come complete
-- from Shopify; there is no Avis sync for them). avis_value_id NULL.
insert into public.sku_mappings
  (vendor, kind, avis_name, sku_code, source, role, avis_value_id, last_seen_at)
values
  ('J&K Cabinetry','color','Java Coffee',   'S1',  'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','Pearl Glaze',   'H9',  'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','Dove',          'E1',  'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','Charcoal Gray', 'E2',  'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','Mocha Glazed',  'K10', 'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','Castle Grey',   'S5',  'shopify_title','classify', null, now()),
  ('J&K Cabinetry','color','White',         'S8',  'shopify_title','classify', null, now())
on conflict (vendor, kind, avis_name) do nothing;

-- ── 3. orders.needs_review (derived rollup) ─────────────────────────────────
alter table public.orders
  add column if not exists needs_review boolean not null default false;

-- filter support for the "show me the flagged ones" list view
create index if not exists idx_orders_needs_review
  on public.orders (needs_review) where needs_review = true;

-- ── 4. verification (expected results in comments) ──────────────────────────
-- Expect: 32
select count(*) as total_rows from public.sku_mappings;

-- Expect: HCI/color/build 7 | J&K/color/classify 7 | Waypoint/color/build 11 | Waypoint/door_style/build 7
select vendor, kind, role, count(*)
from public.sku_mappings group by vendor, kind, role order by vendor, kind, role;

-- Expect: 0  (every row still has a code; classify rows included)
select count(*) as unmapped from public.sku_mappings where sku_code is null;

-- Expect: the column exists and every existing order is false
select needs_review, count(*) from public.orders group by needs_review;
