# SESSION HANDOFF — 2026-09-15

Covers work from 2026-09-09 through 2026-09-16. Where a date is given below
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

## ⚠ The standard: no quick fixes

**Neither the OMS nor the storefront is live.** There is no customer to
inconvenience and no pressure to patch around anything, so the right thing is
always to fix the cause. A workaround shipped now is a workaround that outlives
the reason for it — and this codebase already carries the scars of that: a stage
rule written twice, a dead component left in place for a year, a comment about
foreign keys that was wrong and sent an investigation to the wrong table.

What this means concretely, and what it cost when ignored:

- **Delete dead code, do not leave it unrendered.** `DateEditor` and
  `NextActionCard` were both removed rather than orphaned. A guard whose answer
  is always the same, or a component nobody renders, reads as live to the next
  person.
- **Fix the cause, not the symptom.** The webhook logged `removed` while
  deleting nothing; the fix was error checking on every delete, not special-casing
  SHO-1051.
- **Enforce on the server; the UI follows.** A rule that lives only in a
  component is a rule anyone with the API can ignore. Claims were enforced in
  the route BEFORE the buttons were hidden, deliberately and in that order.
- **Correct stale comments in place.** They cost more than missing ones, because
  they are trusted.
- **Say when something is not done.** Three commits today deliberately left a
  hole open — upload routes ungated until their routes enforced it, attachments
  absent from the realtime publication — because a half-enforced rule that looks
  whole is worse than a stated gap.

If a change seems to need a shortcut, that is the signal to ask rather than take
it.

---

## Pulling files

⚠ **Whole files, always.** Every session that worked from a grep or a snippet
lost time to it — including one that changed a shared signature after auditing
only the callers it happened to hold, and broke the build on a file that was
never pulled.

Garrett runs these from Git Bash on Windows, **not** from an ssh session on the
box. Two commands: check the sizes, then pull.

```bash
cd /c/Users/garre/Downloads
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && wc -l PATH [PATH...]"
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && tar -czf - PATH [PATH...]" > pullN.tar.gz
```

Then extract and **check the line counts against the `wc -l` output** before
reading — a truncated extraction reads like a file with something missing.

- **Quote paths containing brackets:** `'app/api/orders/[id]/route.ts'`.
- **Never leave a placeholder** like `YOUR_HOST` in a command. Derive it, or ask.
- **The tarballs land in Downloads, not the repo.** Run from the local shell; a
  redirect typed inside an ssh session writes a broken archive into the repo
  root, where it joins every `kamal deploy` build context.
- **Before changing a shared signature, find every caller ON THE BOX:**
  `git grep -n "functionName(" -- '*.ts' '*.tsx'`. Auditing the files you hold
  is not auditing the callers.

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

**`requireOrderClaim(orderId, session, overrides, action?)` in `lib/auth.ts` is
the single answer.** Four routes call it: PATCH, attachment upload, attachment
delete, acknowledgment upload.

    unclaimed          -> allowed. Claiming is how you take a row, and requiring
                          a claim before any edit would make every first touch a
                          two-step on a queue full of unpicked work.
    claimed by you     -> allowed.
    claimed by another -> 409 `claimed_by_other`.
    ...unless admin    -> allowed, AND recorded for the activity trail.

⚠ **THE OVERRIDE REACHES THE TRAIL ONLY IF THE REQUEST SUCCEEDS** (item 12,
2026-09-16). Originally the guard inserted the row itself, so that four callers
would not each have to remember to — but it did so before the caller had
validated anything, and every refusal or failed write after the guard left a
row for an edit that never happened. It now records the override on a
`ClaimOverrideLog`; `withClaimOverrideLog` wraps each route handler and writes
the row on a 2xx. The guard requires the log and only the wrapper can make one,
so the original property holds at compile time. The `action` parameter is still
the verb, so the trail reads "Acknowledgment submitted by … (admin) while
claimed by another member".

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

### 13. The activity trail arrives live

`order_activity` now publishes and `useRealtimeActivity` appends new entries
into the order they belong to. The store's own comment had named this gap: a row
the server wrote still needed a refetch, so a colleague's stage move, an admin
override or a cron advance reached nobody's open tab.

⚠ **INSERTS ONLY.** Nothing in the app updates or deletes an activity row — it
is append-only by design — so handling those events would imply they can happen.

⚠ **DEDUPED AGAINST THE OPTIMISTIC APPEND**, matched on text AND time. `time` is
a DAY string, so two identical texts on one day collapse to one in the display.
Dropping the optimistic append instead would put a round-trip in front of every
action's feedback.

### 14. The durable docs caught up

