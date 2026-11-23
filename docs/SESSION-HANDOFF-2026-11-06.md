# Start here — session handoff, 2026-11-06

⚠ **THE START POINT.** Supersedes `SESSION-HANDOFF-2026-11-04.md` as where a
session starts. The 2026-11-04/06 session finished **item 5** — all four parts
and 4c, each deployed and checked live. Item 5's record is in
`SESSION-HANDOFF-2026-11-03.md` §6.3 (its home since its plan); this file points
into it rather than copying it, and records the rest. ⚠ **AMENDED through
2026-11-23** by the 2026-11-10/23 session: §4 items 1–4 done, items 8, 9, 10
and 12 designed, built and LIVE, item 11 done in part, item 6's first bundle
designed, built and LIVE and its second designed (§6), the catalogue sync's
one red (§6.4).

## 0. A new session, first

1. **Snapshot, on the box**, after this file's commit:
   ```bash
   cd ~/cabinet-orders && git archive --format=tar.gz -o ~/repo31.tar.gz HEAD && cd ~ && sha256sum repo31.tar.gz > repo31_tar_gz.sha256
   ```
2. **Upload** `repo31.tar.gz`, `repo31_tar_gz.sha256`, this file, and the
   harness archive `harness-2026-11-23.tar.gz` (sha256 `34ab4e13…`) with its
   `harness-2026-11-23_tar_gz.sha256` — it carries items 10, 12 and item 6's
   first bundle's files (§6.13). Check both hashes — by VALUE: an upload
   renames `x.tar.gz` to `x_tar.gz`, so `sha256sum -c` fails on the name (§3).
3. **Read this file whole**, then the method (§3), before any change.

