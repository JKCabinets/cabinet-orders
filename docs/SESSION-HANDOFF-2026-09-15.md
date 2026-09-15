# SESSION HANDOFF — 2026-09-15

Covers work from 2026-09-09 through 2026-09-15. Where a date is given below
it is the date of the **decision**, taken from the commit trail; the
conversation that produced it may have run across a day boundary.

Successor to `docs/SESSION-HANDOFF-2026-09-08.md`.

**Read in this order before touching anything:**

1. `docs/OMS-STATE-2026-08-26.md` — the data model and the flows
2. `docs/OPERATIONS-2026-08-26.md` — the business rules, especially §12 and §13
3. this file

Then pull whole files for whatever you are about to edit. Do not work from
snippets; the last two sessions both lost time to a file that turned out to
differ from the assumption.

---

## The through-line of this session

Nearly everything below is one idea applied in different places: **a rule
should live in exactly one place, and the place should be the one that can
actually enforce it.**

A gate written in the client and again in the server is two gates that are free
to disagree — and they did, twice, on 09-08. A claim displayed in three places
and checked in none is not a feature. A comment describing a foreign-key
constraint that changed is worse than no comment, because someone trusts it.
A check that reports success while doing nothing is the worst of all, because
there is no failure to investigate.

That last one happened **four times today**, and it is the thing to watch for:

- the client gate stricter than its server (a refusal nobody could explain)
- `npx tsc --noEmit | grep` inverting its own exit code, so a failing check
  reported success and the deploy ran anyway
- the Shopify deletion webhook logging `removed` while deleting nothing, twice
- `override_ack` bypassing a gate and writing nothing to the trail

---

## What shipped

### 1. The requirement table is the record of which flows Terms 12.3 governs

`lib/requirements.ts` gained a `gates` flag: does the SERVER refuse the
transition without this requirement? Distinct from `clocks`, which only means
an SLA timer runs. The delivery-proof gate now derives from the table on **both**
sides — the PATCH route in `app/api/orders/[id]/route.ts` and
`checkDeliveryProofGate` in `lib/stageGates.ts`, which now takes the row rather
than an id so it can ask.

This is the first slice of the PATCH-gates migration that OMS-STATE §4 lists as
pending. The remaining gates — acknowledgment-or-attachment, production start
date, tracking number — are still hand-written in the route with their own type
lists. Same pattern, one gate at a time, each independently testable.

**⚠ Verify behaviour-preserving changes by enumeration, not by reading.** The
delivery change was checked by enumerating all 23 `(type, stage)` pairs and
diffing the old type-list predicate against the new table-derived one: 22
identical, 1 intentionally different. Do that for the remaining gates too.

### 2. Custom jobs are outside our Terms — and that is why they are exempt

**This is the single most important thing in this document to preserve
verbatim.**

A custom customer signs a contract and a purchase order with their own terms.
Terms 12.3 — the 48-hour reporting window, the conditions precedent, the signed
proof of delivery that evidences them — is a **Shopify-checkout agreement** and
does not reach a custom job. The receipt gate that used to apply to custom was
therefore not merely unnecessary: **it was enforcing the wrong document.**

⚠ The reason matters more than the change. "Custom is exempt because it's
hand-driven" is a reason somebody reinstates the gate against the first time the
process tightens up. "Terms 12.3 does not apply to custom jobs" does not decay
that way. It is recorded on the `custom` block of `lib/requirements.ts`,
in the route comment, in OMS-STATE §3, and in OPERATIONS §13.

OPERATIONS §13 (chargeback evidence) now carries a scope line: the checklist is
built on our Terms, so a custom dispute is answered from the customer's contract
and PO instead. Without it, somebody assembling evidence for a custom dispute
pulls a checklist built for a different agreement and concludes the file is
incomplete.

### 3. "No gates" extends to the UI, not just the routes

Garrett, 2026-09-10: **custom has no gates, period — it is an organisation tool.**

