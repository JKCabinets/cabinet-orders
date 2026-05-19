# Security Audit — May 2026

**Reviewed**: Cabinet Orders app at the time of audit (commit prior to this bundle).
**Scope**: All API routes, middleware, auth/session handling, secret management, dependency vulnerabilities, security headers/CSP, and webhook signature handling.

This document records what was found, what's fixed in this bundle, and what's left as standing recommendations.

---

## Summary

The application has a solid security foundation. Authentication uses bcrypt hashing with constant-time compares, lockout on repeated failures, and per-route admin gates that match the middleware allowlist. Webhooks verify HMAC signatures, crons verify a bearer secret with constant-time compare, the quote-form ingest path validates everything aggressively, and the service-role Supabase client is server-only.

The audit found **one critical authorization gap** (single-order PATCH bypassing the backward-PIN gate) and several smaller hardening items. The critical issue and the highest-impact mediums are fixed in this bundle.

---

## Critical

### C1. Single-order PATCH bypasses the backward-stage PIN gate — **FIXED**

**Location**: `app/api/orders/[id]/route.ts`, PATCH handler.

The bulk route (`/api/orders/bulk`) requires the admin PIN before allowing any backward stage transition, and validates that `body.stage` is one of the known stage values. The single-order PATCH did neither. An authenticated user could send `PATCH /api/orders/SHO-12345 {"stage":"New"}` (or any arbitrary string) and the server would write it straight through. The modal's PIN dialog was effectively client-side only — anyone with curl and a session cookie could bypass it.

**Fix**: Extracted the stage-flow logic from the bulk route into a shared `lib/stageGuards.ts` module (`ALLOWED_STAGES`, `stageIndex`, `isBackwardsMove`, `verifyAdminPin`, constant-time compare, the env-driven `ADMIN_PIN`). Both routes now use the same helpers. The PATCH handler:

1. Validates `body.stage` against `ALLOWED_STAGES` (rejects unknown values with 422).
2. Fetches the current stage once, reuses it for both the validation and the Entered-attachment gate.
3. If the target is a backwards move within the same flow, requires `body.admin_pin` and verifies it with a constant-time compare against `ADMIN_PIN`. Rejects with 403 `admin_pin_required` if missing or wrong.
4. Adds rate limiting (`orders:patch`, 30/min) to match the rest of the orders surface.

The client side (`lib/store.tsx` → `moveStage`, `components/OrderModal.tsx`) was updated to thread the entered PIN through to the API call so the modal's backward-move flow continues to work end-to-end. The modal now also surfaces a server-side PIN mismatch (e.g. if `ADMIN_BACKWARD_PIN` is rotated in Vercel without updating the client constant) rather than silently rolling back.

---

## High

### H1. Attachments POST had no input validation, no rate limit, no order-existence check — **FIXED**

**Location**: `app/api/orders/attachments/route.ts`.

Previously:

- `orderId` was taken verbatim from form data and interpolated directly into the storage path (`${orderId}/...`). No regex check, no length cap.
- `file.name` was stored in the DB unescaped. Same string is rendered in admin pages, the attachments panel, and the PDF export. A malicious filename could deliver HTML or script into UI surfaces that don't re-escape.
- `uploaded_by` was inserted without sanitization.
- No verification that the referenced order actually exists, so an authenticated user could spray orphan files into storage by uploading to arbitrary `orderId` strings.
- No rate limit on the upload path.
- No cleanup if the DB insert failed after the storage write succeeded (orphan storage object).

**Fix**:

- Added `ORDER_ID_RE = /^[A-Za-z0-9._-]{1,100}$/` for `orderId`. Rejects path traversal, oversize, or junk.
- Added `sanitizeFileName()` (same logic as the quote-form webhook) so both ingest paths produce identical safe names. The sanitized name is used both in the storage path and the DB row.
- Sanitize `file_name`, `file_type` (with 200-char cap), and `uploaded_by`.
- Look up the order before doing storage IO. 404 if the order doesn't exist.
- Empty-file check (`file.size <= 0` rejected).
- Rate limit: 20/min for POST, 60/min for GET, both under per-IP buckets.
- If the DB insert fails after the upload succeeds, attempt to remove the orphan storage object.

### H2. Attachment DELETE had no rate limit and no audit log — **FIXED**

**Location**: `app/api/orders/attachments/[id]/route.ts`.

Any authenticated user could delete any attachment. There was no ownership check (intentional — small trusted team — but worth being able to investigate after the fact), no audit logging, and no rate limit, so a single account could sweep all attachments faster than they could be re-uploaded.

