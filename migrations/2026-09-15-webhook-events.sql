-- 2026-09-15  webhook_events
--
-- ⚠ THE ONLY RECORD OF A WEBHOOK WAS console.warn, IN A CONTAINER THAT IS
-- REPLACED ON EVERY DEPLOY. On 2026-09-15 the Shopify deletion handler was
-- found to have reported `{"outcome":"removed","groups":2}` twice for SHO-1051
-- while deleting nothing -- six unchecked `.delete()` calls and an
-- unconditional success log. Finding that took an hour and depended entirely on
-- `docker logs` still holding the lines; one more deploy and the evidence would
-- have been gone, leaving a row that "should not exist" and no way to learn why.
--
-- This table is the durable answer to "did that webhook arrive, and what did it
-- actually do". Every logWebhook() call writes a row.
--
-- ⚠ APPEND-ONLY AND UNBOUNDED. Nothing prunes it today. At current volume that
-- is years away from mattering, but if it ever does, delete by `created_at` --
-- do NOT add a trigger, because a table whose job is to record failures should
-- not have machinery that can fail.
--
-- ⚠ RLS MATCHES THE OTHER TABLES: readable by authenticated sessions, writable
-- only through the service role. Webhook payload fragments end up in `detail`,
-- so anon read would expose order references to anybody holding the public key.

create table if not exists public.webhook_events (
  id          bigserial   primary key,
  source      text        not null default 'shopify',
  topic       text,
  outcome     text        not null,
  shopify_id  text,
  order_id    text,
  -- Whatever the call site passed beyond the columns above. Deliberately not a
  -- fixed shape: the useful field differs per outcome (`blocked_by` on a
  -- refused deletion, `table` and `message` on a failed one, `groups` on a
  -- success), and pinning it now would mean a migration per new outcome.
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- "What happened recently" and "what happened to THIS order" are the only two
-- questions anyone has asked of the console logs, so they are the two indexes.
create index if not exists webhook_events_created_at_idx
  on public.webhook_events (created_at desc);
create index if not exists webhook_events_shopify_id_idx
  on public.webhook_events (shopify_id)
  where shopify_id is not null;

alter table public.webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'webhook_events'
      and policyname = 'authenticated_read_webhook_events'
  ) then
    create policy authenticated_read_webhook_events
      on public.webhook_events for select to authenticated using (true);
  end if;
end
$$;

-- Verification:
--
--   select outcome, topic, order_id, shopify_id, created_at
--   from webhook_events order by created_at desc limit 20;
