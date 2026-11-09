# Start here — session handoff, 2026-11-06

⚠ **THE START POINT.** Supersedes `SESSION-HANDOFF-2026-11-04.md` as where a
session starts. The 2026-11-04/06 session finished **item 5** — all four parts
and 4c, each deployed and checked live. Item 5's record is in
`SESSION-HANDOFF-2026-11-03.md` §6.3 (its home since its plan); this file points
into it rather than copying it, and records the rest.

## 0. A new session, first

1. **Snapshot, on the box**, after this file's commit:
   ```bash
   cd ~/cabinet-orders && git archive --format=tar.gz -o ~/repo30.tar.gz HEAD && cd ~ && sha256sum repo30.tar.gz > repo30_tar_gz.sha256
   ```
2. **Upload** `repo30.tar.gz`, `repo30_tar_gz.sha256`, this file, and the
   harness archive `harness-2026-11-06.tar.gz` with its
   `harness-2026-11-06.tar.gz.sha256`. Check both hashes.
3. **Read this file whole**, then the method (§3), before any change.

## 1. Where things stand

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`): after this docs
commit `HEAD~1` is `5c8ea73`, item 5 part 4 (deployed). **The next chain
checks: `HEAD`'s subject is *"Docs: session record and start point
(2026-11-06)"*, tree clean.** ⚠ **The running image is `5c8ea73`**; against
this docs `HEAD` the image check reads MISMATCH until the next deploy, by
design. This session's commits — `git log --oneline d04a568..HEAD` — each a
design record, then its part and its docs: part 2 (`4ccd94d`, its live record
`2a7a20c`), part 3 (design `841fe89`, `3914bc0`), part 4 (`5c8ea73`), this one.

**Production's database:** no migration this session. `shopify_products` holds
3,064 rows, 2,622 current — every variant Shopify has, the 85 REST hid
included — every current row with its options recorded; no colour mapping
discontinued (11-03 §6.3, "Part 2, LIVE").

**Shopify:** every call the OMS makes is GraphQL **`2026-10`**, through
`lib/shopify`'s one strict call and one constant; **no REST is left**. The five
webhook subscriptions deliver in **`2026-10`** — the app's own setting in
Shopify, moved 2026-11-05 (4c); `GET /api/shopify/webhooks` lists each one's
`apiVersion`.

**Cron** — eight jobs (`scripts/cron/crontab`, installed 2026-11-05):
`sync-shopify-catalog`, 10:00 UTC daily, joined them. ⚠ **The deploy chain runs
`npx next typegen` before `npx tsc --noEmit`** (§3). **healthchecks.io:** eight
checks, the dashboard's "Catalog sync" row holding the Avis and Shopify ones.

**The GHCR token** expires **2027-01-02 21:39:50 UTC**; the Monday check turns
red from its 2026-12-21 run (OPERATIONS §5). **The website team:** as 11-04
§1 — they will confirm when the claims form's `submission_id` is live.

## 2. Done this session — all deployed, all checked live

- **Item 5 part 2 — the catalogue from Shopify's own answer** (`4ccd94d`): the
  full sync over GraphQL, read whole; daily at 10:00 UTC with its own check;
  the product webhook reads the product from Shopify. First run as predicted,
  2,622 synced; the product webhook's first live update kept every variant.
- **Item 5 part 3 — the payment-status backfill and its button deleted**
  (`3914bc0`): the app's last REST call.
- **Item 5 part 4 — one API version, one strict call** (`5c8ea73`): every call
  through `lib/shopify` on `2026-10`, after a read-only schema check validated
  all 13 operations against Shopify's own 2026-10 schema; webhook-health no
  longer reads a refused answer as "no orders" (11-03 §4 item 7); item 67's
  comments.
- **4c — the webhooks' payload version:** the handler's ~45 payload fields set
  against Shopify's 2026-07 and 2026-10 release notes (no change to any), then
  moved to `2026-10` by Garrett; the first delivery on it answered 200.
- Every detail, proof and live result: 11-03 §6.3, "Part 2" to "4c".
- ⚠ **An IP block, not the OMS's:** Hetzner blocked the server's IP 2026-11-05,
  about 11:45 → 17:55 UTC; the cause was on Garrett's end and he resolved it.
  What it took down and how it was recovered: 11-03 §6.3, "Part 2, LIVE".
- **The cron log, read whole** (2026-11-06; 6,696 lines, 2026-05-20 →
  11-06): every line accounted for; **no scheduled run missed** since August
  (helpscout-sync since 10-07, webhook-health since 10-01); the 265 entries
  that are not a clean `rc=0` fall into seven episodes, all known — the TLS
  errors of 05-21 → 07-24 (every job; `delivery-complete` never once ran clean
  and was retired after 07-23), the Avis 500s of 08-07 → 08-18, webhook-health's
  first day (08-20), a malformed ping URL (08-26), helpscout-sync's first run
  (10-06), SHO-1059 (10-19), and the IP block. teams-digest skipped with
  `TEAMS_WEBHOOK_URL not set` until 10-21, and has posted every weekday since.

## 3. Method — what holds

The full method is in `SESSION-HANDOFF-2026-09-15.md`; then 10-13 §2 (which
10-29 §2 keeps), 10-29 §2, 11-02 §2 and §3.8, 11-03 §3 and the rules of 11-03
§7.4, and 11-04 §3. In brief: read whole; design before code, decided by
Garrett and committed before the build; build in parts, each proven against
the deployed code as the control; ship as an anchored, pinned patch script; a
migration probed, transcribed and proven first.

**This session's lessons, each paid for once:**
- ⚠ **Every deploy chain runs `npx next typegen` before `npx tsc --noEmit`.**
  The box keeps route types Next.js generated earlier; a deleted or renamed
  route leaves them naming a file that is gone, and the typecheck fails on the
  stale list. Regenerating changes no tracked file.
- ⚠ **Check the control tree against the box by its pins before building on
  it.** A reply that never reached Garrett had edited five files in the
  sandbox, which keeps its files; the control tree, copied from the working
  tree, carried them. Found only because a file read differently from its
  first reading; reset and rebuilt in view (11-03 §6.3, "Part 4, as built").
- **A wrong-base test needs the true tree,** rebuilt and checked by its pins:
  a tree renamed twice was mislabelled, and "passed" for that reason.
- **Whole files, not filtered views** (Garrett, 2026-11-06): pull the file and
  account for every line — a `tail` had hidden part of a day.
- **Ask the data before the theory:** the IP block's start was first read off
  which checks were red (08:00); the log said 11:45 — the green ones had simply
  not been due.
- **The webhooks' payload version is the app's setting, not the code's**
  (OPERATIONS §8).
- **The harness:** PostgreSQL stops after every command (start it first); a
  database copied by TEMPLATE loses `hx.sandbox`; `pg_dump` writes a random
  `\restrict` line, so a snapshot keeps rows and sequences only; the Supabase
  stand-in now sends an array-typed RPC argument as an array; a page can be
  mounted and clicked in jsdom; `make_patch_script.py` builds the patch,
  pinned deletion included.

## 4. Open

1. ⚠ **The `sync-shopify-catalog` check's two integrations** ("OMS Health",
   "OMS Health Email"): NOT YET CONFIRMED (OPERATIONS §6).
2. **Where the app's webhook version is set** — the Dev Dashboard's app
   version, or a custom app's Configuration in the Shopify admin: Garrett to
   say, so OPERATIONS §8 names the place.
3. **Item 4, Garrett's ruling:** the "Delivered" and "Delivery date changed"
   emails, per line or per order (11-03 §6.4).
4. **The storage sweep** (admin): two test photos and whatever the 504 attempts
   of 2026-11-04 left in Storage are named by no record; safe to sweep.
5. From the 11-03 list (§4 there), still open: 8 (UTC "today": a line due today
   reads overdue after 5 p.m. Arizona), 9, 10, and 11 (RECOVERY has never been
   exercised). Item 7 was done with item 5 part 4.
6. **Found this session, left for their own look:** the admin home's warning
   of orders "with no total recorded — backfill via Shopify sync" names the
   wrong tool; the admin Shopify page shows nothing when a sync fails (`if
   (data.ok)`, an empty `catch`); no product create or delete webhook is
   subscribed — the daily sync covers both.

## 5. Where each fact lives

`README.md` points here. `docs/OMS-STATE-2026-08-26.md` — what the system IS.
`docs/OPERATIONS-2026-08-26.md` — the business, services, credentials, cron,
checks, and why. `docs/RECOVERY.md` — when it has gone badly wrong. The
handoffs — each session's decisions; item 5's are in
`SESSION-HANDOFF-2026-11-03.md` §6.3. One fact, one home.
