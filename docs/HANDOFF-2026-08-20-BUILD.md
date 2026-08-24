# JK Cabinets OMS — Build Handoff

**As of 2026-08-20 · supersedes HANDOFF-2026-08-18-BUILD.md**
**AMENDED 2026-08-24 — Project Orders.** One Shopify checkout is now one
PROJECT with one `orders` row per product category. Sections marked ⚠ AMENDED
below were true before that migration and are not now. `git log docs/` shows
what changed and when.

For whoever picks up the codebase next, including a fresh assistant chat with
no memory of prior sessions.

**Read alongside:**
- **SESSION-HANDOFF-OMS-2026-08-20.md** — what to build next, with the
  decisions already made
- **OPERATIONS-2026-08-20.md** — services, costs, credentials, incidents,
  customer commitments, and why decisions were made
- **System Map 2026-08-20** (SVG)
- **HANDOFF-WEBSITE-TEAM-2026-08-20.md** — the storefront side: public claims
  intake, chat, Help Scout, and the `/api/public` surface. A separate effort
  with a separate reader; the two meet only at `POST /api/public/lookup`.

Corrections carried forward from earlier versions, because each cost real time:

- **"Finished all" is NOT a deploy success marker.** Kamal prints it on aborts.
- **`grep -c 'ERROR (SSHKit'` is NOT sufficient either.** A
  `Kamal::ConfigurationError` reports zero. Use **`grep -cE 'ERROR \('`**.
- **`stage_entered_at`** was described as belt-and-braces; the app was the
  weaker half and overrode the trigger. Fixed 2026-08-18.

---

# 1. Stack

| | |
|---|---|
| Repo | `JKCabinets/cabinet-orders` |
| Stack | Next.js 16 (App Router, Turbopack), TypeScript, Supabase (Postgres + RLS + Realtime) |
| Deploy | Kamal → Docker → Hetzner CPX31 |
| Live | `https://www.ordersjkcabinets2you.com` (www canonical) |
| Box | `ssh garrett@5.78.220.153`, `~/cabinet-orders` |

---

# 2. How to work on it

**The assistant has no shell on the production box.** It builds and tests in a
sandbox, delivers files, and Garrett runs them.

- **Edits ship as idempotent, anchor-based Python patch scripts.** Validate ALL
  anchors first, write all-or-nothing, abort writing nothing on any miss.
- **New files ship whole**, with `shasum -a 256` to verify transfer.
- **Migrations** run in the Supabase SQL editor, copy saved to `migrations/`.
- **Config files are patched by anchor, never regenerated wholesale.**

## The deploy loop

```bash
cd ~/cabinet-orders
python3 patch_whatever.py
npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"   # EXIT:1 = clean
rm patch_whatever.py                                           # BEFORE git add
git add -A && git commit -m "..." && git push origin main && kamal deploy 2>&1 | tee kamal-deploy.log
echo "=== ERRORS: $(grep -cE 'ERROR \(' kamal-deploy.log) ==="
```

## Patch-writing lessons, learned the expensive way

These are not style preferences. Each one caused a real failure.

- **Build fixtures from the REAL file, including neighbouring code.** A fixture
  assembled to make an anchor resolve proves only that it resolves in the
  fixture. Three anchor collisions on 2026-08-19 came from this: `door_style`
  appears in both `Order` and `SkuItem`; `if (stage === "In review")` appears in
  two functions in `OrderTable`; `- SHOPIFY_WEBHOOK_SECRET` appears in both
  `builder.secrets` and `env.secret`.
- **A marker that tests for PRESENCE cannot detect a partially-applied change.**
  When a patch adds content to something already patched, the marker must test
  for the NEW content, not the container. A step reported "already applied" and
  silently skipped three new fields on 2026-08-20.
- **Verify what the patch DID, not what it left alone.** Post-write sweeps that
  assert things about untouched code produced three false aborts in one day —
  a claim control the patch never touched, a guard's position relative to a
  different function, a button sharing a background class with a field.
- **Syntax-check generated TypeScript.** A comment-block insertion that landed
  outside the comment produced 34 errors at the gate.
- **A constant serving two purposes will break one of them.** `SHAPE_BODY` was
  both "text to insert" and "text to delete"; editing it broke the deletion.

## Gotchas

- **The tsc gate does not catch Next build-rule errors.** Watch the build.
- **Commands meant for the box get pasted into local Git Bash.** Only `scp`
  runs locally.
