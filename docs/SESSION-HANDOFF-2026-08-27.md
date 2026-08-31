# Session handoff — 2026-08-27

For whoever picks this up next, including a fresh assistant chat with no memory
of it.

**Read `docs/OMS-STATE-2026-08-26.md` first.** That is what the system IS — the
data model, the five pipelines, the gates, the monitoring. This document is what
happened, what is left, and how to work on it without breaking things.

**One home per fact — the split is in `OPERATIONS`, in the header block above
§1, and only there.**

⚠ **This supersedes `SESSION-HANDOFF-2026-08-26.md` for the remaining-work list
and for the method.** That file keeps §1–§3 as the record of its own session and
is worth reading once; its §5 is now a pointer here.

---

# 1. What shipped

Ten commits, `658bc15` through the `OrderTable` one. Almost all of it is one
theme pulled at until it came apart: **the tracking number, and what the system
records about it.**

## The tracking number's whole life

⚠ **A tracking-driven advance wrote no activity row at all.** `trackingAdvancesTo`
sets `updates.stage` without `body.stage`, so every branch of the activity chain
missed and the group moved with its own timeline saying nothing. The webhook door
had the same absence, and wrote its only note on the *cabinet* group. Both now
write a row on the group that moved.

⚠ **The row is keyed on the ADVANCE, not just on the number changing.** The first
fix compared old and new numbers, which meant re-submitting an identical number —
which is what the modal pre-fills — advanced the group and recorded nothing.
Found by Garrett moving a row back and forth and noticing the log did not match.
A carrier-only edit is also an event, and also wrote nothing; both are recorded
now.

⚠ **`PATCH` returns `data.stage`.** `TrackingEntry` read `body?.data?.stage` to
choose between "Tracking saved" and "marked shipped", and no return path carried
one — so it always chose the first and never called `onStageChange`. The shape
was pattern-matched from `PATCH /api/projects/[id]`, which does return `{data}`,
of a *project* row, which has no stage. Realtime refreshed the row a moment later,
so the feature looked right and reported the wrong thing.

⚠ **The field stopped vanishing.** It rendered only while
`nextStageFor === "Shipped"` — and the number is what MAKES the group shipped, so
the control unmounted the instant it succeeded. A number could be entered once
and never afterwards seen, corrected or cleared. It now renders wherever the type
carries tracking, with the next-action button beside it rather than instead of
it, and an empty submit clears the number (taking the carrier with it, leaving
the stage alone).

**`shouldSync` covers the tracking advance**, so the Shopify stage tag no longer
says unshipped after a group has shipped.

## One truth per item

⚠ **A backward move now clears whatever the stage it returns to will demand
again.** `tracking_number` and `carrier` were left in place, so a row could sit
at `New` holding evidence that it had shipped. Two live consequences:
`SAMPLE_RULES.New` and `HARDWARE_RULES.Ordered` both gate their SLA clock on
`!o.tracking_number`, so a retained number switched the clock OFF for exactly the
row that needed chasing; and the modal pre-filled from it, which is how the
unrecorded advance above became reachable.

Hardware cleared *nothing* before this — `FLOWS_THAT_CLEAR` was `{"order"}` and
hardware reports its own flow. It is in now.

**The principle, stated once:** the row holds one current truth per item; the
activity log holds the history. Re-entry starts fresh even when the value is
identical, because what is being recorded is a new decision, not the same one
twice.

**What that cost, and why it is worth knowing:** clearing the number is one line.
The other six steps were what made it not silent — `describeFieldsCleared` needed
a label or the activity row would have said "cleared entered-by" while the number
went too, and the store needed the optimistic mirror or the modal would
re-render holding a number the server had already cleared.

## The activity log's guarantee

⚠ **It was `if / else if` down to a single `activityText`.** One PATCH recorded at
most ONE thing, and which thing depended on branch order. A save carrying a stage
move and a delivery date logged the move and said nothing about the date.

It is now independent checks appending to an array. **The guarantee is statable:
every PATCH records everything it changed.**

⚠ **NOT one row per field.** `Production start date set → moved to "In
production"` stays one row describing two facts, because the date IS the move.
One row per EVENT, and every event gets one. The standalone production-dates row
suppresses itself when the auto-advance row already named the cause.

Rows insert one at a time: a multi-row `INSERT` shares a single `now()`, so rows
from one request would carry identical timestamps and sort arbitrarily.

## Realtime stopped erasing the trail

⚠ **`shapeOrder` does `activity: raw.activity ?? []`, and a realtime payload
cannot carry a joined table.** The store's `onUpdate` replaced the row wholesale,
so *any* live update blanked that order's Activity tab until the next full
refetch — and an empty trail is indistinguishable from nothing having been
recorded. Every other mutation in the store merges with `{ ...o, ... }`; this was
the only wholesale replace.

