# Start here — session handoff, 2026-11-03

⚠ **THE START POINT.** Supersedes `SESSION-HANDOFF-2026-11-02.md` and
`SESSION-HANDOFF-2026-10-29.md` as where a session starts; both stay the
RECORDS of what they cover, and this file points into them rather than copying
them. Everything since the 10-29 docs review is built, deployed and tested live
by Garrett: feature 9 phase 1 (cabinet fulfilment) and feature 10 (cabinet
lines).

⚠ **SINCE THIS FILE'S COMMIT (2026-11-03, the same session): §6.** §4's items
1–3 are done, feature 11 (the consent record) is agreed and comes next, and
item 5 turned out bigger, with a plan. Read §6 before §4.

## 0. A new session, first

1. **Snapshot, on the box**, after this file's commit:
   ```bash
   cd ~/cabinet-orders && git archive --format=tar.gz -o ~/repo28.tar.gz HEAD && cd ~ && sha256sum repo28.tar.gz > repo28_tar_gz.sha256
   ```
   ⚠ `cd ~` first, so the `.sha256` holds the bare name — written with a path
   (`sha256sum ~/repo27.tar.gz`) it fails `-c` on the PC (2026-11-02).
2. **Upload** `repo28.tar.gz`, `repo28_tar_gz.sha256`, this file and
   `phase1-harness.tar.gz` (§3.2). Check the snapshot's hash against the
   recorded one.
3. **Read this file end to end**, then the method it points to (§3) before any
   change.

