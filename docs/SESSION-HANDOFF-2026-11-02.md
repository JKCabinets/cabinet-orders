# SESSION HANDOFF — 2026-11-02

**Read this whole, then `docs/SESSION-HANDOFF-2026-10-29.md` §2 (the method)
and §4 (feature 9, with §4.9 the record of phase 1 as built).** This file
supersedes the 10-29 handoff for what to do next; that one stays the record of
feature 9's design.

## 1. Where things stand

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`) — DEPLOYED, verified
2026-11-02 (the image tag is the commit):

- `HEAD~1` = `82143fb` *"The date editors labelled and lined up; a mixed
  group's vendor dates all or none"*; `HEAD` is the docs commit that added
  this file. **The next chain checks: `HEAD~1` = `82143fb`, tree clean.**
- Since `0fcc615` (the 10-29 docs review), oldest first: `4bc1dd4`,
  `c513ddd`, `3fde2c3` (feature 9 phase 1, parts 1–3), `2105aa0` (its docs),
  `82143fb` (the labels fix, below), and this file's commit.

**Feature 9 phase 1 is LIVE** (deployed 2026-11-02 at `2105aa0`):
- The migration ran 2026-10-29; the start day was moved to **2026-11-02** at
  the deploy, so nothing earlier is ever marked.
- `run-cron.sh` and the crontab installed from `scripts/cron/` and diffed
  clean ("CRON MATCHES THE REPO"); the map line
  `/api/cron/cabinet-fulfilment` is in `~/cron-jobs/healthchecks.map`.
- The app's Admin API scopes: `read_` and `write_merchant_managed_fulfillment_orders`
  — **can fulfil: YES**.
- Run by hand 2026-11-02 20:01Z and 20:29Z: `rc=0`, nothing due (no order at
  In production or At cross dock with a ship date of today).
- ⚠ **NOT YET CONFIRMED BY GARRETT:** the healthchecks.io check
  `cabinet-fulfilment` created and green; Shopify → Settings → Notifications
  → Shipping confirmation ON.
- ⚠ **THE LIVE TEST IS STILL OWED.** #1067 had no dates, and is now back at
  New (the run skips New, recording it once). It needs a cabinet order at In
  production or At cross dock with a ship date of today, then
  `~/cron-jobs/run-cron.sh /api/cron/cabinet-fulfilment`: only that vendor's
  lines fulfilled in Shopify, no tracking, the shipping email received, the
  activity line, and "Marked shipped in Shopify on …" with its date locked.

**`82143fb` — the date editors labelled** (Garrett's two reports on the
deployed phase 1): the Production & Delivery card's editor is one labelled row
per box in the same columns as the facts above it; the band's production and
delivery editors show a label beside every box; Save says in words why it
cannot be used; a mixed group's vendor dates are all or none, so a group with
none saves its other fields (#1067 could not save a delivery target), and
clearing a per-vendor group sends both dates as nothing (the server refuses the
group date cleared alone). Proven in jsdom against the deployed code and on the
real route.

⚠ **The GHCR token expires 2026-11-16** (item 66): the weekly check alarms
from 2026-11-09; a deploy after the 16th needs it renewed first.

## 2. Method — what this session added

The method is the 10-29 handoff's §2 and the 09-15 handoff's. Added:

- **The harness is saved**: `phase1-harness.tar.gz` (outputs). Extract to
  `/home/claude`; `apt-get install -y postgresql-16`; `hx/pgup.sh` → `/tmp/pgup.sh`
  (start the cluster: `initdb -D /tmp/pg/data -U postgres --auth=trust` as the
  postgres user, port 5433, socket /tmp); `npm install --legacy-peer-deps` the
  lockfile's pins plus esbuild, pg, jsdom (`xlsx` is not reachable from the
  sandbox — only the acknowledgment route needs it). It holds production's
  base schema (`prod_base.sql`, transcribed from a read-only probe of
  production — see `schema_probe.sql`), the Supabase stand-in, the builder
  (`build.mjs`: `HX_ALIAS`, `HX_EXPOSE` for a test-only export), every proof,
  and the patch generators (`make_patch*.py`).
- **Every chain says which machine it runs on, and includes the copy step.**
  A chain once ran on Garrett's PC because the scp step was left out.
- **A patch whose files a previous part did not touch cannot tell the two
  bases apart by its pins**: it checks the previous part's files too
  (`REQUIRES`).
- **`sh`, not `bash`, runs the tool's commands**: `${PIPESTATUS}` and `<( )`
  need `bash -c` (cost three times).
- **React decides at module load whether there is a DOM**: jsdom must be set
  up in a module imported FIRST, or change events never reach React.
- **V8's `Date.parse("2026-02-30T00:00:00Z")` is not NaN**: validate a
  calendar date by round trip (`lib/lineFields`' `isIsoDate`).
- **The sandbox ends background processes when a command finishes**: a test
  server and its test run in one script.
- **A docs anchor copied from a re-flowed view misses on indentation**: take
  anchors from `repr()` of the raw lines.

## 3. Feature 10 — cabinet lines: one order, a section per line

### 3.1 Why

Two faults Garrett met on the deployed OMS (2026-11-02):
- **Mixed cabinet orders get stuck.** Waypoint passes New → Entered when its
  acknowledgment is uploaded and checked, but there is no way to upload an HCI
  or J&K acknowledgment and no check for them: the band's single "Upload
  acknowledgment" goes to Waypoint's checker only (`POST
  /api/orders/[id]/acknowledgment` has `VENDOR = "Waypoint Cabinetry"` fixed),
  and the requirement reads "HCI and J&K: attach theirs, or any file".
- **The three cabinet lines deliver separately** (Waypoint, HCI, J&K), but a
  cabinet order has one start date, one delivery target and one proof of
  delivery.

### 3.2 Garrett's rulings (2026-11-02)

- **The shape:** "a combination of both" (considered and rejected: separate
  groups per vendor — "more mess and confusion"). Each cabinet order stays ONE
  group on one page (`SHO-1067-CAB`, as now). Inside it, each cabinet LINE —
  vendor — gets its own section, its own gates and its own buttons. The Next
  Action band works as now, with one gate per line before the stage can move.
  Garrett's example, at New with a J&K and a Waypoint line:
  - Waypoint Ack (Upload Ack) — ✓ when passed, ✗ when failed
  - J&K Ack (Upload Ack) — ✓ when passed, ✗ when failed
  - (Move to Entered)
1. **The order's stage is where its SLOWEST line is.** It moves when every
   line meets the stage's requirement; a line may get ahead, and its section
   shows it.
2. **Per line:** the acknowledgment; the production start and ship-from-
   factory dates; the delivery target; the signed proof of delivery. The order
   reaches Delivered when every line has its proof.
3. **HCI and J&K acknowledgments need NO check:** uploading their
   acknowledgment, PDF or Excel, is all that is required. ("The pdf ack from
   the OMS will be given and that's the actual order … an ack back from the
   manufacturer just as confirmation it's ordered.") Waypoint keeps its
   automatic check, as now.
4. **Names:** staff screens use the Shopify vendor names (Waypoint Cabinetry,
   HCI Cabinetry, J&K Cabinetry); customers see **Select Cabinetry** for
   Waypoint, the others as they are.

### 3.3 Also part of it — Garrett's Production & Delivery layout (2026-11-02)

The card reads as a table: a row per cabinet line on the order (only the
lines it has), a **Production** column (start → finish) and a **Delivery**
column. Modify groups the boxes under two headings: **Production dates**, a
row per line, then **Delivery dates**, a row per line. (Shipping method under
Delivery — to confirm.) This needs per-line start and delivery dates, which is
ruling 2.

### 3.4 What exists to build on

- `orders.vendor_ship_dates` (phase 1): a mixed group's ship date per vendor;
  `production_est_finish_date` held to the LATEST — which is already "the
  slowest line" for production-complete's move to At cross dock.
- `lib/shipDates` (`cabinetVendorsOf`, `vendorShipDate`, `lineVendor`): the
  vendors of a group and the line → vendor rule, shared by the run and the
  screens.
- `order_acknowledgments` has a `vendor` column; `lib/ackFingerprint`'s
  `linesForAckVendor` returns null for HCI and J&K ("no basis to check").
- Files are in file groups (`lib/fileGroups`); an acknowledgment is kept as a
  file of kind `acknowledgment` in the "Acknowledgments" group.
- The run, the "Still on schedule?" check and the locks are per vendor already.

### 3.5 To settle in the design, with Garrett, before code

- Storage for the per-line facts: a jsonb per fact on `orders`, like
  `vendor_ship_dates` (start, delivery target), or one per-line jsonb; proof of
  delivery as an attachment carrying its vendor (`order_attachments` has no
  vendor column today). A NEW migration — the 10-29 one is frozen.
- The requirement table per line: `lib/requirements` produces one row per
  line for a cabinet group, the server gate evaluates each, the band renders
  each with its own button.
- The SLA and the attention list: per line, or the order's (slowest line)?
- What a line ahead of the others shows (its own stage marks?).
- A single-vendor cabinet order: one section — the same as today in effect.
- Phase 2's "Delivered" email (designed, not built): per line or per order.

### 3.6 Read whole before designing (none read whole since 10-29 unless noted)

`lib/requirements.ts`; the Entered gate and the delivery-proof gate in
`app/api/orders/[id]/route.ts`; `app/api/orders/[id]/acknowledgment/route.ts`;
`lib/acknowledgments.ts`; `lib/ackFingerprint.ts`; `lib/fileGroups.ts`;
`lib/orderFiles.ts`; `app/api/orders/enrichment/route.ts`;
`lib/useOrderEnrichment.ts`; `components/NextActionPanel.tsx`;
`components/OrderModal.tsx` (the band's remedies wiring, the upload buttons,
`StageInputsCard`); `lib/attention.ts`; `lib/sla.ts`; `lib/shipDates.ts`;
`lib/shipDateEdits.ts`; `lib/stageLogic.ts`. And production's schema for
`order_acknowledgments` and `order_attachments` — run a read-only probe
(`hx/schema_probe.sql` is the pattern).

## 4. Open beyond feature 10

- Phase 1's live test; the healthchecks check and Shopify's shipping
  confirmation (§1).
- The GHCR token, 2026-11-16 (item 66).
- UTC "today" in `lib/backorders` (×2), `getBackorderStatus`, the backorders
  page and the line editor — a line due today reads overdue after 5 p.m.
  Arizona (Garrett's call).
- Item 64 (Garrett's call).
- REST `2024-01`, retired, in `lib/shopifyStageSync` and the order route's
  `syncToShopify`.
- webhook-health's `graphql()` does not refuse a 200 carrying `errors` —
  verify in the route.
- production-complete's activity insert unchecked; the line editor's backorder
  control offered on archived and someone-else's groups; the export route's
  comment on `SkuItem` stale.
- `PHASE1-NOTES-2026-10-29.md` (outputs only, never committed) is superseded
  by the 10-29 handoff §4.9 and can be deleted.
