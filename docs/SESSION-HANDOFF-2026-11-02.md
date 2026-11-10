# SESSION HANDOFF — 2026-11-02

⚠ **NOT THE START POINT SINCE 2026-11-03 — start at
`docs/SESSION-HANDOFF-2026-11-03.md`.** This file stays the record of phase 1's
live test (§1) and of feature 10 — Garrett's rulings (§3.2), the design
agreed (§3.7) and feature 10 as built (§3.8). Its §4 is carried, current, in
the 11-03 handoff's §4.

**Read this whole, then `docs/SESSION-HANDOFF-2026-10-29.md` §2 (the method)
and §4 (feature 9, with §4.9 the record of phase 1 as built).** This file
supersedes the 10-29 handoff for what to do next; that one stays the record of
feature 9's design.

## 1. Where things stand

⚠ **FEATURE 10 IS BUILT AND DEPLOYED (2026-11-03) — §3.8.** After this docs
commit, `HEAD~1` is part 5, *"Feature 10, part 5: the work queue names the
cabinet line holding an order"*. **The next chain checks: `HEAD~1`'s subject
is that, tree clean** (`git log --oneline 16c9dbd..HEAD` lists feature 10's
commits). The paragraph below is the state before feature 10.

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
- ✓ **CONFIRMED BY GARRETT 2026-11-02:** the healthchecks.io check
  `cabinet-fulfilment` is green (on healthchecks.io and the OMS's dashboard);
  Shopify's shipping confirmation is ON (its email arrived — below).
- ✓ **THE LIVE TEST PASSED, 2026-11-02 (Garrett).** #1067 (mixed, In
  production): J&K's ship date set to 11/02, Waypoint's to 11/10, "On
  schedule" answered; the run by hand at 21:53 UTC fulfilled **J&K's lines
  only** (#1067-F1, `gid://shopify/Fulfillment/7758954037548`, no tracking;
  Shopify: Partially fulfilled, the Waypoint W930 unfulfilled; its Production
  Start Date 2026-10-30, Est. Production Finish 2026-11-10 — the latest line).
  A second run sent nothing. Shopify's shipping confirmation arrived listing
  only the J&K item. The webhook logged `fulfilment_by_oms` (21:53:25 UTC).
  An admin backward move was refused with the locked-date sentence. The card
  reads "Marked shipped in Shopify on 11/02/2026", its date box gone.
  `SHO-1070-CAB` was skipped `before_start` (expected; said once).

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
below 14 days left — so from its 2026-11-02 run (corrected 2026-11-03 from the
script: `WARN_DAYS=14`, `-lt`; this said 11-09); a deploy after the 16th needs
it renewed first.

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

### 3.5 To settle in the design, with Garrett, before code (⚠ SETTLED: §3.7)

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
  ⚠ RULED 2026-11-10 (Garrett): per line, and "Delivery date changed" too —
  `SESSION-HANDOFF-2026-10-29.md` §4.4.

### 3.7 The design, agreed with Garrett 2026-11-02 ("All of that sounds good, I agree")

**What was read whole for it (2026-11-02):** `lib/requirements.ts` (448),
`lib/acknowledgments.ts` (222). **Why mixed orders stick:** the New
requirement is ONE entry, "the manufacturer's acknowledgment", judged by
`ackRequirementMet` (`lib/acknowledgments` l.150): Waypoint needs a green,
current acknowledgment; HCI and J&K need a green one OR "any file" (kinds
other than `acknowledgment`). No HCI or J&K acknowledgment can be green — the
upload route makes only Waypoint's — so for them only a stray file in the
Files tab passes, and the band asks for nothing of the kind. Uploading J&K's
real acknowledgment is refused (a PDF) or read as a Waypoint sheet (red).

**Production's schema** (read-only probe, 2026-11-02, PostgreSQL 17.6):
`order_acknowledgments` — `vendor` NOT NULL, `verdict` CHECK green|red,
`parsed_json`/`result_json` NOT NULL, `lines_fingerprint` and `attachment_id`
nullable; RLS on, NO policy (server only); not in the realtime publication.
`order_attachments` — `kind` CHECK general|proof_of_delivery|customer_upload|
acknowledgment, `group_id` NOT NULL, NO vendor column; authenticated read;
published. `order_file_groups` — ONE group per order per role
(customer_uploads, proof_of_delivery, acknowledgments; a unique index).

**The decisions:**
- **A. Acknowledgments, one per line.** The band shows a row and a button per
  line: "Waypoint Cabinetry: acknowledgment" (Upload acknowledgment) — as now,
  a spreadsheet, checked, ✓ or ✗ with its reasons; "J&K Cabinetry:
  acknowledgment" (Upload acknowledgment) — a PDF or Excel file, ✓ ON UPLOAD,
  no check (ruling 3). **The "any file" stand-in is RETIRED:** a line is met
  only by its own acknowledgment. (Storage: an HCI/J&K upload is an
  `order_acknowledgments` row, `verdict` green, marked RECEIVED rather than
  checked in `result_json`, no fingerprint; its file kind `acknowledgment` in
  the order's Acknowledgments group.)
- **B. Shopify's single dates:** Production Start Date = the EARLIEST line's
  start; Est. Production Finish = the LATEST line's ship date (phase 1 already
  holds the group's finish to the latest).
- **C. The gates, every line at every stage:** New → Entered, every line's
  acknowledgment; Entered → In production, every line's production start
  date; In production → At cross dock, the existing move on the last line's
  ship date; At cross dock → Delivered, every line's signed proof of delivery.
  A single-vendor order shows one line — today's screen in effect.
- **D. The SLA and the work queue:** per ORDER, timed by the slowest line; the
  reason NAMES the line ("J&K Cabinetry: acknowledgment required").
- **E. ONE rule for a line's vendor.** Today two: the acknowledgment gate
  resolves vendors with the SKU resolver (`lookupVendorsForSkus`,
  `lib/acknowledgments` l.201); phase 1 uses the line's own Shopify vendor,
  else the group's (`lib/shipDates`' `lineVendor`). One rule: the line's own
  Shopify vendor (stored since 2026-08-24), falling back to the resolver only
  for lines older than that.