That covers the interface as well as the API. No control may withhold itself
pending a custom job's date, and no copy may say a date unlocks a step. Three
did, all at At cross dock: the row's Confirm Delivery button, the "Awaiting
delivery date" status label, and the card's "Once set, you can confirm delivery
from the stage page". All three now ask the requirement table.

⚠ **A demand nothing enforces is worse than a gate.** There is no refusal to
search for — only a button that never appears.

### 4. The next-action slot

`components/NextActionPanel.tsx` replaces a hand-written branch per gate. The
checklist is generated from `requirementsFor(order)` — the same table the server
gate, `sla.ts` and the work queue read — so the modal and the queue agree by
construction rather than by coincidence. The dead `NextActionCard` in
`OrderModal` (defined once, rendered nowhere) is gone.

Rules the panel follows, each of them load-bearing:

- **Only a `gates` requirement disables the move.** Clock-only requirements are
  listed as outstanding with their field beside them, and the button stays live.
  Disabling on every unmet row would be a client gate stricter than its server.
- **Unknown renders as unmet**, and a gating unknown disables the move. Opposite
  of `lib/attention.ts`, deliberately: a queue that guesses sends somebody to
  redo finished work; a modal that guesses is corrected a second later by the
  person looking at it.
- **Where the field is the action, there is no button.** A tracking number makes
  a group Shipped; a production start date moves a cabinet order out of Entered.
  The server advances on the save.

**⚠ `dateControlsFor` is a different question from `requirementsFor`.** The
first asks "is the date the thing you came here to type", the second asks "is it
required". Conflating them left custom jobs — which require nothing, by
decision — with no date field at all and a prompt stranded below the fold.
`dateControlsFor` resolves the flow from `REQUIREMENTS` itself rather than from
`lib/data`, because **`lib/requirements.ts` deliberately keeps no runtime
dependency on `lib/data`** (see the boot-check comment). A post-condition in the
patch script fails if a third import ever appears.

### 5. Modal layout

Order info split into a 50/50 row: left card is what the order **is** (immutable
facts), right card is what its stages **run on** (the live fields). The right
card is `StageInputsCard`, named for its job and type-aware — "Carrier &
tracking" for hardware and samples, "Production & delivery" for cabinets and
custom. The old section was named after one flow's fields, which is exactly why
`DateEditor` returned null for the two types where the tracking number is the
whole answer.

`DateEditor` is **deleted**, not left unrendered. Its editing moved into the
card. The tracking editor is `TrackingEntry` — the same component the
next-action slot uses — so clearing, advance-on-save, and the re-sync when a
Shopify fulfilment writes underneath stay in one place.

**The button always says "Modify" and is always present.** The old prompts
appeared only while a field was empty, so a date could be entered and never
corrected.

Also: the claim moved into the header chip (it was displayed there as dead grey
text while the Team Member cell showed the same fact and was the only one you
could act on); card text brightness was raised at the shared `LABEL` constant,
since every field name in the modal inherits it.

### 6. The acknowledgment override is logged

`override_ack` was a bare boolean that wrote nothing — no reason, no name, no
activity row. It now takes a reason, refuses an empty one, and writes
`Acknowledgment gate overridden by <name> — <reason>`. Same contract as the
delivery override eight lines below it, which had been doing this correctly all
along.

⚠ The flag also sat **in the gate's condition** (`&& !body.override_ack`), so an
override skipped the check entirely — a row whose acknowledgment was green
recorded a bypass of a check that would have passed. The check runs first now.

### 7. Claims are enforced — server first, everywhere

**`requireOrderClaim(orderId, session, action?)` in `lib/auth.ts` is the single
answer.** Four routes call it: PATCH, attachment upload, attachment delete,
acknowledgment upload.

    unclaimed          -> allowed. Claiming is how you take a row, and requiring
                          a claim before any edit would make every first touch a
                          two-step on a queue full of unpicked work.
    claimed by you     -> allowed.
    claimed by another -> 409 `claimed_by_other`.
    ...unless admin    -> allowed, AND written to the activity trail.