- **Kamal cannot deploy from native Windows.**
- **`.kamal/secrets` fails open** — a missing key becomes an empty string.
- **A variable not declared in `config/deploy.yml` never reaches the
  container**, however correct `.env.kamal` is. Deploy gives no warning.
  `kamal secrets print` will not catch it. **`docker exec … printenv` is the
  only reliable check.** This cost time three times on 2026-08-20.
- **Declared in `deploy.yml` but missing from `.kamal/secrets` fails LOUDLY**
  with `Kamal::ConfigurationError`. That direction is safe.

---

# 3. The data model

⚠ **AMENDED 2026-08-24: FIVE types, and a `projects` table above `orders`.**

```
projects  SHO-1050              one Shopify checkout. Customer, address,
                                and THE FOUR MONEY COLUMNS -- one total per
                                purchase, so a sum over `orders` would
                                double-count a multi-group order.

orders    SHO-1050-CAB   type = "order"     cabinets, 5-stage pipeline
          SHO-1050-HW    type = "hardware"  status + carrier + tracking
          SHO-1050-SMP   type = "sample"    JK stock, 3-stage flow
          QUO-…-CST      type = "custom"    quote form or manual entry
          WRN-0007       type = "warranty"  project_id NULL -- see below
```

A group is an `orders` row with a `project_id`. **A warranty claim is the only
row type with `project_id` NULL** — it is ABOUT a purchase rather than part of
one, and it may be denied, in which case it was never that purchase's work.
So every query joining `projects` must LEFT join, or warranty rows vanish
silently.

**Category comes from the Shopify VENDOR** (`line_items[].vendor` in the
webhook payload), mapped in `lib/categories.ts`. NOT from the SKU resolver:
it is keyed entirely on the SKU and the JK sample products carry empty ones,
which is exactly how sample classification failed silently on 2026-08-19. An
unrecognised vendor falls to the cabinet group and logs `unknown_vendor` — it
is never silently reclassified.

⚠ **No hardware product exists in Shopify yet**, so the hardware vendor
strings in `lib/categories.ts` are unverified. Create a test product with the
intended vendor before calling that work done.

The pre-migration text follows, for the flows it still describes correctly:

```
type = "order"     Standard cabinet orders. Shopify only.
type = "sample"    Shopify webhook, ALL line items vendor "JK Cabinets 2 You".
type = "custom"    Quote form OR manual entry. The same thing, two doors.
type = "warranty"  Raised in-app from a delivered order.
```

⚠ The sample rule above is SUPERSEDED. "ALL line items" was an order-level
test; grouping is per line, so a mixed checkout now yields a cabinet group
AND a sample group rather than being classified standard.

⚠ **`orders_type_check` constrains this column.** It accepted only
`order`/`warranty` until 2026-08-19 — widened by
`migrations/2026-08-19-orders-type-check.sql`, and again for `hardware` by
`migrations/2026-08-20-project-orders.sql`.

⚠ **AMENDED 2026-08-24: FIVE places, not three.**

1. The CHECK constraint. Verified present 2026-08-20 and now
   `(order, warranty, sample, custom, hardware)`.
2. `OrderType` / `ORDER_TYPES` in `lib/data.ts`.
3. The whitelist on `POST /api/orders`.
4. **BOTH stage maps** — `STAGE_ORDER_BY_TYPE` and `STAGE_LIST_BY_TYPE`. A
   type whose stages are not a subset of another flow needs its own array,
   and `stageIndex` without a `type` argument will mis-resolve it: all three
   hardware stage names already exist in other flows.
5. **`TYPE_LIST_LABEL` and every other `Record<OrderType, …>`.** These are
   deliberately exhaustive so the compiler names them — that is how the
   missing hardware category on `/sla` was caught rather than shipped as a
   silently absent column.

A widened TypeScript union is not a widened column, and the test that catches
it is inserting a row — not compiling. **There is no CHECK constraint on
`orders.stage`** (verified 2026-08-20), so adding a STAGE is code-only.

## Pipelines

**Standard** — `New → Entered → In production → At cross dock → Delivered`
- New → Entered: HUMAN. Gated on all-vendors-green OR ≥1 attachment.
- Entered → In production: AUTO when `production_start_date` is set.
- In production → At cross dock: AUTO, `production-complete` cron. **Sole owner.**
- At cross dock → Delivered: HUMAN. **Gated on a `proof_of_delivery` attachment.**
- `archived` is a boolean, not a stage.