`OMS-STATE` and `OPERATIONS` were a week behind, and the worst of it was
describing fixed bugs as known-wrong — a reader budgets time for those.
`OMS-STATE` gained the requirement model's three questions, the closed gates
migration, claim enforcement, the archiving rule, a new §5 for realtime
(Monitoring moved to §6) and `webhook_events`. `OPERATIONS` gained the closed
override inconsistency, the archiving and claim rules in §10, the answered
warranty question in §12, and both 2026-09-15 incidents in §9.

⚠ **A SECOND READ-THROUGH FOUND FOUR THINGS THE FIRST PASS MISSED**, including
one stale since 2026-09-08: `OMS-STATE` still called the loose Entered gate "an
open question in OPERATIONS §12" when §12 had recorded it as decided. Do the
second pass.

⚠ **DATE DISCREPANCY, KNOWN AND LEFT.** The custom decisions read 2026-09-09 in
both docs and in `lib/requirements.ts`; the commit trail dates them 09-10.
Cosmetic, and correcting it means touching deployed code comments.

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
| Warranty claims cannot be raised against custom jobs — **decided by Garrett 2026-09-15** | Our warranty process is a Terms process — the 48-hour window, the conditions precedent, the evidence rules all derive from the checkout agreement a custom customer never accepted. It would also create a claim with no project, which the claim model assumes. The picker already excludes custom, so the behaviour is correct; only the comment saying why is missing. Recorded in OPERATIONS §12. |
| A warranty claim blocks deletion rather than being resolved | The claim is evidence; it should outlive the purchase record, and a person should decide. |
| Admin exemption is server-side and unconditional | The "Edit order" toggle is deliberateness in the UI, not enforcement. An admin acting through the API or a stale tab must still be able to act — and must still be logged. |
| Attachment DELETE gated the same as upload, not more strictly | Removing a signed receipt from another member's claimed row is precisely the crossed-wires case claims exist for. A second, stricter rule is a second thing to keep in sync for no gain. |
| Manual Push, not "Mark delivered anyway" | The stage page has always called it Manual Push. Two names for one action is how somebody concludes there are two. |
| A group-level archive request is refused in both directions | A restore sent for a group is the same second copy of the fact. Accepting it as a harmless no-op would report a success for something that was never allowed. |
| `/api/orders/archive` deleted, not given a refusal | Nothing had called it since the initial commit. A refusal added to a dead route is a guard nobody reaches, and it keeps a path that reads as live. |
| The store undoes one record, not a snapshot of the array | A snapshot taken inside a setState updater is filled in only when React runs the updater, so restoring it undoes other rows' changes that landed meanwhile, or blanks the board if the refusal beats the render. `moveStage` and `updateTeamMember` both did (item 10). |
| Undone fields are derived from the optimistic update, not listed | A hand-kept list of what `moveStage` writes is a second copy of the update; the first field added to one and not the other would stop being reverted with no error. |
| The admin-override row is written by a wrapper on 2xx, not by the guard | The guard wrote it before callers validated anything. Moving refusals above the guard relies on four routes keeping their order right and does nothing for failed writes. A required log that only the wrapper can create keeps "nobody has to remember" at compile time. |
| The override row follows the edit's own rows | It is written after the handler returns. On the trail it now comes after what it describes, which reads naturally; before, it preceded an edit that might not happen. |
| Payment status and its acknowledgement resolve through the project | Money lives on the project by design. Refreshing both copies on every update was the alternative, and it keeps the duplicate this whole session removed. |
| The client resolves payment once, in the store | Same reason archived purchases are hidden there once: the pill, the banner and the work queue each resolving "whose status" would be three copies of one rule. |
| The overnight run honours the refund hold | §10 is a business rule, not a route rule. A refunded order advanced overnight pushes a stage to Shopify; one waiting In production needs a person, which is correct. |
| The group copy is removed in a second commit | That change nulls data and adds a constraint, which needs its own verification, and it is only safe once nothing reads the copy — which the first commit makes true. |
| The payment constraint covers all three fields | A status and its acknowledgement are one fact. An acknowledgement left on a group would compare against a status that lives somewhere else. |
| The code is deployed before the migration runs | Until the webhook stops writing the group copy, the constraint fails every group update and every new checkout's group insert. Demonstrated against PostgreSQL. |
| The archiving constraint shipped with the payment one | Same table, same form, same migration — and the routes' refusal alone left every other writer able to recreate the SHO-1052 state. |
| `archived_at` is cleared on restore | It then means "non-null exactly while archived", which is one fact rather than two that can disagree. When something was archived previously is in the activity trail. |
| This migration runs BEFORE its deploy | The reverse of the payment one: the code writes the column, so the column has to exist first. A column nothing writes yet changes nothing. |
| The archive is its own section, not part of the projects hub | The projects hub is where active work lives. History that is browsed and restored is a different job, and mixing them makes one screen answer two questions. |
| The archived modal disables the stage rail rather than removing it | The rail is the answer to "where did this stop", not only a control. Removing it would take the information out with the action. |
| The archive is one line per purchase, not per group | A customer bought one thing; the groups exist so the backend can track parts that move at different speeds. History is the customer's view, and restoring one part was never possible anyway. |
| The archive gets its own table, not OrderTable | OrderTable renders order rows with claim chips and stage actions. An archive line is a purchase with its parts, and it offers exactly one action. |
| An archived row accepts exactly one request: its own restore | A whitelist of editable fields would grow with every new field and fail open on the one somebody forgot. "Nothing but the way out" cannot drift. |
| Deleting an archived row is refused too | The archive is the record of work that happened, and delete is the most final edit of all. Restore, then delete: two deliberate steps instead of one irreversible one. |
| `.kamal/secrets` stays tracked, and stays a loader | It holds no values, and tracking it is what recovered the 2026-08-03 config damage. Untracking it removed a safety net to solve a problem that did not exist. |
| The registry credential stays a classic PAT for now | GHCR's support for fine-grained tokens is unreliable, and a failed deploy is the wrong moment to discover that. Moving the build to Actions is the real answer and deserves its own decision. |
| `kamal secrets print` before any deploy that follows a secrets change | Both of 2026-09-16's failed deploys would have been caught by it: one name reading EMPTY, in a list of twenty. |

