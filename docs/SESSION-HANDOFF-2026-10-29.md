# SESSION HANDOFF — 2026-10-29

Covers 2026-10-22 → 2026-10-29: item 8 (mockup parity) finished, file groups,
acknowledgment files and rules, items 52–63, and **feature 9 (customer
notifications) designed in full, with phase 1 ready to build**. ⚠ **NOT THE
START POINT SINCE 2026-11-02 — start at `docs/SESSION-HANDOFF-2026-11-03.md`.**
This file stays the record of feature 9's design and of phase 1 as built
(§4.9); its method (§2) still holds.

⚠ **THE OPEN LIST STAYS IN `docs/SESSION-HANDOFF-2026-10-13.md` §6.** One home,
or a correction lands on one copy and misses the other. That file is also the
item-by-item record of everything below (items 8 and 52–67), each with how
it was proved. This file is the summary and the plan.

**Read in this order before touching anything:**

1. This file, end to end. §4 is the whole of feature 9; build from it, not
   from memory of the conversation.
2. `docs/SESSION-HANDOFF-2026-10-13.md` — §2 the method, §3 the lessons, §6
   the open list.
3. `docs/OMS-STATE-2026-08-26.md` and `docs/OPERATIONS-2026-08-26.md` (§2 the
   customer promises, §8 third-party settings).
4. `docs/SESSION-HANDOFF-2026-09-15.md` — the full method.

Then read whole every file you are about to change (§2.1).

---

## 1. Where things stand

**The box** (`5.78.220.153`, `~/cabinet-orders`, branch `main`) is at:

- `HEAD` subject: *"Shopify order updates no longer erase backorder marks;
  every read and write on that path is checked"*
- `HEAD~17` = `4f20fc1e5186363215ad9d2bc332c3022fc62c22` (the Attach a file
  card). Every deploy chain since has checked this pair.
- ⚠ **Then two docs-only commits land on top** — #18, this file, and #19, the
  review of every living doc (below). After them, `HEAD`'s subject is *"Docs:
  the living docs brought up to date (2026-10-29 review)"* and **`HEAD~19`** =
  `4f20fc1e…`. The next deploy chain checks that pair.
- ⚠ **THEN FEATURE 9 PHASE 1, COMMITTED 2026-11-02, NOT YET DEPLOYED**
  (§4.9): `4bc1dd4`, `c513ddd`, `3fde2c3`, and the docs commit that brought
  this file up to date. After it, `HEAD`'s subject is *"Docs: feature 9
  phase 1 as built (2026-11-02)"* and **`HEAD~4`** = `0fcc615` (the 10-29 docs
  review). The phase 1 deploy chain checks that pair.
- ⚠ **DEPLOYED 2026-11-02** at `2105aa0`, then `82143fb` (the date editors
  labelled). The box's state now, and what comes next (feature 10, cabinet
  lines): **`docs/SESSION-HANDOFF-2026-11-02.md`**.

**The commits since `4f20fc1e`, oldest first** — 1–17 deployed and checked
live by Garrett; 18 is this file's own (docs only):

| # | Patch (code + `patch_docs_*`) | What | Migration |
|---|---|---|---|
| 1 | `patch_ack_files.py` | The PO is a real check; every acknowledgment kept as a file; "Attach a file" asks nothing; the route awaits the SKU tables | `2026-10-28-acknowledgment-files.sql`, before |
| 2 | `patch_ack_rule.py` | Item 57: Entered judged vendor by vendor | — |
| 3 | `patch_ack_in_use.py` | The acknowledgment in use marked ✓ In use; the rest kept as history | — |
| 4 | `patch_files_delete.py` | Delete on every file in the purchase's Files tab | — |
| 5 | `patch_files_tab.py` | Step 5d: one Files tab; file-group tiles on the Overview; Upload receipt as a card | — |
| 6 | `patch_specs_files_warning.py` | Item 58: removal prompts state the files that go | — |
| 7 | `patch_website_prefs.py` | Step 4a: Website Preferences to the mockup; the quote form's rooms stored | — |
| 8 | `patch_specs_restyle.py` | Step 4b: Custom Order Specs to the mockup; `GET /api/sku-options` | — |
| 9 | `patch_room_file_groups.py` | One file group per room (Garrett) | `2026-10-28-room-file-groups.sql`, before |
| 10 | `patch_removed_variants.py` | Item 59: variants Shopify no longer has are marked removed | `2026-10-28-shopify-products-removed.sql`, before |
| 11 | `patch_notes_confirmed.py` | Item 54: a note is saved when the server says so | — |
| 12 | `patch_file_delete_order.py` | Item 55: one file's row first, then its stored file | — |
| 13 | `patch_dead_code.py` | Item 56: code made dead by file groups removed | — |
| 14 | `patch_delete_order.py` | Item 61: deleting a custom job asks first, and waits | — |
| 15 | `patch_docs_sku_builder.py` | Item 62 (docs only): `jk-sku-builder` answered | — |
| 16 | `patch_discontinued_colours.py` | Item 60: colours Shopify no longer sells marked discontinued | `2026-10-28-discontinued-colours.sql`, before |
| 17 | `patch_keep_backorders.py` | Item 63: Shopify updates no longer erase backorders; every read and write on that path checked | — |
| 18 | `patch_docs_handoff_2026_10_29.py` | Docs only: this file; the 10-13 handoff's items 5, 8, 9, 64; OPERATIONS §2 and §8 | — |
| 19 | `patch_docs_review_2026_10_29.py` + nine `git rm` | Docs only: every living doc read whole and brought up to date (§3); the README replaced; nine obsolete root files deleted (Garrett) | — |