**Sample** — `New → Entered → Delivered`. Reuses the standard stage names on
purpose. Exempt from both gates. **Does** sync to Shopify.

**Custom** — `New → In review → Ordered → In production → At cross dock →
Delivered`. **Does NOT sync to Shopify.**

**Warranty** — `New claim → In review → Parts ordered → Shipped → Resolved`.

## ⚠ Stage names are NOT globally unique

`"In review"` exists in BOTH warranty and custom. `"New"` and `"Delivered"`
appear in three flows. **Always resolve against the row's `type`.**

This is not theoretical. On 2026-08-19 `/custom` passed `"In review"` as a
table-wide stage prop believing it matched nothing; it matched the WARRANTY
branch, offered "Order parts", and moved a custom order to `Parts ordered` —
a stage its flow does not contain. `stageIndex` returned −1 and no tab matched
it.

**Enforced in three places since:**
- `OrderTable.UpdateStatusActions` guards on `order.stage === stage &&
  rowFlow.includes(stage)` before any branch, and custom rows get
  `CustomFlowActions` driven by `nextStageFor`.
- `PATCH /api/orders/[id]` calls `isStageAllowedForType(body.stage,
  currentType)` — type read from the DATABASE, never the body.
- `/api/orders/bulk` checks per row in both POST and the GET preflight, because
  a batch can mix types and the upfront check runs before the rows load.

Two similar maps, deliberately different:

| | |
|---|---|
| `stageLogic.STAGE_ORDER_BY_TYPE` | Full ordering, for index maths. |
| `data.STAGE_LIST_BY_TYPE` | The subset OFFERED in the UI. |

## Order ids

```
orderNumber = payload.order_number ?? payload.name
orderId     = `SHO-${orderNumber}`  or  `SHO-${shopifyId.slice(-6)}` fallback
```

⚠ **AMENDED 2026-08-24: `orders.id` is NOT the order number.** It is an
internal group handle — `SHO-1050-CAB`. **`projects.id` is the order number**,
the value the customer quotes on the phone and types into lookup.

| | |
|---|---|
| `displayOrderNumber(order)` | What to SHOW a human. Never `order.id`. |
| `matchesOrderNumber(order, term)` | Search. Accepts both forms — somebody will paste a handle out of a log. |
| `poReference(order)` | `Battles-SHO-1050`, for manufacturers. Internal; never shown to a customer. |

`order.id` remains correct for IDENTITY — `moveStage`, `claimOrder`, `.eq("id",
…)`, React keys, attachment paths. A group is what gets claimed and moved. Of
roughly 68 `order.id` sites in the app, only ~19 were display.

`orders.name` is the CUSTOMER name and still present, but the migration COPIED
it to `projects` rather than moving it; the follow-up migration drops it, and
anything reading it must resolve through the project by then. Quote-form rows
keep the `QUO-` prefix, which encodes ORIGIN rather than type — note those ids
are epoch-ms, so a PO reference reads `Battles-QUO-1787174567522`.

Two unhandled edge cases: the `slice(-6)` fallback produces an id matching
nothing the customer has seen, and `payload.name` is `"#1035"` WITH the hash,
so a missing `order_number` yields `SHO-#1035`.

---

# 4. SLA rules

One table in `lib/sla.ts`. **24h soft / 48h hard** throughout.

| Stage | Clock measures from | Runs while |
|---|---|---|
| New | **order date** (`created_at`) | always |
| New claim | **`reported_at`** → falls back to `created_at` | always |
| Entered | `stage_entered_at` | always |
| In review, Ordered | `stage_entered_at` | always |
| In production | `stage_entered_at` | production dates missing |
| At cross dock | `stage_entered_at` | no delivery date set |
| Parts ordered, Shipped, Delivered, Resolved | — | no rule |

**New measures from the order date** so a backward move cannot reset it.

**In production and At cross dock measure MISSING DATA, not elapsed time.**
42 days in production with dates set is normal; 25 hours without them means
nothing can advance the order.

⚠ The At-cross-dock rule tests `!o.delivery_date && !o.scheduled_delivery_date`.
`delivery_date` was **never mapped by `shapeOrder`** until 2026-08-20, so that
reduced to the second test alone. Latent only because the column is null on
every row.