- **Garrett's Production & Delivery layout** (§3.3) is part of it.

**Storage (to build):** a NEW migration — per-line production start and
delivery target on `orders`, in the shape of `vendor_ship_dates` (a mixed
group only; the database holding the group's start to the earliest and its
delivery target to the latest); a `vendor` column on `order_attachments`, so a
proof of delivery (and an acknowledgment's file) names its line. Files stay in
the order's one group per role, each tagged with its line.

**The build, in parts, each proven and committed (as phase 1):** the
migration; the one vendor rule; acknowledgments per line (the upload route
taking the line, HCI/J&K received, the requirement and the enrichment per
line, the band's rows and buttons); per-line dates and proof (the order route,
the gates, the receipt upload per line, the card's layout); the SLA and the
attention reasons naming the line; the docs.

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

### 3.8 Feature 10 as built (2026-11-02 → 11-03) — deployed, tested live by Garrett

**The commits, oldest first** (since `16c9dbd`; hashes where seen — the chain
prints the rest):
1. `39b4c5d` part 1 — migration `2026-11-02-cabinet-lines.sql` (sha256
   `ba635609…`; RAN IN PRODUCTION 2026-11-02, its check row as expected):
   `orders.vendor_start_dates`, `orders.vendor_delivery_targets`,
   `order_attachments.vendor`; `vendor_dates_problem` (earliest / latest).
2. `c5f3a04` part 2 — one rule for a line's vendor (`lib/vendorLookup` layer 0).
3. `bb9cdd3` part 3a — acknowledgments per line, the server (HCI/J&K received;
   the "any file" stand-in retired; the gate names the lines).
4. `9ba8619` part 3b — a row and an Upload acknowledgment per line; the
   acknowledgment panel for every line. DEPLOYED with 1–3a.
5. `0be09b3` — the acknowledgment picker always mounted (Garrett: "nothing
   happens when it's pressed" — an UNCLAIMED order at New had no picker); Move
   to Entered level with the last upload. DEPLOYED; Garrett: "Tested and
   working" (#1071, all three lines ✓).
6. *"Feature 10, part 4a: per-line start dates and delivery targets; every line
   its own proof of delivery (server)"* — one rule for the three per-line dates
   (`lib/shipDateEdits`), `lib/deliveryProof`, the receipt upload's line.
   Committed only, deployed with 4b.
7. `620dbba` part 4b — `CabinetLinesCard` (Garrett's layout); a receipt per
   line. DEPLOYED.
8. *"Per-line production and delivery editors on the band; side-by-side dates;
   per-line starts move the order on"* — from Garrett's check of 7; ⚠ FOUND
   PROVING IT: per-line starts at Entered did not move the order to In
   production (live in `620dbba` through the card). DEPLOYED.
9. *"Each cabinet line's dates in Shopify's additional details"* — "<line>
   Production", "<line> Delivery Target", Waypoint as "Select (Waypoint)
   Cabinetry" (Garrett). DEPLOYED; "Tested and working".
10. *"Feature 10, part 5: the work queue names the cabinet line holding an
   order"*. DEPLOYED; "Deployed and working" (the dashboard names the line).
11. This docs commit.

**Proven before each shipped** (the sandbox harness, the deployed code as the
control each time), among them: the vendor rule's 8 cases (the control fails
the 3 where a stale cache wins); the acknowledgment route end to end — a J&K
PDF received, refusals writing nothing, a stray photo no longer letting an
order to Entered (the control let it); the screens in jsdom; phase 1's 15
order-route cases IDENTICAL after `lib/shipDateEdits` was generalised; the
per-line Delivered gate (the control let a mixed order through on one line's
receipt); Shopify's entries merged, removed when cleared, absent on a
single-vendor order.

**The harness grew** (`phase1-harness.tar.gz`): `prod_base_files.sql` and
`prod_base_acks.sql` (transcribed from the 11-02 probe —
`feature10-schema-probe.sql`); ⚠ a database function stood in must be its
LATEST definition (`file_group_for_role` is redefined in
`2026-10-28-acknowledgment-files.sql`; the 10-27 one refused
"acknowledgments"); stubs for `xlsx` (the sandbox cannot fetch it — Waypoint's
parsing is not exercised there) and `./Toast`; `build.mjs`'s `HX_ALIAS` and
`HX_EXPOSE` (a test-only export, the source untouched). ⚠ A test's OWN inserts
must check their errors (a missing table read as "no acknowledgments"); an
"unchanged rows" proof must snapshot BEFORE the run (one compared the after
with itself) and see a planted change.

## 4. Open beyond feature 10

- ⚠ **`f10-lines-without-vendor.sql` NOT YET RUN** (read-only): how many lines
  in production have no vendor of their own — the only lines where the vendor
  rule falls back. If any, fill them from the product cache.
- Optional tidy: a one-line-waiting reason repeats the line's name in its
  detail ("Waypoint Cabinetry: acknowledgment required" / "Waypoint Cabinetry:
  no acknowledgment yet").
- ~~Phase 1's live test; the healthchecks check and Shopify's shipping
  confirmation (§1).~~ Done 2026-11-02 (§1).
- The GHCR token, 2026-11-16 (item 66) — ⚠ STILL OPEN; the weekly check alarms
  below 14 days left (from its 11-02 run), and no deploy works after the 16th
  until it is renewed.
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