**Done by hand, not by patch:** the Nano White (`WHN`) and Nano Green (`GRN`)
HCI colour mappings were deleted on 2026-10-28 (Garrett: the store is not
live; from now on a colour Shopify drops is marked discontinued — item 60).

**Data checks Garrett ran and their answers** (each command printed counts or
names only, never a secret):

- The first full Sync after item 59: *2536 variants from 130 products · 442
  no longer in Shopify, hidden* (2536 + 442 = the 2978 the table held: every
  variant ever deleted in Shopify, not only the Nano finishes).
- The first Sync after item 60: no colour discontinued — every mapped colour
  is still sold. Castle Grey marked by hand to show the greying, then
  restored by the next Sync (both halves proved live).
- The running app's settings: 36 read, `NEXTAUTH_URL` present, no `onrender`
  — the OMS never calls the SKU builder.
- Shopify app permissions (via the client-credentials exchange — see §4.6).

**Test orders:** #1065 (the acknowledgment tests), #1066 (ingested normally
after JK ProductStudio took over `_sku`), #1067 (mixed: J&K B09-S1 and Waypoint
W930, the Waypoint line marked backordered as item 63's live check).

**The website team** — waiting on them, nothing for us to do:

- `oms-to-website-rooms-and-file-kinds-2026-10-28.md` sent: `rooms` /
  `rooms_label` (Kitchen, Bathroom, Pantry, Laundry Room, Other) and
  `files_meta[].kind`. The OMS accepts both now; nothing shows until the form
  sends them.
- The SKU builder (`shopify-sku-builder.onrender.com`) is being retired by
  them; JK ProductStudio (Shopify-hosted) writes `_sku` / `SKU` since 10-28.
  Their message left Owner and Cost as unfilled placeholders; our record says
  ~$17/month.

⚠ **THE GHCR REGISTRY TOKEN EXPIRES 2026-11-16** (the system map, as of
2026-09-22). The weekly check alarms 14 days ahead, from about November 2; not
renewed, every deploy fails `denied: denied` (OPERATIONS §5). Item 66.

**A snapshot of the repo as on the box after commit 19:** `repo26.tar.gz` —
300 files: the 299 of `repo25.tar.gz`, the nine new files of commits 1–17
(four migrations, `AckFileMark`, `FileGroupTiles`, `app/api/sku-options`,
`lib/skuOptions`, `lib/shopifyColor`) and this file, less the nine commit 19
deleted (`DELETE_THESE_FILES.txt`, `PHASE-A-NOTES.md`, seven loose
`patch_*.py`). Its sha256 is published
beside it as `repo26.tar.gz.sha256` (it cannot be written here: the snapshot
contains this file). A sandbox can reset mid-session; start from it rather
than rebuilding from patches, and check it against the box before patching.

---

## 2. Method — what this period added

The method in `SESSION-HANDOFF-2026-10-13.md` §2 stands. These were paid for
since.

### 2.1 Whole files, never snippets — enforced again on 2026-10-29