**The legacy day-per-stage API is deleted** (2026-08-20). `SLA_TARGETS`,
`daysInStage` and `isOverdue` are gone along with their last consumer. They did
not merely duplicate the rule model — they **contradicted** it:
`SLA_TARGETS.New` was 3 days where the rules call an order hard-overdue at 48
hours. Two definitions of one thing, in one file, differing by more than a
factor of one.

`daysInStage` also fell back to parsing the `date` display string when
`stage_entered_at` was absent, returning **total order age** under a name that
promised stage age. `hoursInStage` returns null instead, so the same mistake is
not available.

---

# 5. Architecture notes

**`lib/store.tsx` holds ONE `allOrders` array.** Per-type lists are `useMemo`
filters. Adding a fifth type is one line.

**`shapeOrder` lives in `lib/data.ts`** — beside the `Order` interface it
builds, because BOTH paths need it: the REST load in `store.tsx` and the
realtime events in `useRealtimeOrders`. **If you add a column to `Order`, add
it there and nowhere else.**

`useRealtimeOrders` carried its own copy until 2026-08-20. It cast `type` to
`"order" | "warranty"` long after there were four types and never learned
`created_at` or `reported_at`, so every realtime row was shaped by the
pre-Alternate-Orders version until the next full fetch corrected it.

**Shared implementations that must not be duplicated.** The recurring bug class
here is copies that drift — it caused the Shopify tag overwrite, the cron
outage, four definitions of "overdue", seven stage-colour maps, the realtime
shape copy, and the admin-versus-app webhooks.

`lib/data.ts` (`shapeOrder`, `STAGE_ACCENT`, `nextStageFor`) ·
`lib/shopifyStageSync.ts` (the only writer of stage → Shopify) · `lib/sla.ts` ·
`lib/stageLogic.ts` / `lib/stageGuards.ts` · `lib/fileValidation.ts` ·
`components/SlaHealthByType.tsx` (shared by `/sla` and the dashboard).

⚠ `app/calendar/page.tsx` **fetches orders itself** with its own interface
rather than using the store. That is why the missing delivery fields went
unnoticed — the calendar read the real values while every store consumer got
`undefined`. Worth consolidating.

---

# 6. Uploads and file validation

`lib/fileValidation.ts` identifies files by **magic bytes**, never the
Content-Type header.

- **Public quote form**: restricted to JPEG, PNG, GIF, WEBP, HEIC and PDF.
  Anything else is rejected with 415.
- **Staff attachments**: not restricted — spreadsheets are legitimate — but a
  dangerous filename or claim, or unidentifiable bytes, are stored as
  `application/octet-stream`, which browsers download rather than render.

Both paths previously trusted `file.type` and stored it as the object's content
type, so an SVG with an embedded script could execute when a staff member
opened it through a signed URL.

`order_attachments.kind` is `general` or `proof_of_delivery`, CHECK-constrained.

---

# 7. The delivery gate

**At cross dock → Delivered requires a `proof_of_delivery` attachment.** Not
any attachment: every order at that stage already carries the ack PDFs from
Entered.

Samples exempt. **The override is deliberate** and requires a **reason**,
enforced server-side, writing an `order_activity` row naming the session user.
Anyone may override; everyone can see who did.

---

# 7b. Payment holds

**A refunded, partially refunded or voided order cannot move FORWARD** until
somebody acknowledges it with a reason.

Shopify's `financial_status` already reached the OMS — the webhook writes
`payment_status` on both the create and the `orders/updated` path, and
`OrderTable` renders it as a pill. Nothing acted on it, so a refunded order
could move through Entered, into production and out for delivery unnoticed. The
confirmation email tells customers production starts within about 24 hours, so
the gap between "refund issued" and "parts cut" is short.

**Forward moves only.** A backward move, an archive, a date edit and a note all
stay open — a refunded order usually needs walking *back*, and blocking that
would strand it exactly when someone is undoing the damage.

**`payment_hold_cleared_for` records WHICH status was acknowledged** and is
compared against the current one, so clearing `partially_refunded` does not
pre-clear a later `refunded`. A boolean would have.

A reason is required, enforced server-side, and written to `order_activity`
naming the session user — the same shape as the delivery-proof override. The
control is accountability, not permission.

`voided` is **not** a refund; it is an authorisation that never captured, and
the copy says so.

---

# 8. Shopify ingestion

## The webhook handler

`app/api/shopify/webhook/route.ts`. Accepts `orders/create`, `orders/updated`,
`orders/cancelled`, `orders/delete`, `orders/deleted` and `products/update`.