⚠ **It stops the trail going backwards; it does not make new entries arrive
live.** Nothing subscribes to `order_activity`, so a row the server writes still
needs a refetch. The real fix is a subscription on that table, which needs it in
the realtime publication — `migrations/v14_realtime_setup.sql` would say whether
it is there.

## The Shopify fulfilment gate was dead on every mixed checkout

⚠ **`fulfillment_status === "fulfilled"` is an ORDER-LEVEL test applied to a
per-group fact.** Cabinets travel by freight and are never fulfilled in Shopify,
so a cabinets-plus-samples order sits at `partial` FOREVER: the sample label was
bought, Shopify held the number, and the whole block was skipped. Single-category
orders worked, which is why it looked fine.

A fulfilment now resolves to a group through `categoryForVendor` — the same
vendor rule that split the checkout, asked of the fulfilment's own `line_items`.
That also retires `fulfillments[0]`, which handed the first fulfilment's number
to every group.

⚠ **The write is conditional now.** `orders/updated` fires on payment changes,
edits and refunds, and the number was re-written every time — so a hand-corrected
number was reverted by the next unrelated Shopify event, with nothing recording
it because only stage changes were logged.

⚠ **Untested against a real payload.** No mixed order has been through it. A
draft order with a cabinet line and a sample line, marked paid, then a label on
the sample only, is the test — the samples group should advance on its own and
cabinets should stay at `New`.

## Also

- **`delivery_date` acquired a meaning.** The calendar wrote `delivery_date` and
  `scheduled_delivery_date` to the same value; nothing else writes the former.
  The calendar now writes only the scheduled one, so `delivery_date` is free to
  mean **a date the customer has been given** — see §2.
- **`OrderTable`'s Update Status column covers samples and hardware.** Every
  branch was keyed on a stage NAME, and the flows added on 08-25 brought names
  none matched: a sample at `Shipped`, hardware at `Ordered` or `Shipped`, all
  three falling past twenty branches to `return null`. A fall-through branch
  reads the next stage from the row's own flow rather than adding three more
  named cases.
- **One of the two private stage-colour copies is gone.** `OrderTable`'s
  `STAGE_COLOR` now spreads `STAGE_ACCENT` and adds only `Archived`. That was
  also the *cause* of `Shipped` and `Ordered` rendering grey — fixing the
  duplication and fixing the bug were the same edit.
- **`production-complete` stops counting failed advances.** The update's error was
  discarded, so a failed write still wrote "moved to At cross dock" and still
  counted in the reported total. A run where every advance fails now returns 500,
  because `run-cron.sh` pings on HTTP status.
- **The samples modal shows Tracking number and Carrier** where cabinets show
  Production dates and Delivery target. Two cells either way — the grid is
  3-column and the second row only fills at six.
- **Documentation corrections** landed from the previous session's read-through,
  and this repo now holds a session handoff for the first time.

## Later the same session

Four more commits after the sections above were written, all deployed and
confirmed.

**Cabinet vendor strings match Shopify.** `CABINET_VENDORS` listed HCI and J&K
as bare `"HCI"` and `"J&K"`; Shopify's product vendor field says `HCI Cabinetry`
and `J&K Cabinetry`, and `isUnknownVendor` compares exactly. So every HCI and
J&K line on every cabinet order logged as an unknown vendor — defeating the one
safeguard that exists to make "unknown" mean unknown. ⚠ Routing was never
affected: `categoryForVendor` falls through to `order`, which is the right
answer for cabinets either way. The canonical names also live in
`lib/vendorLookup.ts` and the two lists disagreed, which is what caused it.

⚠ **A green acknowledgment is now checked against the lines it matched.**
`lib/ackFingerprint.ts` hashes exactly what `reconcileAck`'s verdict depends on —
normalised name, normalised ship-to, and per-SKU quantities and modifications —
stores it at upload, and recomputes at the gate. A stale green blocks the
advance and the panel says *"Matched, but the order has changed since"*.

- **A comparison, not a mutation.** Clearing the ack on write would fire on every
  `orders/updated` (the webhook rewrites `sku_items` constantly, usually to an
  identical value) and would depend on every future write path remembering to
  call it. A fingerprint recomputed at the gate cannot be bypassed by a code path
  nobody thought of.
- **One selector, two call sites.** `linesForAckVendor` is called by both the
  upload route and the gate. If those ever selected differently, by one line,
  every ack would read stale and no cabinet order could advance.
- **NULL means valid.** Every row written before this carries null. Treating that
  as stale would have invalidated every historical acknowledgment on deploy.
- Verified with 17 property tests against the real transformed module, and then
  in production against a real upload and a deliberately wrong one.