Garrett stopped the work because files were being grepped and read in slices
(`SESSION-HANDOFF-2026-08-27.md`: *"Ask for whole files. Read them end to end.
Do not grep the repo to decide what to ask for, and do not work from a
snippet."*). The re-read found, in one afternoon, what every search had
missed — each now part of feature 9's design:

- **Backorders** (`SkuItem.backordered`, `expected_ready_date`) — a per-line
  date nobody had mentioned.
- **The cron's purchase rule** — it skips refunded, archived and unreadable
  purchases (`productionAutoAdvanceSkip`).
- **The cron decides "today" in UTC**, though the codebase itself warns the
  business is in Arizona.
- **Item 63** — every Shopify order update erased the backorders.
- `scheduled_delivery_date` beside `delivery_date`; *"Delivered is
  human-only, via a Confirm Delivery button"*; `displayOrderNumber` returning
  `SHO-1065`.

Choose files from the directory listing, never from a search. The view tool
truncates files over ~16 000 characters in the MIDDLE — read in ranges and
check the last line number against `wc -l`.

### 2.2 Show a finding before acting on it

Item 63 was shown on the real webhook before a line was written — and the
first run showed the backorder SURVIVING, because the stand-in sent a list to
`jsonb` in a form PostgreSQL rejected and the webhook's unchecked update
failed silently. A surprising "it's fine" is a reason to look at the log, not
to stop.

### 2.3 The harness (sandbox-specific — rebuild if lost)

Under `/home/claude/hx`: `build.mjs` (esbuild; `ENTRY`, `SUPA` = the supabase
stand-in, a tree path, an out file), `run.cjs` (jsdom), `supabase_pg.ts` (every
call as SQL on real PostgreSQL 16 at `/tmp:5433`, storage recorded),
`supa_maps.ts` (fetch-driven UI tests), `stubtree/` (Turnstile, EXIF stand-ins),
`/tmp/pgup.sh`, `/tmp/fresh6.sh <db> new` (production's schema from the real
migrations; `base6.sql` is OLDER than production — add columns a test needs).
Fixes made to `supabase_pg.ts` this period, each one a false result first:
`.range()`; `.upsert(rows, {onConflict})`; `rpc()` with arrays passed as
arrays and with no arguments; a list of OBJECTS sent as JSON (a `jsonb`
column), a list of plain values as an array (a `text[]` argument); a
`__failRemove` switch for storage failures. UI: a page needs `StoreProvider`;
jsdom lacks `self` (Next's `Link`) — set `globalThis.self`; make
`/api/realtime-token` never answer, or the realtime client throws uncaught;
React's `AggregateError` hides the real errors — print `e.errors`.

### 2.4 Smaller lessons

- **Copy a docs anchor from the file, never retype it.** "the Files tab" for
  the file's "Files tab" made a docs patch write nothing; the engine refused
  correctly.
- **A post-condition counts uses, not names.** A new comment quoting
  `"stay on the job"`, `"set"` or `sku_judge_discontinued` tripped checks
  meant for code. Check `rpc("…")`, `| "set"`, the exact old sentence.
- **An edit that only removes leaves a one-line comment** — the engine
  requires the new text to be absent from the old.
- **A check command must prove it read something.** `grep onrender || echo
  none` would have printed "none" if the exec had failed; the version used
  printed the count of settings read and whether `NEXTAUTH_URL` was there.
- **Shopify reports a write permission alone**: `write_orders` includes
  reading orders; `write_merchant_managed_fulfillment_orders` includes reading
  fulfilment orders (proved by reading #1067's).

---

## 3. Since the last handoff, in one line each

Items, in full in `SESSION-HANDOFF-2026-10-13.md` §6: **8** mockup parity
(steps 1–5d, 4a, 4b; palette kept; done), **52** order details wait for the
server, **53** notes open to everyone, **54** a note saved only when the server
says so, **55** one
file's row before its stored file, **56** dead code, **57** Entered vendor by
vendor, **58** removal prompts tell the truth, **59** removed variants marked,
**60** discontinued colours, **61** delete asks first, **62** the SKU builder
answered, **63** backorders kept across Shopify updates. **Item 5** (moving a
file between rooms) is closed by file groups' Move.

**The docs, reviewed 2026-10-29 (commit 19).** Every living doc read whole
against this period's changes; 85 stale statements corrected, each marked where
it stands with its date: OMS-STATE (file groups, acknowledgments kept as files,
the product list following Shopify, backorders kept, six realtime tables, the
vendor-by-vendor gate), OPERATIONS (deletions ARE reconciled, five cron routes,
three credentials' symptoms, this period's decisions), RECOVERY (the domain, the
cron scripts only on the box, PITR unconfirmed), the system map, the advisories,
`config/deploy.yml`'s comments. Three docs that read as current were bannered —
the 09-08 "Start here", the realtime spec, KNOWN-WRONG's "still open" items. The
README was the original scaffold's and is replaced by a pointer. Records — the
dated handoffs, SECURITY.md (already bannered) — are left as written.

---

## 4. Feature 9 — customer notifications: the design

**Decided with Garrett on 2026-10-29, every point below.** The promise on
every cabinet order — *"We will notify you when your order has finished
production and is on its way to you"* (OPERATIONS §2) — has never been kept.

### 4.1 What a customer receives — at most seven emails per order

**From Shopify (2):**

1. The **order confirmation**, at checkout.
2. The **shipping confirmation** — *"Order #1065 shipped"*, *"Your cabinets
   have shipped"* — which Shopify sends **when the order is marked
   fulfilled**. Its template picks its version by what the shipment holds,
   lists the items in each shipment, and hides tracking on cabinets. Samples
   already get it when their Shopify label is bought.

**From the OMS, through Help Scout (3)**, each shown to staff and sent only on
**Send** (Garrett: "staff confirm everything"):

3. **Ship date changed** — a delay.
4. **Delivery date changed.**
5. **Delivered** — with the 48-hour sentence.

**Dropped (Garrett):** "in production" ("over informs"); "delivery confirmed"
(the delivery agent and the customer arrange the appointment; the OMS is not
told, and not every order will have a date entered). **There is no OMS "on the
way" email** — Shopify's shipping confirmation is that message; one or the
other, never both.

**Order of work (Garrett):** cabinets first — the promise — then samples and
hardware. Samples already get Shopify's shipping confirmation when their label
is bought.

### 4.2 Phase 1 — fulfilment (build first; one deploy, Garrett)

**One deploy, no report-only switch** (Garrett chose one deploy over a staged
or report-first one). The store is not live, so on test orders the only
customer Shopify emails is Garrett; every fulfilment is recorded on the order,
so the first real ship dates can be checked against what happened.

The OMS starts marking cabinet orders fulfilled in Shopify. **It has never
done so**: `lib/shopifyStageSync.ts` writes only the "Production Stage" note
and the stage tag, and the app had no fulfilment permission until 2026-10-29.

1. **When.** On each line's **ship date** — the "Ship from factory" date,
   which IS `production_est_finish_date` (one field, two names on staff
   screens) — by **Arizona's** date, in a **new run at 15:00 UTC = 8:00 a.m.
   Arizona** (Garrett: the email arrives in the morning). Not inside
   `production-complete` (08:00 UTC = 1:00 a.m.). Add the crontab line on the
   box.
2. **The hybrid (Garrett).** Fulfilment is AUTOMATIC on the date — weekend or
   holiday — because a shipped email days late (the office closed, the agent
   already called) reads as a second shipment. **The business day before**
   (weekends skipped; the OMS has NO holiday calendar — a check on a holiday
   just goes unanswered), staff are asked **"Still on schedule?"**: **On
   schedule** (nothing more) or **Delayed: new date** (which saves the new
   date, and so moves the fulfilment; phase 2 adds the offer of the "ship
   date changed" email to that save — phase 1 sends nothing itself). No
   answer → it
   fulfils on the date. The check shows on the order's Next Action band and in
   the attention list — not in Teams.
3. **What is fulfilled.** That vendor's cabinet lines, **without tracking**
   (website team: their shipping email hides it on cabinets, and a tracking
   number drives Shopify's later shipping updates, which would be wrong for
   scheduled freight), with Shopify notifying the customer. **Matched by
   variant id** — Shopify's line SKU is the base (`W930`), the OMS stores the
   composite
   (`W930-410F-PS`). ⚠ **Superseded 2026-10-29 (ruling 5, §4.9):** matched by
   Shopify's LINE ITEM ID first, by variant id only where unambiguous — two
   Waypoint cabinets on one variant are two lines with one variant id. **Selected by vendor across every fulfilment order** —
   Shopify splits them by shipping profile, and HCI and J&K share "HCI & J&K
   Shipping", so one section can hold two vendors.
4. **Backorders.** A backordered line is LEFT OUT on its vendor's date and
   fulfilled on its own `expected_ready_date`, with the same check the
   business day before (Garrett). The group still moves to At cross dock on
   its ship date, as today (Garrett) — a backorder follows on its own
   shipment.
5. **Mixed groups (Select + J&K).** A ship date **per vendor**; each vendor's
   lines fulfilled on its own date — two Shopify emails, one per shipment. The
   group's `production_est_finish_date` becomes the **latest** vendor's, so
   today's cron, unchanged, moves the group to At cross dock **when the last
   vendor ships** (Garrett), and Shopify's "Est. Production Finish" note
   (written by the order route when the date changes) shows that same latest
   date. Single-vendor groups keep their one date.
6. **Never on the wrong purchase.** The same rule as the cron:
   `productionAutoAdvanceSkip` — not on a payment hold (refund), an archived
   purchase, or a purchase that could not be read.
7. **Never twice.** A record of every fulfilment — which lines, when, which
   Shopify fulfilment, by what — read before every attempt.
8. **The webhook.** Shopify will send the OMS's own fulfilments back as
   `orders/updated`. It already ignores cabinet fulfilments for stage and
   tracking (`fulfilmentIsAuthoritative` is false for cabinets) — KEEP that.
   But it logs `fulfilment_not_applied … drop_ship_vendor` for each, which
   reads "the manufacturer dispatched": recognise the OMS's own and log it as
   such. Its comments ("Cabinets … are never fulfilled in Shopify", "logged …
   so the signal exists by the time that work lands") and `lib/categories`'
   ("bookkeeping or absent", "Not built here") are updated with the work.
   Item 63 already keeps backorders across these updates.
9. **The band.** At In production the headline reads *"Moves to At cross dock
   on <date>, when production ends."* — add that Shopify then emails the
   customer that it shipped.
10. **Before it goes live, verify in Shopify** (Settings → Notifications) that
    the **shipping confirmation** is ON. OPERATIONS §8 recorded it as
    "TURNED OFF" in August; the website team says it is sent on fulfilment.
    Phase 1 depends on it. ⚠ **CORRECTED 2026-11-09:** Shopify has no such
    switch (the website team; OPERATIONS §8).

### 4.3 Phase 2 — the three Help Scout emails

- **One Help Scout conversation per purchase**, created with its first
  notification; each email a reply on it (Help Scout emails it); left closed
  so it does not fill the queue; a customer's reply reopens it with the
  history above. Its id is a new column on `projects` (the purchase already
  links one Help Scout conversation — `consent_evidence`). The integration
  exists: `lib/helpscout` creates conversations and threads, with credentials
  already on the box; the mailbox (**373175**) is `info@`.
- **Each is a prompt**, after the save that causes it: a card under the band
  (like Attach a file) showing the exact email — **Send** / **Don't send** —
  with room for a short note. The trail records which ("Customer notified …
  sent by Garrett" / "Not sent, chosen by Garrett").
- **Failure** keeps the card open with Help Scout's reason; nothing is
  recorded as sent.
- **What the customer was told is recorded**, so a "changed" email goes only
  when they were told the first date, and the public lookup's rule "never give
  a date the customer has not been given" has something to read.
- **Still to decide when building it:** which delivery field the "delivery
  date changed" email watches (the band edits `scheduled_delivery_date`;
  `delivery_date` also exists); the "delivered" trigger — the Confirm
  Delivery move, with its signed receipt; and whose name a reply carries (a
  Help Scout mailbox setting: the user's name or the mailbox's).
  ⚠ **2026-11-10, with the per-line ruling (§4.4):** the "delivered" trigger is
  each line's signed receipt, and "delivery date changed" watches each line's
  delivery target (which field holds it is still the build's to read). Two
  found while reading the record for that ruling, still to settle:
  (a) **"delivery date changed" has no first date to change from.** It goes
  only when the customer was told the first date (above), but the "delivery
  confirmed" email was dropped (§4.1) and the delivery target is internal
  (10-13 item 42), so nothing the OMS sends tells a customer a delivery date:
  as designed it never fires, unless staff record when they told one.
  (b) **The subjects.** §4.4 gives each email its own, but each is a reply on
  one conversation per purchase, subject "Order #1065" (OPERATIONS §2), and a
  reply goes out under its conversation's subject, as understood here — check
  against Help Scout's documentation when building.

### 4.4 The approved wording (Garrett, 2026-10-29 — use exactly)

> **Ship date changed** · Subject: *Order #1065: new ship date*
> Your J&K Cabinetry is now expected to ship on **Monday, November 10**. We'll
> email you again when it ships.

> **Delivery date changed** · Subject: *Order #1065: new delivery date*
> Your delivery is now scheduled for **Thursday, November 20**.

> **Delivered** · Subject: *Order #1065: delivered*
> Your order has been delivered. Report any visible shipping damage within 48
> hours of delivery.

⚠ **PER CABINET LINE — RULED 2026-11-10** (Garrett: *"Lets do your
recommendation, per line. Wording looks good."*). "Delivered" and "Delivery
date changed" go per cabinet line, not per order, and name the line as "Ship
date changed" does (Waypoint as Select Cabinetry, §4.5). Why: each line
arrives on its own day by its own route (OPERATIONS §1), so each has its own
48-hour window; feature 10 records each line's delivery target and signed
receipt; one email at the last line could reach the customer after the first
line's 48 hours had passed. These two supersede the two above:

> **Delivered**, when a line's signed receipt is recorded ·
> Subject: *Order #1067: J&K Cabinetry delivered*
> Your J&K Cabinetry has been delivered. Report any visible shipping damage
> within 48 hours of delivery.

> **Delivery date changed**, when a line's delivery target changes ·
> Subject: *Order #1067: new delivery date*
> Your J&K Cabinetry delivery is now scheduled for **Thursday, November 20**.

> **Staff check, the business day before** (on the order):
> **J&K Cabinetry ships from the factory on Sat Nov 1.** Still on schedule?
> **[On schedule]** **[Delayed: new date]**
> *If nobody answers, it's marked shipped on Nov 1, and Shopify emails the
> customer.*

### 4.5 Rules the wording must keep

- **"Order #1065"**, never `SHO-1065` (Garrett: matches Shopify's "Order
  [number] shipped"; "#1065" alone reads as a ticket). `displayOrderNumber`
  returns `SHO-1065`; the webhook builds that id as `SHO-` + Shopify's
  `order_number`, so the customer's number is the id after `SHO-`.
- **Lines are named as the order email names them:** Waypoint → **Select
  Cabinetry**, HCI → **HCI Cabinetry**, J&K → **J&K Cabinetry**. ("Select
  Cabinetry" is not a vendor in Shopify's data — OPERATIONS §1 — but it is
  what the customer sees.)
- **Never "ship from factory" where a customer can see it** (item 27, with
  the website team): customers read "estimated ship date" / "expected to
  ship". Staff screens may say "ships from the factory".
- **The 48-hour sentence exactly:** *"Report any visible shipping damage
  within 48 hours of delivery."* — never "Terms §12.3" (the Terms are with
  counsel; section numbers may move).
- **Never internal stage names; translate on (type, stage)** (OPERATIONS §2).
- **Short:** each says its one thing. The "what to prepare" link,
  `/pages/shipping-delivery#delivery-day`, has no email now (the "delivery
  confirmed" email was dropped) — kept for when one does.

### 4.6 Settings and permissions

- **Help Scout's satisfaction ratings stay OFF** (a mailbox setting) — or
  every notification invites a rating.
- **Shopify's sender stays `info@`** — the order confirmation tells customers
  to reply; replies must reach Help Scout (whose mailbox is `info@`).
- **Graph from `no-reply@` is NOT the channel** (Help Scout was chosen). Its
  Entra app and secret (expires 2028-08-17) stay unused.
- **The Shopify app's permissions** (2026-10-29, after Garrett added the
  fulfilment one in the Dev Dashboard): `read_inventory`, `read_products`,
  `write_orders`, `write_merchant_managed_fulfillment_orders`. The OMS signs
  in by the client-credentials exchange (`lib/shopify.getShopifyToken`;
  `SHOPIFY_ADMIN_API_TOKEN` is not set). To list them again, on the box —
  prints permission names only:

  ```bash
  cd ~/cabinet-orders && kamal app exec --reuse 'node -e "fetch(\"https://\"+process.env.SHOPIFY_STORE_DOMAIN+\"/admin/oauth/access_token\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:\"client_credentials\"})}).then(r=>r.json()).then(j=>console.log(j.scope?String(j.scope).split(\",\").sort().join(\"\\n\"):\"no scope in the answer; fields: \"+Object.keys(j).join(\", \")))"' 2>&1 | tail -10
  ```

### 4.7 Facts established for phase 1 (from Shopify, the box and whole files)

- **#1067's fulfilment orders, read through the API** (2026-10-29): two, both
  `OPEN`, `requestStatus UNSUBMITTED`, at the location **"JK Cabinets 2 You"**
  (merchant-managed), `deliveryMethod SHIPPING`, `supportedActions`
  `CREATE_FULFILLMENT, REPORT_PROGRESS, HOLD, MERGE`; each line reports
  `sku` (the base) and `vendor`. The OMS's GraphQL version is `2026-04`
  (`app/api/shopify/webhooks`, `cron/webhook-health`). The read-only script
  that read it is below this list — run on the box; it prints statuses,
  locations, actions and items, no customer details; change `name:1067` for
  another order.
- **The crontab (UTC):** production-complete 08:00 daily; Avis sync 07:30;
  webhook-health hourly at :20; Help Scout sync every 15 min; Teams digest
  14:00 Mon–Fri; registry token Mon 15:00. *"No delivery-complete job:
  delivery is human-confirmed (removed in 2b479e6)"* — so
  `lib/shopifyStageSync`'s header mentioning delivery-complete is stale.
  ⚠ 2026-11-02: plus `cabinet-fulfilment` daily at 15:00 (`scripts/cron/
  crontab`, §4.9); the header is corrected.
- **Requirements** (`lib/requirements`): the check is a row requirement at
  `order` / In production with `clocks: false` and `gates: false`. A row
  requirement reaches the attention list only through a clock
  (`lib/attention`), so the check needs its own **attention reason** —
  `AttentionKind` gains a member, and **every screen that switches on it
  must be read whole** first. ⚠ **CORRECTED 2026-11-02 (§4.9):** NOT a
  requirement — the band lists every requirement of its stage, ticked or not,
  so it would read "✓ Still on schedule" every day; and a remedy is one
  upload-style button. The check is its own rule, `lib/shipDates`'
  `dueShipChecks`, read by the band and `attentionFor` (reason `ship_check`).
- **The band** (`components/NextActionPanel`): remedies are keyed by
  requirement id (On schedule / Delayed join that mechanism); its production
  editor has ONE "Ship from factory" input — one per vendor in a mixed group.
  ⚠ Built as its own row on the band, not a remedy (§4.9).
- **The order route** (`app/api/orders/[id]`): stores dates as sent
  (unvalidated); writes a CHANGED date to Shopify as "Est. Production Finish"
  (item 27 kept the name); logs a date only when it changes (items 32, 34).
- **`lib/data`:** one `production_est_finish_date`, `delivery_date` and
  `scheduled_delivery_date` per row; the customer's email on
  `Project.customer_email`; `getBackorderStatus` uses a UTC "today" too.

```bash
docker exec -i "$(docker ps --filter label=service=cabinet-orders --filter label=role=web --format '{{.Names}}' | head -1)" node - <<'EOF'
const d = process.env.SHOPIFY_STORE_DOMAIN;
(async () => {
  const t = await (await fetch(`https://${d}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET, grant_type: "client_credentials" }) })).json();
  const query = `query($q: String!) { orders(first: 1, query: $q) { nodes { name displayFulfillmentStatus
    fulfillmentOrders(first: 10) { nodes { status requestStatus assignedLocation { name } deliveryMethod { methodType } supportedActions { action }
      lineItems(first: 50) { nodes { remainingQuantity lineItem { name sku vendor } } } } } } } }`;
  const r = await (await fetch(`https://${d}/admin/api/2026-04/graphql.json`, { method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": t.access_token },
    body: JSON.stringify({ query, variables: { q: "name:1067" } }) })).json();
  console.log(JSON.stringify(r.data ?? r, null, 1));
})().catch((e) => console.log("FAILED:", e.message));
EOF
```

### 4.8 Phase 1's build — the plan (2026-10-29; as built: §4.9)

**Read whole for it, 2026-10-29:** `lib/shopify.ts`, `lib/shopifyStageSync.ts`,
`lib/autoAdvance.ts`, `app/api/cron/production-complete/route.ts`,
`lib/dates.ts`, `lib/dateUtils.ts`, `lib/sla.ts`, `lib/data.ts`,
`lib/backorders.ts`, `app/api/shopify/webhook/route.ts`, `lib/webhookLog.ts`,
`migrations/2026-09-15-webhook-events.sql`, `app/api/orders/[id]/route.ts`,
`lib/categories.ts`, `lib/requirements.ts`, `lib/attention.ts`,
`components/NextActionPanel.tsx`. ⚠ Read them again if any commit touches
them first.

**Still to read whole before building:** `components/OrderModal.tsx` (2 613
lines — the Production & Delivery card, and what it passes the band),
`lib/store.tsx` (1 176 — how dates are saved), every consumer of
`AttentionKind` (find them from the directory listing, then read each whole —
as of 2026-09-08 they were `app/work/WorkClient` with 3 call sites,
`app/dashboard/…Client` with 4 and `components/Sidebar` with 4, per
`SESSION-HANDOFF-NEXT-SESSION.md` §6; verify, don't trust it),
and `~/cron-jobs/run-cron.sh` on the box.

**The parts, one deploy:**

| Part | Files |
|---|---|
| Ship dates per vendor (mixed groups) | a migration; `app/api/orders/[id]/route.ts`; `lib/data.ts`; `components/NextActionPanel.tsx`; `components/OrderModal.tsx`; `lib/store.tsx` |
| The fulfilment record | the migration |
| The daily run, 15:00 UTC | a new cron route; a new `lib/shopifyFulfil.ts`; `lib/autoAdvance.ts`; `lib/backorders.ts`; the crontab line |
| "Still on schedule?" | `lib/requirements.ts`; `lib/attention.ts` and its consumers; `components/NextActionPanel.tsx`; `components/OrderModal.tsx` |
| The webhook and the comments | `app/api/shopify/webhook/route.ts`; `lib/categories.ts`; `lib/shopifyStageSync.ts` |
| The docs | OPERATIONS §2 and §8; this file; the 10-13 handoff |

**How to prove it:** the real routes on real PostgreSQL with Shopify's API
stood in — the fulfilment-order query and `fulfillmentCreate` recorded in
order — against the box's code as the control; mixed groups, a backordered
line, a refunded and an archived purchase, a second run (never twice), a
weekend date, and a check answered "Delayed". Then live on a test order:
#1067 is mixed with a backordered Waypoint line.

### 4.9 Phase 1 as built (2026-10-29 → 11-02) — committed, live from its deploy

The record of the build; §4.1–4.8 stand with the corrections marked in them.
⚠ **DEPLOYED 2026-11-02** (`2105aa0`; then `82143fb`, the date editors
labelled and a mixed group's vendor dates all or none). The live test, and
what follows, are in `docs/SESSION-HANDOFF-2026-11-02.md`.

**Garrett's rulings (2026-10-29), verbatim in substance:**
1. Due when the ship date is today or earlier (ARIZONA's day), only for ship
   dates on or after the day the run is deployed — not a date chosen in
   advance. Never fulfil a group already Delivered; record it as skipped. At
   cross dock is normal at 8:00 a.m. and is fulfilled. The run gets its own
   healthchecks.io check.
2. Lock a vendor's ship date once its lines are fulfilled, showing "Marked
   shipped in Shopify on MM/DD/YYYY"; the SERVER refuses, not just the screen.
   A backordered line's own date stays editable until that line is fulfilled.
   Phase 2 never offers "ship date changed" after fulfilment.
3. Refuse only a backward move that would clear a locked date, with: *"J&K
   Cabinetry’s lines are marked shipped in Shopify on 11/01/2026, so its date
   can’t be cleared. If it didn’t ship, tell the customer through Help Scout."*
   The clearing rule clears the per-vendor dates at the same moves.
4. The run acts at In production and At cross dock only — an allowlist; every
   other stage is skipped, recorded once per group and reason, the line saying
   that once the group reaches In production with the date passed, the next
   run marks it, so set the real ship date when moving it.
5. Store each line's Shopify line item id (one form for the webhook's number
   and GraphQL's gid); fulfil by it; by variant id only where unambiguous among
   the vendor's unfulfilled lines, else skip that vendor and record why; line
   id the FIRST pass of item 63's carry-over; every writer of `sku_items`
   proven to keep the id and the backorder.
6. Item 65 rides along: `scripts/cron/` committed as it stands after phase 1.

**Readings Garrett confirmed (2026-11-02):** a backordered line ships on the
LATER of its ready date and its vendor's (never ahead of the shipment); when
the two coincide it goes IN the vendor's fulfilment (one email, and one
question); a line left unshipped after its vendor shipped is marked on its
own. A skip is recorded once and blocks nothing. Item 63's fallback passes
reach only stored lines with no id. On a Shopify group the PATCH takes only the
backorder fields from a client's lines. A backordered line's check reads
"**W930-570F-PN (backordered) ships from the factory on Tue Nov 3.** Still on
schedule?".

**The migration** `2026-10-29-cabinet-fulfilment.sql` RAN IN PRODUCTION ON
2026-10-29, ahead of the code (its check identical to the sandbox's). FROZEN at
sha256 `54a5317c…d29476`: any schema change is a new migration. It added
`orders.vendor_ship_dates` (a mixed group's date per vendor; the database holds
`production_est_finish_date` to the latest), `orders.ship_checks` ("On
schedule" per vendor, for a date), `orders.shipped_in_shopify` (written ONLY by
a trigger on the record), `shopify_fulfilments` (THE RECORD: one row per group
and vendor / line / skip reason — the unique key is "never twice"; final once
fulfilled or skipped; server only) and `cabinet_fulfilment_start`. ⚠ **ITS
START DAY READS 2026-10-29 AND IS MOVED TO THE DEPLOY DAY IN THE DEPLOY CHAIN.**

**The commits (not deployed until phase 1 deploys):**
- `4bc1dd4` part 1 — `lib/lineFields` (staff fields, line ids, the carry-over,
  the PATCH's merge); the webhook stores line ids; the PATCH keeps them;
  `OrderDetails` shows refusals and follows the stored lines; `lib/shipDates`
  (the ship-date rules, shared); `lib/dates` (`arizonaToday`,
  `businessDayBefore`); `lib/shopify` (`shopifyGraphql`, strict);
  `lib/shopifyFulfil`; `/api/cron/cabinet-fulfilment`; the migration;
  `scripts/cron/` (`run-cron.sh` with `APP_URL` named once, the registry
  check, the crontab with the 15:00 line).
- `c513ddd` part 2 — `lib/shipDateEdits` (per-vendor dates, "On schedule",
  the locks) asked by the order route; `lib/stageLogic` clears vendor dates and
  answers with the ship date; the store applies what the server stored; the
  webhook logs `fulfilment_by_oms`; attention reason `ship_check`; the health
  row "Shopify fulfilment"; comments made true.
- `3fde2c3` part 3 — the band ("Still on schedule?" in the approved words,
  per-vendor production dates, the headline's email line) and the Production
  & Delivery card (per-vendor dates; the lock shown).

**Proven** in the sandbox on production's own schema (from a read-only probe),
the box's code as the control, every refusal by the rule it names; the patch
scripts on copies of the box. ⚠ **Faults found live in the code before phase
1, now fixed:** item 63's carry-over ERASED a backorder when Shopify removed
the other of two lines sharing a variant and composite; the PATCH dropped line
ids from a client's copy, wrote a stale copy over Shopify's quantities and
stored 2026-02-30; the line editor said "Saved" for a refused save and never
showed Shopify's changes.

**Found, NOT acted on (open):** REST `2024-01` (retired) in
`lib/shopifyStageSync` and the order route's `syncToShopify`; webhook-health's
`graphql()` does not refuse a 200 carrying `errors` (to verify in the route);
UTC "today" in `lib/backorders` (×2), `getBackorderStatus`, the backorders page
and the line editor — a line due today reads overdue after 5 p.m. Arizona
(Garrett's call, open); production-complete's activity insert unchecked; the
line editor's backorder control offered on archived and someone-else's
groups; the export route's comment on `SkuItem` is stale.

**Before the deploy (Garrett):** the app's Admin API scopes include
`write_merchant_managed_fulfillment_orders` (the #1067 read proved READ only);
Shopify's shipping confirmation is ON; the GHCR token renewed if after 11-16
(item 66). **The deploy chain** moves the start day, adds the map line
`/api/cron/cabinet-fulfilment`, creates the healthchecks.io check
`cabinet-fulfilment` (`0 15 * * *` UTC), installs `run-cron.sh` and the
crontab from `scripts/cron/` (diffed), deploys, and checks #1067 live.

**The sandbox harness** (`phase1-harness.tar.gz`): production's base schema,
the Supabase stand-in, the builder, every proof and the patch generators.

---

## 5. Open beyond feature 9

The list lives in `SESSION-HANDOFF-2026-10-13.md` §6. Open there now: **9**
(this design), **25** and **26** (upgrades, waiting), **48** (v14's comment;
`orders` REPLICA IDENTITY), **50** (the trail's shaping written three times),
**64** (new — a mixed order's acknowledgment line does not say which vendor
is still missing), **65** (the cron scripts are not in the repo), **66** (the
registry token expires 2026-11-16), **67** (a stale header comment in the
webhook-subscriptions route). Also: `lib/store.tsx` imports `React` unused (pre-existing);
any backorder marked BEFORE item 63's deploy may already have been erased by a
later Shopify update (not reconstructable).
