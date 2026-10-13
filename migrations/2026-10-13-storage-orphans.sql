-- 2026-10-13-storage-orphans.sql
--
-- Files in storage that nothing refers to any more: the sweep's list
-- (app/api/admin/storage-sweep). Read-only; the sweep deletes through the
-- storage API, never by deleting rows here -- removing a storage.objects row
-- does not remove the file.
--
--   order-attachments  an object no order_attachments.file_path names
--   claim-photos       an object no claim_submissions.photo_paths names
--   team-avatars       not swept: a team member's delete removes its own
--
-- ⚠ OLDER THAN min_age ONLY. An upload is stored a moment before its row is
-- written; a younger object may simply be mid-upload.
--
-- Checked against production before it was written (2026-10-13): all 4 live
-- attachments matched their file, none was missing one, and no orphan sat in
-- the folder of an order that still exists.
--
-- Safe to run twice.

begin;

create or replace function public.storage_orphans(min_age interval default interval '1 day')
returns table (bucket_id text, name text, size bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o
  where o.created_at < now() - min_age
    and (
      (o.bucket_id = 'order-attachments'
        and not exists (select 1 from public.order_attachments a where a.file_path = o.name))
      or
      (o.bucket_id = 'claim-photos'
        and not exists (select 1 from public.claim_submissions s where to_jsonb(s.photo_paths) ? o.name))
    )
  order by o.bucket_id, o.created_at;
$$;

revoke all on function public.storage_orphans(interval) from public, anon, authenticated;
grant execute on function public.storage_orphans(interval) to service_role;

commit;

-- after_migration: what the sweep would find today. Expect order-attachments 32.
select bucket_id, count(*) as orphans, pg_size_pretty(sum(size)) as size
from public.storage_orphans(interval '1 day')
group by bucket_id
order by bucket_id;