⚠ Shopify sends **`orders/delete`** (singular). `ALLOWED_TOPICS` listed only
`orders/deleted` until 2026-08-20, so deletions were dropped as unhandled. Both
spellings are now accepted.

**Every outcome is logged** as `[shopify-webhook]`: `hmac_rejected`,
`duplicate`, `insert_failed`, `ingested`, `verified_by_fallback`.

```bash
docker logs <container> | grep shopify-webhook
```

Without this, "Shopify never called", "called and rejected", and "called and
the insert failed" are indistinguishable. That is exactly the state we were in
on 2026-08-19.

## Dual-secret verification

`verifyShopifyHmac` returns `"primary" | "fallback" | null`. **Fails closed**:
the fallback counts only when non-empty after trimming, and with neither
configured every delivery is rejected.

It exists so the webhook secret can be rotated without downtime: set the old
value as `SHOPIFY_WEBHOOK_SECRET_FALLBACK`, change the primary, confirm from
the logs, clear the fallback. That sequence was used on 2026-08-20 to migrate
from admin-created to app-created subscriptions, and is now the rotation
procedure for a secret that had never been rotated because doing so meant
downtime.

## Sample classification

Reads `payload.line_items[].vendor` **directly**, not the SKU resolver. The JK
sample products have EMPTY skus in `shopify_products`, and the resolver is
keyed entirely on the SKU — so routing classification through it produced an
empty list and silently classified every sample as a standard order.

An order is a sample when EVERY line is the sample vendor. Mixed orders are
standard. A line with no vendor is unknown, and unknown is never assumed to be
JK stock.

This matches `app/calendar` — no, it matches the **storefront Liquid**, which
scans every line item for the same reason.

## Line item properties

`SkuItem.properties` keeps whatever the decoder did not consume. Colour choices
on sample orders arrive under a property name the door-style/colour extractors
do not match, and were being silently discarded. Hidden properties (leading
`_`, `_apo`) are filtered; multi-value properties render as separate chips.

---

# 9. Auth and security

**Gate:** `proxy.ts`. `PUBLIC_PATHS` = `/login`, `/api/auth`,
`/api/shopify/webhook`, `/api/webhooks`, `/api/cron`, `/api/csp-report`,
`/api/health`. `ADMIN_PREFIXES` = `/api/admin`, `/api/shopify/sync`,
`/api/shopify/orders` — **API prefixes only, not `/admin/*` pages.**

**Security review 2026-07-24** — all five areas complete. `password_hash`
column-level SELECT revoked and verified closed on both PostgREST and Realtime.

**Accepted risk:** `qual=true` SELECT on `orders`/`team_members` for
authenticated — required by Realtime, small trusted team. **This is why any
public API must use a separate `public_api` role.**

**`cleanInput` does not sanitise.** It trims and nothing else. Use
`escapeHtml()` at the point of HTML templating. Several call sites carried
comments claiming otherwise; corrected 2026-08-20.

---

# 10. ⚠ Known-wrong code

**`override_ack` on New → Entered** is client-supplied, has no role check, and
is not logged. The delivery gate deliberately does the opposite.

**`claimed_by` and `entered_by` reset on a no-op stage write** — they fire on
`if (body.stage)`, presence not change. Same bug class as the fixed
`stage_entered_at`.

**`/admin/vendors` and `/admin/shopify` have no client-side gate.** Mutations
are gated route-side, so the exposure is cosmetic.

**`addOrder`'s offline fallback fabricates a local row** after a failed POST.

**Concurrent identical webhook deliveries can race** — both pass the
`shopify_id` duplicate check before either inserts, and one hits the primary
key constraint. Observed 2026-08-20 while two subscription sets were live.
Resolved itself when the duplicates were removed; a real fix is an upsert or
catching `23505`.

**Dashboard "avg days" on the In-production card** measures order age.

## Tidy-ups

- Three private stage-colour copies remain (OrderModal, BulkActionBar,
  Sidebar `STAGE_DOT`). `STAGE_ACCENT` in `lib/data.ts` is the shared one.
- `BarRow`, `StageAgingRow`, `OverdueStageBlock` and `OverdueRow` are dead code
  in `SLAClient` after the redesign. `AlertTriangle` is an unused import.