⚠ **Ownership resolved through the project, in four more places.** `eligible`
on the acknowledgment panel, the header pill, the manufacturer PDF export gate
and the team-member cell each read `orders.claimed_by` — null on every
project-linked row since the claim moved up on 2026-08-25. Consequences, all
live for two days: **the .xlsx reconciliation panel did not render at all** on
an owned Shopify cabinet group at New, **the manufacturer PDF export was
hidden** — the first step of the actual workflow — and the header said UNCLAIMED
while the team-member cell four sections below showed the owner's name.

**The acknowledgment is the next action.** At New a cabinet group offered a plain
ENTERED button that failed the gate on click and produced a banner pointing at
the PDF fallback. The next-action slot now states the requirement before it is
pressed, hosts **Upload acknowledgment**, and keeps **Move to Entered** disabled
until the ack is green. `Entry Complete` left the panel below — one transition,
one control. Manual Push stayed, next to the discrepancy breakdown it overrides.

---

# 2. ⚠ What changed about the FACTS

Not code. These are things the documents said, or implied, that are not true.

**Samples ship from JK's own stock and the label is bought directly in Shopify.**
So the Shopify pull is the PRIMARY door for samples, not a fallback — which is
what makes the fulfilment-gate bug above a real loss rather than a tidiness
issue.

⚠ **Hardware is not what several comments claimed.** It ships from the
manufacturer, who supplies a tracking number. **Whether that number ever reaches
Shopify is undecided and depends on the vendor.** `lib/categories.ts` asserted as
fact that hardware ships "via UPS" and that "the fulfilment still carries real
carrier and tracking"; both were assumptions written on 08-25. The comments now
say so. No hardware product is live, so nothing has tested any of it.

⚠ **`HARDWARE_VENDORS` is `["Top Knobs", "Blum"]`, taken from a mockup.** It
appears in no document — `OPERATIONS` §1's vendor table lists only cabinet and
sample vendors. A hardware product whose vendor string differs by a space
ingests as cabinets and inherits the acknowledgment gate, production dates and
the signed-receipt gate, none of which it can satisfy. **Create one test product
in Shopify carrying the intended string and ingest a real order before the
hardware work is called done.**

⚠ **`delivery_date` now means "a date the customer has been given".**
`scheduled_delivery_date` is the internal target. Nothing writes `delivery_date`
today, deliberately — **the notification send should become its only writer**, at
which point the public lookup has a field it can return without promising a date
nobody was told. Do this before real rows carry an ambiguous value; afterwards it
means auditing which is which.

⚠ **The Shopify writeback can only ever reach the first group.** Ingest sets
`shopify_id` on `idx === 0` only, so `syncToShopify`'s `if (order?.shopify_id)`
is false for every other group. That is *accidentally protective* — one Shopify
order has one "Production Stage" note attribute and one stage tag, so a second
group syncing would overwrite the first's. **What a multi-group order should
publish to Shopify at all is an open design question**, and it is the same
"one project, several statuses" problem the public lookup contract already
answers with a status per category.

⚠ **The Shopify vendor strings, verified from the product dropdown 2026-08-27.**
`Waypoint Cabinetry`, `HCI Cabinetry`, `J&K Cabinetry`, `JK Cabinets 2 You`.
**`Select Cabinetry` does not appear** — it is a storefront-facing alias only,
and Shopify's product vendor is `Waypoint Cabinetry`. `HARDWARE_VENDORS` is
still `["Top Knobs", "Blum"]` from a mockup and is still in no document.

**How the acknowledgment actually works.** The designer pulls the PDF order out
of the OMS and enters it into the manufacturer's ordering system. The
manufacturer returns an Excel acknowledgment of what was ordered. That .xlsx is
uploaded to the OMS, which reconciles it against the order and gives a green
light — or lists every line that is off. ⚠ **HCI and J&K use different
acknowledgment formats and have no parser.** Only Waypoint is implemented.

⚠ **HCI and J&K are not commercially the same as Waypoint.** Both are RTA,
stocked, and can be cancelled or returned at any time; Waypoint is locked in and
non-refundable once in production. Those two lines may be retired entirely next
year, which is why building their parsers has not been worth it. The gate stays
for them regardless — the decision was to keep it, not to loosen it.
---

# 2b. ⚠ Two things that are not what their comments say

Found at the end of the session, both by reading rather than searching, and both
change what can honestly be built next.

## The New → Entered gate is looser than every message about it

`app/api/orders/[id]/route.ts`:

```
if (!(await orderAllVendorsGreen(id)) && (!attachments || attachments.length === 0))
```