## 1. Where things stand

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`): `HEAD` is *"Docs:
item 6 bundle 2 designed (2026-11-23)"*, `HEAD~1` *"Docs: item 6 bundle 1
live (2026-11-23)"*, `HEAD~2` `bb297fc` *"Item 6, bundle 1: what staff
screens show wrong (2026-11-23)"* (deployed), `HEAD~3` `1a495a7` *"Docs: item
6 bundle 1 designed (2026-11-23)"*, `HEAD~4` `c9c701b` *"Docs: item 11,
recovery checked in part (2026-11-23)"*, `HEAD~5` `7f87441` *"Docs: item 11
designed (2026-11-23)"*, `HEAD~6` `105a12c` *"Docs: item 12 live
(2026-11-18)"*. **The next chain checks: `HEAD`'s subject is that one, tree
clean.** ⚠ **The running image is `bb297fc`, item 6's first
bundle** (§6.13); against this docs `HEAD` the image check reads MISMATCH
until the next deploy, by design. The 2026-11-04/06
session's commits — `git log --oneline
d04a568..2a7a20c` and after — each a design record, then its part and its
docs: part 2 (`4ccd94d`, its live record `2a7a20c`), part 3 (design `841fe89`,
`3914bc0`), part 4 (`5c8ea73`), its session record.

**Production's database:** no migration this session. `shopify_products` holds
3,064 rows, 2,622 current — every variant Shopify has, the 85 REST hid
included — every current row with its options recorded; no colour mapping
discontinued (11-03 §6.3, "Part 2, LIVE").

**Shopify:** every call the OMS makes is GraphQL **`2026-10`**, through
`lib/shopify`'s one strict call and one constant; **no REST is left**. The five
webhook subscriptions deliver in **`2026-10`** — the app's own setting in
Shopify, moved 2026-11-05 (4c); `GET /api/shopify/webhooks` lists each one's
`apiVersion`. The first order on those payloads, #1078 (2026-11-09, 21:28
UTC), was taken in cleanly: its project and its cabinet group. ⚠ **Every test
order, #1078 among them, was deleted 2026-11-16** (Garrett): Shopify answered
no orders, and the OMS held no Shopify purchase (§6.5). **One test order
since: #1079** (SHO-1079, HCI only, at New when seen) — items 10 and 12 were
checked on it (§6.7, §6.9), and item 6's first bundle, when it was still the
only purchase (2026-11-23, §6.13); it can go with the next clean-up.

**Cron** — eight jobs (`scripts/cron/crontab`, installed 2026-11-05):
`sync-shopify-catalog`, 10:00 UTC daily, joined them. ⚠ **The deploy chain runs
`npx next typegen` before `npx tsc --noEmit`** (§3). **healthchecks.io:** eight
checks, the dashboard's "Catalog sync" row holding the Avis and Shopify ones.
`sync-shopify-catalog` went red once, 2026-11-17 — a slow read, nothing written;
run by hand the same day, three times clean (§6.4).

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

**The 2026-11-10/17 session's lessons:**
- ⚠ **The sandbox can be reset between replies** (found 2026-11-16, after a
  six-day pause): the trees, the harness's new files and PostgreSQL were gone;
  the uploads were not. The control tree was rebuilt from repo30 and the two
  delivered docs patches, and checked against the 18 pins the box had given
  before any edit; the harness's new files were written again. Pack the
  harness archive as soon as its new files are proven; after a pause, check
  what survived before anything else.
- ⚠ **The deploy chain diffs cron** (OPERATIONS §6): `crontab -l | diff -
  scripts/cron/crontab` and `diff ~/cron-jobs/run-cron.sh
  scripts/cron/run-cron.sh`. The 2026-11-16 chain left it out; run the next
  day, clean.
- **A long log, read whole, by shape:** every line given its shape,
  continuation lines attached to their entry, every entry not a clean `rc=0`
  read in full, and the count checked against the last reading's (265 to line
  6,696 — the same, 2026-11-17).
- **The typecheck in the sandbox:** `xlsx` downloads from `cdn.sheetjs.com`,
  which the sandbox cannot reach. Installed from a copy of the lockfile without
  it, both trees carry one TS2307 (the acknowledgment route) and their error
  sets are compared; the box's chain typechecks whole.
- **An upload renames dots:** `x.tar.gz` arrives as `x_tar.gz`, so
  `sha256sum -c` fails on the name — compare the value.
- **A whole page, mounted:** item 9's proof mounted the real `OrderModal` (2,706
  lines) in jsdom with a store stand-in that names any field it was not given;
  a test row needs every field a real row carries (`notes` was missing first).

## 4. Open

1. ✅ **The `sync-shopify-catalog` check's two integrations** ("OMS Health",
   "OMS Health Email"): CONFIRMED by Garrett 2026-11-10 — both on, the check
   green (OPERATIONS §6).
2. ✅ **Where the app's webhook version is set** — ANSWERED by the record: the
   **Dev Dashboard**, where the app's permissions are set too (10-29 §4.6).
   OPERATIONS §8 names it. Closed 2026-11-10: nothing left to do.
3. ✅ **Item 4, Garrett's ruling** — RULED 2026-11-10: the "Delivered" and
   "Delivery date changed" emails go PER LINE, with the wording proposed;
   recorded with feature 9's design, `SESSION-HANDOFF-2026-10-29.md` §4.4,
   and two findings for phase 2's design in §4.3.
4. ✅ **The storage sweep** — DONE 2026-11-10 (Garrett). The dry run listed 7
   files, 256,143 bytes, each placed from the record before anything was
   deleted. `claim-photos` 2: the claims form's two attempts of 2026-11-04,
   CR-1016 and its retry CR-1017 by their times (the claims table rebuilt
   empty since). `order-attachments` 5: QUO-1793816226246's timed-out first
   attempt (2026-11-04, stored after the request gave up, so no row), and one
   each under WRN-1059-1, -3, -4 and SHO-1059-CAB, left by the hand removal
   of 2026-10-19 (10-13 item 40, corrected). Confirmed with 7: `removed: 7`;
   the dry run after it, `count: 0`.
5. From the 11-03 list (§4 there), still open: 8 (UTC "today": a line due today
   reads overdue after 5 p.m. Arizona), 9, 10, and 11 (RECOVERY has never been
   exercised). Item 7 was done with item 5 part 4. ✅ **8 and 9 DONE** —
   designed 2026-11-10, built, deployed 2026-11-16 and LIVE (§6.3). ✅ **10
   DONE** — designed 2026-11-17 (§6.6), with (b) and (c); built, deployed
   and LIVE (§6.7). Open: 11. Numbered on from there:
   - **12. The band's line rows, drawn at once** (Garrett: *"Option A as item
     12"*). ✅ **DONE** — designed 2026-11-18 (§6.8); built, deployed and LIVE
     (§6.9). ✅ **11 DONE IN PART** — designed 2026-11-23 (§6.10); A and E
     done, B and C (the test restores) declined for now, D not run (§6.11).
     Next, as planned: item 6's findings, then item 7; 13 and 14 open.
   - **13. The enrichment hook hides a failed request** (Garrett, designing
     item 12). `useOrderEnrichment` returns nothing on a refused or
     failed request — silent by design (`lib/useOrderEnrichment` lines 28–31,
     105, 112) — so no screen can tell "waiting" from "failed", and no
     wording fixes that: item 12's rows stay as drawn until the modal is
     reopened. Garrett: *"the hook exposes a failed state, so the band can
     say "couldn't check — reopen the order""*. Its own item, to design. ⚠
     Not every missing answer is a failure: the hook asks only about cabinet
     groups not archived (line 82), so an archived group is never asked.
   - **14. The stored files have no backup** (Garrett, 2026-11-23, item 11:
     *"Yes"*). Supabase's backups hold the database and only metadata about
     Storage — its own Backups page says so — so every uploaded file
     (attachments, acknowledgments' kept files, signed receipts, claim
     photos) exists in one place. RECOVERY calls it a known gap. Its own
     item, to design.
6. ⚠ **IN THREE BUNDLES (Garrett, 2026-11-23: "lets proceed with your
   recommendations").** Bundle 1, what staff screens show wrong — the
   backorders sort, the calendar's saves, the strip's claim, the projects
   page's attention, the back-on date, `missing_mod_value` — ✅ **DONE:
   designed 2026-11-23 (§6.12), built, deployed and LIVE (§6.13).** Bundle 2,
   the quiet admin and ops failures — the admin Shopify page, the admin home's
   warning, `cron.log`'s ping ids, and the calendar's delivery save (found
   building bundle 1) — **DESIGNED 2026-11-23 (§6.14)**.
   Bundle 3, one rule everywhere — Waypoint's three tests, the vendor sorts,
   the raw ISO dates. Recorded only: the sync's retry, the product webhooks,
   the system map's line (Garrett's to edit).
   **Found this session, left for their own look:** the admin home's warning
   of orders "with no total recorded — backfill via Shopify sync" names the
   wrong tool; the admin Shopify page shows nothing when a sync fails (`if
   (data.ok)`, an empty `catch`); no product create or delete webhook is
   subscribed — the daily sync covers both. And (found 2026-11-10) the system
   map still reads "Planned (feature 9 phase 1)", live since 2026-11-02.
   **Found 2026-11-10, reading for items 8 and 9:**
   - A member's "back on" date (`oooUntil`, stored `YYYY-MM-DD`) shows a day
     early: `new Date(...)` reads it as UTC midnight, 5 p.m. the day before
     in Arizona — `app/team/page.tsx`, `ProfileView`, `ProfileSummary` (not
     yet read whole).
   - Raw ISO dates on staff screens ("Exp 2026-11-10", "Starts …", "Sched
     …"), where every other date reads MM/DD/YYYY (09-15 item 11): the
     backorders page, `OrderTable`'s status labels, the line editor's
     tooltips, the calendar.
   - The calendar's two saves close the editor without checking the server's
     answer (`saveDelivery` reads none; `saveProductionDates` closes on a
     refusal too).
   - `lib/backorders` sorts "oldest first" by `orders.date`, the yearless
     display string the screens stopped reading 2026-10-19.
   - The order modal's group strip reads `claimed_by` off the group, so every
     group of a claimed Shopify purchase reads "unclaimed" there.
   - The review-reason labels are two copies (`OrderDetails`, the export
     route), and both lack `missing_mod_value`, which reads "Review".
   **Found 2026-11-17:**
   - The daily catalogue sync does not try again: one slow morning leaves the
     catalogue a day old and the check red until someone runs it (§6.4).
     Recorded; a design only if it recurs or Garrett wants it to retry.
   - `cron.log` holds four checks' ping ids: `run-cron.sh` logs a `/fail` ping
     it could not send with only `/fail` cut (OPERATIONS §6).
   - The projects page calls `attentionFor(g)` with no enrichment, so its
     "Needs attention" filter and count and each row's lead never include the
     acknowledgment or receipt reasons the work queue and dashboard show —
     the shape `attentionForProject`'s 2026-09-08 comment calls "identical to
     the feature not working" (found reading for item 10).
   **Found 2026-11-18, reading for item 12:**
   - Waypoint is tested three ways: the server's `isWaypointVendor`
     (`lib/vendorFamily` — the acknowledgment route, which decides whether an
     upload is checked; the fingerprint; the stage sentences); a regex in
     `AcknowledgmentPanel` (line 18) and the band (line 762) that also
     accepts a bare "Select"; and `ackStatus`'s `/waypoint/i`
     (`hasWaypoint`). The names lines carry (HCI, J&K and Waypoint
     Cabinetry) get one answer from all three; "Select Cabinetry", the
     storefront alias no line carries, is Waypoint to the first two and not
     to the third. The band moves to the server's test with item 12 (§6.8).
   - Two other screens order vendors by their own copy of the rule:
     `OrderDetails`' Full Order sections (line 123, `localeCompare` in the
     browser's locale) and the export route's headings (line 225, on the
     server, "Unassigned" last). Not the band's; today's names sort the same
     in every locale tried (§6.8).
   **Found 2026-11-23, building bundle 1:**
   - The calendar's delivery save writes to Shopify on every save of a group
     that carries the Shopify order's id — it always sends the window and the
     notes, and the route syncs on either being present — and the calendar
     shows nothing of Shopify's answer, so a failed write there is silent.
     Bundle 1 gave the production card its true line only, as designed; the
     delivery card never had one. In bundle 2 (Garrett: *"I agree, In"*).
   **Found 2026-11-23, designing bundle 2 — for later** (Garrett: *"We can
   work on these later"*):
   - Revenue's month and year begin at UTC midnight
     (`app/api/admin/revenue/route.ts` lines 35–40) — 5 p.m. Arizona — so an
     order placed the last evening of a month counts in the next, and on
     12/31 in the next year. Bundle 3's rule.
   - The revenue route admits any signed-in member (`requireAuth`, line 72);
     only `/admin` reads it, and every other admin-only route requires an
     admin. `/api/admin/health` is the other `requireAuth`, but the dashboard
     reads health for everyone.
   - The unpriced count includes refunded purchases, which the sums leave out.
   - The Shopify page's "No vendor" choice is `""`, the same as "All
     vendors": it lists every product.
7. **The website team's answers (2026-11-09)** to the questions sent as the
   10-29 record has them — that notifications plan stands:
   - **Quote requests:** the website sends each only to the OMS's quote
     endpoint and does not push it into Help Scout. They ask the **OMS** to
     create a Help Scout conversation for each, as it does for claims, tagged
     exactly `quote-request` (the Custom Quote Request view shows only
     those), and to tell them when a test quote can confirm it. **An OMS
     feature, to design.**
   - **The shipping confirmation:** Shopify has no on/off switch — it is sent
     whenever a fulfilment is created with the customer notified (OPERATIONS
     §8, corrected). Garrett: tested in the last session — the email arrived
     2026-11-02 (11-03 §1), and on a mixed order it lists only the lines that
     ship — so their offered joint test on #1078 is optional. (#1078 was
     deleted 2026-11-16 with every test order.)
   - **Risky orders:** nothing holds them; Shopify rates each order low,
     medium or high and shows it, but does not stop the order. Production
     starts in the OMS, so the hold belongs there, from that rating (they
     offered a tag if easier). Garrett: *"Okay, that sounds good"*. **An OMS
     feature, to design** — beside the payment hold.

## 5. Where each fact lives

`README.md` points here. `docs/OMS-STATE-2026-08-26.md` — what the system IS.
`docs/OPERATIONS-2026-08-26.md` — the business, services, credentials, cron,
checks, and why. `docs/RECOVERY.md` — when it has gone badly wrong. The
handoffs — each session's decisions; item 5's are in
`SESSION-HANDOFF-2026-11-03.md` §6.3, and the 2026-11-10/18 session's in §6
below. One fact, one home.

## 6. 2026-11-10 to 11-23 — this session's designs and results

Items 1 to 4 of §4: done and recorded there (`8ffab24`). Items 8 and 9 of the
11-03 list (§4 item 5): designed below, each agreed by Garrett and committed
before any code (`3eab9e5`); built together, one commit each, one deploy, item
9's patch pinned on item 8's (both touch `production-complete` and
`OrderDetails`) — as built and live, §6.3. Then the catalogue sync's red
(§6.4), the ingestion check's 0 and 0 (§6.5), item 10's design (§6.6), item
10 as built and live (§6.7), item 12's design (§6.8), item 12 as built and
live (§6.9), item 11's design, with its read-only part's facts (§6.10), and
item 11 as done (§6.11), item 6's first bundle's design (§6.12), that
bundle as built and live (§6.13), and the second bundle's design (§6.14).

### 6.1 Item 8 — Arizona's "today". DESIGN, agreed 2026-11-10

Garrett: *"That looks good, and yes the calendar should be in it"*.

**Read whole:** `lib/dates` (115 lines), `lib/dateUtils` (60), `lib/backorders`
(206), `lib/data` (1,445), `app/backorders` (294 + 12),
`components/OrderDetails` (627), `components/OrderTable` (1,329),
`app/api/cron/production-complete` (153), the readers — the dashboard (1,040)
and the sidebar (531) — and the calendar (703). Every place that derives a day
from the clock was found by its output across the code, and every DATE field
parsed or compared against the clock checked the same way: the family is
complete.

**Found — seven places take "today" as UTC's date** (`toISOString()`), which
from 5 p.m. to midnight Arizona is already tomorrow (the record said five):
1. `lib/backorders` `rollupBackorders` — the dashboard's "past commit" and the
   backorders page's "Past" count a line due today as missed.
2. `lib/data` `getBackorderStatus` — `OrderTable`'s "N backordered" at At
   cross dock clears a day early.
3. `BackordersClient` (line 256) — "· past" on a line due today.
4. `OrderDetails` (line 218) — a line's pill reads "ready" the evening before.
5. `OrderTable` (line 1100) — "Early Push" turns to "Mark Cross-dock" the
   evening before the ship date. New to the record.
6. `production-complete` (line 12) — a run by hand after 5 p.m. moves
   tomorrow's orders a day early; harmless at its scheduled 08:00 UTC (1 a.m.
   Arizona), when the two dates agree. 10-29 §2.1 noticed it; no list held it.
7. `lib/backorders` `flattenBackorderedLines` — no caller anywhere.
And **the calendar's "today"** (its highlight, the month it opens on) is the
browser's own clock: right only on a computer set to Arizona.

**The change:** 1–6 take phase 1's `arizonaToday()` from `lib/dates`, the rule
the fulfilment run and `lib/shipDates` already use; the two `todayIso`
parameters stay for tests, their comments corrected (both said "local"). 7 is
deleted with a one-line note — dead code carrying the fault would read as live
(09-15, "The standard"). The calendar's "today" and starting month come from
`arizonaToday()`. `arizonaToday`'s comment ("five places found") names its
users. No migration; no change to what any route accepts or stores.

**The proof, the deployed code as the control:** the functions and the three
screens (jsdom) at 4:30 p.m. Arizona (both agree), 5:30 p.m. and 11:59 p.m.
(the control already "tomorrow"), midnight (both move), and New Year's Eve —
each with the browser in Phoenix and in Tokyo; `production-complete` on
PostgreSQL at 08:00 UTC (identical) and at 6 p.m. Arizona (the control
advances tomorrow's order, the new code does not); the typecheck, both trees'
error sets identical and a planted error caught in each changed file; the
patch on box-shaped trees.

### 6.2 Item 9 — three loose ends. DESIGN, agreed 2026-11-10

Garrett: *"Look right, lets proceed"*.

**Read whole:** `scripts/cron/run-cron.sh` (161), `FullOrderGroup` (62),
`OrderModal` (2,706), the export route (631), `lib/skuDecoder` (192);
`production-complete` and `OrderDetails` with item 8.

**(a) `production-complete`'s trail row.** The order moves (its error checked),
then the "Production complete — moved to At cross dock automatically" row is
inserted with its error discarded: a failed insert leaves a moved order with no
trail line, and the run reports full success. **The change:** the error is
checked, logged and named in the answer (`trail_failed`: the order and the
reason). The status stays 200 — the route's own rule for a partial failure,
and the move happened. `run-cron.sh` writes every answer's body to `cron.log`
(line 132), so it is seen there.

**(b) Edits offered where the server refuses — wider than the record put it.**
`OrderModal` gives Full Order's `OrderDetails` `readOnly = archived || Shopify
group` (line 1813), and the claim (`canEdit`) never reaches it. So the
backorder pill opened its editor on archived work and on a colleague's claim
(on a Shopify group staff must still set backorders, which is why it ignored
`readOnly`), and Edit, Delete and Add SKU were offered on a custom job or claim
a colleague holds — each refused with 409. **The change:** two answers, not
one. The lines (add, edit, remove): read-only on a Shopify group, archived
work, or a colleague's claim. The backorder: read-only on archived work or a
colleague's claim, where the pill shows its state (ok, back or ready, with its
tooltip) and opens nothing — read-only is never blank (09-15). An admin's
"Edit order" gives both, as everywhere in the modal. A new prop through
`FullOrderGroup` to `OrderDetails`; the modal's one call site.

**(c) The export route's comment.** It said `skuDecoder`'s `SkuItem` has no
review fields, so it read them "through this narrow cast"; that type is
`lib/data`'s full one, re-exported (`lib/skuDecoder` lines 153–158), with
`needs_review`, `review_reason` and `modifications`. **The change:** the comment
corrected and both casts (`ReviewFields`; the `modifications` cast, line 289)
dropped, so the fields are read through the real type — a renamed field fails
the typecheck instead of passing a cast. Types and comments only.

**The proof:** (a) the real route on PostgreSQL with the trail insert made to
fail — the control advances and says nothing, the new code advances alike and
names the row; a normal run's answer identical. (b) the real modal in jsdom:
the owner's claim (the pill opens), a colleague's (a label; no Edit, Delete or
Add — in the control they open), an admin's "Edit order", archived work, and a
Shopify group (backorder editable, lines not — as now). (c) the route's
compiled output byte-identical. Typecheck and patch as item 8.

### 6.3 Items 8 and 9 — AS BUILT, deployed 2026-11-16, LIVE

- **Built 2026-11-16 as designed** (§6.1, §6.2), after the sandbox was reset
  (§3): the control tree rebuilt from repo30 and the two delivered docs
  patches, checked against the 18 pins Garrett's box gave at `3eab9e5`.
- **Item 8** — `patch_item8_arizona_today_2026-11-16.py`, sha256 `cf4edafb…`;
  the eight files of §6.1. **Proven, ALL PASS:** five instants — 4:30 p.m.,
  5:30 p.m. and 11:59 p.m. Arizona, midnight, New Year's Eve at 6 p.m. — the
  functions in UTC, Phoenix and Tokyo, the three screens with the browser in
  Phoenix and Tokyo. From 5:30 p.m. the control was on tomorrow everywhere (a
  line due tomorrow "ready", "Awaiting delivery date" for "1 backordered",
  "Mark Cross-dock" for "Early Push", "· past" on a line due today), and on
  New Year's Eve in Tokyo it opened the calendar on January 2027; at 4:30 p.m.
  it was right but for the calendar in Tokyo; at midnight both moved together.
  `production-complete` on PostgreSQL: identical at 08:00 UTC; by hand at 6
  p.m. Arizona the control also moved tomorrow's order.
- **Item 9** — `patch_item9_loose_ends_2026-11-16.py`, `3baf9672…`, pinned on
  item 8's: on a box without item 8 it refuses, nothing written. The five
  files of §6.2. **Proven, box + item 8 the control:** (a) the trail insert
  refused for one order by a trigger — the control moved both orders, left the
  line missing and answered silent; the new code moved both, answered 200 with
  `trail_failed: 1` naming the order and the reason, and logged it; a normal
  run identical. (b) the real `OrderModal`, Full Order tab, seven cases: the
  owner's claim — all offered, both trees; a colleague's claim, and an admin
  before "Edit order" — the control offered Add SKU, edit, delete and an
  opening pill, the new code a label and nothing else; an admin after "Edit
  order" — all, both; archived work — the control's pill opened, the new
  code's is a label; a Shopify group, the owner's claim — backorder editable,
  lines not, both; a Shopify group, a colleague's claim — the control's pill
  opened, the new code's is a label. (c) two `SkuItem` fields renamed in
  copies: the control's casts passed it silently; the new code fails the
  typecheck at all five uses.
- **Two departures from the design's wording:** a read-only pill on a line
  not backordered is titled "Not backordered" (the button's "Mark as
  backordered" names an action); and (c) — dropping the cast left an alias
  `rf` with no purpose, removed, so the compiled route differs from the
  control by exactly that alias: the control with `const rf = item;` removed
  and `rf` read as `item` is byte-identical to the new.
- **Typecheck:** `next typegen`, then `tsc`: each item's error set identical to
  its control's; a planted error caught in every changed file (8, then 5).
  Both trees carry the sandbox's one `xlsx` TS2307 (§3).
- **Deployed 2026-11-16** (Garrett): `8af4e0f` *"Item 8: Arizona's today
  (2026-11-16)"*, then `c1401a1`, pushed, `kamal deploy`; the container up 21:21:39 UTC. The
  image check (2026-11-17): `DEPLOYED` at `c1401a1`. ⚠ The chain left out the
  cron diff (§3); run 2026-11-17: the crontab and `run-cron.sh` match the repo,
  the map's sync entry is well-formed.
- **LIVE** (Garrett, 2026-11-17): *"on an already claimed order a different
  team member can click and see the full order when clicking the tab, but cant
  interact with buttons."* The owner's pill still opening: proved in the
  harness, not checked live.

### 6.4 2026-11-17 — `sync-shopify-catalog` red once: a slow read, nothing written

- **What happened.** Garrett: the check DOWN; its ping #14 was `/fail` at
  10:00:16 UTC. `cron.log`, snapshotted whole (8,040 lines, sha256
  `682d16cc…`): `[2026-11-17T10:00:01Z] /api/cron/sync-shopify-catalog rc=22
  response=HTTP 502 {"ok":false,"error":"Shopify's catalogue was not read
  within 15s"}` — the read's own budget (`lib/shopifyCatalogue`,
  `CATALOGUE_READ_MS`), the whole read's race (no "page N"): a call to Shopify
  still unanswered at 15 s. **Nothing was written** — the read is whole before
  any write; the catalogue stayed as 11-16's sync left it.
