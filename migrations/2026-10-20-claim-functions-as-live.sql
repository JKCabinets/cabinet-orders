-- 2026-10-20  The four claim functions AS THEY RUN LIVE (item 37 of the
-- 2026-10-13 handoff).
--
-- ⚠ WHY. Read from the live database on 2026-10-19 (pg_get_functiondef):
-- claim_order and release_order had been HARDENED in the Supabase SQL editor
-- (`SET search_path TO ''`, every table qualified) while v16_order_claims.sql
-- still holds the old bodies; claim_project and release_project were in NO
-- migration at all. A database rebuilt from the repo would have had the old
-- pair and lacked the purchase pair. These are the live bodies, verbatim but
-- for line endings (the live ones were pasted with \r\n).
--
-- ⚠ BEHAVIOUR UNCHANGED. Run against live, the only difference is that the
-- bodies are stored with \n. Before running it, check that the four live
-- functions still match these (the step-1 query in the 2026-10-20 handoff
-- record); if any does not, do NOT run this: someone changed it since.
--
-- CREATE OR REPLACE keeps each function's owner and grants. Idempotent. The
-- three submission functions are not here: they match their own migration
-- (2026-10-06-claim-submission-claims.sql). The LAST statement is the check.

begin;

CREATE OR REPLACE FUNCTION public.claim_order(p_order_id text, p_user text)
 RETURNS TABLE(ok boolean, claimed_by text, reason text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_current_claimed_by text;
  v_stage              text;
BEGIN
  -- Lock the row so concurrent claim calls serialize through this
  -- transaction. FOR UPDATE on an indexed primary key is fast.
  SELECT o.claimed_by, o.stage
    INTO v_current_claimed_by, v_stage
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  IF v_stage <> 'New' THEN
    -- Allow claiming on any stage — some teams may want to flag
    -- in-progress orders too. If you want to restrict, uncomment:
    -- RETURN QUERY SELECT false, v_current_claimed_by, 'wrong_stage'::text;
    -- RETURN;
    NULL;
  END IF;

  -- Already claimed by someone else
  IF v_current_claimed_by IS NOT NULL
     AND v_current_claimed_by <> p_user THEN
    RETURN QUERY SELECT false, v_current_claimed_by, 'already_claimed'::text;
    RETURN;
  END IF;

  -- Free, or already ours — set/refresh the claim
  UPDATE public.orders
     SET claimed_by = p_user
   WHERE id = p_order_id;

  RETURN QUERY SELECT true, p_user, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_order(p_order_id text, p_user text)
 RETURNS TABLE(ok boolean, claimed_by text, reason text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_current_claimed_by text;
BEGIN
  SELECT o.claimed_by
    INTO v_current_claimed_by
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'not_found'::text;
    RETURN;
  END IF;

  -- Nothing to release
  IF v_current_claimed_by IS NULL THEN
    RETURN QUERY SELECT true, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Someone else owns it — don't let us steal the release.
  -- Admin-side force-release should go through the regular PATCH
  -- endpoint with explicit admin check, not through this function.
  IF v_current_claimed_by <> p_user THEN
    RETURN QUERY SELECT false, v_current_claimed_by, 'not_owner'::text;
    RETURN;
  END IF;

  UPDATE public.orders
     SET claimed_by = NULL
   WHERE id = p_order_id;

  RETURN QUERY SELECT true, NULL::text, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_project(p_project_id text, p_user text)
 RETURNS TABLE(ok boolean, claimed_by text, reason text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current text;
begin
  -- Lock the row so concurrent calls serialise through this transaction.
  select p.claimed_by into v_current
    from public.projects p
   where p.id = p_project_id
     for update;

  if not found then
    return query select false, null::text, 'not_found'::text;
    return;
  end if;

  -- Held by somebody else. Report WHO, so the UI can say "already claimed by
  -- Joanna" rather than a bare failure.
  if v_current is not null and v_current <> p_user then
    return query select false, v_current, 'already_claimed'::text;
    return;
  end if;

  -- Free, or already ours. Idempotent on purpose: clicking claim twice is not
  -- an error, and refreshing claimed_at records the most recent intent.
  update public.projects
     set claimed_by = p_user,
         claimed_at = now(),
         updated_at = now()
   where id = p_project_id;

  return query select true, p_user, null::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_project(p_project_id text, p_user text, p_is_admin boolean DEFAULT false)
 RETURNS TABLE(ok boolean, claimed_by text, reason text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current text;
begin
  select p.claimed_by into v_current
    from public.projects p
   where p.id = p_project_id
     for update;

  if not found then
    return query select false, null::text, 'not_found'::text;
    return;
  end if;

  -- Nothing to release. Not an error -- the desired state is already true.
  if v_current is null then
    return query select true, null::text, null::text;
    return;
  end if;

  -- ⚠ An ADMIN may release anyone's claim; nobody else may.
  --
  -- One owner per purchase means a claim left behind blocks the whole thing,
  -- and somebody has to be able to hand it on. But a designer quietly taking
  -- another designer's project is how ownership stops meaning anything, so it
  -- is an admin action and it is recorded by the caller.
  if v_current <> p_user and not p_is_admin then
    return query select false, v_current, 'not_owner'::text;
    return;
  end if;

  update public.projects
     set claimed_by = null,
         claimed_at = null,
         updated_at = now()
   where id = p_project_id;

  return query select true, null::text, null::text;
end;
$function$;

commit;

-- The fingerprint of each: arguments, result, settings, security, volatility
-- and the body with \r removed -- the same expression the step-1 check uses.
select json_object_agg(p.proname, md5(concat_ws('|',
         pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef::text, p.provolatile::text,
         replace(p.prosrc, E'\r', '')))) as after_migration
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('claim_order', 'release_order', 'claim_project', 'release_project');