**A green acknowledgment OR any attachment at all.** Any file — a customer
drawing, a photo — satisfies it. `checkAttachmentGate` in `lib/stageGates.ts` is
the same: `count === 0`. So the banner asking for "the manufacturer's
acknowledgment PDF", and the requirement line shipped this session saying
*Manufacturer acknowledgment required*, both describe something stricter than
what is enforced.

⚠ **And the comment three lines above it says the opposite about overrides:**
*"Admin role override is NOT provided — attachments are a hard requirement"* —
while the same `if` contains `&& !body.override_ack`. Any client can send
`override_ack: true` and skip the gate entirely. That is the known-wrong item at
full strength: not merely unlogged and role-check-free, but documented as not
existing.

**The decision this forces, and it is not made.** Either the UI tells the truth
about a loose gate, or the gate tightens to match the UI. Tightening means
requiring an attachment of a specific `kind` — the column exists and
`proof_of_delivery` already uses it — which would make *"Manufacturer
acknowledgment required"* literally true and would be the HCI/J&K path. It is a
real behaviour change: anyone relying on "attach anything" starts being refused.

## The attention enrichment path is dead

`lib/attention.ts` documents `AttentionEnrichment` for facts that need a join,
with `ackMissing` and `receiptMissing`. **No caller passes it.** All five call
sites in `WorkClient` and `DashboardClient` are `attentionFor(o)` with no second
argument.

So **"Manufacturer acknowledgment missing" and "Signed delivery receipt missing"
have never appeared on a screen.** The mechanism is built, documented, and
unreachable — a safeguard that exists and never fires.

⚠ **This blocks the stale-ack reason.** Making a stale acknowledgment visible
outside the modal means adding `ack_stale` beside them — which would be a third
dead reason unless enrichment flows first. Both callers hold a list of orders and
`orderAllVendorsGreen` is per-order, so calling it per row is an N+1 across the
whole queue. It needs a batch endpoint: given N order ids, return which have a
green non-stale acknowledgment and which have a `proof_of_delivery` attachment,
one query per table. Then both clients fetch once and pass `enrich` per row.

**One open question on its shape:** the batch has to carry the fingerprint
result, because a stale green is not green for `ack_missing` purposes and is
separately `ack_stale` — two facts per order, not one boolean.

---

# 3. Two principles, now load-bearing

**One truth per item.** The row holds the current truth; the activity log holds
the history. A backward move clears whatever the stage it returns to will demand
again, so re-entry is always a fresh recording. Anything worth keeping for
documentation goes in attachments or internal notes — the OMS does not
accumulate every version of a fact.

**Every change gets a row, and every row is an event that happened.** Not one row
per field: combined forms are kept where one row describes the cause and the
effect together. But nothing changes silently, and nothing is claimed that did
not happen — which is why an unchanged number that advances a group reads
*confirmed* rather than *added*, and a carrier-only edit says so rather than
claiming the number was updated.

---

# 4. ⚠ What is left, ranked