- **What it was not.** Not the deploy: the six files the route runs
  (esbuild's inputs — the route, `lib/cronAuth`, `lib/shopify`,
  `lib/shopifyCatalogue`, `lib/shopifyColor`, `lib/supabase`) byte-identical
  before and after items 8 and 9, the container up since 21:21 UTC the day
  before. Not cron or the monitor: the diffs clean. No Shopify Admin incident
  published that day (IncidentHub).
- **The log, read whole** (§3): lines 1–6,696 as 11-06 read them (265 not clean,
  the same count); 6,697–8,040 every job on schedule every day, and ONE entry
  not clean — this one. The 13 runs before it (two by hand on 11-05, then
  daily from 11-06): each 2,622 variants, 131 products, nothing removed.
- **Run by hand three times, a minute apart** (18:16–18:19 UTC): 9.9, 10.1 and
  9.0 s each, the whole run (the read, six writes, two database steps); each
  2,622 / 131 / 0; each pinged, no ping failed — a success ping returns the
  check to UP. The read inside that, as the
  7.7 s of 11-04: the 15 s budget keeps about twice its margin. **One slow
  moment at Shopify, at 3 a.m. Arizona; nothing changed.**
- **Found:** the run does not try again (§4 item 6). What to do when it goes red
  this way: OPERATIONS §6.

