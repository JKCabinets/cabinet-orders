# Start here — session handoff, 2026-11-03

⚠ **SUPERSEDED AS THE START POINT by `SESSION-HANDOFF-2026-11-04.md`** (2026-11-04).
This file stays the RECORD of the 2026-11-03/04 session — §6 and §7 above all.

⚠ **THE START POINT** (until 2026-11-04). Supersedes `SESSION-HANDOFF-2026-11-02.md` and
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

- ⚠ **AS OF ITEM 5 PART 1's COMMIT (2026-11-04):** `HEAD` is *"Item 5, part 1: both order writers through one guarded GraphQL write -- nothing written if the order cannot be read"*,
  `HEAD~1` *"Docs: item 5's plan agreed (2026-11-04); part 1's design"*, `HEAD~2`
  `245032a` (feature 12). **The next chain checks: `HEAD`'s subject is part
  1's, tree clean.**
- ⚠ **THE RUNNING IMAGE IS PART 1's COMMIT** from its deploy, so the image check
  (`docker ps … | grep -qF "$(git rev-parse HEAD)"`) reads DEPLOYED against it;
  a later docs-only commit reads **MISMATCH** until the next deploy — by design.
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

⚠ **THE GHCR TOKEN WAS RENEWED 2026-11-03 (item 66) AND EXPIRES 2027-01-02
21:39:50 UTC** (the check's log, 2026-11-03 21:40:21Z: `rc=0 ok, expires in 59
days`). The Monday check alarms below 14 days left (`WARN_DAYS=14`, `-lt`,
whole days rounded down): green through its 2026-12-14 run, **red from its
2026-12-21 run** — a red registry-token check on healthchecks.io is THIS. After
2027-01-02 every `kamal deploy` fails `denied: denied` until it is renewed: the
chain in OPERATIONS §5 ("Renewing the GHCR token", proven 2026-11-03).

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
  token and wrote `.env.kamal` only after GHCR accepted it. Its new expiry,
  from the check's log (2026-11-03 21:40:21Z, `rc=0`): **2027-01-02 21:39:50
  UTC** — recorded in §1, OPERATIONS §5, item 66 and the system map by feature
  11 part 1's commit.
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

**Done 2026-11-03** (read-only checks, then part 1):
- **(1)** `shopify-consent-check.js` (sha256 `597990d9…`, outputs): all five
  webhook subscriptions deliver payloads in `2026-04`. #1071–#1074 are all
  `source web` (the cart), each with an IPv4 in `browser_ip` and in
  `client_details` (equal), a 111-character browser and the Refund Policy date.
  ⚠ The Kitchen designer's invoice checkout is still UNSEEN — one test order
  through it after the deploy (the reader takes a missing `client_details` as
  nothing to record).
- **(2)** `f11-projects-probe.sql` (sha256 `bf3f6cfb…`): production's
  `projects` — 29 columns, 4 rows, RLS with its four policies, in
  `supabase_realtime` with no column list — transcribed as
  `prod_base_projects.sql` (sha256 `c57e97dd…`, outputs; for the harness's
  base), on which the probe reads exactly as production did.
- **(3) Part 1, the migration:** `2026-11-03-consent-record.sql` (sha256
  `8b249ab8…`), proven twice on that base (all 29 columns of every row
  unchanged, a planted change seen, `published` false under a column list).
  **RAN IN PRODUCTION 2026-11-03**, its check row as expected (`new_columns 3`,
  `all_text_nullable true`, `published true`); committed as part 1. Nothing
  writes the columns until part 2.
- **(4) Part 2, the code** (its own commit, deployed): `lib/consent` reads the
  fifth attribute and Shopify's checkout record (`readCheckout`:
  `client_details.browser_ip`, else the order's `browser_ip`;
  `client_details.user_agent`; capped at 100 and 2,000 characters); the
  webhook writes `refund_policy_updated` with the consent and the checkout's
  two on both paths (`checkoutColumns`: each only when sent, never cleared);
  `Project` declares the three; consent by email sets no policy date and
  leaves the checkout's record alone; the consent row shows "· Refund Policy
  <date>" when there is one, then "Checkout IP …" with the browser in a
  closed expander.
  **Proven against the deployed code as the control** (the harness; base
  `prod_base*` plus the migrations through 2026-11-03):
  - the REAL webhook through seven deliveries: the control writes none of the
    three; feature 11 each as designed — a refund update carrying neither
    keeps them, a top-level IPv6 when `client_details` is null, `unknown` as
    sent, a browser with no IP; every other row of projects, orders, activity
    and webhook outcomes IDENTICAL between the trees. ⚠ Consent arriving later
    without the fifth MIRRORS the order's attributes, as `terms_version`
    always has (the control clears `terms_version` the same way); the
    checkout's record, not carried, is kept.
  - `lib/consent`'s readers, 14 cases (odd names, `unknown`, blank, caps, a
    non-object, `client_details` winning over a different top-level IP).
  - the email-consent route over a hand-planted date: cleared in feature 11,
    kept by the control; the checkout's record untouched in both.
  - the consent row in jsdom: shown in feature 11, absent in the control; an
    older order's card byte-identical between the trees.
  - typecheck: the two trees' error sets identical (two missing modules,
    `xlsx` and `tailwindcss`); a planted error seen in each of the five files.
- **(5) After the deploy:** a test order through the cart and one through the
  Kitchen designer (its invoice checkout still unseen), each checked on Full
  Order; then the as-built docs commit.
  ✅ **LIVE-TESTED 2026-11-04** (Garrett): SHO-1075 (cart) and SHO-1076 (Kitchen
  designer) each show the Refund Policy date, the checkout IP and the browser
  on Full Order — Shopify records `client_details` on the invoice checkout too.
  The update path is proven in the harness only (#1071–#1074 were deleted in
  cleanup); the next Shopify update to SHO-1075 or SHO-1076 runs it live. Seen
  on screen: the browser string breaks mid-word (`break-all`) — `break-words`
  rides with feature 12 (§7.3).

### 6.3 Item 5 — bigger than §4 says; the plan AGREED (2026-11-04)

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
  and its button; (4) one version constant, `2026-10` — ⚠ FOUND 2026-11-03: all
  five webhook subscriptions deliver payloads in `2026-04`, the version the
  webhooks route registers with. Whether that request or the app's own webhook
  setting decides it is to confirm first; either way, moving it moves the
  payloads the webhook handler reads, so it is a step of its own, the handler
  read against the new version's payload. Item 67's comment fix with it.

**AGREED — Garrett, 2026-11-04:** *"Lets do item 5"*, then, to the four parts in
that order with the backfill and its button deleted in part 3: *"Yes, looks
good, lets proceed."* Each part is its own commit and deploy, part 1 first —
it removes the hazard that can erase an order's Additional details.

**Part 1, the design: one guarded write for both order writers.**
- **`lib/shopifyOrderWrite.ts`** (new): `writeOrderToShopify(shopifyId, { set,
  remove, note?, stage? })`, over GraphQL (`shopifyGraphql`, `lib/shopify`'s
  version), `{ ok }` or `{ ok: false, error }`:
  1. **read** the order's `customAttributes` and `tags`. ⚠ **If the read fails,
     NOTHING is written** — not the attributes, not the note, not the tags —
     and the error says so;
  2. the attributes **merged**: the list read, `set`'s keys set, `remove`'s
     removed; written with `orderUpdate`, with `note` when given. (`orderUpdate`
     replaces the whole list too, so the read stays.) Its `userErrors` refuse;
  3. **the stage tag**, when `stage` is given: `tagsRemove` the other stage
     names found in the tags read (case-insensitively, as `mergeTags` does),
     then `tagsAdd` "JK Order" and the stage. No other tag is touched.
- **`syncStageToShopify`** (`lib/shopifyStageSync`; production-complete calls it)
  and **the order route's `syncToShopify`** keep their signatures and their
  results; their insides become one call. What each sets is unchanged: the
  stage writer "Production Stage"; the order route the stage, the three dates,
  the delivery window and notes, each line's two entries (removed when empty),
  the note. REST `2024-01` leaves both. `mergeTags` goes when nothing calls it.
- **Proof:** both writers in both trees against a Shopify stand-in (REST for the
  deployed code, GraphQL for part 1): the normal write, the same attributes and
  tags in both; ⚠ **a failed read — the deployed code erases the consent
  attributes, part 1 keeps them**; another tag untouched; a line's entry
  removed; a refused `orderUpdate` reported.

**Part 1, as built and proven (2026-11-04)** — its own commit, deployed:
`lib/shopifyOrderWrite.ts` (new) as designed above; `syncStageToShopify` and the
order route's `syncToShopify` each one call to it, their signatures and answers
unchanged (the stage writer logs a refusal); `mergeTags`, `getShopifyToken`'s
use in the route and both REST `2024-01` calls gone. **Proven against the
deployed code** (both writers in both trees, a Shopify stand-in speaking REST to
the control and GraphQL to part 1, on an order carrying the five consent
attributes, a line's date and the tags JK Order, New, HCI Order, vip):
- **the normal writes** — the stage writer, and the order page's (dates, a
  line's entries removed and another's set, the note) — leave the SAME order in
  both trees; tags in odd case (`jk order`, `in production`) end the same too;
- ⚠ **a failed read:** the deployed code ERASED the consent (0 of 5 left) and
  answered success (`true`, `{ok: true}`); part 1 KEPT it, wrote nothing, and
  answered `false` / "Could not read the order in Shopify, so nothing was
  written";
- **a refused `orderUpdate`** is reported: "Shopify refused the update: …";
- typecheck: the trees' error sets identical; a planted error seen in each of
  the three files.
**Next:** part 2, the catalogue sync on GraphQL.

**Part 2, the design — AGREED, to build next session.** Garrett, 2026-11-04:
*"That sounds good. I mainly want to make sure that the oms is UpToDate without
manual intervention. Should pull its truth from shopify and update based on
what actually live."* and *"I think once a day at a quite hour is best."* The
principle: **Shopify's own answer is the truth; an event is only the signal to
read it.**
- **Found first** (`catalogue-read-timing.js`, read-only, sha256 `7472f9eb…`):
  REST 2024-01 (the Sync now) read 131 products and **2,537** variants in 5.2 s,
  one product capped at exactly 100 (⚠ CORRECTED: three are at 100 — "Part
  2, settled before the build" below); GraphQL read the same 131 products and
  **2,622** variants in 3.8 s (14 pages of 200, 42 points a page of ~1,800, 100
  a second restored, no throttling), the largest product **175** — **85
  variants today's sync never sees**. The table's current rows (2,537) mirror
  REST's view. Its 442 removed rows all have no product id: older rows, marked
  by full syncs, not by the webhook.
- **(a) The full sync over GraphQL:** `productVariants`, 200 a page by cursor,
  read whole before anything is written, as now; a throttled answer waits and
  retries (capped), and the page cap stays. The same row per variant (id;
  title, with the variant's name when the product has more than one; SKU;
  vendor; price; stock; product id; removed cleared; colour). `colorOptionOf`
  is handed the REST shape built from GraphQL's options, so it stays unchanged
  and shared with the webhook. Then item 59's marking and item 60's judging,
  as now. Synchronous (about 4 s); the admin page unchanged.
- **(b) The product webhook reads that product's variants from Shopify over
  GraphQL** — all of them, paged — instead of the payload, which is REST-shaped
  and likely stops at 100: otherwise each update to the 175-variant product
  would mark (a)'s corrected variants removed again. A failed read marks
  nothing removed and answers 500, so Shopify resends.
- **(c) The full sync daily at 10:00 UTC (3 AM Arizona)** — after the Avis sync
  (07:30) and production-complete (08:00), before cabinet-fulfilment (15:00),
  whose vendor lookups read the catalogue; clear of webhook-health's :20. A
  cron route under `CRON_SECRET` like the others, its `scripts/cron/` script
  and crontab line, and a healthchecks check with both integrations (Garrett
  creates it; its ping URL goes into `~/cron-jobs/healthchecks.map`, on the box
  only).
- ⚠ **The first sync corrects the table:** up to 85 variants back from removed
  or new, and a colour item 60 marked discontinued only because its variants
  were hidden may come back current. The admin page's removed count falls.
- **Proof:** the sync route in both trees against a stand-in catalogue holding
  a product of more than 100 variants — the deployed code marks the hidden
  ones removed, part 2 keeps them current, every other row identical; the
  webhook's product path the same way; the cron route's auth and its ping.

**Part 2, settled before the build (2026-11-04, the next session)** — read
whole, checked, probed and ruled on before any code; committed as *"Docs: item
5 part 2 settled before the build (2026-11-04)"*.
- **Read whole first:** the sync route, the webhook route (all 1,148 lines), the
  webhooks route, `lib/shopify`, `lib/shopifyColor`, `lib/cronAuth`, both Avis
  sync routes and `lib/runAvisSync`, `scripts/cron/crontab` and `run-cron.sh`,
  `app/admin/shopify`, both 2026-10-28 catalogue migrations, `proxy.ts`, both
  health routes, `lib/webhookLog` and the `webhook_events` migration. Found:
  - **No migration.** Every column the rows write exists, neither function
    changes, and `webhook_events.outcome` has no CHECK (production's, by the
    probe below), so the three new outcomes need nothing.
  - **The cron route is `/api/cron/sync-shopify-catalog`.** `proxy.ts` already
    passes `/api/cron/*`, and the route guards itself with `verifyCronAuth`.
    `run-cron.sh` takes any endpoint, so (c)'s "script" is the existing one:
    the job is a crontab line and a `healthchecks.map` entry (on the box only).
    About 4 s fits kamal-proxy's 30 s and `run-cron.sh`'s 60 s. (⚠ 7.7 s measured
    in production, a token per call: "Part 2, as built" below.)
  - ⚠ **A second place (c) did not name:** the dashboard's health panel
    (`app/api/health-summary`) groups checks BY NAME; an unlisted check reads
    "Other checks · Not yet grouped".
  - **One row, two copies:** the sync route and the webhook each build the same
    `shopify_products` row.
  - **Only `PRODUCTS_UPDATE` is subscribed:** a product deleted in Shopify is
    marked removed only by a full sync, which (c) makes daily.
  - Left unchanged, as agreed: the admin page shows nothing when a sync fails
    (`if (data.ok)`, an empty `catch`).
- **Shopify's webhook policy, checked 2026-11-04** (shopify.dev, "Troubleshoot
  webhooks" and the changelog "Updates to webhook retry mechanism"): a delivery
  not answered with a 2xx within **five seconds** fails; a failed one is retried
  **8 times over 4 hours**, backing off; if failures persist the subscription is
  **removed** (the page gives no exact threshold). Ours are shop-specific
  (`webhookSubscriptionCreate`), so a removed one stays removed until the
  webhooks route's POST creates it again. A retry carries the ORIGINAL payload,
  which reading Shopify's own answer (b) makes harmless.
- **Production's `shopify_products`, probed** (`item5p2-catalogue-probe.sql`,
  read-only, one row, sha256 `59d3fb15…`; outputs): 12 columns — ⚠ `vendor` is
  `NOT NULL DEFAULT ''`, which no repo file says, and `title` and `sku` are `NOT
  NULL` (GraphQL's `sku` can be null: it is written `""`, as REST's code does);
  the primary key and the product index only; RLS with `no_direct_access`
  (`false`), so only `service_role` reaches it; no triggers; not published. Both
  functions are the repo's (`shopify_mark_removed` `9eb904e9…`,
  `sku_judge_discontinued` `9cd990c1…`, line endings normalised), with the
  repo's grants. `webhook_events`: its primary key only. Rows: 2,979 = 2,537
  current + 442 removed; every id numeric and equal to its `variant_id`; every
  current row has a `product_id`. Transcribed as the harness's
  `prod_base_catalogue.sql`, on which the probe reads identically in all nine
  schema sections (a planted difference seen).
- ⚠ **What the counts corrected:**
  - **Three products are at exactly 100 current variants**, not one ("Found
    first" above said one). 2,622 − 2,537 = 85, and a 175-variant product alone
    hides 75: at least two are capped (⚠ three, settled: 175, 105, 105 — below).
    The design stands — GraphQL reads them
    all — and a read-only check before the deploy reads the three in Shopify.
  - **No full sync has run since item 60's deploy.** 1,117 current rows have no
    `options_at`, which every write since item 60 sets; the 1,420 that have it
    came from product webhooks (not a multiple of 100, so not a sync cut short).
    `sku_judge_discontinued` judges HCI only once EVERY current HCI row has its
    options, and no colour is discontinued today — so **part 2's first run is
    likely item 60's first HCI judgement**: some HCI colours may be marked
    discontinued for the first time, on the whole catalogue, not only restored
    as the note above expects. (⚠ Settled: no HCI colour lives only past 100,
    so none — "Part 2, as built" below.)
  - ⚠ **Until part 2 is deployed, "Sync SKUs" stays unpressed.** (⚠ LIFTED: no
    HCI colour is hidden, so a REST sync discontinues nothing — below.) A REST sync
    would make that first judgement on the capped view, and could discontinue a
    colour whose only variants REST hides — reversible, but greyed out on the
    Mappings page and in the specs panel until a later sync restored it.
  - Four current variants have no SKU, and "JK Cabinets 2 You" has four current
    variants — probably the samples (⚠ settled: the four colour-sample
    products); the pre-deploy check settles it, with the
    1,117's vendors.
- **Garrett's rulings, 2026-11-04, in his words:**
  - **A product Shopify says does not exist** — proposed in the session and
    ruled by Garrett, a decision in its own right rather than one read off the
    principle: *"yes, with a log line. A product Shopify says doesn't exist is
    Shopify's answer, so marking its variants removed and answering 200 follows
    the principle. It's also safe to be wrong about, because marking removed is
    reversible: the rows stay for past orders, and if the product reappears,
    the next daily sync clears it. I'd log it to `webhook_events` as its own
    outcome, so a disappearance is visible rather than silent."* Outcome
    `product_gone`. A small behaviour change: today's webhook has no such path.
  - **A product answered with no variants:** *"right to distrust it, but answer
    200, not 500. A 500 asks Shopify to resend, which only helps a failure that
    passes: a timeout, a 5xx, a throttled read. A well-formed answer with no
    variants would come back the same on every resend."* and *"So: mark nothing,
    log it as its own outcome, answer 200, and let the daily sync settle it from
    the full catalogue."* Outcome `product_no_variants`. ⚠ **The rule it sets: a
    500 only for a failure that can pass** — persistent failures can remove the
    subscription.
  - **A failed read** (a time-out, a 5xx, a throttled answer, an error): nothing
    written, a 500, and — proposed and agreed (*"Yes"*) — its own outcome,
    `product_read_failed`, so a run of them shows before Shopify removes the
    subscription.
  - **The build:** *"agreed, all three. One module behind both the button and
    the cron, one row builder instead of two, and numeric ids. The numeric ids
    are the catch that matters most: with `gid://` ids, the first run would mark
    the entire catalogue removed."*
  - **The five seconds:** *"The roughly five-second limit covers the whole
    handler, not just the read. The upsert and the two database calls follow
    it. So cap the read well inside the limit, around three seconds, and treat
    a read that runs out of time as a failed read: a 500, which is right there
    because it's transient."*
  - **Paging:** *"Page past 250 variants within that cap. Shopify allows a
    product up to 2,048, and the largest here is already 175."* ⚠ Found writing
    this record: a product too large to read inside the cap would fail on every
    resend, which is not transient; `product_read_failed` shows it, and the
    daily sync still reads that product whole.
  - **The proof:** *"rows written by the deployed sync are matched exactly by
    part 2's, and nothing is marked removed except the variants REST was
    hiding."*
  - **The health panel** — proposed and agreed (*"Yes"*): the new check joins
    the "Catalog sync" row, its detail "Waypoint options and Shopify products",
    and is named exactly `sync-shopify-catalog`.
- **The build, in order:** (1) ✅ the probe, above; (2) the code — one module
  (`lib/shopifyCatalogue`: the read, the row, the run); the sync route's POST
  and the cron route each one call to it; the webhook's product path reading
  the product from Shopify; health-summary's row; the crontab line — proven
  against the deployed code as the control (the proof above, with Garrett's
  three: the deployed sync's rows matched exactly and only the hidden variants
  kept current; the three outcomes; a read past its cap a 500, a product past
  250 paged); (3) read-only checks before the deploy (the three products in
  Shopify; the 1,117 and the four by vendor); (4) the deploy, then the check
  created (both integrations) with its `healthchecks.map` line, the crontab
  installed, and the first run read.

**Part 2, as built and proven (2026-11-04)** — its own commit, *"Item 5, part 2:
the catalogue from Shopify's own answer -- the full sync over GraphQL, daily; the
product webhook reads Shopify"*, with these docs; its deploy steps: 11-04 §4.
- **The code:** `lib/shopifyCatalogue.ts` (new) — `readCatalogue`
  (`productVariants`, 200 a page, whole within 15 s, a throttle waited out 2 s at
  a time, five times; any id not numeric refuses the read), `readProduct` (one
  product, paged past 250, within 3 s; each read is raced against its whole
  budget, since `lib/shopify` fetches a token before every call),
  `catalogueRows` (the one row: `""` for a missing SKU, the vendor trimmed, the
  Color option read by `lib/shopifyColor` from the REST shape built from
  GraphQL's names), `runCatalogueSync` (read whole, write 500 a call, mark the
  rest removed, judge; the admin page's answer). The sync route's POST and the
  new `/api/cron/sync-shopify-catalog` each one call to it; the webhook's product
  path reads Shopify, with the three outcomes as ruled; health-summary's
  "Catalog sync" row names `sync-shopify-catalog` (its stale count corrected);
  the crontab's eighth line. `run-cron.sh` unchanged.
- **Measured, then adjusted** (the pre-deploy checks below): the full read took
  **7.7 s** in production, a token fetched for every call, where the timing check
  ("About 4 s" above) had one token. So the read's budget is 15 s, not the 20
  first built, and the writes go 500 a call, not REST's 100 — six calls for
  2,622 rows, not 27 — so read and writes fit kamal-proxy's 30 s even at the
  0.7 s a call Supabase answered on 11-04.
- **Proven against the deployed code as the control** (the harness: production's
  `shopify_products` transcribed from the probe; ONE catalogue served as REST,
  100 a product, to the control and as GraphQL to part 2, shaped like
  production's and hiding 85):
  - **the first full sync**, on a production-shaped table (REST's view, 200 rows
    without options, old removed rows, a variant since deleted): all 308 rows
    the control wrote are IDENTICAL in every field in part 2's; part 2's 85 more
    are exactly the hidden ones, all current; both marked the one deleted
    variant removed. ⚠ Item 60's first HCI judgement: the control discontinued 4
    colours, 3 only because REST hid their variants; part 2 the 1 truly gone;
  - **the planted `gid://` row id**: all 305 numeric rows marked removed — the
    comparison caught it;
  - a second run changed nothing; a failed page (1 or 2), a read past 15 s, a
    constant throttle, a `gid://` id from Shopify, a non-admin: nothing written;
    throttled twice: waited, then identical; a catalogue with a 300-variant
    product: read whole;
  - **the webhook, ten cases:** the 175-variant product kept whole (the control
    marked 75 removed); a product past 250 paged (300; the control wrote 100);
    gone, on a stale retry — its variants marked removed, `product_gone` (the
    control rewrote the stale payload); no variants — nothing marked,
    `product_no_variants` (the control marked them all removed); a failed,
    throttled or slow read — 500, `product_read_failed`, nothing else written,
    the slow one at 3.01 s; a price change, a removed variant, a bad id — as the
    control;
  - **the cron route:** no header, a wrong one, an unset secret — 401; the same
    sync and answer as the admin page; a Shopify failure — 502. `run-cron.sh`
    pings the check, and `/fail` on a 502;
  - **the health panel:** the control shows the new check under "Other checks";
    part 2 counts it in "Catalog sync";
  - **typecheck:** the two trees' error sets identical; a planted error seen in
    each of the five files.
- **Found proving it:** the harness's Supabase stand-in sent a `text[]` argument
  as JSON — both trees failed alike, the test's fault; it now follows the
  function's signature, as PostgREST does. `pg_dump` writes a random `\restrict`
  key each time, so a data snapshot keeps rows and sequences only.
- **The pre-deploy checks, run 2026-11-04** (read-only, outputs:
  `item5p2-predeploy-check.sql`, sha256 `b2aadc38…`; `item5p2-shopify-check.js`,
  sha256 `3cd19bdf…`, which sends part 2's own two queries): 131 products,
  **2,622** variants, 14 pages in 7.7 s, every id numeric, every field answered
  under production's scopes. REST hides **85**: HCI's "Wall Cabinet - 2 Doors"
  (**175**) and two J&K wall cabinets (**105** each) — the table's three at 100,
  its counts reconciling (HCI 867 + 75, J&K 1,243 + 10). The 1,117 without
  options: HCI 387, Waypoint 415, J&K 315. The four without a SKU: the four
  colour-sample products. Shopify's five HCI colours and seven J&K codes are
  exactly the mappings', and **no HCI colour lives only past 100**. The webhook's
  read of the 175: 442 ms, its token included. At most 42 points a page; 1,958
  of 2,000 left.
- **The first run, predicted:** `synced 2622, products 131, removed 0,
  discontinued 0, restored 0`; the 85 new rows, or revived if among the 442 old
  removed ones (which carry no product id); then 2,622 current, none without
  options.

**Part 2, LIVE (2026-11-05)** — the record, committed as *"Docs: item 5 part 2
live (2026-11-05)"*.
- **Deployed:** `4ccd94d`, its container up from about 00:00 UTC on 11-05; every
  cron run to 11:30 that day ran on it, `rc=0`.
- ⚠ **An IP block, not part 2's:** Hetzner blocked the server's IP from about
  **11:45 to 17:55 UTC** on 11-05; the cause was on Garrett's end, and he
  resolved it. The box stayed up (169 days). Cron's calls to its own address
  still reached the app, but the app's calls out hung (kamal-proxy's 504;
  `webhook-health`'s own 500) and no ping left the box, so four checks went
  down. (Read first from which checks were red, the start looked like 08:00;
  `cron.log` put it at 11:45 — the green ones had simply not been due.) After
  it: the 18:00 runs `rc=0`; `webhook-health` at 18:20 `rc=0`, no recent order
  missing; all five webhook subscriptions; the 15:00 `cabinet-fulfilment` run
  made by hand at 19:00 (nothing due); that day's Teams card not sent.
- **The setup:** the check `sync-shopify-catalog` created by Garrett (⚠ its two
  integrations NOT YET CONFIRMED); its `healthchecks.map` line (eight keys, mode
  600); the crontab installed from the repo (eight jobs; the old one kept as
  `~/crontab.before-item5p2`).
- **The first run**, 19:03:54 UTC through `run-cron.sh`, **exactly as
  predicted**: `{"ok":true,"synced":2622,"products":131,"removed":0,
  "discontinued":0,"restored":0}`, 10.3 s, pinged.
- **The probe after** (`item5p2-catalogue-probe.sql`): 3,064 rows = 2,979 + the
  85, all new (none revived from the 442); 2,622 current, none without options;
  the three products 175, 105, 105; every vendor's count Shopify's (HCI 942, J&K
  1,253, Waypoint 423, the samples 4); every id numeric; no colour discontinued
  — HCI judged for the first time, all five colours current. 2,195 current rows
  carry a Color option (not predicted; the judgement, which reads them,
  matched). The schema and both functions unchanged.
- **Still to see live:** (b), the product webhook reading Shopify — no product
  update observed since the deploy. The next to the 175-variant product shows
  it: that product must stay at 175 current (REST's payload would have cut it
  to 100).

### 6.4 Still open from this session

- **Item 4, Garrett's ruling:** the "Delivered" email per line or per order —
  and "Delivery date changed" too, since feature 10 gave each line its own
  delivery target. Proposed: per line. The "Delivered" email carries the
  48-hour sentence, and sent only at the last line it could reach a customer
  after their first line's 48 hours had passed; a line of a mixed order then
  needs approved wording.
- ~~**`phase1-harness.tar.gz` was not uploaded this session**~~ — uploaded later
  the same session, and used for feature 11 part 2. Its `prod_base.sql`
  `projects` matched production's 2026-11-03 probe exactly.

## 7. 2026-11-04 — the Turnstile check, the forms' slow uploads, feature 12

### 7.1 Turnstile (the website team's note, 2026-11-03)

Cloudflare's dashboard said siteverify was not called for the quote and claims
widgets. **Checked, nothing changed.** Both endpoints call siteverify on every
submission before anything is stored, each with its own secret (the quote form
`TURNSTILE_SECRET_KEY`; the claims form `TURNSTILE_CLAIMS_SECRET_KEY`, and also
the action `claim` and the storefront's hostnames), refuse anything short of
success with 403 `turnstile_failed`, and refuse everything (503) when a secret
is missing (`lib/turnstile`). In production (`turnstile-config-check.js`, sha256
`98339317…`, read-only): both secrets set, different, a production key's shape,
and known to Cloudflare (a junk token answered `invalid-input-response`).
Stored submissions (`turnstile-submissions.sql`): no quote in 30 days, the last
claim 2026-10-14 — the website team's third possibility, nothing submitted
while the dashboard looked. Their test on 2026-11-04 passed Turnstile on both.

### 7.2 The forms' slow uploads (the website team's note, 2026-11-04)

Their first submission on each form answered 504 after ~30 s; the retry
succeeded. **Found** with read-only checks (`submission-timing.sh`,
`network-timing-check.js`, `db-statement-timing.sql`, `attachment-failures.sql`,
`submissions-last-2-days.sql`) and `upload-timing-check.sh` (which WROTE scratch
files to `claim-photos/_network-test/` and deleted each):
- **The 504 is kamal-proxy's**, at its default 30 s response timeout
  (`config/deploy.yml` sets none). Nothing sleeps.
- **The slow step is the file upload to Supabase Storage.** Each row was saved
  ~2 s in; a 100 KB upload then took 24 s, or hung — the quote's ended in
  "Gateway Timeout" from Supabase's own gateway, 61 s in. The upload test:
  0.4–12.5 s at random, from the container AND from the host; MTU 1500
  throughout; DNS, connections, small requests (136–672 ms) and Postgres's
  statements (milliseconds) all fine. Supabase posted **"Storage issues in
  us-east-1"** — 5XX errors, degraded performance — at 18:43 UTC (11:43 AM
  Arizona) the same day.
- **What it cost:** the first attempts' files were lost (QUO-1793816226246, 0
  files; CR-1016, 0 photos, yet a Help Scout conversation), and CR-1017, the
  retry, was a second claim. ⚠ The quote form did NOT save twice: its retry was
  answered as the same submission by `submission_id`
  (`orders_submission_id_unique`, 2026-09-24).
- **Cleaned up by Garrett, 2026-11-04:** QUO-1793816226246 deleted in the OMS;
  CR-1016 and CR-1017 by `delete-test-claims-2026-11-04.sql` (guarded — it
  deletes only if exactly those two match); their Help Scout conversations
  deleted. The storage sweep removes what was left in Storage after a day.

### 7.3 Feature 12 — the public forms answer within seconds, and never save twice (AGREED)

**Garrett, 2026-11-04:** *"I support all fixes and the trade off is fine for the
first point. If images are lost, especially for warranty items the support team
can reach out directly though helpscout to gather images and inform that they
were dropped. This isnt a big deal and would be very rare to begin with. The
main thing is that the form come through and isn't duplicated by a person
clicking the submit button 20 times because its taking to long."*

1. **Answer once the submission is saved; store the files after the answer.**
   Both forms: the row (about 2 s), the answer with its reference, then the
   files on the long-lived server, each upload retried (three attempts, each
   capped below Supabase's own 60 s, a pause between). A file still not
   stored: the quote's trail says so (as now); a claim's Help Scout
   conversation names the photos that never arrived. ⚠ A restart mid-upload (a
   deploy) loses those files — ACCEPTED: support asks the customer.
   - **A claim and Help Scout:** the claim is saved ALREADY LEASED to the route
     (`helpscout_leased_at` now; `claim_helpscout_lease` skips a lease under 10
     minutes), so the retry job cannot send it before its photos; the photos
     stored, the lease released, then sent. After a restart the lease expires
     and the retry job sends it.
   - **The photos a claim was sent** are recorded when it is saved (a new
     column), so whichever sender reaches Help Scout can name the ones that
     never arrived.
2. **Every answer comes from the app, with CORS, before the gateway's 30 s:** a
   time limit on each step before the answer (the rate limit, siteverify — 8 s
   already — the save); a save that runs too long answers "try again", and the
   retry is the same submission (3). A catch-all answers anything unexpected,
   with CORS.
3. **Never saved twice:** the claims form's `submission_id` (the website team is
   adding it; the quote form has it) — a column and a partial unique index (the
   migration), a repeat answered 201 with the reference already issued
   (`duplicate: true`). Twenty at once: one row, twenty answers with one
   reference — the unique index decides the race, the losers read the winner's
   reference. The quote route answers its own race (23505 at the insert) the
   same way, not with a 500.
4. **With it:** the consent row's browser string wraps at spaces (§6.2).

**The build:** (1) `f12-forms-probe.sql` — production's `claim_submissions`
and the quote's unique index (sha256 `2f5e93ad…`; the repo's
`claim_helpscout_lease` body md5 is `e8fc6d77…`, to compare); (2) the
migration, proven over the transcribed base; (3) the two routes,
`lib/claimIntake` and `lib/claimHelpScout`, proven against the deployed code:
a Storage stand-in that stalls, and twenty simultaneous submissions with one
`submission_id`; (4) the docs, OPERATIONS's kamal-proxy note among them.

### 7.4 ⚠ The claims table, dropped and repaired (2026-11-04) — an incident

**What happened.** `prod_base_claims.sql` — a HARNESS file: production's
`claim_submissions` transcribed for the sandbox's test database, its first
statement `drop table if exists public.claim_submissions cascade` — was handed
over beside the feature 12 migration, under the same hash file, and run in
production's SQL editor after the migration. It replaced the table with an
empty copy: the five claims' rows, the migration's two columns and, by
CASCADE, `claim_helpscout_lease` (its result is the table's row type) were
gone, and numbering would have restarted at CR-1001. Nothing else: the other
nine claim functions name the table only in their bodies. **The fault was the
handover, not the run:** the file should never have left the sandbox.
Garrett: *"Nothing needs restoring site isn't live yet, all claims and orders
are tests"* — so no rows were restored.

**Found** by `claims-table-check.sql` (read-only, sha256 `0861647e…`): 0 rows,
34 columns, no lease function, numbering unused.

**Repaired** by `claims-table-repair-2026-11-04.sql` (sha256 `bec31b69…`), one
transaction: numbering after CR-1017, the highest reference issued (the next
is CR-1018); the lease function as 2026-10-05 wrote it, with its grants; the
table's eight comments, verbatim from their migrations; feature 12's columns,
checks and index, verbatim. **Proven:** the claims table built by its own
migrations in production's order (its columns identical to the probe), the
incident reproduced on it, the repair run twice — the table's 72-line
description identical to the original's, and a planted change seen. **In
production:** its check `36 · 2 · 1 · service_role · 10 · CR-1018 · 9`, then
`claims-table-check.sql`: 0 rows, 36 columns, both checks, the lease function,
numbering at 1017, 2 photos in Storage — test photos, which the storage sweep
removes.

**The rules it leaves:**
- ⚠ **A HARNESS FILE NEVER LEAVES THE SANDBOX LOOSE.** It travels only inside the
  harness archive, which is uploaded at a session's start and never opened
  outside the sandbox — never as a download of its own, never beside a
  deliverable, never under a deliverable's hash file. Only what Garrett is to
  run is handed over, each step with its full commands, the hash check
  included; anything shown that is not for him to run says so.
- ⚠ **Every harness database file refuses to run outside the sandbox:** its first
  statement raises unless `hx.sandbox` is `on`, which only `hx/fresh.sh` sets on
  the databases it makes. Proven: on a database that is not the sandbox's —
  run plainly, or as ONE multi-statement query, as Supabase's SQL editor sends
  it — it stops there and the table stays as it was (3 rows, 1 column); with
  the setting, the same file replaces it.
- **A function's fingerprint normalises line endings.** Production's
  `claim_helpscout_lease` differed from the repo's only by CRLF (pasted from
  the PC): fingerprint `md5(replace(prosrc, E'\r', ''))`.
- **Same-day migrations ran in production in the other order** (the screening
  value before Help Scout on 10-05; claiming before emailed claims on 10-06):
  production's column order is the probe's, not the file names'. A base built
  from the migrations follows production's order.

**The migration file** `2026-11-04-claim-submission-id.sql` (sha256
`38627940…`) joins `migrations/` with this commit: it ran in production on
2026-11-04 (its check `2 · 1 · 2 · 5 · 5`), was lost with the table, and was
re-applied verbatim by the repair. **Next:** feature 12's code (§7.3), its
build steps (3) and (4).

### 7.5 Feature 12, as built (2026-11-04)

**The code** (its own commit, deployed):
- **`lib/publicForms`** (new): `requestBudget` — every step before the answer
  capped, inside one 20 s budget (kamal-proxy gives up at 30 s); `uploadWithRetry`
  — three attempts, each capped at 45 s (below Supabase's own 60 s gateway),
  pauses of 3 s and 10 s, "already exists" counted as stored; `afterAnswer`.
- **The claims route:** a catch-all (500 `save_failed`, with CORS); the rate
  limit capped at 4 s (through on a time-out, as on its failure); Turnstile
  capped (503 `turnstile_unavailable`); `submission_id` — a repeat answered 201
  `{ref, duplicate: true}`, a race (23505) the same, a save over 8 s 503
  `try_again`. The claim saved HOLDING its own Help Scout lease, with
  `photos_sent`; after the answer, started when the row lands (even after the
  request stopped waiting): the photos, all at once, three attempts each; the
  lease released; `pushClaims`.
- **The quote route:** the same budget, catch-all (500 `server_error`), caps and
  503s; a race (23505) a duplicate when an order has the `submission_id`, else
  503 (a `QUO-<millisecond>` id shared with another submission); the 201 says
  `attachments_received`. After the answer (`settleQuote`): the trail's first
  line, the files all at once, three attempts each ("… (after 3 attempts)" on
  the trail), the group found once after them, the legacy URL.
- **`lib/claimIntake.storeClaimPhotos`:** all at once; paths
  `<claim>/<time>-<n>-<name>`; `attempts` an option (1 for the staff route,
  whose behaviour is unchanged).
- **`lib/claimHelpScout`:** `photosNeverArrived`; the internal note names them —
  *"⚠ 1 photo the customer sent never arrived: door.jpg. Ask the customer to
  send it again, and tell them it was lost on our side."*
- **The consent row's browser string** wraps at spaces (`break-words`).

**Proven against the deployed code as the control** (the harness: a
production-shaped base with the transcribed claims table, the lease and the
migration; Storage, Help Scout and siteverify stood in):
- **claims, Storage slow** (3 s an upload, 2 photos): the control answered in
  6.0 s, feature 12 in 0.0 s; both photos stored, then sent to Help Scout with
  both attached. The retry job, run mid-upload, sent nothing — and with the hold
  planted out of the save, it sent the claim mid-upload with 0 photos.
- **claims, Storage failing:** three attempts, and the note names the photo; the
  control made one attempt, and its note said nothing.
- **claims, twenty at once with one `submission_id`:** the control saved 20
  claims with 20 references; feature 12 one claim, one reference, 19 answers
  marked duplicate.
- **claims, the save slow (12 s):** feature 12 answered 503 at 8.0 s; the page's
  retry was the same claim; its photo stored and sent all the same. The
  control: 12 s, and the retry a second claim.
- **claims, something thrown:** feature 12 answered 500 with CORS; the control
  did not answer.
- **quote, the same five:** 6.1 s → 0.0 s; "(after 3 attempts)" on the trail;
  twenty at once — the control 2 × 201 and 18 × 500 (the `QUO-` id and the
  `submission_id` index both), feature 12 20 × 201 and one order; the save slow
  → 503 at 8.0 s, the retry the same order, its file saved; thrown → 500 with
  CORS.
- **`storeClaimPhotos`** (shared with the staff route): the same outcomes in both
  trees — same-named photos, a refused photo, a refused record (its files
  removed). **`photosNeverArrived`:** five cases, among them a name that begins
  with a number.
- **The consent row:** identical in both trees but for the wrap class.
  **Typecheck:** the trees' error sets identical; a planted error seen in each of
  the six files.
- ⚠ The harness's Supabase stand-in answered a set-returning function with its
  first value, not its rows: fixed. Both trees had failed alike, which is how
  the test's fault was told from the code's.

**After the deploy:** the website team tests both forms, once told it is live.