⚠ **THE GUARD LOGS ITS OWN OVERRIDE.** A side effect in a guard is unusual and
deliberate: an admin acting over somebody's claim must reach the trail every
time, and four callers each remembering to write that row is four chances to
forget — and the one that forgets is indistinguishable from a normal edit
afterwards. The `action` parameter is the verb, so the trail reads
"Acknowledgment submitted by … (admin) while claimed by another member".

⚠ **THE PATCH ROUTE WAS REFACTORED ONTO IT, not left alone.** It held the only
copy. Leaving one hand-written implementation beside three helper callers is
exactly how the client and server gates drifted apart on 09-08.

⚠ **OWNERSHIP RESOLVES THROUGH THE PROJECT.** `orders.claimed_by` is null on
every project-linked row since the claim moved up on 2026-08-25, so a check
reading it raw finds no owner on any Shopify purchase and enforces nothing on
the type with the most hands on it. `claimOwnerOf` does this once.

⚠ **ADMIN EXEMPTION IS SERVER-SIDE AND UNCONDITIONAL. THE "EDIT ORDER" TOGGLE
IS NOT ENFORCEMENT.** This surprised Garrett on 09-15 and will surprise the next
person harder. An admin's request succeeds whether or not the toggle has been
pressed; the toggle exists so that stepping into somebody else's work is a
*second, deliberate act* in the UI rather than a reflex, and it resets when the
modal points at a different group. Do not "fix" the server to require it —
an admin acting through the API, a script, or a stale tab must still be able to
act, and must still be logged.

**Where the UI follows:** the modal (next-action panel, stage-inputs card,
acknowledgment panel) hides controls a non-owner cannot use; the table's action
column refuses at every stage. Read-only is never blank — the checklist, stage,
dates and vendor reconciliation still render, because somebody who cannot act
still needs to see what the row is waiting on. That is how they tell the owner
instead of starting a second copy, which is the entire point of claims.

⚠ **NO ADMIN BYPASS IN THE TABLE**, deliberately. A live bypass in a list row
would make overriding a colleague's claim reflexive. An admin who needs to act
opens the row.

⚠ The table's check previously existed on **two branches out of twenty** —
`New` and `New claim`. A claimed row was protected until the moment somebody
started working it and open to everyone from Entered onward, which is backwards:
an unstarted row is cheap to duplicate, a row halfway through production is not.

### 8. Realtime on `projects`

The publication carried `orders` and `team_members` but not `projects`. Since
the claim lives on the project, **a claim taken by one person reached nobody
else's screen until they refreshed** — which defeats the entire purpose of
claims. The subscription in `lib/store.tsx` had been correct the whole time and
had nothing to receive. Recorded as `migrations/2026-09-14-realtime-projects.sql` — the filename is a
day early and stays that way, because renaming an applied migration is worse
than a filename that is off by one.

### 9. The Shopify deletion webhook

SHO-1051 was deleted twice — `orders/cancelled` and `orders/delete` — and the
handler logged `{"outcome":"removed","groups":2}` both times while removing
nothing. Six `.delete()` calls discarded their errors and the success log ran
unconditionally.

The blocker was `orders.about_order_id → orders`, the **one `NO ACTION` edge
left** on these tables: `WRN-1051-1`, a warranty claim about `SHO-1051-CAB`.
A claim is standalone, so it is never among the group ids being deleted and
never gets cleared.

⚠ The comment above those deletes claimed every foreign key was `NO ACTION`.
They are all `CASCADE` today. **That stale comment sent this investigation to
the wrong table first.** Corrected in place.

A blocked deletion is now **refused and named**, not resolved: nulling
`about_order_id` orphans the claim, deleting it destroys real work because
somebody tidied up Shopify. A warranty claim is evidence and should outlive the
purchase record. Returns 200 (retrying cannot clear a claim) with
`blocked_by: [...]`. Real delete failures return 500 so Shopify retries.

SHO-1051 was cleaned up by hand; it could not be re-triggered because the
Shopify order was already gone.

### 10. The gates migration is finished