- `app/calendar/page.tsx` fetches orders independently of the store.
- The attachments route comment lists order-id prefixes `QUO-`/`WAR-`; real
  ones are `SHO-`, `ORD-`, `WRN-`, `SMP-`, `CST-`.
- `team_member_auth` table — optional hardening.

---

# 11. What shipped 2026-08-18 → 2026-08-20

**Public intake, phase 1 items 1–3**
- `measureFrom: "reported"` + `hoursSinceReported` (inert)
- `orders.reported_at` migration + `shapeOrder` mapping
- Warranty New claim measures from `reported_at`

**Proof of delivery**
- `order_attachments.kind` migration; upload route validates it
- Receipt upload path and badge in the attachments panel
- The gate itself, with a reasoned and logged override

**SLA**
- Page redesign: KPI row, needs-attention, per-type health, stage breakdown,
  all-orders table with search and filters
- `SlaHealthByType` shared component (dashboard swap still pending)
- All stages shown, including those with no rule; all four types listed
- Hydration fix — the store loads client-side, so the page renders its header
  until mounted

**Alternate Orders — completed**
- Phase 3: quote form writes `custom`; samples classified at ingest
- `orders_type_check` widened — the constraint phase 1 forgot
- Phase 2c client: per-row flow guard, `CustomFlowActions`, warranty branches
  type-gated, real stage props on `/custom` and `/samples`
- Phase 2c server: per-type validation in `PATCH` and both bulk paths

**Ingestion**
- `[shopify-webhook]` outcome logging
- `POST /api/shopify/webhooks` bootstraps all topics from scratch
- `orders/delete` accepted
- `webhook-health` cron: reconciles Shopify's orders against the OMS
- Dual-secret HMAC; migration to app-owned subscriptions completed
- `run-cron.sh` captures response bodies on failure

**SLA, finished**
- Dashboard uses the shared `SlaHealthByType`; its private `SlaCategory` gone
- teams-digest migrated off the legacy API — reports by TYPE, covers all four
  types, and sends even when all-clear
- `SLA_TARGETS`, `daysInStage`, `isOverdue` deleted

**Payment holds**
- `payment_hold_cleared_for` / `_at` migration
- Forward-move block, reasoned acknowledgement, activity row, modal banner

**Correctness**
- One `shapeOrder`, in `lib/data.ts`; the stale realtime copy deleted
- `delivery_date`, `delivery_window`, `delivery_notes` finally mapped
- Line item properties kept and displayed
- Magic-byte upload validation; CORS allow-list; timing check
- Autofilled fields and native selects readable app-wide
- Samples no longer shown the acknowledgment panel or vendor PDF export
- Favicon and apple touch icon

---

# 12. Open backlog

**Order modal redesign.** The largest remaining piece, fully specified in
**SESSION-HANDOFF-OMS-2026-08-20.md** — a whole-file rewrite of a large
component, with a behaviour inventory that must be diffed before shipping.

⚠ **That document says 1,183 lines. It is 1,327 lines as of 2026-08-24.**
Section 1.5 there tells the next session to stop if `wc -l` does not match —
correct instinct, stale number. Confirm the count and re-cut the chunk
boundaries; the drift is age, not tampering.

**⚠ Admin metrics — BLOCKED.** `orders` has **no money column of any kind**,
verified against `information_schema` on 2026-08-20. Sell totals are impossible
until four nullable `numeric(12,2)` columns exist — `subtotal_price`,
`total_tax`, `total_shipping`, `total_price` — populated at ingest from the
webhook payload, hand-entered for custom orders, refreshed on `orders/updated`
so a later refund cannot leave a stale total, and backfilled through the
existing `/admin/shopify` import. A "job" is one order.

**Notifications.** Microsoft Graph is configured and scoped. Still to build:
the send path, the confirm/deny queue, a send log keyed on order + trigger, and
templates. Four of five triggers are date-field changes, and all date edits
flow through `PATCH /api/orders/[id]` — one hook point. The scheduled "on its
way" notification belongs in the `production-complete` cron.

**Health status in the app** — a panel on `/admin` and a dashboard banner
reading healthchecks.io's API. A convenience layer over email, never a
replacement: if the box is down, so is the OMS.

**Admin metrics panel.** Unblocked now that custom orders exist.

**Public intake Phase 1 items 4–13.**

**Everything in §10.**

---

# 13. Env and conventions

- **Env vars** live in `.env.kamal` (gitignored, box-only). Every runtime
  variable must ALSO be listed under `env.secret` in `config/deploy.yml`.