---

## Open — not done, deliberately

0. ✅ **PROJECTS HOLD THE TRUTH FOR ARCHIVING — decided 2026-09-15, deployed 2026-09-16 as `76115c7`.**

   `app/api/projects/[id]/route.ts` already documents this: "The GROUPS ARE NOT
   TOUCHED. `orders.archived` stays false on project-linked rows; a group is
   hidden because its project is archived... Writing both would be two copies of
   one fact." It was right, and until this was built nothing enforced it —
   `PATCH /api/orders/[id]` with `{archived: true}` set the duplicate flag on
   a project-linked row happily, and `/api/orders/bulk` did too.

   That is how SHO-1052 vanished: the project was archived AND the groups were
   archived individually. Restoring the project cleared the only flag that route
   owns, both groups kept `archived = true`, and the order stayed invisible in
   cabinet orders while showing in the projects hub. Fixed by hand:
   `update orders set archived = false where project_id = 'SHO-1052';`

   **Garrett's rule:** a project is the unit of archiving. Archive the project
   and both groups go with it; restore the project and both come back. It should
   not be possible to archive one group of a purchase on its own.

   The change:
   - `PATCH /api/orders/[id]` refuses `archived` when `project_id` is set, and
     says to use the project endpoint. Standalone rows — custom jobs, warranty
     claims, which have no project — keep order-level archiving.
   - `/api/orders/bulk` archive action: same refusal, or it is the bypass.
   - The Archive / Restore controls in `OrderModal` and `OrderTable` stop
     offering it for project-linked rows.

   ⚠ **RULE 3 IS ALREADY DONE.** "Block archiving until every part is in its
   last stage" is enforced in the projects route today: it refuses with
   `not_complete` and names the unfinished groups by id and stage, unless the
   project is refunded. Do not rebuild it.

   **Built** (`patch_archive_project_truth.py`):
   - `PATCH /api/orders/[id]` refuses `archived` in either direction on a
     project-linked row — 422 `archived_not_allowed`, naming the project —
     and refuses a non-boolean `archived` on any row. Above the claim guard,
     which at the time also kept it from leaving a phantom admin-override row;
     item 12 has since made that placement irrelevant to the trail.
   - `/api/orders/bulk` refuses each project-linked row first, before the
     permission and no-op checks, in the route's existing per-row shape.
   - `/api/orders/archive` **deleted**. `SECURITY.md`, the only thing that
     named it, is marked as a historical record.
   - `archivesAsOrder` in `lib/data` is the one client question. The modal
     button, the table's Delivered action and the bulk bar ask it; the modal
     button also requires `canEdit`, matching the table. A bulk selection
     with no applicable action says why instead of showing an empty bar.
   - The store's `archiveOrder`/`unarchiveOrder` revert a refusal on the one
     row and return it, and every caller toasts it. They used to discard it.
     The modal now waits for the answer before closing.
   - Two stale comments in `lib/data.ts` on the fields the rule keys on:
     `project_id` is null for custom jobs too, and order-level archiving
     covers warranty claims too.

   **Proved by enumeration**, compiling the real files before and after with
   identical stubs, under React 19:
   - PATCH: 960 cases. 480 identical; the other 480 are exactly the requests
     carrying `archived` on a project-linked row or a non-boolean `archived`,
     each now a 422 with no write. Before, a project-linked request wrote
     `orders.archived` unless a member ran into somebody else's claim, and an
     admin acting over a claim left an override row on the trail as well.
   - Bulk: 12 requests over 49 ids, each identical to "before, with every
     project-linked row refused and its write and activity row removed".
   - OrderTable: 1,656 renders. 1,592 identical; 64 lose only Archive Order,
     all on project-linked rows.
   - OrderModal: 644 renders. 90 lose the archive button — 70 project-linked,
     20 claim-locked with Edit order off. Every other button identical.
   - BulkActionBar: 60 renders, all as specified.
   - Store: 80 scenarios — success, 409, 422, non-JSON 500, network failure,
     with and without a queued or concurrent realtime write. Same request
     byte for byte; success identical; every failure undone exactly.

   **Not built:** a database constraint (item 11).


