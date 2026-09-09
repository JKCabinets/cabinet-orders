# Session handoff — 2026-09-08

Written at the end of a long single session. Supersedes nothing; adds to
`SESSION-HANDOFF-2026-08-27.md`.

**Read `docs/OMS-STATE-2026-08-26.md` first.** This document is what happened
and why. What the system IS lives there, and several things in it are now out
of date — §7 below lists exactly which.

⚠ **Dated 2026-09-08 from the database, not from a clock.** The claim rows
created in this session carry `created_at` of 2026-09-08. Patch scripts written
during it are named `2026-09-01`, which is when they were first drafted. The
mismatch is real and not worth renaming; it is noted so nobody later reads it
as two sessions.

---

# 1. The standing rule, from Garrett, 2026-09-08

**No quick fixes, no hacks. Nothing is live yet — the store is password
protected and there are no real customers. Prefer clean for launch over fast
now.** This is a decision about how to work, not about one change, and it
applies until someone says otherwise.

It is the reason several things in this session were done the long way: the
requirement model was scoped as its own piece rather than bolted on, the
`public_api` boundary was left as real work rather than papered over, and the
warranty create path was collapsed into one implementation instead of a second
insert next to the first.

---

# 2. ⚠ Security incident — `projects` was world-readable AND writable

**The most serious thing found in this session.** Closed the same day.

## What was wrong

`projects` was the only table in the database with `relrowsecurity = false`.
Supabase's default privileges grant ALL to `anon` and `authenticated` on new
tables in the public schema, and RLS is what normally makes that harmless.
Without it the grants stood alone:

```
anon → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
```

Verified from inside the running container, using the anon key from the
container's own environment:

```
projects      HTTP 200  [{"id":"SHO-1046"}]     ← a real row
orders        HTTP 200  []                      ← RLS on, correct
team_members  HTTP 401  permission denied       ← no grant, correct
```