| | Piece | Notes |
|---|---|---|
| 1 | **Batch attention enrichment** | Makes `ack_missing`, `receipt_missing` and a new `ack_stale` reachable for the first time. New endpoint taking N order ids and returning, per order, whether the acknowledgment is green and whether it is stale, plus whether a `proof_of_delivery` attachment exists — one query per table, not per row. Then `WorkClient` and `DashboardClient` pass `enrich`. ⚠ **Without this the fingerprint shipped this session is only visible to somebody who opens the modal**, and a customer changing an already-Entered order is exactly the case nobody would open it for. |
| 2 | **The New → Entered gate decision** | See §2b. Tell the truth about a loose gate, or tighten it to an attachment `kind`. Blocks the requirement model, because a per-stage requirement list cannot be honest until the gate is. |
| 3 | **The requirement model** | One `requirementsFor(order)` returning `{label, satisfied, action}[]`, derived beside the server gate rather than beside the UI, asserting at module load that every stage in every flow has an entry — same shape as `lib/attention.ts`. Drives the next-action panel for all five flows: acknowledgment at New, tracking number at Ordered, signed receipt at At cross dock. ⚠ If the panel computes its own list, that is the same rule in two places, and the visible symptom is a green checklist beside a server refusal. |
| 4 | **The Overview layout** | The agreed design is below. ⚠ Deliver as a NEW component shipped whole with a checksum plus a small patch swapping it in — `OrderModal.tsx` is ~2,400 lines and a half-applied patch leaves the modal broken. |
| 5 | **The column drop** | `shopify_id`, `ship_to`, `customer_phone`, `customer_email`, `payment_status`, `payment_hold_cleared_*` still on `orders` after being copied to `projects`. **109 references across 18 files.** Ingest writes both sides so they do not drift — confirmed at webhook lines 622/678 and 765/802. Code first, verified, THEN the migration. `orders.name` stays until warranty linking exists. **Its own session.** |
| 6 | **Rate limiting is keyed by IP** | `` `${bucket}:${ip}` `` — one office IP shares one allowance on every rate-limited route. `rateLimitOr429` **fails open**, confirmed. Needs a decision about the bucket and a pass over every caller's limit. **Its own session.** |
| 7 | **Notifications** | The order confirmation promises *"we will notify you when your order has finished production and is on its way"* and nothing sends it. **The hook point is confirmed:** `PATCH /api/orders/[id]` is the sole writer of all four date fields, because every UI goes through the route. **Read the email from `projects`.** **Trigger 5 must gate on the receipt existing**, not on the stage — the delivery override reaches Delivered with no receipt, and "signed for" would be false in writing. **Add the old values to the existing `currentRow` SELECT** and set-vs-changed falls out with no new query. `production-complete` fires at **1am Phoenix**. |
| 8 | **Public intake** | Claims intake and `POST /api/public/lookup`. ⚠ **Warranty claims have customer-facing copy and no way to reach a customer** — the translation table gives all five warranty stages wording, the endpoint returns a *project*, and warranty is standalone. In `OPERATIONS` §12 Critical. Decide before building. |
| 9 | **Historic money backfill** | Projects ingested before the money columns sum as zero; `/admin` says how many. Backfill via `/admin/shopify`. |
| 10 | **Delete the seven stray healthchecks** | ⚠ **BY EXACT NAME, NEVER BY PATTERN** — all seven are `jk-`-prefixed and so is `jk-webhook-health`, which is real and caught the genuinely missed order #1038. Names in `OPERATIONS` §12. Then shrink `IGNORED_CHECKS`. |
| 11 | **`/projects?filter=archived`** | The sidebar links to it; the page reads its filter from state, not the URL, so it lands on All. |
| 12 | **`OrderTable` spacing** | The action column was fixed this session; the SPACING pass was not. It is a `<table>` and needs its own. |
| 13 | **Known-wrong code** | ⚠ `override_ack` is client-supplied, unlogged, has no role check, and the comment beside it denies it exists — see §2b · **`GroupStrip`'s owner still reads `g.claimed_by` raw**, which is why the order card says `unclaimed` under a header showing the owner's name; the strip only renders for project-linked rows, so one prop fixes it · the calendar fetches orders itself, bypassing the store, and its `saveDelivery` swallows its own failure (`catch {}`, no `res.ok`) ten lines below a `saveProductionDates` that checks both · concurrent identical webhook deliveries can race on insert · one private stage-colour copy remains, location unknown · a project-linked group at `New` renders a **Claim** button whose only outcome is a warning toast — **decision made: remove Claim from the table entirely, it does not belong there** · the `Delivered` branch offers **Archive Order**, which writes `orders.archived`, but a purchase archives as a whole through `/api/projects/[id]` · the modal's `DateEditor` still offers production dates on samples · `lib/stageGates.ts` has an orphaned doc comment describing `checkAttachmentGate` sitting above `checkDeliveryProofGate` · `AckSummary` is declared twice, in `lib/acknowledgments.ts` and `lib/ackStatus.ts`.

**⚠ On `override_ack`.** Named as known-wrong in `OPERATIONS` §10, `OMS-STATE` §3
and here. That stops the next reader inferring a policy from the delivery gate's
"an override needs a reason" — it does **not** reduce the inconsistency. **The
fix is small:** read the role from the session, require a reason, write the
activity row. It matches two implementations that already exist. It is the right
rank while it is the acknowledgment gate; it would not be if it were delivery or
payment.

## The modal redesign, as agreed

Design intent from 2026-08-27, recorded because it exists nowhere else. Behaviour
first, then layout — the behaviour half shipped.

**The stage rail and the next action group together, visually.** SLA warnings
(`2d overdue`) move up beside the stage heading. The next-action panel gets
larger and holds every function for the current stage.

**The current stage's requirements are bubbles with checkmarks** — satisfied and
unsatisfied both visible, so the gate is legible before it is hit rather than
after. A cabinet order at New progresses: **Claim order** → **Submit
acknowledgment** (→ **Resubmit** while red) → **Move to Entered** once green.

⚠ **The next action is per TYPE.** Cabinets, hardware and samples each follow
their own path, and the panel reflects the row's own flow rather than a shared
sequence with exceptions.

**The override lives in the next-action section**, not in a separate panel.

**Red-ack discrepancies go to the full order page.** Clicking the red
acknowledgment opens it, where every line item is already listed and a
per-line problem has something to attach to. ⚠ **`reconcileAck` also produces
ship-name and ship-address mismatches, which belong to no line item** — those
have to stay in the next-action panel or the click-through hides them.