All four stage gates now derive from `lib/requirements`. OMS-STATE §4 can be
closed. Verified by enumerating every (type, from-stage) pair: **69 of 69
identical.**

⚠ **THE ack GATE'S TYPE LIST WAS DEAD WEIGHT.** `currentType !== "sample"` could
never fire — `New → Entered` exists only in the cabinets flow, because no other
type has an Entered stage at all. It read as a rule and decided nothing.

⚠ **THE TRACKING GATE IS DERIVED AT THE TYPE LEVEL, NOT THE STAGE LEVEL.** The
table lists `tracking_number` at the stage BEFORE Shipped (sample @ New,
hardware @ Ordered) because `requirementsFor` answers "what is the CURRENT stage
waiting on". That gate applies *whichever direction you come from*, so a
current-stage question would silently stop requiring the number on a backward
admin move from Delivered — exactly when somebody is fixing a mistake and it
matters. `typeEverRequires` asks the type-level question instead.

⚠ **`gates` IS DESCRIPTIVE, NOT EXECUTABLE.** The production gate still reads
the request body: `requirementsFor` answers from the STORED row, but the modal
sends the date and the stage in one PATCH, so deriving the whole check would
refuse the very request that satisfies it. The table can say a requirement
blocks a transition; it cannot say "and the request itself may supply it". Do
not try to finish the job by making the route fully table-driven.

### 11. In production names its own automatic move; dates read MM/DD/YYYY

A cabinets row In production with an estimated finish date moves itself —
`production-complete` advances anything whose finish date has arrived. The panel
said nothing about that, so the button looked like the only way forward and a
waiting row looked stalled. It now names the date, and the button reads **Manual
Push**, because pressing it takes the transition early rather than waiting.

⚠ **THE PROMISE IS ONLY MADE WHERE THE CRON WILL KEEP IT.** `lib/autoAdvance.ts`
holds the cron's own rule and BOTH import it: stage In production, not archived,
type on the ALLOWLIST, and a finish date actually set. Without the finish date
the cron's query never matches and the row sits there indefinitely, so the old
wording stays. A UI promising an automatic move on a row nothing is watching is
worse than silence — somebody waits for it.

⚠ **`formatMDY` PARSES THE STRING, IT DOES NOT USE `new Date()`.** These are
DATE columns: `new Date("2026-09-16")` is UTC midnight, which in Phoenix is 5pm
on the 15th, so every date would render a day early and look like a data bug.
Anything that is not plain ISO is returned untouched — `orders.date` and
`order_activity.time` are stored as DISPLAY strings ("Sep 14"), and reformatting
those means changing what is written at ingest, not the renderer.

### 12. Webhook outcomes persist

`logWebhook` wrote to `console.warn` and nowhere else, in a container replaced on
every deploy. That is how the SHO-1051 deletion bug survived two attempts: the
only evidence was log lines one more deploy would have erased. Every call site
now also writes a row to `webhook_events` (migration
`2026-09-15-webhook-events.sql`).

⚠ **THE INSERT IS NOT AWAITED, AND FALLS BACK TO stderr.** A handler must not
fail or slow because logging failed — Shopify retries on a non-2xx, so a logging
error would become a redelivery loop for a webhook that already did its work.
This runs in a long-lived container, so the promise settles after the response.
A log table that quietly stops recording would be the same shape as the bug it
replaces, hence the console fallback.

---

## Health and cron — already investigated, do not redo

⚠ **`webhook-health` IS A RECONCILIATION, NOT A HEARTBEAT, AND ITS FILE EXPLAINS
WHY.** An earlier version asked "do the webhook subscriptions exist?" and was
wrong in BOTH directions — green on 2026-08-20 while ingestion was completely
dead, and it would have gone red forever once obsolete subscriptions were
removed. It now asks the only question that matters: Shopify is the source of
truth for what orders exist, do we have them? **Read that file before touching
anything in this area.** On 2026-09-15 it was green hourly: `missing_count: 0`,
with `ORDERS_UPDATED` and `ORDERS_DELETE` both subscribed.

