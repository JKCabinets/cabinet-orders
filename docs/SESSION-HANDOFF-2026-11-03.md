# Start here — session handoff, 2026-11-03

⚠ **THE START POINT.** Supersedes `SESSION-HANDOFF-2026-11-02.md` and
`SESSION-HANDOFF-2026-10-29.md` as where a session starts; both stay the
RECORDS of what they cover, and this file points into them rather than copying
them. Everything since the 10-29 docs review is built, deployed and tested live
by Garrett: feature 9 phase 1 (cabinet fulfilment) and feature 10 (cabinet
lines).

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

- After this docs commit, `HEAD~1` is *"Docs: feature 10, cabinet lines, as
  built and deployed (2026-11-03)"* and `HEAD~2` is *"Feature 10, part 5: the
  work queue names the cabinet line holding an order"*. **The next chain
  checks: `HEAD~1`'s subject is that docs commit, tree clean.**
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
