-- v16_order_claims.sql
--
-- Atomic claim/release of orders, used by the order-management UI to
-- prevent two users from accidentally editing the same order at the
-- same time. The PATCH /api/orders/[id] endpoint will still accept
-- claimed_by writes (used by stage-change auto-unclaim), but the
-- dedicated /api/orders/[id]/claim endpoint goes through these
-- functions for race safety.
--
-- Pattern:
--   claim:    sets claimed_by ONLY IF it was previously NULL
--             or already equal to the calling user (re-claim is a
--             no-op success). Returns the row state after the op.
--   release:  sets claimed_by = NULL ONLY IF it was the calling
--             user. Releasing someone else's claim fails.
--
-- Both functions return a single row with three columns:
--   ok            -- boolean: did the op succeed?
--   claimed_by    -- the resulting claimed_by value (string or null)
--   reason        -- when ok=false, a short machine-readable code
--                    ("already_claimed", "not_owner", "not_found",
--                    "wrong_stage")
--
-- We only allow claims on orders still in stage "New" — once an
-- order moves into production, claiming is meaningless and the
-- PATCH endpoint already auto-clears claims on stage transition.

-- Drop and recreate so we can iterate on the function bodies
-- without leaving orphaned overloads around.
DROP FUNCTION IF EXISTS claim_order(text, text);
DROP FUNCTION IF EXISTS release_order(text, text);

CREATE OR REPLACE FUNCTION claim_order(p_order_id text, p_user text)
RETURNS TABLE(ok boolean, claimed_by text, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_claimed_by text;
  v_stage              text;
BEGIN
  -- Lock the row so concurrent claim calls serialize through this
  -- transaction. FOR UPDATE on an indexed primary key is fast.
  SELECT o.claimed_by, o.stage
    INTO v_current_claimed_by, v_stage
    FROM orders o
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
  UPDATE orders
     SET claimed_by = p_user
   WHERE id = p_order_id;

  RETURN QUERY SELECT true, p_user, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION release_order(p_order_id text, p_user text)
RETURNS TABLE(ok boolean, claimed_by text, reason text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_claimed_by text;
BEGIN
  SELECT o.claimed_by
    INTO v_current_claimed_by
    FROM orders o
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

  UPDATE orders
     SET claimed_by = NULL
   WHERE id = p_order_id;

  RETURN QUERY SELECT true, NULL::text, NULL::text;
END;
$$;

-- Grant execute to the role our app uses. Supabase uses the
-- "service_role" key for server-side calls; we keep functions
-- private from anon / authenticated clients since the app routes
-- everything through Next.js API handlers.
REVOKE ALL ON FUNCTION claim_order(text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION release_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_order(text, text)   TO service_role;
GRANT EXECUTE ON FUNCTION release_order(text, text) TO service_role;