### 6.5 The ingestion check reads 0 and 0 — every test order deleted

Since 2026-11-16 22:20 UTC `webhook-health` answers `"shopify_orders_checked":0,
"note":"no orders in Shopify to reconcile","oms_purchases_checked":0`. Both
counts went from 1 to 0 in the same hour and nothing went red: an order deleted
in Shopify, its delete webhook removing the purchase before the hourly check
looked. Garrett (2026-11-17): *"Yes, all old test orders were deleted"* — #1078
among them. The log shows the same after each earlier clean-up (from 10-19,
11-02 and 11-04). As designed; the first real order makes it reconcile again.

### 6.6 Item 10 — one waiting line named twice. DESIGN, agreed 2026-11-17

Garrett: *"Looks good and include both"* — (b) and (c) with it.

**Read whole:** `lib/attention` (384 lines), `lib/requirements` (456), and the
four readers of the reasons — the work queue (481), the projects page (694),
the dashboard (1,040), the sidebar (531).

**Found.** One function, `linesWaiting` (`lib/attention` lines 108–127). Two
screens show a reason's label over its detail — the work queue's rows and the
dashboard's Needs-attention panel; the projects page shows the label only; the
sidebar counts kinds. With ONE line waiting the detail repeats the label's name:
"Waypoint Cabinetry: acknowledgment required" over "Waypoint Cabinetry: no
acknowledgment yet".

**The change.** One line waiting: the detail drops the name and says why as a
sentence, in the order route's own words for the same states — "No
acknowledgment yet"; "Its acknowledgment did not match the order"; "The order
changed since its acknowledgment". Two or more: unchanged — "Acknowledgments
required: A, B" over "A: … · B: …", where the names say which why is whose.
Every label unchanged (decision D: the reason names the line); no kind,
severity, count or filter changes.
- **(b)** The receipt, one line: "Upload each line's signed delivery receipt"
  under a label naming one line becomes "Upload its signed delivery receipt";
  several unchanged.
- **(c)** The comment above `ENRICHED_REASONS` still says the New gate passes
  "on a green acknowledgment OR any attachment" and to "attach the
  acknowledgment for HCI and J&K" — retired by feature 10, 2026-11-02.
  Corrected; comment only.

**The proof, the deployed code as the control:** `attentionFor` in both trees
over every case — one line in each of the three states, two lines, one
receipt, two receipts, the unnamed fallbacks — the new differing from the
control only in those details, every label and every other reason identical;
the real work queue mounted in jsdom, the enrichment answered by a stand-in,
showing the row's two lines in both trees; the typecheck with a planted error;
the patch on box-shaped trees.

### 6.7 Item 10 — AS BUILT, deployed, LIVE

- **Built as designed** (§6.6): `lib/attention.ts` only —
  `patch_item10_one_line_named_once_2026-11-17.py`, sha256 `5668a75a…`.
- **Proven, ALL PASS.** `attentionFor` in both trees over the same 12 cases:
  every reason's kind, severity and label identical; the details differ only
  where agreed — one line missing, failed or stale (of two), a single-line
  order, one receipt of two; two lines waiting, two receipts, the fallbacks,
  met and no enrichment identical. The real work queue in jsdom, the
  enrichment from the stand-in, four cases: one line missing, failed or
  stale — the new detail without the name — and two, identical. The patch:
  `--check` writes nothing; it applies byte-identical to the tested tree,
  re-runs ALREADY APPLIED, refuses a broken anchor and another base, and
  carries no sandbox path.
- **Deployed** (Garrett): `5e32f74`, through the chain — `next typegen`,
  `tsc`, the cron diffs (§3) — and `kamal deploy`; the image check
  `DEPLOYED` at `5e32f74`.
- **LIVE** (Garrett): the dashboard and the modal on SHO-1079 (HCI only, at
  New), in screenshots.
- **A wording note.** §6.6 called the details "the order route's own words".
  For a failed line the route's refusal says "its acknowledgment did not
  match" (`app/api/orders/[id]/route.ts` line 361); the agreed detail, "Its
  acknowledgment did not match the order", adds "the order". Built as agreed;
  recorded so the two are not read as one string.
- **The harness:** item 10's files — `tests/item10_unit.ts`,
  `tests/item10_queue.tsx`, `prove_item10.py` — postdate
  `harness-2026-11-17.tar.gz` (§0).