The key used is `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which **ships in the client
bundle on every page load, including the login page.** It is public by design;
RLS and grants are the controls, and this table had neither.

Exposed: `customer_email`, `customer_phone`, `ship_to`, `name`, `total_price`,
`subtotal_price`, `total_tax`, `total_shipping`, `payment_status`. PostgREST
honours `limit` and `offset`, so the exposure was the whole table.

**And it was not read-only.** PostgREST exposes DELETE, and a filter such as
`?id=neq.__none__` matches every row.

## Why this table and no other

`projects` is also the only table created outside `migrations/` — made by hand
when the project model landed on 2026-08-25. Every table that went through a
migration got RLS. That is one fact, not two.

## What was done

`migrations/2026-09-01-projects-rls.sql`. RLS enabled and four policies created
in one transaction, mirroring `orders` exactly: `authenticated` may read,
nobody may write directly, `anon` matches no policy and gets nothing.
`service_role` bypasses RLS, so every OMS route was unaffected.

Confirmed afterwards from outside — `projects` now returns `200 []`, matching
`orders`. ⚠ The SQL editor runs as `postgres` and bypasses RLS, so it **cannot**
confirm this; the container probe is the only check that means anything.

## Still open from it

- **The Supabase API logs have not been reviewed** for `anon` requests to
  `/rest/v1/projects` between 2026-08-25 and 2026-09-01. Bots do sweep for
  exposed Supabase projects using keys scraped from JS bundles. Probably
  nothing, given the store is password protected. "Probably" is doing work in
  that sentence.
- **`projects` and `order_acknowledgments` still have no creating migration in
  the repo.** The database cannot be rebuilt from git. This incident is what
  that costs.

## What it changes about how tables get made

Any new table is created with RLS enabled **in the same transaction** as the
`create table`, before a row exists. `claim_submissions` was made that way for
exactly this reason. The window between creating a table and enabling RLS is
the whole vulnerability, so there should not be one.

---

# 3. What shipped

## The public order lookup — `POST /api/public/lookup`

Answers "where is my order" for a customer, from the storefront page at
`/pages/order-status`. Four routes point customers into it (three knowledge
base articles, the contact page, the FAQ, Beacon's suggested questions), all of
which were landing on a page saying order status was not switched on.

- **200 in every case**, including on error. A different status, shape, or
  response time for "no such order" against "wrong email" is an oracle
  confirming which order numbers exist.
- **Cabinets only in `stages`.** One project can hold cabinets in production
  and a sample already delivered, and the page renders ONE step list. The step
  list is the cabinet group; everything else appears as tracking. They cannot
  overlap — cabinets go by freight and never carry a tracking number.
- **Rate limited on IP and on order number**, and it **fails closed** — the
  only route on the box that does. Elsewhere a Redis outage letting requests
  through means spam; here it means an unthrottled oracle.
- Labels live in `lib/customerFacing.ts`. The storefront renders what the
  server sends, so wording changes without a theme deploy.

## The claims intake — `POST /api/public/claims`

Public, multipart, photos. Writes to `claim_submissions`.

⚠ **Fails OPEN, unlike the lookup, and the difference is deliberate.** Failing
closed would refuse a customer's claim during an outage they cannot see, inside
a 48-hour window that Terms 12.3 makes a condition precedent. Spam is
recoverable; a missed deadline is not. The same reasoning runs through the
route: only four fields are required, a failed photo upload never fails the
claim, and the row is written before the photos so a partial failure leaves a
claim rather than orphaned images.

## The warranty flow, end to end

See §4 — it is the largest thing here and has its own section.

## `/api/public` reachable

`proxy.ts` wraps everything not in `PUBLIC_PATHS` and redirects to sign-in. The
lookup deployed correctly and then answered a customer's POST with a login
redirect. ⚠ It also broke the **CORS preflight**, which would have been the
confusing part: `proxy.ts` runs for OPTIONS too, so the browser's preflight was
redirected, the POST never sent, and the failure would have surfaced as a CORS
error pointing at correct code.

⚠ **Everything under `app/api/public/` is now unauthenticated by construction.**
Adding a file to that directory makes it public with no second decision
anywhere. That is the point of the directory and also the hazard.

## The modal's Entered gate

Both directions were broken and neither had been noticed, because the workflow
was running through the table row's "Entry Complete" button, which has no
client gate.

| State | What happened | Server would |
|---|---|---|
| Attachment, no ack | Button disabled; generic button suppressed | Allow |
| Green ack, no attachment | Button enabled, own client gate refused it | Allow |

The second is the ordinary Waypoint case: `/api/orders/[id]/acknowledgment`
writes one `order_acknowledgments` row and **never an `order_attachments`
row**, so a green ack normally means zero attachments. Fixed by mirroring the
server's OR in `doMoveStage` — a predicate removed, not added.

## Rate limiter options

`checkRateLimit` gained `failClosed` and `subject`. Defaults unchanged, so all
existing call sites behave exactly as before.

---

# 4. The warranty flow

## How it works, decided 2026-09-08

1. A customer submits a claim on the website. It lands in `claim_submissions`.
2. **That submission is a DRAFT, not a claim.** It appears on `/warranty` above
   the claims table, at New claim — which is what New claim means: nobody has
   worked it yet.
3. A team member opens it, confirms which order GROUP it is about, and records
   what actually needs replacing.
4. Creating the claim is that act. It produces a `warranty` row in `orders`.

⚠ **The submission and the claim are two different records, and both are
kept.** The customer says "my base drawer cabinet has a dent in the drawer
front"; a vendor cannot fill that. Staff write "W1842-580F-PN, Middle Drawer
Only, qty 1". The submission is what they actually reported, `received_at`
carries legal weight under Terms 12.3, and editing a report in place is how the
report gets lost.

## Ids: `WRN-1048-1`

⚠ **This replaced THREE generators that all had the same bug.**
`app/api/orders/route.ts`, `app/api/warranties/route.ts` and `lib/store.tsx`
each contained `` `WRN-${String(Date.now()).slice(-4)}` ``. The last four digits
of epoch milliseconds cycle every **ten seconds**, so two claims logged ten
seconds apart collide on a primary key. Only the first was reachable; the other
two were dead code carrying the bug forward.

`lib/warrantyId.ts` is now the only one. Sequence is **max + 1, not count + 1** —
counting would reuse a number if a claim were deleted, and reusing a claim
reference is worse than a gap in one.

⚠ **The sequence is per PURCHASE, not per group.** `SHO-1048-CAB` and
`SHO-1048-SMP` both key on `1048`. `lib/createWarranty.ts` therefore counts by
id pattern, not by `about_order_id` — counting by group would give two claims
the same number and only the conflict retry would catch it, which is an error
path doing the work of normal operation.

**Every claim is its own row, always suffixed.** Garrett's reasoning: each
carries its own dates and lead times regardless of when it was raised. Two
claims on one order minutes apart can take completely different paths. Same
argument as cabinets and samples being separate groups under one project,
applied one level down.

⚠ **`WAR-` was nearly adopted** on the strength of a comment in
`app/api/orders/attachments/route.ts` listing `WAR-...` among example id
patterns. That comment is wrong; `ID_PREFIX_BY_TYPE.warranty` is `WRN`.

## One create path

`lib/createWarranty.ts` is the only implementation. Both callers — manual
creation through `POST /api/orders`, and completion through
`POST /api/claim-submissions/[id]/promote` — go through it. They differ in
where the facts come from and nothing else.

- **`about_order_id` is required**, and points at the **GROUP**. The 48-hour
  window runs from a delivery and deliveries are per group.
- **`stage` is set explicitly to `New claim`.** The column default is `New`,
  which is not a stage in the warranty flow.
- **Claims are assigned on creation**, `claimed_by` = `auth.session.user.id`.
  ⚠ `team_members.id`, NOT the username — `claim_order` and `release_order`
  compare against the id, so a claim stored under a username would make
  `release_order` refuse its own owner with `not_owner`.

## Stage fields, decided 2026-09-08

No new columns. `Shipped` holds the expected ship date in
`scheduled_delivery_date`; `Parts ordered` on a cabinet claim holds the
production pair. ⚠ **Both stages currently have NO SLA rule** — `sla.ts` says
there is no field that would say when to stop worrying. There is now one; making
the rule read it belongs with the requirement model.

## The claimed lines

`sku_items` on a claim is what is being replaced, not a copy of the parent's
lines: the SKU, the **quantity affected**, and `description` — the part, in the
vendor's terms. "Middle Drawer Only" against a whole cabinet SKU.

⚠ **`door_style` and `color` are carried from the parent LINE.**
`OrderDetails` groups on `item.door_style` and `item.color`, decoded and
persisted server-side at ingest, **per line, not per row**. Dropping them left
the group header reading "Unknown style" on a SKU whose own suffix said Painted
Navy. Carried in both the modal and the promote route — leaving it out of one
would make a promoted claim behave differently from a manual one.

---

# 5. Bugs found in existing code

**Stage changes discarded an owner.** `PATCH /api/orders/[id]` had
`if (body.stage && body.stage !== "New") updates.claimed_by = null;`.

Three problems: `claim_order()` contains the stage restriction **commented
off**, with a note that some teams may want to flag in-progress orders — so the
database deliberately permits claiming at any stage. Warranty rows start at
`New claim`, so one lost its owner on a PATCH that did not change its stage.
And it cleared the column with **no ownership check**, discarding whoever held
the row — the exact thing `release_order()` refuses with `not_owner` and
`release_project()` restricts to admins. Deleted.

⚠ **The cost:** `release_order()` has no admin override, unlike
`release_project()`. Handing on a standalone claim from somebody who has left
now means an explicit `claimed_by` PATCH. An admin release for standalone rows
is worth building.

**Warranty rows were excluded from the items view by name.**
`OrderModal` had `projectGroups.filter((g) => g.type !== "warranty")` with a
message saying a claim carries damage reports, not SKU lines. True when
written; false once claims recorded parts. Nothing failed — it quietly asserted
the data did not exist.

**`storedType` is computed and discarded.** `app/api/orders/attachments/route.ts`
lines 137-144: `safeContentType()` runs, produces the sniffed type, and the
upload stores `file.type` — the browser's claim — anyway. `lib/fileValidation.ts`
explains at length why that matters: an SVG or HTML file with an embedded
script and a chosen MIME, opened later by a staff member through a signed URL.
The quote-form route does this correctly, which is how it was spotted. **Not yet
fixed.**

**⚠ NOTHING CAN SEND MAIL. Graph is UNBUILT, not broken — I filed it wrongly
here first.** There is no Graph credential in `.env.kamal` (44 entries, none of
them Graph), none in `.kamal/secrets`, none in `config/deploy.yml`, and **no
code anywhere that sends mail**: no `graph.microsoft`, no `sendMail`, nothing.

I originally wrote this up as §5's failure mode 1 — a secret that exists and
silently does not arrive. That was wrong. Nothing arrives because nothing was
put in, and nothing fails silently because nothing runs. OPERATIONS §8's
"set up 2026-08-18" describes an **app registration in Azure**; the box knows
nothing about it.

The distinction decides how it is treated: a broken integration is an urgent
fix, an unbuilt one is a feature that ranks against other features. Filed
wrongly it would either be hunted for as a bug that does not exist, or trusted
as working because it appears in a list of configured services.

⚠ **The promise is unaffected either way.** The Shopify order confirmation tells
every cabinet customer we will notify them when production finishes. Nothing
can send that.

**`.kamal/secrets.bak` is clean.** All nineteen values are references, proven by
a constant 42-character offset between key name length and value length across
every row. No rotation needed; deletion is tidiness.

---

# 6. Decisions, with their reasons

- **Warranty updates go to the customer by email, not a lookup.** Push, not
  pull. A customer waiting on a claim would otherwise refresh a page saying
  "Parts ordered" for a week, and it removes the enumeration surface a claim
  lookup would have created. The storefront's `claims` block stays in place and
  always receives `[]`, so the decision can reverse with no theme change.
- **The lookup shows cabinets only.** Samples and hardware appear as tracking
  numbers. ⚠ The reasoning that a customer can track those in their Shopify
  account holds for samples, whose label is bought inside Shopify — it does NOT
  hold for hardware, where whether a tracking number ever reaches Shopify is
  undecided. Tracking is read from `orders.tracking_number` instead, which is
  populated either way.
- **`scheduled_date` never carries an estimate.** The page renders it as
  "Delivery booked for …", which turns a working date into a commitment. The
  production estimate appears in prose in the stage note instead, hedged.
- **Estimated wording throughout.** Garrett: full truckloads of cabinets are
  estimated production and delivery dates; trucks break down, weather holds
  orders. ⚠ Do not add "dates can move" — "estimated" carries it, and saying
  more makes movement sound expected when it is roughly one job in ten.
- **"Arrived at our delivery partner", not "Arrived in Arizona".** Select
  Cabinetry builds in Kingman, Arizona. ⚠ Also not "Ready to schedule
  delivery": the row STAYS at that stage after a delivery is booked, so
  anything implying scheduling is still to come is false for the orders
  furthest along.
- **Notes appear only on the current stage.** A completed step reading "we will
  let you know when it is on its way" reads as a system that has lost track.
- **Nothing customer-facing reveals what has not been entered.** "Awaiting an
  estimated completion date" is a missing-data SLA condition — on the work
  queue that is the point, on a reassurance page it announces our own
  unfinished admin.
- **A tracking number that cannot be its carrier's gets no link.** Carrier sites
  render "not found" as a normal page, so a link built from a junk number looks
  identical to a working one. Found because "1515" produced a perfectly
  respectable UPS page.

---

# 7. ⚠ What this makes out of date in OMS-STATE and OPERATIONS

Not yet amended — both were held as review copies during this session and
amending a stale base is how the corrections get lost. Each needs:

**OMS-STATE**

- §1 — there are now public endpoints. The system is no longer only an internal
  OMS behind auth.
- §3 — the warranty flow's `Parts ordered` and `Shipped` now have date fields.
- §3 — hardware's "ships via UPS" assumption is corrected in `categories.ts`
  and still wrong in `sla.ts` and `data.ts`.
- New — the draft/claim distinction, and that a submission is not a row in
  `orders`.
- New — `WRN-1048-1`, always suffixed, sequence per purchase.

**OPERATIONS**

- §9 incident history — the `projects` RLS exposure, in full.
- §12 Critical — `secrets.bak` resolves as clean. Add the Graph gap, the
  `public_api` gap, and the missing `projects` / `order_acknowledgments`
  migrations.
- §10 — claims are now assigned on creation and a stage change no longer
  releases them.
- The document-set table — this file, and `handoff-website-to-oms-2026-09-01.md`.

---

# 8. Remaining work, ranked

⚠ **REWRITTEN AFTER THE SESSION CONTINUED.** Items 3 and 4 below were the
requirement model and batch attention; both are DONE — see §11. What follows is
what is actually left.

1. **The next-action panel.** Started, not finished, and §11 says exactly where
   it stopped. The one piece with work already done against it.
2. **`storedType`.** Two lines. A live stored-XSS mitigation wired to nothing.
3. **The requirement model.** ⚠ Larger than the old handoff's item 3 describes:
   the requirement is encoded in FOUR places — `SLA_RULES.clockRuns`/
   `waitingFor`, `fieldsToClearOnBackwardMove`, the PATCH gates, and
   `trackingTargetStage`. Garrett's decision: `requirementsFor` becomes the
   source and the others derive from it. ⚠ A source table with no consumer is
   `AttentionEnrichment` again, so the first slice must ship with a real one.
4. **Batch attention enrichment**, behind the requirement model.
   ⚠ `attentionForProject` has **no `enrich` parameter at all** — line 225 is a
   hardcoded `attentionFor(g, undefined, now)` — so the project rollup stays
   blind even after both clients pass one.
5. **The `public_api` boundary.** Both public routes run as service role, so
   the select lists are the only thing keeping `customer_phone` and
   `internal_notes` out of a public response. supabase-js authenticates with an
   API key rather than a Postgres role, so this means signing a short-lived JWT
   with `role: "public_api"` using `SUPABASE_JWT_SECRET`, which is already in
   `.kamal/secrets`.
6. **Missing migrations** for `projects` and `order_acknowledgments`.
7. **Admin release for standalone rows** — see §5.
8. **Stale comments**, listed in §9.

---

# 11. After this handoff was written

The session did not stop here. Everything below happened afterwards, in order.

## The requirement model — DONE, and larger than §8 item 3 described

`lib/requirements.ts` is the source: what a row still needs, per `(type,
stage)`, each entry carrying a label, a remedy, a predicate, and whether being
unmet keeps an SLA clock running.

```
lib/requirements.ts          the source
  ├── lib/sla.ts             clockRuns / waitingFor derive from it
  ├── lib/attention.ts       the two join-backed reasons derive from it
  ├── app/work/WorkClient     3 call sites
  └── app/dashboard/…Client   4 call sites
        via lib/useOrderEnrichment.ts → POST /api/orders/enrichment