- **Migrations** under `migrations/`; docs under `docs/`.
- **Avis API:** `https://public-api.avisplus.io/api/public/v1`, Bearer
  `AVIS_API_TOKEN`, 60 req/min. Stable ids: option `key`,
  `option_values[].value_id`.
- **Dependency dispositions** in `docs/dependency-advisories.md`. The `xlsx`
  scanner flag is a **FALSE POSITIVE** — do not act on it.
- **Timezone:** `America/Phoenix` for display dates.


---

# Appendix — 2026-08-24 session

Added by the Project Orders session. Everything above marked ⚠ AMENDED is
corrected in place; this is what is NEW.

## What shipped

| | |
|---|---|
| `migrations/2026-08-20-project-orders.sql` | `projects` table, group rebuild, `hardware` in the type CHECK, RLS + Realtime on `projects` |
| `lib/categories.ts` | Vendor → category, the one implementation |
| Webhook | Ingests project + one group per category; money on the project |
| `lib/data.ts` | `displayOrderNumber`, `matchesOrderNumber`, `poReference`, project fields in `shapeOrder` |
| Calendar | Reads the store instead of its own fetch |
| `production-complete` cron | Type allowlist |

## Business rules recorded here because the code cannot explain them

**Custom orders are hand-driven.** Contract work: priced by hand, paid in
person, larger and fully bespoke, scheduled by conversation. The OMS RECORDS
what happened rather than driving it.

- `production-complete` filters `.in("type", ["order", "sample"])` — an
  ALLOWLIST, so the next type added is not automated by omission, which is
  exactly how custom orders acquired that cron in the first place.
- `CUSTOM_RULES` carries no SLA at In production or At cross dock. Those rules
  measure MISSING DATA, which means "stalled" only when something was going to
  advance the order. Nothing was.
- Their front half keeps its rules: New and In review measure OUR
  responsiveness to a quote request, hand-driven or not.
- ⚠ Open: `Ordered` still carries a rule. It means the job is placed and we are
  waiting on a manufacturer — the same reason warranty's `Parts ordered` has
  none.

**A Shopify fulfilment is authoritative only for what WE ship.** Samples and
hardware are tracked in Shopify with a real carrier and number, so a fulfilment
IS the event and the tracking comes free. Cabinets are DROP-SHIP: the
manufacturer's partner delivers and Shopify never sees that shipment, so a
fulfilment there is bookkeeping, and calling it "Delivered" is untrue. It is
also why the signed-receipt gate exists — we are not the ones delivering.

⚠ **A cabinet fulfilment is not nothing**: it means the MANUFACTURER
DISPATCHED. That is the trigger behind the notification the order confirmation
already promises, currently planned off the production-complete cron inferring
dispatch from a date. Logged as `fulfilment_not_applied` rather than discarded.

## Still outstanding

- **`webhook-health` matches `orders.shopify_id`.** Works only because ingest
  denormalises it onto the FIRST group. Repoint it at `projects.shopify_id`
  BEFORE the follow-up migration drops the column, or it emails hourly that
  every project is missing.
- **Realtime on `projects` is not subscribed.** The publication and policies
  exist; `useRealtimeOrders` does not listen. A refund will not reach an open
  browser until a full refetch — which defeats the payment hold, whose entire
  purpose is stopping an order moving after a refund.
- **The follow-up migration** dropping the columns copied to `projects`
  (`name`, customer fields, `shopify_id`). Additive-only was deliberate: there
  is no staging environment, so between migration and app deploy the running
  app must still find every column it reads.
- **See `docs/KNOWN-WRONG-ADDITIONS-2026-08-20.md`** for the bulk-route
  delivery gate, the duplicated attachment gate, and custom orders' missing
  backward-move clearing.

## Verified against the live database, 2026-08-20

Recorded so the next session does not re-derive them:

- Every FK on `order_activity`, `order_acknowledgments`, `order_attachments`
  and `damage_reports` is **NO ACTION** — a primary-key rename must rebuild,
  not `UPDATE`.
- **`sku_items` is a JSONB column on `orders`, not a table.**
- `order_attachments.file_path` embeds the order id as its leading folder, with
  **no foreign key** — renaming a row orphans its storage objects silently.
- No CHECK constraint on `orders.stage`. `orders_source_check` allows only
  `Shopify` / `Manual`, and will need widening when public claims intake lands.