1. **`order_attachments` does not publish over realtime.** `order_activity`
   now does (see below). Attachments are harder: the store holds no attachment
   state and `AttachmentsPanel` fetches its own list per modal, so a change
   event has two consumers and nowhere to merge into. **Follow
   `lib/ackStatus.ts`** — module-level cache, per-order subscriber sets, an
   `invalidate` that refetches and notifies every mounted view. Then the client
   change, then the publication. Adding the table alone broadcasts to nobody and
   looks like a fix.
2. **Rail timestamps** (mockup 2) need a real per-transition time. The activity
   trail's `time` is a display string — `"Aug 24"`, no clock time. Either the
   PATCH route starts writing a real timestamp per transition (better, and
   useful beyond the rail) or the rail shows dates only. Deferred by Garrett.
3. **The warranty-vs-custom exclusion is not documented in the picker.**
   Decided and recorded in OPERATIONS §12; the picker's own comment is still
   missing, and an unexplained exclusion reads as an oversight.
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
7. **`fieldsToClearOnBackwardMove` is the last consumer not deriving from
   `lib/requirements`.** The PATCH gates were migrated 2026-09-15; this one was
   left because it is a behaviour change rather than a refactor — what a
   backward move clears is a decision, not a restatement of what a stage needs.
   Argue it on its own, and enumerate before and after like the gates were.
8. **Mockup parity is not finished.** Two structural differences remain between
   the deployed modal and the mockups: Next Action is a cell in a strip rather
   than a full-width band under the rail, and the mockup repeats the primary
   action in a sticky footer. Both are changes to the Overview's layout rather
   than to any panel, so they want their own commit. Everything else from the
   mockups — the split row, the card badges, the type scale, the control
   sizing, the claim chip — is done.
9. **`~/cron-jobs/cron.log` holds 196 non-zero `rc` runs and nobody has looked
   at how many are recent.** Most will be the 64-day outage and the six-day
   monitoring failure, both long closed. Worth one pass to confirm nothing is
   failing now:

   ```bash
   grep -E "rc=(22|[1-9])" ~/cron-jobs/cron.log | tail -10
   grep "2026-09" ~/cron-jobs/cron.log | grep -cE "rc=(22|[1-9])"
   ```

   Zero on the second command means it is all history.
10. ✅ **`moveStage` restored a stale snapshot on a refusal — fixed 2026-09-16.**
    ⚠ **CORRECTED.** This item first said a refused move empties every list
    until a reload. That was measured with the refusal arriving before React
    rendered, which a real network does not do. Re-tested under real
    scheduling, against the real `lib/store.tsx` under React 19, the defect
    was three things:
    - **The backward-move clearing never mirrored** on a store that had
      updated recently. `moveStage` looked its row up in a snapshot taken
      inside a setState updater, which React had not run yet, so it was
      still `[]`. 180 of 1,044 such scenarios produced a different optimistic
      row from the one the code intended — every one a backward move on a
      flow that clears.
    - **A refusal undid other rows' changes.** By the time the answer came
      back the updater had run, so the snapshot was the array as of that
      render; restoring it reverted anything that landed while the request
      was out, a colleague's realtime edit included. 464 of 464 scenarios
      with a concurrent write.
    - **Only if the refusal beat React's next render** did it restore `[]`.
    `updateTeamMember` had the same shape. Both now undo one record, field by
    field (`undoFields`), and `moveStage` computes its clearing inside the
    updater, from the row as it actually is (`patch_store_revert_one_record.py`).
    **Proved** over 2,088 `moveStage` scenarios — every type, every from/to
    pair in its flow, five server answers, a clean and a recently-updated
    store, with and without a concurrent write — and 30 `updateTeamMember`
    scenarios: requests and results identical; the optimistic row equal to
    the old code's whenever its snapshot worked; success identical; every
    refusal undone to the exact prior record, with concurrent writes left
    standing.
11. ✅ **The database backs the archiving rule — 2026-09-16.**
    `orders_archived_standalone_only CHECK ((archived = false) OR (project_id IS NULL))`,
    the same form as `orders_total_price_standalone_only`, added by the item 19
    migration. The route checks stay, so a caller gets a 422 that explains
    itself rather than a 500 naming a constraint.
