# Security patch summary

Each finding below maps to a CWE from the security scan, the root cause in the
codebase, and the file(s) changed. All 18 patched files preserve their original
paths under `cabinet-orders-security-patches/` — drop them in over the
matching files in your repo.

> ⚠️ **Schema additions you'll need (Supabase migration):**
>   - `orders.created_by TEXT` — set by manual create routes, used by the new
>     DELETE & archive authorization checks. Existing rows without this value
>     become admin-only deletable, by design.
>   - The team-creation flow now writes `password_hash` and `password = NULL`.
>     Confirm `team_members.password_hash` exists (it's already referenced in
>     `authOptions.ts` and `team/[id]/route.ts`, so should be present).
>
> **One-time backfill** (run once, then drop the column):
> ```sql
> -- Force re-hash on next login for any legacy plaintext accounts
> UPDATE team_members SET password = NULL WHERE password_hash IS NOT NULL;
> ```

---

## CWE-1285 — Improper Validation of Index/Offset (uuid 8.3.2)

**Score:** 8.3.2 · **Root cause:** transitive dep `uuid@8.3.2` has a known
write-past-end bug when callers pass small buffers + large offsets to
`v4`/`v5`/`v6`. Fixed in uuid 11.1.1+.

**Files:**
- `package.json` — added `"uuid": "^11.1.1"` to `overrides`

**Also fixed (same CWE class in app code):**
- `app/api/admin/audit/route.ts` — `parseInt(limit)` accepted negative / NaN /
  huge values. Now uses a new `parseBoundedInt()` helper that clamps to
  `[1, 500]` and validates integer-ness.

---

## CWE-770 — Allocation of Resources Without Limits or Throttling (×3)

**Score:** 8.7, 8.7, 8.2 · **Root cause:** the rate-limit helper was being
called without `await` — `if (!checkRateLimit(req))` always evaluates `!Promise`
which is always `false`, so the limit never triggered. Combined with several
unauthenticated or unbounded endpoints.

**Files:**
- `lib/auth.ts` — added `rateLimitOr429()` helper that's harder to forget
  to await, and `parseBoundedInt()` for bounded numeric query params
- `app/api/orders/route.ts` — proper `await rateLimitOr429(...)`, type whitelist
- `app/api/warranties/route.ts` — proper `await rateLimitOr429(...)`
- `app/api/orders/archive/route.ts` — added rate limit
- `app/api/webhooks/quote-form/route.ts` — public endpoint, now rate-limited
  (10 req/min/IP), capped at 10 files / 60 MB / 100 KB body per submission, per-field length cap
- `app/api/shopify/webhook/route.ts` — 5 MB body cap
- `app/api/admin/audit/route.ts` — `limit` clamped to `[1, 500]`
- `app/api/shopify/sync/route.ts` — pagination capped at 200 Shopify pages;
  GET endpoint caps at 50 000 rows / configurable via `?max=` (bounded)

---

## CWE-288 — Authentication Bypass via Alternate Path (×2)

**Score:** 8.7, 8.6 · **Root cause #1:** `PUBLIC_PATHS.some(p => pathname.startsWith(p))`
treated `/loginEvilPath` and `/api/auth-bypass` as matching `/login` and
`/api/auth`, allowing unauthenticated access to any sibling route.
**Root cause #2:** the middleware's admin check only fired for non-existent
paths `/api/orders/delete` and `/api/warranties/delete`; the real DELETE
handlers at `/api/orders/[id]`, `/api/team/[id]`, `/api/admin/*` were never
gated at the middleware layer.

**Files:**
- `middleware.ts` — strict path matching (exact match OR `prefix + "/"`); real
  admin prefixes (`/api/admin`, `/api/shopify/sync`, `/api/shopify/orders`).
  Route-level `requireAdmin()` calls remain as defense in depth.

---

## CWE-863 — Incorrect Authorization

**Score:** 8.2 · **Root cause:** `app/api/orders/[id]` DELETE only blocked
Shopify orders for non-admins; non-admin members could delete any manually
created order (including ones other members had created or that came in via
the public quote form). `archive/route.ts` likewise accepted any
authenticated user as authorized for any order.

**Files:**
- `app/api/orders/[id]/route.ts` — DELETE now requires admin OR
  `(order.source === "Manual" AND order.created_by === current_user)`.
  Audit-logs every deletion.
- `app/api/orders/archive/route.ts` — same rule for archive/restore
- `app/api/orders/route.ts` & `app/api/warranties/route.ts` — set
  `created_by` on insert so the rule above can apply to new rows

---

## CWE-918 — Server-Side Request Forgery

**Score:** 7.7 · **Root cause #1:** every `https://${SHOPIFY_STORE_DOMAIN}/...`
URL trusted the env var without format validation; a misconfigured env or
admin-takeover could redirect the admin API token to attacker hosts.
**Root cause #2:** `quote-form/route.ts` extracted `https://...` URLs from
public email bodies and stored them as `file_path`, which the signed-URL
route would later turn into staff-clickable links.

**Files:**
- `lib/shopify.ts` — added `isValidShopifyDomain()` regex
  (`/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i`), thrown if env is wrong
- `app/api/orders/[id]/route.ts` & `app/api/cron/production-complete/route.ts`
  — validate domain + shopify_id (numeric) before any outbound fetch
- `app/api/shopify/sync/route.ts` — Link-header pagination URLs validated
  against the same allow-list before each follow-up `fetch`
- `app/api/webhooks/quote-form/route.ts` — legacy attachment URLs now only
  accepted if their hostname is in `QUOTE_LEGACY_URL_HOSTS` (env-controlled
  allow-list); HTTPS only

---

## CWE-349 — Acceptance of Extraneous Untrusted Data With Trusted Data

