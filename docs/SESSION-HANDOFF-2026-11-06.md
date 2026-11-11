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

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`): `HEAD` is *"Docs:
items 8 and 9, designed (2026-11-10)"*, `HEAD~1` *"Docs: open items 1 to 4
(2026-11-10)"*, `HEAD~2` *"Docs: the website team's answers (2026-11-09)"*,
`HEAD~3` the session record, `HEAD~4` `5c8ea73`, item 5 part 4 (deployed).
**The next chain checks: `HEAD`'s subject is that one, tree clean.** ⚠ **The running image is
`5c8ea73`**; against
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
`apiVersion`. The first order on those payloads, #1078 (2026-11-09, 21:28
UTC), was taken in cleanly: its project and its cabinet group.

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
   exercised). Item 7 was done with item 5 part 4. ⚠ **8 and 9 DESIGNED
   2026-11-10 (§6), to build together** — one commit each, one deploy.
6. **Found this session, left for their own look:** the admin home's warning
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
     ship — so their offered joint test on #1078 is optional.
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
`SESSION-HANDOFF-2026-11-03.md` §6.3, and the 2026-11-10 session's in §6
below. One fact, one home.

## 6. 2026-11-10 — this session's designs and results

Items 1 to 4 of §4: done and recorded there (`8ffab24`). Items 8 and 9 of the
11-03 list (§4 item 5): designed below, each agreed by Garrett and committed
before any code; built together, one commit each, one deploy, item 9's patch
pinned on item 8's (both touch `production-complete` and `OrderDetails`).

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