⚠ **A stale acknowledgment after Entered does NOT move the order back.** If a
customer changes an order that has already advanced, the row stays where it is
and asks for an updated acknowledgment until it goes green again. Reverting a
stage would be a side effect of a customer phone call, which is not a decision
the system should take.

**The `…` menu holds:** Claim project, Unclaim project, Re-decode.

**"Acknowledgment required" appears once**, in the next-action panel only — not
also under the stage heading.

**Attachment uploads happen in the Attachments card or in the Files tab.** Both
are entry points to the same thing.

**Do not duplicate the action buttons in a sticky footer.** The mockup showed
Upload acknowledgment and Move to Entered in both the panel and a footer; that is
the same duplication that put ENTERED and Entry Complete on screen together.

⚠ **The mockup shows Cabinets `Unclaimed` and Samples `Garrett` on one project.**
Those cannot differ — one owner per purchase is the whole reason the claim moved
up. The mockup inherited the `GroupStrip` bug it was drawn beside; both cards
should read the same name.

## Bigger than any of the above, and not code

- ⚠ **Garrett is the sole admin on every service.** No second credential holder,
  no break-glass procedure. ⚠ `docs/RECOVERY.md` contradicts this — it documents
  `.env.kamal` copies on the laptop and in the password manager, and a
  break-glass procedure in Scenario 4. **It is dated 2026-05-20 and stale in the
  worst way**: `NEXTAUTH_URL` still points at `sslip.io`, the orphaned hostname
  that caused the 64-day cron outage, and its PITR section is truncated
  mid-list. The document you would open in a crisis walks you back into a
  known incident.
- **Supabase PITR status and retention are unknown.** `RECOVERY.md` asserts Pro
  tier with PITR; `OPERATIONS` §12 lists it as unknown. One is wrong.
- **The Hetzner restore has never been tested.**
- **What `jk-sku-builder` is** — ~$17/month across two line items, documented
  nowhere.
- ⚠ **Who supplies hardware, and are they integrated with Shopify.** Decides
  whether the fulfilment path is real for hardware or whether manual entry is the
  only door. Nothing should be built on the current comments.
- ⚠ **`.kamal/secrets.bak` is committed to git.** `.kamal/secrets` belongs there
  — it holds `$REFERENCES`, not values. The `.bak` is the shape of the
  2026-08-03 incident, where that exact file was regenerated from a stale paste
  and silently lost four keys. **Check today whether it contains literal values
  rather than references. If it does, the answer is rotation, not deletion** —
  git history keeps it either way. Raised at the start of the 08-27 session and
  never checked.
- **Seven `patch_*.py` scripts and `DELETE_THESE_FILES.txt` are committed.** The
  scripts are anchor-based patches against code that has since moved, so
  re-running one would either miss loudly or hit something it should not. Inert
  where they sit; worth deleting deliberately rather than leaving as litter that
  looks runnable.
- **`docs/` holds nine files; the split table in `OPERATIONS` names six.**
  `RECOVERY.md`, `KNOWN-WRONG-ADDITIONS-2026-08-25.md` and
  `HANDOFF-2026-08-25-REWORK.md` are unaccounted for — the last is a handoff no
  current document mentions at all. `KNOWN-WRONG-ADDITIONS` §3 is also stale: it
  proposes a second predicate reading `STAGE_LIST_BY_TYPE`, and
  `isStageOfferedForType` already exists and is called. "This table is the only
  copy of the split" is a stronger claim than it can currently support.
- **Two questions from the Shopify product pages, neither chased.** Line items
  carry `_apo_addons` with a price (`"23.89"` on the order inspected) — **confirm
  the project money totals include add-ons and not just the base line price**,
  because that is revenue. And a chip reading **"Simple Trends"** sat beside the
  vendor field; if that is ever a *vendor* rather than a tag it will log as
  unknown, like HCI and J&K did.

---

# 5. How to work on this

Moved here from `SESSION-HANDOFF-2026-08-26.md` §5, which now points at this
section. Everything before "Added this session" is unchanged and still true.

**The assistant has no shell on the box.** It builds and tests in a sandbox,
delivers files, and Garrett runs them. Edits ship as **idempotent, anchor-based
Python patch scripts** validating every anchor and writing nothing on any miss.
New files ship whole with `shasum -a 256`.

**Garrett is on Windows in Git Bash.** Only `scp` runs locally; everything else
runs on the box over `ssh`. A bare `cd ~/cabinet-orders` locally resolves to
`/c/Users/garre/cabinet-orders` and fails.

## The loop