## 1. Where things stand

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`):

- ⚠ **AS OF THE §6 COMMIT:** `HEAD~1` is `e936001` (the commit that added this
  file), `HEAD~2` *"Docs: feature 10, cabinet lines, as built and deployed
  (2026-11-03)"*, `HEAD~3` *"Feature 10, part 5: the work queue names the
  cabinet line holding an order"*. **The next chain checks: `HEAD~1` =
  `e936001`, tree clean.**
- ⚠ **THE RUNNING IMAGE IS PART 5's COMMIT.** Docs commits are never deployed
  (nothing in the app changes), so the image check (`docker ps … | grep -qF
  "$(git rev-parse HEAD)"`) reads **MISMATCH** against a docs `HEAD` until the
  next deploy — by design, not a fault. Check against part 5's hash
  (`git log --oneline -3`).
- `git log --oneline 0fcc615..HEAD` lists every commit since the 10-29 review
  (§2).

**Production's database** — both migrations RAN, each check row as expected:
`2026-10-29-cabinet-fulfilment.sql` (sha256 `54a5317c…`, FROZEN) and
`2026-11-02-cabinet-lines.sql` (sha256 `ba635609…`).

**Cron** — `scripts/cron/crontab` (in the repo since 2026-11-02, item 65),
installed and matching the box: production-complete 08:00 UTC, teams-digest
14:00 weekdays, sync-avis-catalog 07:30, webhook-health :20 hourly,
helpscout-sync every 15 minutes, check-registry-token 15:00 Mondays,
**cabinet-fulfilment 15:00 daily** (8 a.m. Arizona). Each pings its own
healthchecks.io check through `~/cron-jobs/healthchecks.map` — on the box only,
its URLs are credentials in effect (OPERATIONS §5).

**Shopify** — the app has `write_merchant_managed_fulfillment_orders` ("can
fulfil: YES"); Shipping confirmation is ON (its email arrived 2026-11-02).
Additional details carry, per line of a mixed cabinet order, "<line>
Production" and "<line> Delivery Target" — Waypoint as "Select (Waypoint)
Cabinetry".

⚠ **THE GHCR TOKEN EXPIRES 2026-11-16 (item 66) — THE ONE DEADLINE.** The
Monday check alarms below 14 days left (`WARN_DAYS=14`, `-lt`) — so since its
2026-11-02 run: a red registry-token check on healthchecks.io is THIS. After the
16th every `kamal deploy` fails `denied: denied` until it is renewed: a classic
PAT with `write:packages` and `read:packages`, into `.env.kamal`
(`KAMAL_REGISTRY_PASSWORD`), checked with `docker login` and
`~/cron-jobs/check-registry-token.sh` before the next deploy (OPERATIONS §5).

## 2. What was built since 2026-10-29 — all deployed

**Feature 9 phase 1 — cabinet fulfilment.** The daily run marks a cabinet
order's lines shipped in Shopify on their ship-from-factory date, vendor by
vendor, and Shopify emails the customer; "Still on schedule?" before; a
vendor's date locked once shipped. **Record:** `SESSION-HANDOFF-2026-10-29.md`
§4.9 (rulings, design, as built); the live test, passed 2026-11-02:
`SESSION-HANDOFF-2026-11-02.md` §1. Commits `4bc1dd4`, `c513ddd`, `3fde2c3`
(parts 1–3), `2105aa0` (docs), `82143fb` (the date editors labelled).

**Feature 10 — cabinet lines: one order, a section per line.** Each cabinet
line (vendor) has its own acknowledgment, dates and signed receipt; the
order's stage is its slowest line's. **Record:** `SESSION-HANDOFF-2026-11-02.md`
§3 — §3.2 Garrett's rulings, §3.7 the design agreed, §3.8 as built (every
commit, what was found and fixed, what was proven). Commits `39b4c5d`,
`c5f3a04`, `bb9cdd3`, `9ba8619`, `0be09b3`, part 4a, `620dbba`, the
line-editor fix, the Shopify lines, part 5, the docs — the unhashed ones by
subject in §3.8.

**Feature 9 phase 2 — the three Help Scout emails — is DESIGNED, NOT BUILT**
(`SESSION-HANDOFF-2026-10-29.md` §4.3). With feature 10 one question is new:
a "Delivered" email per line or per order (`SESSION-HANDOFF-2026-11-02.md`
§3.5, unsettled).

**How it is described now:** OMS-STATE "Cabinet lines" and "Cabinet
fulfilment"; OPERATIONS §1–§2, §5, §7–§8.

## 3. Method — what holds

The method is carried in the handoffs, newest last: `SESSION-HANDOFF-2026-09-15.md`
(the full method), `SESSION-HANDOFF-2026-10-29.md` §2,
`SESSION-HANDOFF-2026-11-02.md` §2 and §3.8 (this session's lessons). In
brief, every change this session went:

1. **Read whole** every file about to change, and the readers of what it
   changes (a field copied field by field drops what it does not name).
2. **Design before code**; every point decided by Garrett, recorded in his
   words, committed BEFORE the build (so a reset sandbox loses nothing).
3. **Build in parts**, each proven against the DEPLOYED code as the control —
   the control failing exactly where the change succeeds is the proof.
   Typecheck plus a planted error per changed file. A test's fault is told
   from the code's by failing in both trees.
4. **Ship as an anchored patch script**: pinned sha256 per file (before and
   after), `--check` writes nothing, `ALREADY APPLIED` on a second run, `MISS`
   on the wrong base; `REQUIRES` where a patch's own files cannot tell an
   older base. On the PC: `sha256sum -c`, `scp`. On the box: apply →
   `npx tsc --noEmit` → commit → `git push` → `kamal deploy` → the image check.
5. **A migration**: production's schema read with a read-only probe (one row),
   transcribed into the harness's base; proven twice over seeded rows with a
   snapshot taken BEFORE and a planted change seen; run in the SQL editor
   before the deploy that needs it; its own check row last.

### 3.1 Lessons this session (each cost a fix once)

- An UNCLAIMED order at New had no acknowledgment picker mounted — a button
  that opens a ref's picker needs the picker present whatever the panel shows.
- A move that reads a derived field must not run before it is derived: per-line
  starts at Entered did not move the order on (§2, the line-editor fix).
- A stand-in's database function must be its LATEST definition; a test's own
  inserts must check their errors; an "unchanged rows" proof must snapshot
  before and see a planted change.
- A `.sha256` recorded with a path fails `-c` elsewhere; record bare names.

### 3.2 The harness — `phase1-harness.tar.gz`

Extract to `/home/claude` (it is `hx/`). PostgreSQL 16 on `/tmp:5433`
(`/tmp/pgup.sh`; `hx/fresh.sh <db> <sql…>`); `npm install --legacy-peer-deps`
the lockfile's pins plus esbuild, pg and jsdom into `hx/node_modules`.
`hx/build.mjs <test> <tree> <out>` bundles a test against a tree
(`HX_ALIAS` stands a module in; `HX_EXPOSE` exports a test-only symbol, the
source untouched). The base: `prod_base.sql`, `prod_base_files.sql`,
`prod_base_acks.sql` (from the 11-02 probe), `seed_orders.sql`; stand-ins for
`supabase` (`supabase_pg.mjs`, real SQL), `sku_mappings`, `shopify_products`,
`xlsx` (the sandbox cannot fetch it — Waypoint's sheet parsing is never
exercised there) and `./Toast`. Patch generators: `make_patch*.py`.

## 4. Open

⚠ **AS OF §6 (2026-11-03): items 1, 2 and 3 are DONE (§6.1); item 5 is bigger
than written here and has a plan (§6.3); feature 11, the consent record, is
agreed and comes first (§6.2).** The list below stands as it was written.

1. **The GHCR token, 2026-11-16 (item 66)** — §1.
2. ⚠ **Confirm the `cabinet-fulfilment` check has both alert integrations**
   ("OMS Health" and "OMS Health Email", healthchecks.io → the check →
   Integrations). It is green, but a check without them would fail SILENTLY;
   the other six have both (OPERATIONS §6). Found reviewing the docs,
   2026-11-03.
3. **`f10-lines-without-vendor.sql`** (read-only, one row) — how many lines in
   production have no vendor of their own, the only lines where the vendor
   rule falls back to the product cache. If any, fill them.
4. **Feature 9 phase 2** — §2.
5. **REST `2024-01`, retired by Shopify,** still used by `lib/shopifyStageSync`
   and the order route's `syncToShopify` — which now also writes each line's
   dates. Move both to a supported version (or GraphQL) before Shopify stops
   answering it.
6. **Item 67:** `app/api/shopify/webhooks/route.ts`'s header says its POST
   registers products/update; it registers all five topics. A comment — with two
   more found reviewing the docs (2026-11-03): `lib/vendorLookup.ts` ("The
   four-layer chain", l.151) and the enrichment route's header (l.31) — five
   layers since feature 10's part 2. Fix each with the next change to its file.
7. webhook-health's `graphql()` does not refuse a 200 carrying `errors` —
   verify in the route.
8. UTC "today" in `lib/backorders` (×2), `getBackorderStatus`, the backorders
   page and the line editor — a line due today reads overdue after 5 p.m.
   Arizona (Garrett's call).
9. production-complete's activity insert unchecked; the line editor's backorder
   control offered on archived and someone-else's groups; the export route's
   comment on `SkuItem` stale.
10. Optional tidy: a one-line-waiting reason repeats the line's name in its
   detail ("Waypoint Cabinetry: acknowledgment required" / "Waypoint
   Cabinetry: no acknowledgment yet").
11. RECOVERY has never been exercised (OPERATIONS §12).

**Done since the 10-29 list:** item 64 (a mixed order's acknowledgment names
each line — feature 10); item 65 (the cron scripts in the repo —
`scripts/cron/`, 2026-11-02); phase 1's live test, the healthchecks check and
Shopify's shipping confirmation (2026-11-02). `PHASE1-NOTES-2026-10-29.md`
(outputs only, never committed) is superseded and can be deleted.

## 5. Where each fact lives

`README.md` points here. `docs/OMS-STATE-2026-08-26.md` — what the system IS.
`docs/OPERATIONS-2026-08-26.md` — the business, services, credentials, cron,
checks, and why. `docs/RECOVERY.md` — when it has gone badly wrong. The
handoffs — the record of each session's decisions; the numbered items live in
`SESSION-HANDOFF-2026-10-13.md` (61–67). One fact, one home.

## 6. This session (2026-11-03) — results and decisions, before any build

### 6.1 §4's items 1–3: done

- **Item 1, the GHCR token: RENEWED 2026-11-03** (Garrett). `docker login`
  succeeded, through a chain that refused anything but a 40-character `ghp_`
  token and wrote `.env.kamal` only after GHCR accepted it. ⚠ **Its new expiry
  is still to record** — here, in OPERATIONS §5 and in item 66. It is in the
  check's log line: `grep ' registry-token ' ~/cron-jobs/cron.log | tail -1`.
- **Item 2: CONFIRMED** (Garrett): `cabinet-fulfilment` has both alert
  integrations, and its check is green.
- **Item 3: CLOSED.** `f10-lines-without-vendor.sql` (read-only, one row;
  sha256 `ea1b87c8…`; outputs only; proven against the real `lineVendor`,
  `prefetchVendorMaps` and `resolveVendors`) ran 2026-11-03: 4 orders, 6
  lines, **no line without a vendor of its own** — every other column 0.
  ⚠ Kept as a finding: for such a line the two readers fall back
  DIFFERENTLY — `lib/vendorLookup` to the product cache, `lib/shipDates`'
  `lineVendor` to the order's vendor — so the acknowledgment gate and the
  fulfilment run could name different vendors. No line reaches it today.
- **Shopify, read 2026-11-03** (`shopify-api-check.js`, read-only, sha256
  `1218335f…`, outputs only): four orders, #1071–#1074, every one still
  carrying the customer's consent. Its deprecated-calls endpoint answers 404
  for this app, so Shopify gives no list of flagged calls.

### 6.2 Feature 11 — the consent record, completed (AGREED; before item 5)

**Asked by the website team** (*"Website to OMS: consent record, 2026-10-29"*):
every cart and Kitchen designer order since 2026-10-29 (first #1068, cart;
#1069, Kitchen designer) carries a fifth attribute, `Refund Policy updated` —
e.g. `September 24, 2026`, the "Last updated" date of the Refund Policy the
customer agreed to, read from the policy as `Terms version` is from the Terms;
`unknown` if it cannot be found; new orders carry the new date when the
policies change at go live. The other four and the wording (v1) are unchanged.
*"Please record it with the other four, keep it, and show it with the consent
on the order."* And: *"keep the checkout's IP address and browser with each
order's consent record, as Shopify provides them"* — for a Kitchen designer
order, whatever Shopify records on its invoice page.

**Why it is right:** OPERATIONS §13's Terms acceptance record already names the
gap (*"the customer's IP is NOT captured"*) and counts snapshotting each
policy's version among the two cheapest, most valuable pieces of evidence. The
2026-09-01 rule against keeping IP and browser (claim submissions) was that
nothing needed them; a dispute does.

**The design — Garrett, 2026-11-03: *"All of that looks good, lets proceed"*:**
- **Storage:** three text columns on `projects`, beside `terms_*`:
  `refund_policy_updated`, `checkout_ip`, `checkout_user_agent` — as sent,
  like the four, so an odd value can never fail an order's insert. A NEW
  migration, run before the deploy.
- **The webhook, both paths** (order created, order updated): the Refund
  Policy date through `lib/consent` (`CONSENT_ATTRIBUTES`, `TermsConsent`,
  `readConsent`) and `consentColumns` — written only when the payload carries
  consent, never cleared. The IP and browser from Shopify's `client_details`,
  by their own reader, under the same rule: as sent, when present, never
  cleared.
- **Consent staff record by email:** `refund_policy_updated` null, as
  `terms_version` is (the conversation is the record). The checkout's IP and
  browser are untouched: they describe the checkout, not the agreement.
- **The screen** (`OrderHeaderCards`' "Terms consent" row): its second line
  "Wording v1 · Terms 1-926 · Refund Policy September 24, 2026", the Refund
  Policy part only when there is one; a third line "Checkout IP …", the
  browser string in an expander like "What they agreed to". All as sent:
  `unknown` reads "unknown", with no warning (staff cannot act on it).
- **No backfill:** each order's next update from Shopify fills its columns.
- **Exposure, checked:** the public lookup names its columns (`id,
  customer_email, created_at`); the public claims route does not read
  `projects`; every `select("*")` reader is behind `requireAuth` or is the
  server's own. Realtime and `authenticated_read_all_projects` carry the new
  columns to staff screens only — as the customer's email and phone today.
- **Docs with it:** OPERATIONS §13's "IP is NOT captured" corrected;
  OMS-STATE's consent section; `lib/consent`'s header ("four attributes").
- ⚠ **Outside the code:** keeping IP and browser should be covered by the
  Privacy Policy — the website team's and counsel's to confirm.

**The build, in order:** (1) read-only: what Shopify recorded on the four test
orders (IP and browser present, per source) and which API version the
webhook's payloads are; (2) production's `projects` read with a read-only
probe, transcribed into the harness's base; (3) the migration, proven twice
over seeded rows; (4) `lib/consent`, the webhook, `lib/data`'s `Project` and
the screen, each proven against the deployed code as the control; (5) the
docs.

### 6.3 Item 5 — bigger than §4 says; a plan PROPOSED, not yet decided

- **REST `2024-01` is in FOUR files:** `lib/shopifyStageSync`, the order
  route's `syncToShopify`, **`app/api/shopify/sync`** (the catalogue sync,
  `products.json`; items 59 and 60) and
  **`app/api/admin/backfill-payment-status`** (a one-time tool; its button is
  on `app/admin/shopify`). Shopify answers a retired version as its oldest
  supported one, so these already run on a version that changes each quarter;
  REST has been legacy since 2024-10-01, and a deprecated API can stop working
  at any time. GraphQL is on `2026-04` (supported to 2027-04-01), written in
  three places (`lib/shopify`, the webhooks route, webhook-health).
- ⚠ **Both order writers can ERASE an order's Additional details.** Each reads
  the attributes, changes some and PUTs the whole list; a failed read (a 429,
  a 5xx, a network error) leaves the list empty, so the PUT carries only this
  save's attributes and Shopify replaces the rest — the customer's consent,
  each line's dates. The tags are guarded (a failed read leaves them alone);
  the attributes are not. Not happened yet (§6.1).
- **The plan:** (1) one guarded GraphQL write for both order writers —
  attributes written only after a successful read (`orderUpdate` overwrites
  the list too, so the guard stays), tags by `tagsAdd`/`tagsRemove`; (2) the
  catalogue sync on GraphQL (`colorOptionOf` reads REST's shapes — read
  `lib/shopifyColor` and its callers whole first); (3) delete the backfill
  and its button; (4) one version constant, `2026-10`, once it is known what
  the webhooks route's version governs — item 67's comment fix with it.

### 6.4 Still open from this session

- **Item 4, Garrett's ruling:** the "Delivered" email per line or per order —
  and "Delivery date changed" too, since feature 10 gave each line its own
  delivery target. Proposed: per line. The "Delivered" email carries the
  48-hour sentence, and sent only at the last line it could reach a customer
  after their first line's 48 hours had passed; a line of a mixed order then
  needs approved wording.
- **`phase1-harness.tar.gz` was not uploaded this session** — every code
  change needs it.
