-- ─── Security improvements ────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

-- 1. Add failed_attempts and locked_until to team_members for account lockout
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS failed_attempts integer not null default 0;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_login timestamptz;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS password_hash text;

-- 2. Create audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial primary key,
  event text not null,
  username text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS audit_log_username_idx ON audit_log(username);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at desc);

-- 3. Create rate_limits table for persistent rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  id text primary key,
  count integer not null default 0,
  reset_at timestamptz not null,
  created_at timestamptz default now()
);

-- ─── Delivery calendar ────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date date;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_window text not null default '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_notes text not null default '';

-- ─── Damage reports ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS damage_reports (
  id bigserial primary key,
  order_id text not null references orders(id) on delete cascade,
  damage_type text not null,
  affected_skus jsonb not null default '[]'::jsonb,
  description text not null default '',
  cause text not null default '',
  resolution text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  reported_by text not null,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS damage_reports_order_idx ON damage_reports(order_id);
CREATE INDEX IF NOT EXISTS damage_reports_status_idx ON damage_reports(status);

-- ─── Shopify products sync ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shopify_products (
  id text primary key,
  title text not null,
  sku text not null,
  variant_id text,
  price numeric,
  inventory_quantity integer,
  synced_at timestamptz default now()
);