```

⚠ **The SLA derivation changed no behaviour, and that was proved rather than
asserted:** 384 rows — every combination of the five relevant date/tracking
fields across every stage of every flow — compared against the four original
predicates. Zero differences.

⚠ **Three states, not two.** A requirement is `met`, `unmet` or `unknown`.
Unknown is what a join-backed requirement reports when nobody fetched the
enrichment. In `attention.ts` unknown produces NO reason — a queue that guesses
sends somebody to redo finished work. In the modal it renders as an open circle
with the move button disabled — a modal that guesses is corrected a second
later by the person looking at it. Same table, opposite defaults, both
deliberate.

## The enrichment endpoint

`POST /api/orders/enrichment` answers `{ackGreen, hasAttachment,
hasProofOfDelivery}` for many rows in **five queries regardless of row count**.
Two reasons built in August — `ack_missing`, `receipt_missing` — had never
appeared on a screen because answering them meant a query per row.

Getting there needed two splits, each keeping ONE implementation:

- `lib/vendorLookup.ts` → `prefetchVendorMaps` (the two queries, any number of
  orders) + `resolveVendors` (the four layers, no I/O). Layer precedence
  verified: variant_id beats SKU shape beats base SKU beats fallback.
- `lib/acknowledgments.ts` → `summariseAcks` + `allVendorsGreen`, both pure.

⚠ **The batch path and the server gate call the same functions.** A second copy
of either would mean the queue and the gate disagreeing about whether an order
can advance, and the queue is the one people would believe.

⚠ `attentionForProject` **had no `enrich` parameter at all** — a hardcoded
`attentionFor(g, undefined, now)`. Passing enrichment in the clients would have
left every project-rendered screen blind, which looks exactly like the feature
not working. Fixed.

⚠ **Eleven attention call sites, not five.** §8 of the 08-27 handoff said "all
five call sites in WorkClient and DashboardClient". There are seven across
those two and four more in `components/Sidebar.tsx`. Sidebar is deliberately
NOT enriched: all four of its calls ask only about `sla_breached` and
`sla_due_soon`, both row-only.

## Entered → In production is now gated

⚠ **There was never a gate.** Setting `production_start_date` at Entered
AUTO-ADVANCES the row, and that was the whole rule; nothing refused a manual
advance without dates. The row then sat at In production where
`production-complete` — which advances on `production_est_finish_date <= today`
— could never move it.

Garrett's correction, and it is domain knowledge rather than preference: the
manufacturer gives production dates within a day or two of the order being
placed, **well before production starts**. So "in production without dates" is
a skipped step, not an honest record of an unknown.

The gate accepts the date in the SAME request, because a PATCH carrying both
the stage and the date is what the modal sends. The auto-advance is untouched —
it fires only when `body.stage === undefined`.

⚠ **This raises the blocked count.** `Entered` had no clocking requirement
before; a cabinet order sitting there over 24 hours without dates now reads as
blocked. That is the intended signal.

## Where the next-action panel stopped

Three notes from using the OMS, all one cause — the slot was a hand-written
branch per case, so every gate had to be taught to it separately:

1. Submit/Resubmit acknowledgment renders in `AcknowledgmentPanel` AND the slot.
2. The production-dates prompt sits in `DateEditor` below rather than the slot.
3. At Entered the slot's button advanced without dates. **Server half fixed
   above; the UI half is the panel.**

`components/NextActionPanel.tsx` is written and NOT deployed. It generates a
checklist from `requirementsFor` — one row per requirement, tick from
`state()`, remedy as a button, move button disabled until all are met — with
inline date fields, because setting the dates IS the action at Entered.

⚠ **It has a known bug: it patches `delivery_date` where `DateEditor` writes
`scheduled_delivery_date`.** Fix that before wiring.

⚠ **`OrderModal.tsx` ALREADY DEFINES A LOCAL `NextActionCard` at ~2172 that is
DEAD** — one occurrence repo-wide, rendered nowhere. It is an earlier version
of this same card that was inlined into the stage grid at ~1128 and left
behind. The new component is named `NextActionPanel` only to avoid colliding
with it; **the dead one should be deleted**, along with any helper that becomes
unused with it — `tsc` will not say, because `noUnusedLocals` is off.

⚠ **THE WORK STOPPED HERE ON PURPOSE.** The remaining patch deletes a
component, drops its orphaned helpers, replaces a grid cell and strips
`AcknowledgmentPanel`'s duplicate buttons — and `OrderModal.tsx` is 2,574 lines
of which roughly 900 were still unread. Four guards tripped during this session,
every one on an anchor written from a half-remembered read rather than from the
file. **Read it end to end first.**

## Live at the end of the session

The live next-action slot is the `glass-sage` grid at ~1128: three cells,
Current stage · Next action · owner. Saving a field is
`updateOrderDetails(id, details)` from the store. `doMoveStage` already runs the
client Entered gate and handles the delivery-proof refusal, so the panel's move
button should keep calling it rather than checking anything itself.

---

# 9. ⚠ Stale comments found this session

Every one was believed before it was checked. Listed because the pattern is the
point, not the individual lines.

| File | Says | Actually |
|---|---|---|
| `sla.ts` | hardware runs New → Ordered → Delivered, "Shipped" gone | Four stages; the code 26 lines below says so |
| `sla.ts` | hardware ships "via the manufacturer's UPS account" | Corrected in `categories.ts` 08-27, missed here |
| `stageLogic.ts` | `sample` maps to `ORDER_STAGE_ORDER` | Four lines below: `sample: SAMPLE_STAGE_ORDER` |
| `stageLogic.ts` | hardware runs Ordered → Shipped → Delivered | Missing `New` |
| `data.ts` | samples run New → **Entered** → Delivered | `["New", "Shipped", "Delivered"]` since 08-25 |
| `data.ts` | `isStageOfferedForType` — same `ORDER_STAGE_ORDER` claim | Contradicted by `stageLogic.ts` |
| `data.ts` | "a SAMPLE only when EVERY line is this vendor" | Pre-project model; splitting is per line |
| `data.ts` | `displayOrderNumber`'s doc block | Sits above `parseMoney` |
| `data.ts` | `matchesOrderNumber`'s doc block | Sits above `LEGAL_SUFFIXES` |
| `attachments/route.ts` | example ids include `WAR-...` | `WRN` |
| `stageGates.ts` | `checkAttachmentGate` doc block | Sits above `checkDeliveryProofGate` |

`categories.ts` is the file that named this failure — *a comment that
contradicts the function under it is worse than no comment: it is read and
believed* — and it was named once and then reproduced ten more times.

---

# 10. Method notes

- **Checksum locally BEFORE `scp`, not only after.** Twice this session a file
  failed to transfer and the stale copy was diagnosed by `tsc` instead. One
  `shasum` on the sending side catches it first.
- **A stale export is indistinguishable from a reverted file.** An
  `OPERATIONS` copy arrived missing two commits' worth of amendments and read
  exactly like a revert. `git log -- <file>` is the cheap discriminator.
- **Patch scripts check already-applied BEFORE their guards.** A guard asserts
  the unpatched shape, so running it first makes a correct second run report a
  MISS. A re-run has to be boring or the first run's output means nothing.
- **`esbuild` parses; `tsc` understands.** A `.select()` string split across
  lines with `+` compiles fine and breaks supabase-js's row-type inference,
  which only `tsc` catches.
- **The container has no `curl`.** Use `node -e` with global fetch.