12. ✅ **Phantom admin-override rows — fixed 2026-09-16.** `requireOrderClaim`
    wrote "… by X (admin) while claimed by another member" before the caller
    validated anything. Not just PATCH: all four callers could stop after it —
    PATCH with eleven refusals and a failed update, attachment upload with a
    failed storage write or row insert, attachment delete with a failed
    delete, acknowledgment upload with a failed insert.

    **Option A — move the refusals above the guard — was rejected.** Eleven
    reordered blocks in PATCH, each route keeping its order right forever; a
    member on somebody else's claim told to fix the tracking number before
    being told the row is claimed; and nothing for the failed writes.

    **Built (option B, `patch_claim_override_on_success.py`):** the guard
    records the override on a `ClaimOverrideLog` and `withClaimOverrideLog`,
    wrapping each of the four handlers, writes it only on a 2xx. The guard
    requires the log and only the wrapper creates one, so an unwrapped caller
    fails `tsc` — verified: restoring one route's old call in a patched tree
    gives TS2345.

    **Proved by enumeration** over all four routes, real route files and
    `lib/auth.ts`, before and after, 432 cases (admin and member × unclaimed,
    own and other's claim × project-linked and standalone × every outcome the
    stubs reach): responses identical in every case; writes identical except
    40 phantom override rows removed from failed requests and 24 override rows
    moved to after the edit's own writes on success. PATCH outcomes exercised
    for an admin over a claim: success, invalid stage, `stage_not_in_flow`,
    `admin_pin_required`, `payment_hold`, `total_price_not_allowed`, a bad
    total and a failed update. The attachment, production-date, tracking and
    delivery-proof gates were not reachable through the stubs; the wrapper
    keys on the response status, not on which refusal produced it.
13. ✅ **`/orders/archived` and the table's archive branches are gone —
    2026-09-16** (`patch_delete_archive_mode.py`, item 20 step 3b). The slug
    opened the cabinets hub in archive mode, and a cabinet group cannot be
    archived on its own, so it could never list a row. Removed with it:
    `ResolvedSlug.archive`, the hub's `archive` prop and its nine branches, and
    OrderTable's `"Archived"` branches — the Restore button, the status label,
    the hidden column, its colSpan arithmetic and the stage colour — plus the
    restore wrapper in `useRowActions` and the icon import it used.
14. ✅ **Dead code and stale text — cleared 2026-09-16**
    (`patch_dead_code_and_stale_comments.py`).
    - `app/sla/SLAClient.tsx`: `StageAgingRow`, `OverdueStageBlock`,
      `OverdueRow` and `BarRow` deleted — 384 lines that nothing rendered and
      nothing could, since none was exported — along with the `archiveOrder`
      and `moveStage` destructures and the five imports only they used. ⚠ The
      SLA page's "Archive" button lived in there, and a search for archive
      controls on 2026-09-16 counted this page as a live surface because of it.
      Dead code answers searches.
    - `app/api/orders/bulk/route.ts`: the foreign-key comment was wrong. **Read
      from the database 2026-09-16:** `damage_reports`,
      `order_acknowledgments`, `order_activity` and `order_attachments` all
      CASCADE from `orders`; the only NO ACTION edges are
      `orders.about_order_id -> orders` (a warranty claim blocks deleting the
      order it is about) and `orders.project_id -> projects`. The child deletes
      stay: they are what makes a failure reportable per row.
    - `components/BulkActionBar.tsx`: the delete warning said a job's project
      goes too. A custom job has no project; it now names what actually goes.

    **Proved by rendering:** the SLA page and the bulk bar, before and after,
    identical in every case (the bulk bar with the warning text normalised).

    What it replaced, for the record:
    - `app/sla/SLAClient.tsx`: `OverdueStageBlock`, `OverdueRow`,
      `StageAgingRow` and `BarRow` are defined and never rendered, and
      `archiveOrder` and `moveStage` are destructured and never used. The SLA
      page's Archive button lives in that dead code.
    - `app/api/orders/bulk/route.ts:244` says every child foreign key is
      `NO ACTION` (verified 2026-08-20). §9 of this file says they are all
      `CASCADE` now — the same stale comment that sent SHO-1051 to the wrong
      table.
    - `components/BulkActionBar.tsx:232` warns that deleting a custom job also
      removes its project. Custom jobs have no project.
15. **`/api/shopify/orders` inserts cabinet rows with no project.** Called
    from `app/admin/shopify/page.tsx:69`, which was not read. It writes one
    `type: "order"` row per Shopify order and no `project_id` — the shape from
    before projects existed — and the archiving rule would treat such a row
    as standalone. None exist: on 2026-09-15 `orders` held three rows, one
    custom job, one cabinet group and one sample group, each linked as the
    model says. Whether OPERATIONS §12's historic backfill runs through this
    importer is unverified.
