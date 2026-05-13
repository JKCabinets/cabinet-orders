-- ============================================================
-- Cabinet Orders — Supabase SQL Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ─── Team Members ────────────────────────────────────────────
create table if not exists team_members (
  id           text primary key default gen_random_uuid()::text,
  username     text unique not null,
  name         text not null,
  initials     text not null,
  role         text not null default 'member' check (role in ('admin', 'member')),
  avatar_color text not null default 'blue',
  active       boolean not null default true,
  password     text not null default 'demo1234',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- Seed team members (update passwords after setup)
insert into team_members (id, username, name, initials, role, avatar_color, password)
values
  ('1', 'ax', 'Alex',  'AX', 'admin',  'blue',  'demo1234'),
  ('2', 'br', 'Brett', 'BR', 'member', 'teal',  'demo1234'),
  ('3', 'dn', 'Dana',  'DN', 'member', 'amber', 'demo1234'),
  ('4', 'ca', 'Casey', 'CA', 'member', 'rose',  'demo1234')
on conflict (id) do nothing;

-- ─── Orders ──────────────────────────────────────────────────
create table if not exists orders (
  id          text primary key,
  type        text not null default 'order' check (type in ('order', 'warranty')),
  name        text not null,
  source      text not null default 'Manual' check (source in ('Shopify', 'Manual')),
  detail      text not null default '',
  stage       text not null default 'New',
  member      text not null default 'AX',
  date        text not null default '',
  sku         text not null default '',
  notes       text not null default '',
  archived    boolean not null default false,
  shopify_id  text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ─── Activity Log ─────────────────────────────────────────────
create table if not exists order_activity (
  id         bigserial primary key,
  order_id   text not null references orders(id) on delete cascade,
  text       text not null,
  time       text not null,
  created_at timestamptz default now()
);

-- ─── Indexes ─────────────────────────────────────────────────
create index if not exists orders_type_idx     on orders(type);
create index if not exists orders_stage_idx    on orders(stage);
create index if not exists orders_archived_idx on orders(archived);
create index if not exists activity_order_idx  on order_activity(order_id);

-- ─── Updated_at trigger ──────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger orders_updated_at
  before update on orders
  for each row execute function update_updated_at();

create or replace trigger team_updated_at
  before update on team_members
  for each row execute function update_updated_at();

-- ─── Row Level Security (optional but recommended) ───────────
-- Disable RLS since we use service role key from server only
alter table team_members  disable row level security;
alter table orders        disable row level security;
alter table order_activity disable row level security;

-- ─── Add order detail columns (run if upgrading from earlier version) ─────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS door_style text not null default '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS color text not null default '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku_items jsonb not null default '[]'::jsonb;