- **Seen on the same order:** opening it, the band read "Each cabinet line"
  for a split second, then the HCI row (Garrett: *"For a split second it says
  the "Each cabinet line" then switches to the HCI"*) — item 12, §6.8.

### 6.8 Item 12 — the band's line rows, drawn at once. DESIGN, agreed 2026-11-18

Garrett: *"Option A as item 12"*; the receipts with it (*"Receipts: yes,
include (b)"*); and the design agreed with his four amendments — notes that
instruct rather than report, the server's own sort, the server's row key,
three more proof cases: *"With those, I'd agree the design as written."*

**Read whole:** `components/NextActionPanel` (786 lines),
`lib/useOrderEnrichment` (123), `lib/vendorLookup` (239), `lib/shipDates`
(196), `lib/vendorFamily` (19), `lib/requirements` (456),
`lib/acknowledgments` (249), `lib/deliveryProof` (30), `lib/ackStatus` (159),
the enrichment route (177), the vendors route (60); `OrderModal` (read whole
for item 9) again where it mounts the band (lines 470–560, 1546–1620).

**Found.**
- **The flash.** The band draws a cabinet line's rows from the enrichment —
  `ackLines` at New, `proofLines` on a mixed order at At cross dock — which
  lands a moment after the modal opens. Until then it draws the requirement's
  general row ("Each cabinet line's acknowledgment", the Waypoint-and-HCI
  remedy under it), then swaps it for the lines; the move column moves too
  (it sits level with the last line only once there are lines, line 524).
- **A row is a vendor's line, not a SKU.** The server keys each row by vendor
  name — `resolveVendors`' `uniqueVendors`, once each, sorted — one
  acknowledgment and one receipt per vendor: two HCI SKUs make one row. The
  order's own lines name the same vendors wherever a line carries its own
  (decision E: `lib/shipDates`' `lineVendor` asks a line's own vendor first,
  as `resolveVendors`' layer 0 does).
- **The sort was the server's alone,** inline in `resolveVendors`
  (`lib/vendorLookup` line 221), a module that imports supabase and cannot
  reach the browser. And `localeCompare` with no locale asks the runtime's
  default — the server's container (the Dockerfile and `deploy.yml` set no
  `LANG`, and with none Node answers `en-US`) or each person's browser — so
  even one function orders two ways wherever a locale does: in Danish or
  Turkish "HCI Cabinetry" sorts before "hci cabinetry", in Czech "Ch" after
  "H". The names in use, with the alias "Select Cabinetry", sort the same in
  all twelve locales tried, and the same by code units.
- **Before the answer** the band offers no upload, and the move is disabled —
  a gating unknown (the band's header, "UNKNOWN RENDERS AS UNMET").

**The change.**
1. **The rows are drawn from the order's own lines until the answer lands.**
   `cabinetVendorsOf(order)`, sorted by the server's rule (2), gives the
   names. Each row is the row the answer will draw — the same key
   (`ack:<vendor>`, `proof:<vendor>`), the same place, the same open circle —
   in a third state, *unknown*: no upload button and the move disabled, as
   now. Its note says what the line needs, never whether it has it (Garrett:
   *"it has to read as an instruction, not a status"*) — the line's
   "missing" note with the upload instruction taken off:
   - Waypoint: "Its acknowledgment spreadsheet, which must match the order"
   - HCI, J&K and any other: "A PDF or Excel file"
   - a receipt, on a mixed order: "Its signed delivery receipt"
   When the answer lands its names and states stand, even none: on the same
   names nothing moves — the circle, the note and the button change in
   place. One line keeps the receipt's single row, as feature 10 has it; a
   group whose lines name no vendor keeps the general row until the answer.
2. **One sort, in one place.** The server's sort moves, as it is, to a new
   pure module, `lib/vendorOrder`, which `resolveVendors` and the band both
   import — one function, not a copy. One thing is added: the locale, pinned
   to `en-US`, the container's own default — so the server's order does not
   change, and every browser orders as the server does. The container's
   default is checked on the box before the build.
3. **Waypoint by the server's test.** The notes ask `isWaypointVendor`
   (`lib/vendorFamily`) — the test the acknowledgment route uses to decide
   whether an upload is checked against the order — instead of the band's
   own regex, so "must match the order" is said exactly where the server
   checks it. They differ only on a vendor named "Select" alone, which no
   line carries. (The other two tests: §4 item 6.)

**Where a drawn row can still change** (Garrett: *"acceptable as the one
place a jump remains. It's honest, rare, and the server's names win"*): a line
with no vendor of its own — stored before 2026-08-24 — is drawn under the
group's vendor; the server may name another from the product cache (variant,
SKU shape, base SKU), and the row changes once, when the answer lands.

**If the answer never comes** — a failed request (the hook is silent by
design) or an archived group (never asked) — the rows stay as drawn: the
names and what each needs, no claim. Telling waiting from failed is item 13
(§4 item 5).

**Not changed:** the checklist's states and the move's gate; the remedies
the modal passes; the date fields (in line order, as now); the enrichment
hook; every server answer — `resolveVendors` returns what it did, in the
order it did. Files: `lib/vendorOrder` (new), `lib/vendorLookup`,
`components/NextActionPanel`. No migration.

**The proof, the deployed code as the control:** the real `OrderModal` in
jsdom, the enrichment held by the stand-in and then released — what the band
shows before the answer and after, both trees:
- SHO-1079's shape (HCI only, at New);
- Waypoint and HCI;
- J&K beside HCI and Waypoint — the `&` and the sort;
- two HCI lines and a Waypoint — one HCI row, the server's key;
- a line with no vendor of its own — drawn under the group's, changed by the
  answer;
- a group whose lines name none — the general row;
- each line's receipt on a mixed order at At cross dock, and one line's;
- an answer that never comes;
- switching from one purchase's order to another's with the first request in
  flight — its late answer must not paint the second band (the hook drops a
  superseded answer and keys its map by order id: shown, not assumed).
The control: the general row, then the lines. The new code: the lines
throughout, the same keys before and after; where the server names another
vendor, the one change. Then `resolveVendors` in both trees over a set of
inputs, the hard names among them ("J&K", "hci", "Select (Waypoint)"):
identical under the container's default locale; under a Danish one the
control's order moves and the new code's does not. The typecheck with a
planted error in each changed file; the patch on box-shaped trees.

### 6.9 Item 12 — AS BUILT, deployed, LIVE

- **Before the build** (Garrett, 2026-11-18): the box's pins for the 14 files
  item 12 touches or reads, and no `lib/vendorOrder.ts` — PINS MATCH at
  `af65791`. The running container's locale: `en-US LANG=unset LC_ALL=unset
  SAME ORDER` — so pinning `en-US` leaves the server's order as it was.
- **Built as designed** (§6.8): `lib/vendorOrder` (new: `compareVendorNames`,
  `sortVendorNames`), `lib/vendorLookup` (its inline sort replaced by
  `sortVendorNames`), `components/NextActionPanel` (the drawn rows, the
  unknown state's notes, `isWaypointVendor`) —
  `patch_item12_band_lines_at_once_2026-11-18.py`, sha256 `3051c14c…`.
- **Proven, ALL PASS** — the real `OrderModal`, the enrichment held and then
  released, its answer computed by each tree's own `resolveVendors`,
  `ackLineStates` and `proofLineStates`:
  - all nine cases: after the answer the new band is identical to the
    control's — rows, notes, buttons, the move, the action column. Before it,
    the control drew the general row and the new code each vendor's row,
    unknown, with the agreed notes and no upload; the move disabled, and the
    action column's and title row's controls the same in both;
  - where the drawn names are the server's (seven cases), every row is the
    same DOM node before and after, changed in place, and the move column no
    longer moves; two HCI lines are one row; J&K, HCI and Waypoint in the
    server's order;
  - the one change, as accepted: a line with no vendor of its own drawn under
    the group's (HCI), the server naming Waypoint for it — HCI kept, Waypoint
    added. A group whose lines name none: the general row in both, until the
    answer;
  - one line's receipt: the single row, unchanged; a mixed order's receipts:
    each line's row from the start;
  - an answer that never comes, and a refused one: the new rows stay as
    drawn; the control's general row stays;
  - switching to another purchase's order with the first request out, its
    answer landing before or after the second's: it never painted the second
    band, in either tree;
  - **found while proving:** the modal holds each line's upload BEFORE the
    answer (from the acknowledgment status, which answers first), so the
    band's own guard is what keeps an unknown line from offering one — with it
    removed, both lines offered "Upload acknowledgment";
  - `resolveVendors` over nine inputs, the hard names among them: identical
    in both trees under the container's locale; under a Danish one the
    control's hard names moved ("HCI Cabinetry" before "hci cabinetry"; "Ø"
    and "Å" last) and the new code's did not; the names in use moved in
    neither.
- **Typecheck:** `next typegen`, then `tsc`: both trees' error sets identical
  (the sandbox's one `xlsx`, §3); a planted error caught in each of the three
  files.
- **The patch:** `--check` writes nothing; it applies byte-identical to the
  tested tree, re-runs ALREADY APPLIED; a broken anchor, another base, and a
  different `lib/vendorOrder.ts` already present each MISS with nothing
  written; no sandbox path.
- **Deployed** (Garrett, 2026-11-18): through the chain — the pins, `next
  typegen`, `tsc`, the cron diffs — and `kamal deploy`. The running image
  checked against item 12's commit again by the chain that committed this
  record.
- **LIVE** (Garrett, 2026-11-18): *"Deployed and tested"*, with a screenshot of
  SHO-1079 answered: "HCI Cabinetry: acknowledgment" over "Upload theirs, a
  PDF or Excel file", Upload acknowledgment, Move to Entered waiting.
- **The harness:** `harness-2026-11-18.tar.gz` (sha256 `0e8a0dd3…`) carries
  items 10 and 12's files (§0).

### 6.10 Item 11 — exercising RECOVERY. DESIGN, agreed 2026-11-23

Garrett: *"Lets go with your recommendation"* — parts A, B, C and E; D, the
rollback rehearsal on production, not run. Point-in-time recovery: its status
recorded, nothing changed (*"I will go with your recomendation"*). The stored
files' missing backup: item 14 (*"Yes"*, §4 item 5).

**Read whole:** `docs/RECOVERY.md` (278 lines), `docs/OPERATIONS-2026-08-26.md`
(1,648), `config/deploy.yml` (135), `scripts/cron/crontab`,
`instrumentation.ts`; `scripts/cron/run-cron.sh` where it names its target
(line 55). Hetzner's and Supabase's own documentation (2026-11-18).

**Found.**
- **A restored box is live.** It boots with the crontab, and `run-cron.sh`
  calls production's own address (`APP_URL`, line 55) with the real cron
  secret, then pings the real checks; Docker restarts the app and
  kamal-proxy. With a network, a copy would run production's jobs a second
  time — claims to Help Scout within 15 minutes; at 15:00 UTC the cabinet
  fulfilment, which marks lines shipped in Shopify — and ping checks green
  from the wrong machine. A restore test fences the copy before it boots.
- **Hetzner:** a backup's menu offers "Create new Server", which leaves the
  server alone; Cloud Firewalls are stateful, and one outbound rule makes all
  other outbound traffic drop; the create form has a Firewalls step. Backups
  are deleted with their server.
- **Supabase:** "Restore to a New Project" (beta) copies the database into a
  new project and leaves production alone — not Storage, API keys or auth
  settings; extensions that act on their own (`pg_cron`, `pg_net`) start in
  the copy at once. A restore over the project overwrites production: never
  part of an exercise.
- **Scenario 1 rebuilds** (`git checkout <SHA>`, `kamal deploy`) and leaves a
  detached `HEAD` the deploy chain refuses; `kamal rollback <version>`
  switches to a kept container without a build, even with GHCR down.

**Part A, read-only — done (Garrett, 2026-11-23):**
- **The box-only files, by hash:** `.env.kamal` `38bea389…` (24 keys),
  `~/.cron-secret` `15784859…`, `~/cron-jobs/healthchecks.map` `90ccccd7…`.
  Also `run-cron.sh` `d3c094c6…`, `check-registry-token.sh` `a6c2f3dd…`,
  `.kamal/secrets` `b19cdce2…` and `crontab -l` `2b2e7e3a…`, all four in git
  too.
- ⚠ **The laptop's only `.env.kamal` copy was from 2026-05-20, and 12 of the
  24 keys were missing from it or different.** Missing: `AVIS_API_TOKEN`,
  `HEALTHCHECKS_API_KEY`, `HELPSCOUT_APP_ID`, `HELPSCOUT_APP_SECRET`,
  `TURNSTILE_SECRET_KEY`, `TURNSTILE_CLAIMS_SECRET_KEY`,
  `SHOPIFY_WEBHOOK_SECRET_FALLBACK`. Different: `KAMAL_REGISTRY_PASSWORD`,
  `SHOPIFY_WEBHOOK_SECRET`, `TEAMS_WEBHOOK_URL`, `QUOTE_WEBHOOK_SECRET`,
  `ADMIN_BACKWARD_PIN`. A rebuild from it would not have deployed, verified a
  webhook, reached Help Scout, served either form, synced Avis or posted the
  digest. **Refreshed 2026-11-23, 11:20 Arizona** (Garrett): `.env.kamal`,
  `.cron-secret` and `healthchecks.map` in `~/backups/cabinet-orders/`, each
  dated `20261123`, each matching the box's hash; the May copy kept beside
  them. `~/.cron-secret` holds exactly the `CRON_SECRET` in `.env.kamal`
  (checked 2026-11-23), so two files carry everything the box alone holds.
- ⚠ **There is no password manager and no secure note** (Garrett,
  2026-11-23: *"I dont have a secure not or password manager"*).
  `RECOVERY.md`'s "password manager as secure note" (lines 46–47, 134–135,
  231–245) was never true: the laptop is the only copy off the box besides
  Hetzner's seven days. A second copy off the laptop: Garrett's decision,
  open.
- **Hetzner backups are on:** seven, daily at about 14:38 UTC, 41.5–42.8 GB;
  the newest `2026-11-23T14:38:08Z`.
- **Supabase:** daily PHYSICAL backups at about 06:36 UTC, 16–23 November
  listed; Storage objects not included (the page says so). **Point-in-time
  recovery is off** — inferred: the daily backups run, and they stop when it
  is enabled (Supabase's documentation). Recorded only (Garrett).
- **Extensions:** `pg_stat_statements`, `pgcrypto`, `plpgsql`,
  `supabase_vault`, `uuid-ossp` — no `pg_cron` and no `pg_net`, so nothing in
  the database acts on its own and no trigger can make a web request: C's
  condition holds.
- **The rollback window:** six containers — running `75c9c55` (item 12), then
  `5e32f74`, `c1401a1`, `5c8ea73`, `3914bc0`, `4ccd94d` — two weeks back.

**B. The Hetzner restore, to a fenced temporary server** (the server
untouched):
1. A Cloud Firewall: inbound TCP 22 only; outbound one rule, ICMP to
   `192.0.2.1` (a documentation address nothing answers), so every other
   outbound packet drops.
2. The newest backup's "Create new Server": CPX31 (its disk at least the
   backup's), the firewall chosen IN the form. If the form does not offer it,
   stop and create nothing; the fallback is to convert the backup to a
   snapshot and create from the snapshot through Add server.
3. SSH in; the fence shown: healthchecks.io and production's health address
   both fail.
4. The box-only files against part A's hashes; the backup's git `HEAD` and
   its Docker images; each step timed.
5. The server deleted, then the firewall.
6. Nothing got out: healthchecks.io's pings all from `5.78.220.153`;
   production's kamal-proxy log with no request from the copy's address.
Not proven: a rebuild from scratch — the copy cannot reach GitHub or GHCR, by
design.

**C. The Supabase restore, to a new project** (production untouched): the
newest daily backup, the cost it shows read before confirming; timed; row
counts of the main tables against production's — production ahead by
whatever came after the backup; the new project deleted. While it exists, a
second full copy of the customer data.

**E. The docs, after:** `docs/RECOVERY.md` — what was exercised and when, the
timings, what was harder than expected; Scenario 1 leads with `kamal
rollback`; Scenario 2 fences a restored box before it boots; Scenario 3
records point-in-time recovery off and "Restore to a New Project" as the safe
first step; Scenario 4 rewritten to the truth — no password manager, the
laptop's copies, and whatever second copy Garrett chooses. `OPERATIONS` §11
and §12: the restore and point-in-time items closed or updated.

### 6.11 Item 11 — DONE IN PART, 2026-11-23

- **A, the read-only part: done** (§6.10). Its finding that mattered: the
  laptop's six-month-old `.env.kamal` copy, refreshed the same morning with
  `.cron-secret` and `healthchecks.map`, each checked against the box's
  hash; and no password manager. A second copy off the laptop: none for now
  (Garrett: *"Lets do 3 for now, and maybe later we can add a password
  manager"*).
- **B, the Hetzner test restore: not run** (Garrett: *"I don't want to create
  a new server just to test"* — it needs a temporary server at a small hourly
  charge). Found on the way: the Create Firewall form showed the production
  server under Apply to; caught on the form. Applied to production, the fence
  would have closed the site and cut it off from Supabase and Shopify —
  `RECOVERY.md` Scenario 2 now says Apply to must be empty.
- **C, the Supabase test restore: not run**, with B — it too makes a
  temporary paid copy (a project).
- **D: not run**, as agreed.
- **E: done** — `docs/RECOVERY.md`: "checked in part, a restore still never
  run"; where things live (PITR off, the Storage files in no backup — item
  14, the laptop as the only copy off the box); a new section, "Keeping the
  copies off the box current", with the refresh command (tested on a
  stand-in box: three OKs, and a missing file stops it); Scenario 1 leads with
  `kamal rollback`; Scenario 2 warns a restored box is live and gives the
  fenced way; Scenario 3 restores to a new project first, and records PITR
  off; Scenario 4 rewritten without the password manager. `OPERATIONS`: the
  2026-11-23 amendment; §5's GHCR renewal ends by re-copying `.env.kamal` to
  the laptop; §11 and §12 updated.
- **Still open from it:** a tested restore (OPERATIONS §12); a second copy off
  the laptop (a password manager, later perhaps); item 14.

### 6.12 Item 6, bundle 1 — what staff screens show wrong. DESIGN, agreed 2026-11-23

Garrett: *"Everything looks good"*, with one change — the back-on date reads
MM/DD/YYYY (*"I prefer mm/dd/yyyy"*). One deploy, ten files.

**Read whole:** `lib/backorders` (169 lines), `app/calendar/page.tsx` (706),
`app/projects/ProjectsClient.tsx` (694), `lib/attention` (393),
`lib/useOrderEnrichment` (123), `lib/dates` (122). **In part, for their
facts:** the order route's PATCH (lines 110–1157: its refusals and its Shopify
answer), the store's `updateOrderDetails`, `OrderModal`'s claim and strip
(read whole for item 9), the three back-on renderings, both review-label maps
and where `missing_mod_value` is set. **Read whole before building:**
`OrderModal`, `OrderDetails`, the export route, `ProfileView`,
`ProfileSummary`, the team page.

1. **The backorders sort** (`lib/backorders` line 112). "Oldest first" ran
   `Date.parse()` on `orders.date`, a display string with no year ("Nov 18"),
   which V8 reads as 2001: from January, January's orders sort before
   December's, and orders a year apart collide. → Sorted on `created_at`,
   which every row carries and whose Phoenix day is the day `orders.date`
   shows (`lib/dates`, checked 2026-10-19); ties by id. The counts, the
   overdue and undated flags and the SKU ranking unchanged.
2. **The calendar's saves** (`app/calendar/page.tsx`). The delivery save
   closed the editor without reading the answer; the production save closed
   it on a refusal too, and for a Shopify order said "Shopify sync failed"
   when nothing had been saved. A mixed order's dates are per line, so the
   calendar's one pair is refused ("The order's finish must be the latest
   vendor's…", 422); a locked vendor date is refused (409); archived and
   someone else's claimed work before either. And on a save it said "Synced to
   Shopify" without asking — the route answers `shopify_synced` and
   `shopify_error`. → On a refusal the editor stays open with the server's
   sentence under Save, and no Shopify status. On a save it closes: "Synced
   to Shopify" only on `shopify_synced: true`, "Saved — Shopify sync failed"
   on `false`, nothing more when no Shopify write happened. What is sent is
   unchanged (the scheduled delivery date alone); Realtime still updates the
   page.
3. **The strip's claim** (`OrderModal`, `GroupStrip`). It read `g.claimed_by`,
   null on every Shopify group since 2026-08-25, so every group of a claimed
   purchase read "unclaimed"; the strip shows only for two or more groups, so
   always a purchase. → It takes `resolvedClaimedBy`, the owner the modal
   resolves through the purchase — the header's answer — on every group, as
   the projects page does.
4. **The projects page's attention** (`ProjectsClient` lines 132 and 607). Its
   own list, `attentionFor(g)` with no enrichment and no purchase-level
   "Unclaimed", so its count, filter and lead missed the acknowledgment and
   receipt reasons and unclaimed purchases that the work queue and dashboard
   show. → `attentionForProject(project, groups, now, enrich)` with
   `useOrderEnrichment`, the queue's and the dashboard's own call; each
   expanded group's line `attentionFor(g, enrich(g))`. The count may rise on
   deploy, to the dashboard's; the two joined reasons arrive a moment after
   the page draws, as on the queue.
5. **The back-on date** (the team page, `ProfileView`, `ProfileSummary`).
   `new Date("2026-11-30")` is UTC midnight, 5 p.m. the 29th in Arizona: "Back
   Nov 29". → `lib/dates`' `formatMDY`, built from the date's own parts:
   "Back 11/30/2026", all three (Garrett: MM/DD/YYYY).
6. **`missing_mod_value`** read "Review" on screen and "review" on the vendor
   PDF: both copies of the labels lacked it. → One map in a new pure module,
   `lib/reviewReasons.ts`, typed so every `ReviewReason` must have a label (a
   new reason without one fails the typecheck); `OrderDetails` and the export
   route import it; unknown old values keep the fallback. Label "Missing
   modification value"; help "A modification on this line is missing its
   depth value. Confirm it with the customer before the order is placed."

**The proof, the deployed code as the control, each in both trees:** the sort
across December and January; the real calendar page — a refusal, a save
synced, a save whose Shopify write failed, a save with nothing to sync; the
real modal on a claimed two-group purchase; the real projects page against
`attentionForProject` for the same data; the three back-on renderings at
Arizona's clock; both labels for `missing_mod_value`. The typecheck with a
planted error in each changed file; the patch on box-shaped trees.

### 6.13 Item 6, bundle 1 — AS BUILT, deployed, LIVE

- **Before the build** (Garrett, 2026-11-23): the box's pins for the 15 files
  the bundle touches or reads, and no `lib/reviewReasons.ts` — PINS MATCH at
  `1a495a7`.
- **Built as designed** (§6.12), ten files —
  `patch_item6_bundle1_staff_screens_2026-11-23.py`, sha256 `37bb8b0b…`:
  1. `lib/backorders`: oldest first by `created_at`; a row without one last,
     ties by id.
  2. `app/calendar/page.tsx`: both saves read the route's answer
     (`readSave`). A refusal keeps the editor open with "Not saved: " and the
     server's sentence under Save — `message`, else `error`, else "HTTP n" —
     and takes the production card's Shopify line away; a request with no
     answer says "Could not reach the server. Check the dates and try again."
     A save closes the editor, and the production card reads "Synced to
     Shopify" only on `shopify_synced: true`, "Saved — Shopify sync failed" on
     `false`, and "Shopify order", as before any save, when no Shopify write
     happened. Cancel and reopening clear the sentence. What is sent:
     unchanged.
  3. `OrderModal`'s `GroupStrip` takes `claimedBy` (`resolvedClaimedBy`): the
     purchase's owner on every card. One addition, said with the patch: a
     holder no longer on the team list reads "claimed", as the header's chip
     says "Claimed" — the strip read "unclaimed".
  4. `ProjectsClient`: `useOrderEnrichment(allOrders)`; each row's reasons
     `attentionForProject(p, groups, Date.now(), enrich)`; each group's line
     `attentionFor(g, enrich(g))`.
  5. The team page, `ProfileView`, `ProfileSummary`: "Back" and `formatMDY`.
  6. `lib/reviewReasons` (new): `REVIEW_REASONS`, a `Record<ReviewReason,
     { label, help }>` with `missing_mod_value`, and `reviewReasonWords`
     (undefined for a value it does not know). `OrderDetails` and the export
     route read it and keep "Review" / "review" for an unknown value.
- **Proven, 165 checks, ALL PASS** — the box (`1a495a7`) the control:
  - the sort: the control put January before December, and its order
    depended on the input's; the new code oldest first by `created_at` either
    way, ties by id; the rollup's numbers and the summary identical;
  - the REAL calendar page, all four editors (the day's production and
    delivery cards, "Set dates →", "Schedule →"), the route's answer stood in.
    A 422 and a 409 with their sentences, a bare code, a body that is not
    JSON, no answer: the new editor stays open on each with its sentence; the
    control closed (with no answer, stayed open, silent) and on the
    production card read "Shopify sync failed". Synced, the Shopify write
    failed, no Shopify write: the new card reads "Synced to Shopify", "Saved —
    Shopify sync failed", "Shopify order"; the control read "Synced to
    Shopify" for all three. What each sends: identical;
  - the REAL modal on a two-group purchase: the owner (a colleague; the
    viewer) on both cards, with the avatar; "unclaimed" when nobody holds it;
    "claimed" for a holder not on the list. The control: "unclaimed" on every
    card. The header's chip unchanged;
  - the REAL projects page beside `attentionForProject` on the same rows and
    enrichment: identical once the enrichment answered (a missing
    acknowledgment, an unclaimed purchase, a missing receipt — 3 needing
    attention); as first drawn, the row-only reasons alone; the control 0. One
    enrichment request;
  - "Back …" for 2026-11-30 in all four renderings (the team page,
    `ProfileView`, `ProfileSummary` card and full), under Phoenix, UTC and
    Tokyo: "Back 11/30/2026" in each; in Phoenix the control read "Back Nov
    29" and "Back November 29";
  - `missing_mod_value`: the REAL `OrderDetails` names it, with its help and
    in the summary strip; the REAL export route's GET, on the sandbox's
    PostgreSQL, names it on the line and in the banner; an unknown value keeps
    "Review" / "review"; the whole PDF, the new label read back as "review",
    byte-identical to the control's.
- **Typecheck:** `next typegen`, then `tsc`: both trees' error sets identical
  (the sandbox's one `xlsx`, §3); a planted error caught in each of the ten
  files; with `missing_mod_value`'s words removed, `tsc` refuses
  `REVIEW_REASONS` (TS2741).
- **The patch:** `--check` writes nothing; it applies byte-identical to the
  tested tree, re-runs ALREADY APPLIED; a broken anchor and another base each
  MISS with nothing written; no sandbox path.
- **Deployed** (Garrett, 2026-11-23): `bb297fc`, through the chain — the
  pins, `next typegen`, `tsc`, ten files staged — then the cron diffs (CRON
  MATCHES) and `kamal deploy`. Checked after: tree clean, the ten files at
  their pins, LIVE IMAGE IS `bb297fc`.
- **LIVE** (Garrett, 2026-11-23): the projects page, SHO-1079 its one
  purchase — "3 needs attention", led by "HCI Cabinetry: acknowled…": the
  purchase's Unclaimed, the line's acknowledgment and Past SLA, which is
  `attentionForProject`'s answer for it; the code before asked for neither
  the acknowledgment nor the purchase's Unclaimed. Its group's line: "HCI
  Cabinetry: acknowledgment re…". The other five have nothing live to show
  them yet — no purchase with two groups (the strip), no backordered line, no
  member out of office, no `missing_mod_value` line — and the calendar's saves
  were not exercised live; each as proven above.
- **The harness:** `harness-2026-11-23.tar.gz` (sha256 `34ab4e13…`) carries
  items 10, 12 and this bundle's files (§0).

### 6.14 Item 6, bundle 2 — the quiet admin and ops failures. DESIGN, agreed 2026-11-23

Garrett: *"1) Agreed 2) Agreed 3) Yes 4) I agree, In 5) We can work on these
later"*. One deploy: four app files, and `run-cron.sh` installed on the box by
the chain.

**Read whole:** `app/admin/shopify/page.tsx` (278 lines),
`app/api/shopify/sync/route.ts` (87), `app/admin/page.tsx` (346),
`app/api/admin/revenue/route.ts` (123), `scripts/cron/run-cron.sh` (161),
`scripts/cron/check-registry-token.sh` (123), `scripts/cron/crontab` (65); the
calendar page as bundle 1 left it. **In part, for their facts:**
`lib/shopifyCatalogue`'s `runCatalogueSync` and its answers (lines 290–341);
the order webhook's money (lines 426–458, 824–872); OPERATIONS §6.

1. **The admin Shopify page** (`app/admin/shopify/page.tsx`). "Sync SKUs"
   acted only on `data.ok` (line 55), under an empty `catch` (59): a refused or
   failed sync — the 15 s read that turned the check red on 11-17 among them —
   stopped the spinner and said nothing. A failed load (`if (data.data)`, line
   39; an empty `catch`, 45) showed "No products synced yet — Click Sync SKUs
   to pull products from Shopify": false, and an invitation to sync. The
   vendor list (line 180) ran the previous render's fetch, which holds the
   vendor chosen before: each pick listed the one before it. → A refusal reads
   "Sync failed: " and the server's reason ("HTTP n" when it gives none), and
   the list reloads — a sync can fail after writing part, and the "Synced"
   time should say what is stored. No answer reads "No answer from the server
   — the sync may still have run. Reload in a minute to see its time." A
   failed load reads "Could not load the catalogue: " and its reason, with Try
   again, in place of the stats and the list. The vendor list fetches the
   vendor chosen.
2. **The admin home's warning** (`app/admin/page.tsx` line 93). "backfill via
   Shopify sync" names a tool that never wrote a total: the sync is the
   product catalogue, and a purchase's total is written by the order webhook
   on every create and update. → "⚠ N order(s) with no total recorded —
   counted as $0 here. Shopify's next update of the order writes it." The
   count read 0 when its query failed (`app/api/admin/revenue/route.ts` line
   121), hiding the warning exactly when it cannot know → the failure fails
   the route, and the panel says "Could not load revenue".
3. **`cron.log`'s ping ids** (`run-cron.sh` line 157). A ping that could not be
   sent was logged as its target with the last part cut — `/fail`, from a
   failure ping, leaving the check's id. → The line names the kind, never the
   address: `ping_failed http=… ping=success|fail` (the endpoint already names
   the check). The chain installs the script into `~/cron-jobs` by a copy and a
   rename, hash-checked — a run starting meanwhile reads the old file or the
   new, never half — and the cron diff then reads CRON MATCHES. The ids
   already logged (33 lines, 2026-11-05) are overwritten in place, each
   `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`: the same bytes, the same length, so
   a line a job appends meanwhile cannot be lost and the line count holds; the
   chain prints counts, never an id. The four checks are not replaced: the ids
   left the box only in the logs uploaded to these sessions (11-06, 11-17),
   private, in a sandbox since reset.
4. **The calendar's delivery save** (found building bundle 1, §4 item 6). It
   writes to Shopify on every save of a group carrying the order's id, and
   showed nothing of the answer. → It reads `shopify_synced` as the production
   save does, and the delivery card gets the production card's line — "Synced
   to Shopify", "Saved — Shopify sync failed", nothing more when no Shopify
   write happened: one status per order, the last save's answer, on both
   cards.

**Recorded, for later:** §4 item 6, "Found 2026-11-23, designing bundle 2".

**The proof, the deployed code as the control, each in both trees:** the real
admin Shopify page — a sync answered, refused, not JSON, unanswered; a load
answered, refused, unanswered; two vendor picks in a row; the real revenue
panel's warning, and the real revenue route on the sandbox's PostgreSQL with
the count's query failing; `run-cron.sh` in a stand-in home, a stand-in curl
failing the job and its ping; the overwrite on a copy of a log with made-up
ids while lines are appended; the real calendar's delivery card — synced,
failed, no write. The typecheck with a planted error in each changed file; the
patch on box-shaped trees.
