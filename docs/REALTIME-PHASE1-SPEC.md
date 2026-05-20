# Realtime Phase 1 — Specification

**Status:** Approved for implementation
**Author:** Garrett + Claude
**Date:** 2026-05-20

This is the source-of-truth design doc for Realtime Phase 1. If you're
about to implement code from this file, read it top to bottom first.

## Goals (Phase 1)

Build the foundation for collaborative real-time behavior in the app:

1. **Realtime data sync** — when one user changes an order, all other
   users see the change within ~1 second without refreshing.
2. **Online presence** — see which team members are currently active.
3. **Order claim system** — prevent two team members from working on
   the same new order at once.

## Non-goals (Phase 1)

These are explicitly deferred:

- Concurrent-edit safety banner ("this order was updated by X") — Phase 2
- Realtime on tables other than `orders` — Phase 4
- Cursor/selection sharing — never
- Notifications outside the open browser tab — separate feature
- Mobile push — separate feature
- Auto-release of idle claims — never (per business requirement)
- Idle timeout warnings — separate notification feature later

## Architecture summary

Browser opens a WebSocket to Supabase Realtime for presence + row events.
Postgres logical replication feeds Realtime. Next.js (on Hetzner) handles
all mutations using service-role HTTP. Browsers mint short-lived JWTs
via Next.js to authenticate their WebSocket connection.

Key flows:

- **Mutations:** Browser → Next.js server (auth, validation) → Postgres.
- **Real-time reads:** Postgres → logical replication → Supabase Realtime
  → Browser. RLS gates events using JWT claims.
- **Token minting:** Server reads NextAuth session, signs JWT with
  Supabase JWT secret, browser uses it to auth the Realtime WebSocket.

## Authentication: Path 1b (JWT minting)

Token includes:
```json
{
  "sub": "<user_id>",
  "role": "authenticated",
  "app_user": "<username>",
  "app_role": "<admin|member|viewer>",
  "exp": <30 min from now>
}
```

Signed HS256 with Supabase JWT secret. 30-minute TTL. Refresh 5 min
before expiry.

## Database changes

### Migration v14_realtime_setup.sql

```sql
-- Add claim columns
ALTER TABLE orders
  ADD COLUMN claimed_by_user_id text NULL REFERENCES team_members(id),
  ADD COLUMN claimed_at timestamptz NULL;

CREATE INDEX idx_orders_claimed_by ON orders(claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

-- Enable RLS (doesn't affect service-role API queries)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Realtime channel policy: any authenticated user reads all orders
CREATE POLICY "authenticated_read_all_orders"
  ON orders FOR SELECT TO authenticated USING (true);

-- Enable logical replication for this table
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER TABLE orders REPLICA IDENTITY FULL;
```

## API changes

### New: POST /api/realtime-token
Mints short-lived Supabase JWT. 30-min TTL. Returns `{ token, expiresAt }`.

### New: POST /api/orders/[id]/claim
Atomic claim. Returns 409 if already claimed. Only allowed in "New" stage.

### New: POST /api/orders/[id]/release
Releases claim. Only claimer or admin. Audit-logged with action type
distinguishing self-release from admin-force-release.

### Modified: PATCH /api/orders/[id]
- Rejects with 403 if order is claimed by someone else (and caller isn't
  admin), and stage is "New"
- Auto-clears claim on stage transition out of "New"

## Realtime client (lib/realtimeClient.ts)

Wraps `@supabase/supabase-js` createClient with the minted token.
Schedules token refresh 5 min before expiry. Exposes singleton client
and teardown function.

## Store integration (lib/store.tsx)

useEffect that:
- Opens `orders-realtime` channel subscribing to INSERT/UPDATE/DELETE
- Opens `presence-global` channel for online users
- Dispatches store actions to merge events
- Cleans up on unmount

## Env vars (new)

Three to add to `.env.kamal`:
- `SUPABASE_JWT_SECRET` (server-side only, for signing JWTs)
- `NEXT_PUBLIC_SUPABASE_URL` (build-time, embedded in client JS)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build-time, embedded in client JS)

The NEXT_PUBLIC_ ones go in `builder.secrets` in deploy.yml and as
`--mount=type=secret,id=...` in Dockerfile RUN block.

## UI

### Avatar component (new, reusable)
Initials in colored circle. Green outline if user is online (from
presence state). Tooltip shows full name on hover.

### Order list — claim UI (only for "New" stage)
- Unclaimed: "Claim" button next to row
- Claimed by me: "✓ Working on this" + [Release] link
- Claimed by other: their Avatar + "Working on this", row non-interactive

### Order modal — claim awareness
- Unclaimed "New": "Claim to edit" button
- Claimed by me: normal editing
- Claimed by other (non-admin): inputs disabled, banner shows claimer
- Claimed by other (admin): inputs enabled, "Override claim" link

## Edge cases

- **Race claim:** Atomic UPDATE with `WHERE claimed_by_user_id IS NULL`.
  Loser gets 409.
- **Token expiry:** Refresh 5 min before. Failed refresh = subscription
  drops, recovers on next page nav.
- **Network blip:** Auto-reconnect. On SUBSCRIBED event, refetch orders.
- **Admin force-release while modal open:** Claim clears, modal updates
  via realtime event. User can save normally.
- **Claim persists across reconnect:** Yes (it's database state, not
  presence). Online ring goes away (presence) but claim icon stays.

## Implementation order

### Session 1 — Foundations (4 hours)
- Env vars added to .env.kamal, deploy.yml builder.secrets, Dockerfile
- Migration v14 applied to Supabase
- /api/realtime-token endpoint built, tested with curl

### Session 2 — Realtime data sync (3 hours)
- lib/realtimeClient.ts with token refresh
- Subscription effect in store
- Test: two windows, order edit reflects across

### Session 3 — Presence (3 hours)
- Presence channel + Avatar component with online ring
- Test: online status appears/disappears correctly

### Session 4 — Claim system (4 hours)
- Claim/release endpoints
- PATCH and stage-transition updated
- Full UI for claim states
- Test: race, auto-release on stage move, admin override

Total: ~14 hours over 4 sessions.

## Success criteria (end of Phase 1)

Demoable behavior:

1. Two browser windows, different users, both see green avatar rings
2. Shopify webhook creates new order — appears in both windows live
3. Window 1 clicks "Claim" — Window 2 sees claim indicator immediately
4. Window 2 tries to open order — inputs disabled, banner shows claimer
5. Window 1 fills details, "Move to Entered" — claim clears, order
   shows in Window 2's Entered tab

## Deferred to later phases

- Disconnected indicator UI (Phase 2)
- Concurrent-edit banner (Phase 2)
- Realtime on damage_reports, warranties, vendors, etc. (Phase 4)
- Stale claim visual indicator (yellow ring after N hours)
- Claim notification system (email/Teams ping if stuck > N hours)
- Team member profile pages with photo upload, phone, email
- Idle-claim warnings