16. ✅ **The overnight production run ignored the purchase — fixed 2026-09-16
    (commit 1 of 2).** `production-complete` and `productionAutoAdvance` read
    only the group's own `archived`, always false on a project-linked row, and
    neither read the refund hold at all — a refund blocks forward movement
    (OPERATIONS §10) and the cron is a forward move that pushes a stage to
    Shopify. Investigating it found that every hold check read the GROUP's copy
    of `payment_status`, and the acknowledgement was stored per group.

    ⚠ **THE HOLD WAS NOT DEAD, as was first believed.** The `orders/updated`
    handler writes `payment_status` onto every group as well as the project
    (webhook lines 889–946). Confirmed live on 2026-09-16: a note edited in
    Shopify reached both SHO-1052 groups and the project in one event, and a
    group row set to `refunded` by hand returned `409 payment_hold`. The real
    defects were two copies kept equal by two unchecked writes, a per-group
    acknowledgement, and a cron that read neither the hold nor the project.

    **Built** (`patch_payment_through_project.py`): `paymentRecordOf` in
    `lib/data` resolves payment through the project. PATCH reads the project and
    writes the acknowledgement there, refusing with `purchase_unavailable`
    (named `payment_status_unavailable` until step 2 of item 20)
    if the project cannot be read. The store resolves every row once, so the
    refund banner, the work queue and the payment pill follow.
    `productionAutoAdvanceSkip` is the one rule the cron and the modal's promise
    share: refunded, archived or unreadable purchases are not advanced, and the
    cron reports what it skipped. No group-level acknowledgements existed, so
    there was no data to lift.

    **Proved by enumeration**, real files before and after: PATCH 192 cases —
    standalone identical; project-linked identical to the old route with the
    group copy set equal to the project's, the acknowledgement written to the
    project instead; an unreadable project refused with nothing written. Cron
    over 469 rows — exactly the old advanced set minus 115 skips (42 payment
    hold, 72 archived purchase, 1 missing project), and nothing advanced when
    the projects cannot be read. `productionAutoAdvance` 2,736 cases; the work
    queue's hold reason 78 cases; the real store resolving rows, hiding archived
    purchases and keeping row identity as before.

    **Not in this commit:** `teams-digest` still counts the groups of archived
    purchases (inert while `TEAMS_WEBHOOK_URL` is empty), and the group copy
    itself — item 19.
17. ✅ **The team page announced writes it had not waited for — fixed
    2026-09-16** (`patch_activity_dates_and_team_results.py`). Four buttons,
    not one: Reactivate, Delete, and Deactivate/Delete on the active list. Two
    of them had nothing to wait FOR — `deactivateTeamMember` and
    `deleteTeamMember` applied their change locally and discarded the server's
    answer, the same shape as the archive pair before item 10. Both now undo a
    refusal and return `{ ok, error }`; delete puts the member back at its old
    position, since there is no row left to mend. All four buttons wait, then
    say what actually happened. **Proved:** four store scenarios — success
    leaves the state exactly as before and returns `{ ok: true }`; a refusal is
    undone and reported, where the old code left the change standing.
18. ✅ **Activity rows are dated in Phoenix — fixed 2026-09-16.**
    `activityDate()` in `lib/data` is the one expression. Four writers lacked a
    timezone: the PATCH route, the claim-override row, the warranty route and
    the client's optimistic label. **Proved** at every hour of four dates
    including two month ends: `2026-09-17T00:30Z` is Sep 16 in Phoenix, and
    `2026-10-01T02:00Z` is Sep 30 — both of which the old code dated a day
    later. ⚠ **Eleven other writers still spell the option out inline.** They
    are correct, so this patch left the webhook and the crons alone; adopt the
    helper as each is next edited. ⚠ **Rows already written keep their date** —
    a row dated tomorrow cannot be told from one written tomorrow.