**Fix**: Same rate-limit bucket as upload (`attachments:delete`, 20/min). Every deletion is logged to `audit_log` with `attachment_deleted` event, including `attachment_id`, `order_id`, `file_name`, and the original `uploaded_by`, so investigations have something to work with.

---

## Medium

### M1. `ADMIN_BACKWARD_PIN` defaults to "4951" in code

**Location**: `lib/stageGuards.ts:23` (formerly `app/api/orders/bulk/route.ts:22`).

If the env var isn't set, the code falls back to the legacy default. With this bundle, the server-side PIN gate is now load-bearing (per C1), so the fallback should not be relied on. **Set `ADMIN_BACKWARD_PIN` in Vercel to a unique value** if you haven't already, and rotate `ADMIN_CODE` in `components/OrderModal.tsx` to match. (The `.env.example` now documents this variable.)

### M2. No rate limits on several routes

Routes that authenticated users can hammer:

| Route | Status |
| --- | --- |
| `app/api/orders/[id]/route.ts` PATCH | **Fixed** (30/min) |
| `app/api/orders/[id]/route.ts` GET | not rate limited |
| `app/api/orders/[id]/export/route.ts` GET | not rate limited (expensive: scans all SKUs + vendor lookups) |
| `app/api/orders/[id]/vendors/route.ts` GET | not rate limited |
| `app/api/orders/attachments/route.ts` POST/GET | **Fixed** (20/60 per min) |
| `app/api/orders/attachments/[id]/route.ts` GET/DELETE | **Fixed** (60/20 per min) |
| `app/api/admin/*` | not rate limited (admin-only, lower priority) |
| `app/api/team/[id]/route.ts` PATCH/DELETE | not rate limited (admin-only) |
| `app/api/vendors/[id]/route.ts` | not rate limited (admin-only) |

The remaining items are not critical (admin-only routes already require the admin role), but the **`/api/orders/[id]/export/route.ts`** in particular is worth limiting in a future pass — a single member account could DoS the database by hammering it.

### M3. `.env.example` was missing six env vars the code reads — **FIXED**

`ADMIN_BACKWARD_PIN`, `QUOTE_LEGACY_URL_HOSTS`, `QUOTE_WEBHOOK_SECRET`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `TEAMS_WEBHOOK_URL`. Now all documented with notes on when they're optional vs. required.

### M4. Dead `experimental.serverActions` config — **FIXED**

`next.config.mjs` had `experimental.serverActions.allowedOrigins: ["localhost:3000"]`. No Server Actions exist in the codebase (`grep -r "use server"` returned nothing), so the config was dead — but if Server Actions were ever added, only localhost would have been allowed, breaking production. Removed entirely.

### M5. `team/[id]` PATCH allows changing usernames and roles without uniqueness or audit-friendly logging

**Location**: `app/api/team/[id]/route.ts`.

- Username changes don't check uniqueness (the DB will reject duplicates via constraint, but the error surface is opaque).
- Role changes are silently applied — only password changes get audit-logged. Promoting a member to admin or demoting an admin should be tracked.
- No `sessionVersion` bump on role change, so a member who's just been demoted retains admin in their JWT until it expires (4 hours).

**Status**: Not fixed in this bundle (out of scope — separate from the PIN/attachment surfaces). Worth a future pass: add `event: "role_changed"` audit-log on role mutation, and bump `sessionVersion` so the change takes effect on the next request.

---

## Low / informational

### L1. Dependency audit

`npm audit --omit=dev` (production deps only):

- **1 moderate**: postcss XSS via `</style>` in stringify output, pulled in transitively through `next > postcss`. Next.js 16.2.6 is the current line; the upstream postcss in Next's bundle hasn't been bumped. Not exploitable in this app (postcss runs at build time, not at request time). Will resolve when Next.js bumps it.
- **0 high/critical** in production dependencies.

`bcryptjs` bumped from **2.4.3 → 3.0.3** (no known CVEs in 2.4.3, but 3.x is the current line). Breaking-change notes from the upstream release:

- ESM-by-default with UMD fallback. Existing `import bcrypt from "bcryptjs"` calls continue to work.
- Generates `$2b$` hashes by default instead of `$2a$`. **Existing hashes continue to validate** — both `$2a$` and `$2b$` are accepted by `bcrypt.compare()`. No data migration needed.
- Types ship natively. `@types/bcryptjs` removed from devDependencies.

`npx tsc --noEmit` runs clean after the bump.