```bash
# LOCALLY
cd /c/Users/garre/Downloads
shasum -a 256 patch_2026-08-27_whatever.py
scp patch_2026-08-27_whatever.py garrett@5.78.220.153:~/

# ON THE BOX
cd ~/cabinet-orders
shasum -a 256 ~/patch_2026-08-27_whatever.py
python3 ~/patch_2026-08-27_whatever.py .
npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"   # EXIT:1 = clean
git status --short

# ON EXIT: 1
git add path/to/changed/file.ts && git commit -m "…"
git push origin main && kamal deploy 2>&1 | tee kamal-deploy.log
echo "=== ERRORS: $(grep -cE 'ERROR \(' kamal-deploy.log) ==="
```

⚠ **The script lives in `~/`, not in the repo, and takes the repo root as an
argument.** `git ls-files` shows seven `patch_*.py` committed by accident; the
old loop's `rm` before `git add` was supposed to prevent that and failed seven
times because it depended on remembering. Outside the working tree there is
nothing to remember.

⚠ **`git add` named files, never `-A`.** `git status --short` tells you what is
dirty; it does not stop `-A` taking it. A stray deletion under `docs/` nearly
rode along with a code commit this session.

⚠ `"Finished all"` prints on aborts, and `grep -c 'ERROR (SSHKit'` reports zero
on a config error. Use `grep -cE 'ERROR \('`.

⚠ **Verify the deploy, do not infer it.** `tsc` passing means the code compiles.
Kamal tags images with the commit SHA:

```bash
git rev-parse --short HEAD
docker ps --filter label=service=cabinet-orders --format '{{.Image}}  {{.Status}}'
```

If the tag is an older SHA the deploy did not run or aborted. A container being
up proves only that a container is up.

## ⚠ Work from WHOLE FILES, never snippets

Every anchor failure traces to reasoning about a partly-visible file: a duplicate
`style` attribute that could not be seen, a blank line that was assumed, a second
call site nobody knew existed. Pull the file, check the length against `wc -l`,
then patch.

Several files at once, which is better than base64 for everything but a single
stubborn file:

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && tar -czf - lib/a.ts lib/b.ts" > ~/Downloads/set.tar.gz
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && wc -l lib/a.ts lib/b.ts"
```

`tar -tzvf` gives a manifest to check before uploading. When a plain paste keeps
arriving empty:

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && base64 -w0 path/to/file" > ~/Downloads/file.b64
```

⚠ **Send `wc -l` as its OWN command.** Combined with `base64` the count lands
inside the encoded stream; combined with `tar` it lands inside the gzip and the
archive will not open. Both happened.

⚠ **Check the upload against `wc -l`.** A truncated paste looks exactly like a
short file.

## ⚠ How files get pulled, and why it is never a grep

**Ask for whole files. Read them end to end. Do not grep the repo to decide what
to ask for, and do not work from a snippet.**

The reason is not tidiness. Every anchor failure in this project traces to
reasoning about a file that was only partly visible, and every wrong diagnosis
traces to a search that returned what was looked for and nothing about what was
not. This session produced four examples in one day:

- A search for `liveOrder.claimed_by` found four readings and missed a fifth
  written as `g.claimed_by` in a loop — the one that is still wrong. **A search
  scoped to one identifier is not a search for the fact.**
- A guard verifying a vendor list matched its own COMMENTS as well as the array,
  reporting seven values where the array held five distinct ones. Strip comments
  before scanning code.
- A detailed case that the acknowledgment feature was deadlocked, built entirely
  from reading code, was killed by one screenshot of a Shopify dropdown. **The
  thing that was actually broken sat in the same dropdown.**
- `docs/RECOVERY.md` and `docs/KNOWN-WRONG-ADDITIONS-2026-08-25.md` both contain
  claims that are false today, and neither would be found by searching for the
  thing they are wrong about.