⚠ **IT CANNOT SEE THE REVERSE.** It catches orders Shopify has that we lack. An
order WE have that Shopify has deleted is invisible to it — a poll of current
orders never notices an absence — so deletions depend entirely on the webhook
arriving. That is the 1051 shape. `webhook_events` now records deliveries, but
nothing reconciles deletions. Whether to add that is an open question.

⚠ **THERE IS NO delivery-complete CRON, AND THAT IS DELIBERATE.** Removed in
`2b479e6`: "delivery is human-confirmed". Same principle as fulfilment syncing to
Shipped rather than Delivered — a machine cannot know the customer has it. The
crontab kept the comment header after the job was deleted, which looks like a
lost job and is not.

⚠ **`~/cron-jobs/run-cron.sh` HAS TWICE HAD THE FAILURE THIS CODEBASE KEEPS
HAVING.** `|| true` swallowed a persistent HTTP 400 so the dead-man's switch was
dead for six days while every layer reported success; and `curl -f` discarded
the response body, so a failing health check logged "error: 500" and threw away
the route's own explanation of which order was missing. Both are fixed and
commented. Cron output goes to `~/cron-jobs/cron.log` — the script prints
nothing on success, so silence is not a result.

---

## Decisions — keep the reasoning, not just the outcome

| Decision | Reasoning that must survive |
|---|---|
| Custom exempt from the receipt gate | Terms 12.3 is a Shopify-checkout agreement and does not reach custom jobs. The gate was enforcing the wrong document. |
| Custom has no gates at all, UI included | It is an organisation tool. A demand nothing enforces is worse than a gate. |
| Cabinet delivery date stays a client-side nudge | Garrett, 09-10: effectively gated because the row withholds Confirm Delivery until a date is entered. Not a server rule. |
| Warranty claims cannot be raised against custom jobs | Our warranty process is a Terms process — the 48-hour window, the conditions precedent, the evidence rules all derive from the checkout agreement a custom customer never accepted. The claim modal's picker already excludes custom; **that exclusion is correct and should say why.** Not yet recorded in the picker — see open items. |
| A warranty claim blocks deletion rather than being resolved | The claim is evidence; it should outlive the purchase record, and a person should decide. |
| Admin exemption is server-side and unconditional | The "Edit order" toggle is deliberateness in the UI, not enforcement. An admin acting through the API or a stale tab must still be able to act — and must still be logged. |
| Attachment DELETE gated the same as upload, not more strictly | Removing a signed receipt from another member's claimed row is precisely the crossed-wires case claims exist for. A second, stricter rule is a second thing to keep in sync for no gain. |
| Manual Push, not "Mark delivered anyway" | The stage page has always called it Manual Push. Two names for one action is how somebody concludes there are two. |

---

## Open — not done, deliberately

1. **`order_activity` and `order_attachments` do not publish over realtime.**
   Adding them to the publication alone would broadcast to no listener — the
   client has no subscription for them. Code first, then the publication.
2. **Rail timestamps** (mockup 2) need a real per-transition time. The activity
   trail's `time` is a display string — `"Aug 24"`, no clock time. Either the
   PATCH route starts writing a real timestamp per transition (better, and
   useful beyond the rail) or the rail shows dates only. Deferred by Garrett.
3. **The warranty-vs-custom exclusion is not documented in the picker.**
   Decision is made (see table); the comment and doc line are not written.
4. **Orphaned claims are unchecked.** `projects.claimed_by` holds two id formats
   (`"1"` and `"member-…"`). Any project holding an id that no longer matches a
   `team_members.id` locks every non-admin out of it permanently, with the chip
   reading "Claimed" and no name:

   ```sql
   select p.id, p.claimed_by from projects p
   left join team_members t on t.id = p.claimed_by
   where p.claimed_by is not null and t.id is null;
   ```

5. **Nothing reconciles deletions** — see the health-and-cron section above.
6. **`orders.date` and `order_activity.time` are display strings, not ISO**, so
   they still read "Sep 14" while every real date column now reads MM/DD/YYYY.
   Fixing that means changing what is written at ingest.