### L2. Next.js / React version posture

- **Next.js 16.2.6** is the latest patched version, which includes the coordinated 13-advisory security release of May 2026 (auth bypass via App Router segment-prefetch, WebSocket SSRF CVE-2026-44578, cache poisoning, XSS in CSP nonces, several DoS). Pinned to the exact version, so no risk of drift.
- **React 19.2.6** resolved across all consumers (next, next-auth, lucide-react). This is the patched RSC version (covers CVE-2026-23870).
- Vercel-hosted deployments are not affected by the WebSocket SSRF (handled at Vercel's edge), but the upgrade is the only complete mitigation per Vercel's own advisory.

### L3. CSP allows `'unsafe-inline'` and `'unsafe-eval'` on `script-src`

This is the typical Next.js limitation — hydration scripts are inlined without nonces. Mitigating requires switching to nonce-based CSP, which is invasive (requires a custom middleware that issues nonces and threads them through the layout). Worth doing eventually; not urgent.

The other CSP directives are strong: `frame-ancestors 'none'` (clickjacking protection beyond the X-Frame-Options header), `object-src 'none'`, `form-action 'self'`, no `unsafe-*` on `style-src` beyond `'unsafe-inline'` (also Next.js limitation).

### L4. Next.js 16 deprecation: `middleware.ts` → `proxy.ts`

The build now prints: *The "middleware" file convention is deprecated. Please use "proxy" instead.* This is a Next.js 16 file-convention rename. The current file works, but at some future minor version this will become an error. Migration is a file rename plus updating the export name. Not urgent — the rename can happen the next time `middleware.ts` is touched.

### L5. Standing items from the roadmap (status check)

- `ADMIN_BACKWARD_PIN` rotation — see M1.
- Team password defaults: **already resolved on the code side**. `app/api/team/route.ts` no longer uses a `"demo1234"` default; it generates a cryptographically random 22-char temporary password meeting the password policy (`Aa1!` + 18 base64 bytes) and returns it once in the response. Any old accounts created via the legacy code still need their passwords rotated manually.
- `TEAMS_WEBHOOK_URL` rotation: still recommended — the value was shared in a previous conversation. Regenerate the Power Automate flow when convenient. The SSRF guard in `app/api/cron/teams-digest/route.ts` limits the blast radius if the value leaks (only Microsoft hosts are accepted).
- Legacy `member` field and `"GB"` defaults: cosmetic only, no security impact.

### L6. Webhook posture

- **Shopify webhook** (`/api/shopify/webhook`): HMAC verification with constant-time compare on raw bytes, length-checked first to avoid the `timingSafeEqual` throw. 5 MB body cap. Topic whitelist. Numeric-only `shopifyId`. Sanitized fields on insert. Solid.
- **Quote-form webhook** (`/api/webhooks/quote-form`): Rate-limited per IP (10/min), 60 MB total upload cap, 20 MB per file, 10 files max, 4 KB per field cap. Optional `QUOTE_WEBHOOK_SECRET` with constant-time compare. Legacy URL allowlist via `QUOTE_LEGACY_URL_HOSTS`. Filename sanitization. CORS is wildcard but the shared-secret gate compensates. Solid.
- **Cron routes**: All three (`production-complete`, `delivery-complete`, `teams-digest`) verify the `CRON_SECRET` bearer with constant-time compare and fail closed if the env var is missing. `teams-digest` additionally has an SSRF allowlist for the outbound webhook URL.

### L7. Service-role posture

The Supabase service-role client (`lib/supabase.ts`) is imported only by server-side modules under `app/api/**` and `lib/vendorLookup.ts` (also server-only). No client component imports it. The key is never exposed to the browser.

---

## What's left for a future pass (not urgent)

1. **Rate-limit the export route**. Single most expensive endpoint on the orders surface.
2. **Audit-log role and active-status changes** in `team/[id]` PATCH, and bump `sessionVersion` on role change so demotions take effect immediately.
3. **Rename `middleware.ts` → `proxy.ts`** to silence the Next.js 16 deprecation warning.
4. **Nonce-based CSP** to drop `'unsafe-inline'` and `'unsafe-eval'` from `script-src`. Invasive; do when the rest of the stack is stable.
5. **Rotate `ADMIN_BACKWARD_PIN` in Vercel and `ADMIN_CODE` in `OrderModal.tsx`** away from `"4951"`. With the server-side gate now load-bearing, the legacy default is a real liability.
6. **Rotate `TEAMS_WEBHOOK_URL`** via Power Automate.