**The pull, every time:**

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && tar -czf - lib/a.ts lib/b.ts" > ~/Downloads/set.tar.gz
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && wc -l lib/a.ts lib/b.ts"
```

`tar -tzvf` first as a manifest, then check the extracted counts against the
`wc -l`. ⚠ **Never combine them into one command** — the count lands inside the
gzip and the archive will not open. That happened; it is recoverable by
stripping the bytes before the gzip magic, but only if you notice.

⚠ **Do not propose a step that depends on a file you have not read.** A design
proposed on an unread `stageGates.ts` was wrong about what the gate checks, and
the correction changed the whole plan.

## Lessons that each cost real time

**A secret needs THREE files.** The value in `.env.kamal`, a line in
`.kamal/secrets` reading it out, the name under `env.secret` in
`config/deploy.yml`. Missing the second fails the deploy loudly. Missing the
third reaches nothing, silently.

**esbuild parses; `tsc` understands.** A sandbox parse will not catch a duplicate
JSX attribute (TS17001), an undeclared import, or a name that does not resolve.

**Two call sites can need opposite treatment.** One needed a helper; the other
already had the value in scope and would have been shadowed by the rewrite. Split
the file at function boundaries rather than matching text.

**Count elements, not strings.** A guard counting `"AvatarWithProfile"` read 5
where there were 3 renders — the import line contains the name twice.

**A replacement that is a PREFIX of its anchor skips silently.** "Already
applied" is derived from the replacement being present; a prefix is present
before the step runs.

**Guards that scan for a string will fire on their own comments.** Strip comments
before scanning code.

**A CSS grid cannot draw a line across cells.** `borderTop` on each cell draws
under *that cell*. Use an element spanning `1 / span N`.

**`fr` units hide small changes.** Fixed px for predictable content, `minmax()`
only where content varies.

**A ternary branch takes ONE expression**, exactly like `{cond && (…)}`. A
comment plus an element is two children in both.

**When a patch is abandoned mid-way, write down its unapplied steps.** A patch
abandoned, the problem fixed, and only the part being looked at rebuilt — the
rest did not fail, it stopped existing.

**A description of a fix needs one home too.** A duplication was once fixed by
writing the rule against duplication into all three documents, with three
different row counts. The instinct to make every document self-explaining is what
creates the copies that drift.

## Added this session

⚠ **An idempotency marker must survive every step after it.** A doc patch used a
sentence as its "already applied" signal; a later patch replaced that exact
sentence. Once both had run, the first could not recognise its own work and
reported a miss on a file that was already correct. Sharper version of the prefix
rule above.

⚠ **Steps that chain need SEQUENTIAL validation.** Validating every anchor against
the file as it stood before the run means a step anchored on an earlier step's
output can never pass. Apply in sequence in memory, and still write nothing if
any step misses — all-or-nothing is about the disk, not about the check.

⚠ **An unrun patch needs a place to live, not a mention in passing.** One patch
was built, deferred for a good reason, and then dropped out of the conversation
for six hours while "still unrun" was written twice and moved past. Noting it is
not a mechanism. Either run it or write it into this file.

⚠ **A patch that is not ATTACHED in the message asking for it will not be run.**
Twice this session a file was referenced by name and checksum without being
attached. Both times it was a patch built earlier in the session rather than in
the current turn.

⚠ **Ask what the person did; do not infer it from the payload.** A stage move
with no activity row was diagnosed correctly from the data and then narrated back
as a story about which control had been clicked, which was a guess presented as
fact. The database says what changed. It does not say what was pressed.

⚠ **A zero from a log grep settles nothing.** Container logs rotate at 10 MB, are
not shipped anywhere, and a container replacement loses them. Zero does not
distinguish "never happened" from "rotated away".

⚠ **`{cond && (…)}` TAKES ONE EXPRESSION, and so does a ternary branch.** A JSX
comment plus an element is two children and will not compile. This lesson was
written into this file at 8pm and broken at 11pm by inserting an explanatory
comment above a component inside a `&&`. Caught by the sandbox parse rather than
by remembering it.

⚠ **An "already applied" marker must survive every step after it, INCLUDING
steps in a later patch.** A doc patch used a sentence as its marker; a second
patch replaced that sentence. Once both had run, the first reported a miss on a
file that was already correct.

⚠ **Steps that chain need SEQUENTIAL validation.** Validating every anchor
against the file as it stood before the run means a step anchored on an earlier
step's output can never pass. Apply in sequence in memory and still write nothing
if any step misses — all-or-nothing is about the disk, not about the check.

⚠ **A design can inherit the bug it was drawn beside.** The modal mockup showed
two group cards on one project with different owners, which the model forbids —
because the screen it was traced from had the ownership bug.

⚠ **Verify what a screenshot proves, not what it suggests.** `docker exec … echo
ok` proves a container is running and nothing about which build. The image tag
against `git rev-parse --short HEAD` is the check.

## ⚠ The failure mode this system actually has

Not crashes. **Silence.**

A tag overwrite that ran for weeks. A 64-day cron outage hidden by a duplicate
code path. Six days of dead monitoring with every layer reporting success. Seven
fields that existed in the database and in the API while invisible to every typed
caller. And this session: a stage change with no trail, an Activity tab emptied
by its own refresh, a Shopify pull that never ran on the shape of order the model
exists for, and a save that reported success on a write it had discarded.

Three habits catch these. **Read the thing end to end rather than grepping it for
what you expect to find.** When a rule matters, **make something notice** — a
CHECK constraint, a type, a guard in the patch, an assertion at module load. And
**verify the change landed rather than trusting the tool's own report**: two doc
patches reported success and changed nothing, and a deploy was confirmed by a
container being up rather than by the image tag.