---

## Process — what cost time today, and what to do instead

**⚠ `npx tsc --noEmit 2>&1 | grep -E "error TS"` inverts the exit code.** `grep`
exits 1 when it finds nothing, so a **clean** typecheck looks like failure and a
**failing** one looks like success. Chained with `&&`, this deployed a broken
commit. Use bare `npx tsc --noEmit` and chain everything with `&&`:

```bash
cd ~/cabinet-orders \
  && python3 ~/patch_x.py . \
  && npx tsc --noEmit \
  && git add <files> \
  && git diff --cached --stat \
  && git commit -m "..." \
  && git push origin main \
  && kamal deploy 2>&1 | tee kamal-deploy.log
```

**⚠ `git diff --cached --stat` before every commit.** The build compiles what is
**committed**; `tsc` on the box checks the **working tree**. A file left
unstaged passed locally and failed the build — twice.

**⚠ Changing a shared signature means `git grep` on the box first.** Auditing
callers in the files you happen to hold is not auditing callers.
`components/OrderEntryActions.tsx` was not in the pulled set, and its call broke
the build.

**⚠ `components/OrderModal.tsx` cannot be typechecked in isolation** without
every component it imports. Three failures today were symbol *availability* in
that file — a prop type too narrow, a `useEffect` referencing a `const` declared
110 lines below it. Be slower about anchor placement there specifically.

**⚠ A patch must not check for the symbol it removes.** One script's
prerequisite looked for `claimOverride` — the very thing it deleted — so its
second run refused its own work. Prerequisite checks should accept either state:
the marker it needs, *or* the marker it leaves behind.

**⚠ Post-condition counts are guesses until measured.** Nearly every patch in
this session failed its own post-conditions on the first run because an
identifier appeared in a doc comment, twice in one condition, or twice on an
import line (`import { X } from "./X"`). That is the check working. Measure,
then set the number — never relax the check to make it pass.

**⚠ Verify the deployed image, every time:**

```bash
HEAD_FULL=$(git rev-parse HEAD)
docker ps --filter label=service=cabinet-orders --format '{{.Image}}' | grep -q "$HEAD_FULL" \
  && echo "DEPLOYED" || echo "MISMATCH"
```

---

## The patch scripts

Changes ship as idempotent Python scripts in `~/`, not as diffs. Each validates
every anchor before writing a byte, writes nothing if any anchor misses, asserts
post-conditions on the result, and reports `ALREADY APPLIED` on a second run.
New components ship whole, with a `shasum -a 256` to check against.

If a script prints `MISS`, the file on the box differs from the copy it was
written against. **Do not hand-edit to make it apply** — send the miss back and
get a corrected script, or the box and the record diverge.

Scripts applied today, in dependency order:

```
patch_delivery_gate_terms.py
patch_next_action_panel.py
patch_custom_no_date_prompt.py
patch_next_action_dates_layout.py
patch_claim_header_full_width.py
patch_claimchip_userid_type.py
patch_split_order_info.py
patch_card_heading_icons.py
patch_override_ack_audit.py
patch_entry_actions_override.py
patch_claim_enforced_server.py
patch_claim_lock_modal.py
patch_webhook_delete_errors.py
patch_claim_lock_table.py
patch_claim_guard_uploads.py
patch_claim_lock_ack_panel.py
patch_gates_from_table.py
patch_auto_advance_and_dates.py
patch_webhook_events_table.py
```

⚠ A prerequisite check keyed on a **CSS class** rather than on an interface once
refused a panel for being *newer*. Check props and exported symbols, not
styling.

---

## Housekeeping

- `pull*.tar.gz` files accumulate in the repo root and end up in every
  `kamal deploy` build context. `mv ~/cabinet-orders/pull*.tar.gz ~/`.
- Commit `c029fc1` carries the wrong message (it holds the dates-and-layout
  change under the custom-prompt commit's message). Left alone — it is pushed,
  and a follow-up commit is safer than rewriting shared history.