19. ✅ **The group copy of the payment fields is gone — 2026-09-16 (item 16,
    commit 2).** `patch_payment_group_copy_removed.py`: the webhook stops
    writing `payment_status` onto groups, at ingest and on `orders/updated`;
    `backfill-payment-status` walks and writes projects (a project-less
    Shopify row, item 15's shape, is no longer backfilled); and
    `migrations/2026-09-16-orders-standalone-payment-and-archive.sql` blanks the
    three payment fields on project-linked rows and adds
    `orders_payment_standalone_only` and `orders_archived_standalone_only`, in
    one transaction. The columns stay for custom jobs and warranty claims.

    ⚠ **CODE FIRST, THEN THE MIGRATION.** While the webhook still writes the
    group copy, the constraint makes every group update fail — notes, SKUs,
    tracking — and a new checkout's group insert fail and take its project
    with it. Checked beforehand: no trigger or function touches these columns
    (only `orders_updated_at` and `trg_orders_bump_stage_entered_at` exist), 2
    group rows carried a status, none an acknowledgement, none `archived`.

    **Proved against real PostgreSQL**, running the migration file verbatim on
    production-shaped data: the group copy blanked and standalone rows
    untouched; a second run changes nothing; afterwards the OLD webhook's group
    update and insert are refused by `orders_payment_standalone_only` while the
    NEW ones succeed; an acknowledgement on a group is refused and on a
    standalone row accepted; archiving a group is refused, restoring one and
    archiving a standalone row accepted; a stage move still runs its trigger.
    With a project-linked archived row present, the migration fails and the
    blanking rolls back with it — all or nothing. The backfill route, run
    before and after against a recording database, moved from writing a group
    and a project-less row to writing only projects.
20. **The Archive as its own section** (decided 2026-09-16, in progress). The
    projects hub is an ACTIVE-work hub; the archive is history and belongs
    somewhere else. Four tabs — All, Shopify Orders, Custom Orders, Warranty
    Orders — one line per archived PURCHASE showing its parts and the stage
    each stopped at, and one line per archived custom job or warranty claim.
    Restore puts a whole purchase back, at the stages its parts were already
    at; archiving never moved a stage, so this is the existing behaviour, not a
    new rule. An archived row opens a STRIPPED-DOWN modal: details, activity
    and attachments, no controls.

    Why a new table rather than OrderTable: that component renders order rows
    with claim chips and stage actions, and an archive line is a purchase with
    its parts. Item 13's deletion — the dead `/orders/archived` slug, the hub's
    `archive` prop and OrderTable's `"Archived"` branches — happens as part of
    this rather than on its own.

    Steps, each its own commit:
    1. ✅ `archived_at` (`patch_archived_at.py`, 2026-09-16) — the archive
       sorts by when something went in, which nothing recorded.
    2. ✅ **An archived row is read-only, on the server**
       (`patch_archived_read_only.py`, 2026-09-16). `lib/archived.ts` answers
       "archived on its own, or through its purchase", and six write paths ask
       it: PATCH, DELETE, the bulk delete path, both attachment routes and the
       acknowledgment upload, each refusing with 409 `archived_read_only`. The
       one request an archived row accepts is its own restore — PATCH
       `{archived: false}` and nothing else, on a standalone row. A group whose
       purchase is archived is refused even that; the projects route restores
       the purchase. The webhook and the crons never come through these routes,
       so Shopify's updates for an archived purchase keep landing.

       **Proved by enumeration**, 52 cases over the six routes before and
       after: 35 identical when nothing is archived, 17 newly refused, none
       unexpected. Restore still works; a restore carrying any other field does
       not; bulk archive and restore are untouched while bulk delete refuses
       and still writes its audit row; on a project-linked group the archiving
       rule answers first with its better message.

       ⚠ **One contract change:** PATCH now reads the purchase ONCE, at the top,
       for both this rule and the payment hold, and an unreadable purchase is
       refused there — 500 `purchase_unavailable`, renamed from
       `payment_status_unavailable` in item 16 and now raised before the
       ownership gate rather than after it.
    3. ✅ **The section itself** (`patch_archive_section.py`, 2026-09-16).
       `/archive` with the four tabs, one line per archived purchase showing its
       parts and the stage each stopped at, one per archived standalone row,
       newest first by `archived_at`. Restore per line: a purchase through the
       projects route, a standalone row through PATCH. The Sidebar points here
       and its count now includes warranty claims. The projects hub's Archived
       filter is gone — ⚠ **it was broken**: `groupsByProject` is built from
       `allOrders`, which hides the groups of an archived purchase, so that
       filter listed purchases with ZERO parts. Nothing had been archived until
       today, so nobody had seen it. The hub's control is archive-only now,
       since a restore branch there could not be reached.

       **Proved by rendering**: the archive lists exactly the archived things,
       newest first with the undated last, tabs count and filter, a purchase
       line shows its parts, and Restore calls `archiveProject(id, false)` for a
       purchase and `unarchiveOrder(id)` for a standalone row. The projects hub
       before and after: every other filter identical, Archived gone.
    3b. ✅ **The deletions** (item 13, `patch_delete_archive_mode.py`,
       2026-09-16). **Proved by enumeration:** 224 OrderTable renders over every
       type, every reachable stage, archived and not, select mode on and off,
       empty and populated — all byte-identical to before. `/orders/archived`
       now resolves to null, so the route 404s; every surviving slug resolves to
       the same type and stage it did.
    4a. ✅ **The panels take a `readOnly` prop** (`patch_panels_read_only.py`,
       2026-09-16). `AttachmentsPanel`, `AcknowledgmentPanel` and
       `DamageReportPanel` each carry their own write controls, so gating them
       from the modal alone would leave a button alive one file deeper.
       Defaults to false, so nothing changes until 4b passes it.
       `OrderDetails` already had the prop.

       In `readOnly`: attachments keep the list, the names, the sizes and
       Download, and lose upload, receipt upload, the drop zone and delete;
       damage reports keep the list and expansion and lose Report damage and
       the status buttons; the acknowledgment folds into the `canAct` gate it
       already had, which covers submit, resubmit and Manual Push in one
       answer. **Proved by rendering:** the default renders are identical to
       before, and in `readOnly` the attachments panel keeps exactly one
       control — Download — and no inputs at all. The acknowledgment panel's
       fold is typechecked rather than rendered; its gate is the existing one.
    4b. ✅ **The modal itself** (`patch_modal_read_only.py`, 2026-09-16).
       `archivedVia` moved to `lib/data` and `lib/archived.ts` re-exports it, so
       the modal hides precisely what the six routes refuse. Every write control
       is gone; the stage rail stays **disabled** because it is how you read
       where the work stopped, and notes and tracking stay as read-only fields.
       The header gains "Handled by …" and "Archived <date> · restore to make
       changes".

       **Proved by enumeration**, 144 renders over type × stage × admin × claim
       state × archived-by-row / by-purchase / not-archived: the 48 live renders
       are identical to before, and in all 96 archived renders NO enabled
       control matches a write verb, NO input is editable, and the header says
       both facts. What survives is the tab bar, the disabled rail, the three
       pane toggles and Close.
21. **The registry token expires, and the deploy path around it is easy to
    break.** It went on 2026-09-16, the second time after 2026-08-18, and
    `kamal deploy` failed at `docker login` with `denied: denied` — nothing
    built, nothing pushed, production untouched. Written up in OPERATIONS §5
    (the loader section) and §9. What is still open:
    - **Record the new token's expiry** somewhere with a reminder. This is the
      second time it has been found by a failed deploy.
    - **Or move the image build into GitHub Actions** with the automatic
      `GITHUB_TOKEN`, leaving the box to pull only. That removes the write
      credential from the box, and it is a real change to the pipeline:
      builds stop happening on the box. Its own decision, not a deploy-day fix.
    - ⚠ **`.kamal/secrets` is a loader and is tracked deliberately.** It holds
      no values, on any commit. It was untracked that evening on a mistaken
      reading and restored the same evening; the file's own `.gitignore`
      comment already said to keep it.

---

## Process — what cost time today, and what to do instead

**⚠ A DELETION NEEDS A MARK, or the patch script thinks it is already applied.**
These scripts decide state per edit: `new` present once means applied, `old`
present once means pending. That works for an insertion, where `new` contains
`old`. It is wrong for a DELETION, where `new` is a SUBSET of `old` — the
replacement text is already in the file before the edit runs, so the script
reports PARTIAL and refuses. An empty `new` is worse: `count("")` is the length
of the file, so the edit looks applied every time. Both bit on 2026-09-16.
**Give every deletion a short comment saying what went and when.** It makes the
replacement unique, and it leaves the reason where the code used to be.

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

**⚠ Verify the deployed image, every time — from inside the repo:**

```bash
cd ~/cabinet-orders \
  && HEAD_FULL=$(git rev-parse HEAD) \
  && test -n "$HEAD_FULL" \
  && git log -1 --format='HEAD %H %s' \
  && docker ps --filter label=service=cabinet-orders --format 'IMAGE {{.Image}}' \
  && docker ps --filter label=service=cabinet-orders --format '{{.Image}}' | grep -qF "$HEAD_FULL" \
  && echo "DEPLOYED" || echo "MISMATCH (or a step above failed)"
```

⚠ **AN EMPTY HEAD PASSED THE OLD CHECK.** Run outside the repo, `git
rev-parse` fails, `HEAD_FULL` is empty, and `grep -q ""` matches every line: on
2026-09-16 it printed DEPLOYED while the running image was five commits behind
and nothing had been deployed. `test -n` refuses the empty value, and the printed
HEAD and IMAGE lines let a person see what was compared.

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
patch_realtime_activity.py
patch_docs_2026_09_15.py
patch_archive_project_truth.py
patch_docs_archive_enforced.py
patch_store_revert_one_record.py
patch_docs_store_revert.py
patch_claim_override_on_success.py
patch_docs_claim_override.py
patch_payment_through_project.py
patch_docs_payment_through_project.py
patch_payment_group_copy_removed.py
patch_docs_payment_group_copy_removed.py
patch_archived_at.py
patch_docs_archived_at.py
patch_docs_registry_and_loader.py
patch_archived_read_only.py
patch_docs_archived_read_only.py
patch_archive_section.py
patch_docs_archive_section.py
patch_panels_read_only.py
patch_docs_panels_read_only.py
patch_modal_read_only.py
patch_docs_modal_read_only.py
patch_delete_archive_mode.py
patch_docs_delete_archive_mode.py
patch_dead_code_and_stale_comments.py
patch_docs_dead_code.py
patch_activity_dates_and_team_results.py
patch_docs_dates_and_team.py
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