**Score:** 6.3 · **Root cause:** the public quote-form endpoint accepted
arbitrary body fields and used them to override server-extracted values,
including `body.attachment_url`. Combined with the missing secret check
(only enforced when `QUOTE_WEBHOOK_SECRET` env was set), this let any
internet caller seed arbitrary data into the orders table.

**Files:**
- `app/api/webhooks/quote-form/route.ts` — all string fields go through
  `sanitize()` (HTML-encode) and are length-capped; the legacy URL pathway
  is now allow-listed; secret comparison is constant-time

---

## CWE-436 — Interpretation Conflict

**Score:** 6.3 · **Root cause:** `checkRateLimit()` returns `Promise<boolean>`
but callers wrote `if (!checkRateLimit(req))` — `!Promise` is always `false`,
so the guard silently did nothing. This is the same root cause as the CWE-770
finding (a JS/TS truthiness vs await mismatch).

**Files:**
- `lib/auth.ts` — added the `rateLimitOr429()` helper (returns a
  `NextResponse | null` you can directly `if (limited) return limited`)
- All endpoints listed under CWE-770 above were converted to use it

---

## CWE-328 — Use of Weak Hash (here: plain-text password storage)

**Score:** 6.3 · **Root cause:** `lib/authOptions.ts` accepted a plain-text
`password` column as a fallback when `password_hash` was absent — comparing it
with `===`. The team-creation route at `app/api/team/route.ts` *seeded* every
new user with literal plaintext `password: "demo1234"`, so the fallback was
the primary path for new accounts.

**Files:**
- `lib/authOptions.ts` — plain-text path is now a **one-shot migration**:
  authenticates via constant-time compare, then immediately rehashes with
  bcrypt (cost 12) and wipes the `password` column. Also adds a dummy
  bcrypt-compare on the user-not-found path to defeat enumeration timing.
- `app/api/team/route.ts` — admin-supplied password is now required to pass
  `validatePassword()` and is bcrypt-hashed before insert. If no password is
  supplied, the server generates a cryptographically random temporary one,
  returns it **once** in the response so the admin can pass it on, and stores
  only the hash.

---

## CWE-79 — Cross-Site Scripting (×2)

**Score:** 5.1, 2.3 · **Root cause:** `app/api/orders/[id]/export/route.ts`
interpolated every order field (customer name, address, notes, vendor, SKU
descriptions, …) directly into HTML with `${field}`. Most paths sanitized
those fields on write, but the Shopify webhook (`shopify/webhook/route.ts`)
did not — so a malicious Shopify order title/customer name was a stored XSS
vector against any staff member viewing the export. The previous `sanitize()`
also missed `&` and `/`, so it didn't fully neutralize HTML.

**Files:**
- `lib/auth.ts` — `sanitize()` now encodes `& < > " ' / \``; added a separate
  `escapeHtml()` for output-time templating (no trim)
- `app/api/orders/[id]/export/route.ts` — every interpolation goes through
  `escapeHtml()`; added a strict Content-Security-Policy header
  (`default-src 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  no-referrer`
- `app/api/shopify/webhook/route.ts` — all ingested string fields are now
  `sanitize()`'d at write time (same as the manual create path)
- `app/api/damage-reports/[id]/route.ts` — `resolution` now sanitized; `status`
  is enum-validated

---

## Files changed (18)

| File | Why |
|---|---|
| `package.json` | uuid override |
| `middleware.ts` | strict public-path matching, real admin gating |
| `lib/auth.ts` | tighter `sanitize`, `escapeHtml`, `rateLimitOr429`, `parseBoundedInt` |
| `lib/authOptions.ts` | no plaintext password, one-shot migration, timing-safe compare |
| `lib/shopify.ts` | domain allow-list to prevent SSRF |
| `app/api/orders/route.ts` | awaited rate limit, type whitelist, `created_by` |
| `app/api/orders/[id]/route.ts` | DELETE auth fix, shopify_id validation |
| `app/api/orders/[id]/export/route.ts` | HTML-escape everything, CSP |
| `app/api/orders/archive/route.ts` | authorization, rate limit |
| `app/api/admin/audit/route.ts` | bounded `limit`, validated `username` |
| `app/api/team/route.ts` | bcrypt-hash on create, no plaintext default |
| `app/api/shopify/webhook/route.ts` | length-checked HMAC, body size cap, sanitize ingest |
| `app/api/shopify/sync/route.ts` | bounded pagination, ILIKE escaping, Link-header validation |
| `app/api/webhooks/quote-form/route.ts` | rate limit, file/size caps, URL allow-list, constant-time secret |
| `app/api/cron/production-complete/route.ts` | timing-safe secret, fail-closed when missing, SSRF guard |
| `app/api/cron/delivery-complete/route.ts` | timing-safe secret, fail-closed when missing |
| `app/api/damage-reports/[id]/route.ts` | enum status, sanitize resolution |
| `app/api/warranties/route.ts` | awaited rate limit, `created_by` |

---

## Things to do *after* applying these patches

1. **`npm install`** to pick up the uuid override; re-run your scanner to
   confirm CWE-1285 has cleared.
2. **Run the SQL migration** at the top of this file (add `created_by` to
   `orders`).
3. **Rotate `CRON_SECRET`** if it was deployed without a value before — the
   cron endpoints now fail closed if the env var is unset.
4. **Rotate every team member's password** that was created via the previous
   `team/route.ts` (they all had the default `demo1234`). The login flow
   will quietly upgrade them to bcrypt on first login, but you should still
   force rotation.
5. **Set `QUOTE_LEGACY_URL_HOSTS`** to your legitimate form-submission CDN
   hosts (comma-separated) if you still rely on the legacy URL pathway in
   `/api/webhooks/quote-form`. Leaving it empty disables that pathway entirely
   (recommended).
