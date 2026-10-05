# SESSION HANDOFF — 2026-09-15

Covers work from 2026-09-09 through 2026-09-30. Where a date is given below
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
reading — a truncated extraction reads like a file with something missing. One
command that does all of it and says so:

```bash
cd /c/Users/garre/Downloads
P="components/OrderModal.tsx lib/data.ts"      # quote bracket paths
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && git log -1 --format='%H %s' && wc -l $P" > pull.remote-wc.txt \
  && ssh garrett@5.78.220.153 "cd ~/cabinet-orders && tar -czf - $P" > pull.tar.gz \
  && mkdir pull && tar -xzf pull.tar.gz -C pull \
  && (cd pull && eval "wc -l $P") > pull.local-wc.txt \
  && echo "PULLED — compare the two wc files"
```

The `git log -1` in the first line matters as much as the counts: it says WHICH
COMMIT the copy is of, and a patch written against a stale copy is the failure
this whole procedure exists to prevent.

⚠ **A grep is not a pull.** On 2026-09-24 a pattern of mine matched
`address_line` inside `address_line1`, reported a field as missing, and the
website team renamed a field on the strength of it. The field had been there all
along.

- **Quote paths containing brackets:** `'app/api/orders/[id]/route.ts'`.
- **Never leave a placeholder** like `YOUR_HOST` in a command. Derive it, or ask.
- **The tarballs land in Downloads, not the repo.** Run from the local shell; a
  redirect typed inside an ssh session writes a broken archive into the repo
  root, where it joins every `kamal deploy` build context.
- **Before changing a shared signature, find every caller ON THE BOX:**
  `git grep -n "functionName(" -- '*.ts' '*.tsx'`. Auditing the files you hold
  is not auditing the callers.

---

## Deploying

Every change goes the same way, and each step exists because a previous one was
skipped.

**1. Verify the script, both ends.** Hashes are computed by whoever wrote the
script, in the same step that published it — never quoted from memory:

```bash
cd /c/Users/garre/Downloads \
  && echo "<sha256>  patch_x.py" | sha256sum -c - \
  && scp patch_x.py garrett@5.78.220.153: \
  && ssh garrett@5.78.220.153 "echo '<sha256>  patch_x.py' | sha256sum -c -"
```

**2. Apply, typecheck, commit, deploy — one chain, `&&` throughout** so a
failure stops it:

```bash
cd ~/cabinet-orders \
  && test -z "$(git status --short)" \
  && python3 ~/patch_x.py . \
  && python3 ~/patch_docs_x.py . \
  && npx tsc --noEmit \
  && git add <the files the patch names> \
  && git diff --cached --stat \
  && git commit -m "..." \
  && git push origin main \
  && kamal deploy 2>&1 | tee kamal-deploy.log
```

⚠ **The scripts write before `tsc` runs.** A failed typecheck leaves the tree
modified; `git checkout -- <files>` is the undo. Do not hand-edit to make it
compile.

⚠ **Never `npx tsc --noEmit 2>&1 | grep "error TS"`.** `grep` exits 1 on no
match, so a clean typecheck looks like a failure and a failing one looks clean.
That inversion deployed a broken commit once already.

**3. Verify the deploy — the image tag IS the commit:**

```bash
cd ~/cabinet-orders \
  && HEAD_FULL=$(git rev-parse HEAD) \
  && git log -1 --format='HEAD %H %s' \
  && docker ps --filter label=service=cabinet-orders --format 'IMAGE {{.Image}}' \
  && docker ps --filter label=service=cabinet-orders --format '{{.Image}}' | grep -qF "$HEAD_FULL" \
  && echo "DEPLOYED" || echo "MISMATCH"
```

**4. Migrations run in Supabase by hand, and are verified by LISTING what they
made.** ⚠ "Success. No rows returned" is what the SQL editor says for a
statement that changed something, a statement that changed nothing, and a SELECT
that matched nothing. On 2026-09-16 a constraint migration reported it and had
added nothing; only the listing query showed that. A migration whose columns the
new code writes runs BEFORE the deploy.

⚠ **Run the deploy inside `tmux`** (`tmux new -As deploy`) if the connection is
unreliable: a dropped ssh session kills `kamal deploy` mid-run and leaves the
deploy lock held (`kamal lock release`).

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

⚠ **IT DID NOT WORK IN PRODUCTION UNTIL 2026-09-30.** Publishing the table was
checked; being able to READ it was not. Realtime delivers a row only to a role
that may SELECT it, and `order_activity`'s only policy, `no_direct_access`,
refuses everyone — so no browser received a single trail row. Only stage moves
and archiving add their row locally; every other row — notes, dates, claims,
overrides, a colleague's anything — waited for a refresh, which came to look
normal. Questioned when a room save's row needed one. Fixed by
`authenticated_read_all_activity`, SELECT only; see OMS-STATE §5.

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
| `archived_at` is tied to `archived` by a CHECK, both tables | The Archive section sorts on the date and shows "—" for a missing one. With the constraint, a missing date can only mean "not archived", never "archived by a path that forgot". |
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
| Specs save one room at a time, through a database function (2026-09-30) | Every property of the whole-document save was proven wrong against the real panel. The merge and the unlink must be one transaction, and PostgREST has none; a function is the only place they can be one. |
| A revision per ROOM, inside the document | `updated_at` moves on any edit to the row; a document-wide counter makes Kitchen conflict with Bath. |
| `custom_specs` is v2 | Adding `rev` changes the shape, and a reader must not infer a shape from its keys. A stale tab shows no specs until reload and cannot save — accepted: one designer per custom job (Garrett). |
| PATCH refuses `custom_specs`; it does not ignore it | Ignoring it answers 200 to an old tab for a save that never happened. |
| An unreadable document is refused and named, never emptied | Emptying is what the old route did, silently. The migration names every such row and writes nothing. |
| Archived custom jobs are converted too | Read-only is about human edits; a v1 row left behind would violate the CHECK forever (Garrett, 2026-09-30). |
| The validator is `service_role`-only | A role without EXECUTE on a CHECK's function cannot write ANY row. RLS lets only `service_role` and the owner write `orders`, so nothing else needs it — and it stays off `/rpc`. |
| Rooms capped at 100, style groups at 50 | The uncapped validator was quadratic: 3.2 s of CPU at 8,000 rooms. |
| A refusal keeps the draft; a conflict replaces it | A network or claim refusal changed nothing, so the typing stays, marked unsaved. A conflict means someone else's version is the truth. |
| The specs panel is keyed by the job | It held drafts from mount; a re-pointed modal would have saved one job's rooms onto another. Latent today, closed anyway. |
| `order_activity` readable by `authenticated`, read-only (2026-09-30) | Realtime delivers only what the subscriber's role may read. `authenticated` is a signed-in session's 30-minute token and already reads all of `orders`; the trail is about those orders. Writes stay refused by `no_direct_access`. |
| One shared list of an order's files, every request ticketed (2026-09-30) | Two views that fetch for themselves disagree after any change, and step 4 adds a third. Only the newest ticket writes, so a slow answer cannot undo a change it predates — `ackStatus`'s way of doing it is proven to. |
| A view mounting refetches the list | Attachments do not publish over realtime. A cache kept until invalidated would never show a colleague's upload, not even on reopening. |
| Gates ask the server, not the shared list | A gate is a point-in-time check; a cache can be a second out of date. The server re-checks anyway. |
| Receipt offered only where `lib/requirements` asks for one | Only a cabinet group needs a signed receipt. The button on a custom job was a demand nothing enforces, which the custom rule forbids. |
| The attachments panel is read-only on somebody else's claim | Every other panel already was; a colleague was offered Upload and Delete and refused after the fact. |
| `spec_ref` checked at upload against the STORED specs; the race left open (2026-09-30) | A room nobody saved yet does not exist, and one removed is gone. A file that loses the race reads as the job's — never another room's, because ids are never reused. Closing it would mean inserting through a locking function. |
| The same bins wherever files are shown (Garrett, 2026-10-01) | Two views with different bins under the same labels are two lists. On a custom job the Files tab is the attachments panel itself, so they cannot drift. |
| Where an upload is filed is set by what opened the picker, and forgotten once read | The modal opens the picker for "a file" from a work-queue row; that must land on the job whichever room was last on screen. A target that carried over would file the next upload somewhere nobody chose. |
| The brand fonts are served from the repo, BOTH of them (Garrett, 2026-10-01) | A build that downloads fonts can fail for a reason no commit contains, and did. Moving only DM Sans would have left the build fetching Cormorant from Google. Built from Google's sources so they are the same designs, reproducibly. |
| A claim's reference is CR-1042, from an identity column (Garrett, 2026-10-01) | The submission id is a 36-character uuid, over the page's 32, and unreadable down a phone. CR, not WAR-: no claim exists until promotion. |
| The spam checks flag a claim; they do not drop it (Garrett, 2026-10-01) | Browsers autofill fields named "website". A customer told "received" whose claim was binned has lost the reporting window. Turnstile runs first, so the flagged are few. |
| Turnstile in one module, `lib/turnstile.ts` (Garrett, 2026-10-01) | Two forms, two copies of one check, is how checks drift apart. The quote route's answers are proven unchanged. |
| The claims check requires its action and a storefront hostname | Its own secret already fails a quote-form token, as the website asked; action and hostname also catch a misconfigured widget. |
| A scrubbed JPEG keeps its Orientation, and nothing else | Dropping it turned phone portraits sideways. The one fact kept says nothing about where or who. |
| A honeypot flag keeps what the field held, first 100 characters (2026-10-05) | CR-1003, a genuine claim, tripped the honeypot through Chrome's autofill. "Filled" cannot tell an autofilled company name from a bot's junk; the value can, and it is evidence for the website's fix. |

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
   does (item 13, working since 2026-09-30). The client half for attachments
   now exists: `lib/attachments` (item 24 step 2) is one shared list per order,
   and a view mounting refetches, so a colleague's upload appears on reopening.
   What remains for LIVE: a subscriber that calls `refreshAttachments(orderId)`
   on a change, and a read policy for `authenticated` — a published table with
   no read policy delivers nothing (OMS-STATE §5). ⚠ Not `lib/ackStatus.ts`'s
   pattern, which this item used to recommend: its `invalidateAck` race is proven
   (Open 25).
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
15. ✅ **The pre-project order importer is gone — 2026-09-16**
    (`patch_remove_order_importer.py`). `/api/shopify/orders` wrote one
    `type: "order"` row per Shopify order with no project, and it was one click
    away as "Import orders" on `/admin/shopify`, a page an admin opens to sync
    SKUs. It had never run in this schema, and nothing is live — every order is
    a test order — so there was no backlog to import. Deleted, guarded by its
    hash; the button, its handler, its state and its result banner went from
    the page, and its entry from `proxy.ts`'s admin prefixes. OPERATIONS §12's
    "historic projects still need backfilling" is struck through.

    **What it freed up, done the same day:** it was the only writer that set
    `archived` without `archived_at`, so
    `migrations/2026-09-16-archived-at-matches.sql` now adds
    `orders_archived_at_matches` and `projects_archived_at_matches` — archived
    exactly when dated. No code changed with it: every remaining writer sets
    the two together. **Proved against real PostgreSQL:** archive with a date,
    restore clearing it, archive a purchase, insert with defaults — all
    accepted; archive without a date, clear the flag but keep the date, date a
    row that is not archived, insert archived with no date — all refused.
    Checked first: no row on either table disagreed at `d534e20`.

    **Left as records:** `SECURITY.md`, `docs/HANDOFF-2026-08-20-BUILD.md` and
    `migrations/2026-09-16-archived-at.sql` still name the route. They describe
    what was true when they were written. The system map did too, and was
    redrawn from scratch on 2026-09-22 — it describes the system as it is, so
    it does not get to keep an old fact.
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

    **Not in this commit:** the group copy itself — item 19. And `teams-digest`,
    which counted the groups of archived purchases as active work — ✅ fixed
    2026-09-21 (`patch_digest_skips_archived_purchases.py`): it loads the
    purchases of the rows it reads and drops anything `archivedVia` says is
    archived, the question the routes and the modal already ask. An unreadable
    projects table now fails the run (500, nothing posted) rather than posting
    a summary that cannot tell finished work from live work. **Proved** with
    the real route on a mixed dataset: active 6 → 4, cabinet orders 2 → 1,
    hardware 1 → gone — exactly the two groups of the archived purchase —
    with the unconfigured path identical and the failure path posting
    nothing. Still inert while `TEAMS_WEBHOOK_URL` is empty.
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
21. ✅ **The registry token is watched — 2026-09-16, option A.** It expired on
    2026-08-18 and again on 2026-09-16, and both times a failed deploy was how
    anyone found out. `~/cron-jobs/check-registry-token.sh` now runs weekly and
    alarms 14 days ahead, and every run logs the expiry date. Outside git, like
    `run-cron.sh`; installed copy sha256 `a6c2f3dd…67571a7`.

    **Option B — build in GitHub Actions — was declined.** Actions pushes with
    its own token, but the build needs fifteen secrets, all of which would move
    into GitHub; the box would still need an expiring token to PULL a private
    image; and deploys would stop being one command on the box. It trades one
    expiring credential for more secrets in more places.

    **Proved** against ten stubbed cases — valid, expiring in 5 days, no
    expiry, rejected, missing `write:packages`, an unparseable date, network
    down, no token, no mapping, a malformed ping URL — each logging the right
    reason and pinging the right URL, with the token in no log, no stderr and
    no command line. And once against the real GitHub API with a bogus token:
    `token REJECTED (HTTP 401)`.
    - ⚠ **`.kamal/secrets` is a loader and is tracked deliberately.** It holds
      no values, on any commit. It was untracked that evening on a mistaken
      reading and restored the same evening; the file's own `.gitignore`
      comment already said to keep it.
24. **Custom jobs become an attachment-led hub** (decided with Garrett,
    2026-09-24; mockup in hand). A custom job is specs and files, not SKUs. The
    designer owns it end to end: no gates, SLA still applies, claimed jobs show
    in My Work. The website form fills it in and everything stays editable.

    **The shape agreed:** `custom_specs` jsonb holding AREAS (Kitchen, Master
    Bath), each with one or more SETS (Perimeter, Island), each set carrying
    manufacturer, door style, colour and notes — one set is ONE combination, so
    a second style is a second set. Every area and set gets a generated id at
    creation, and `order_attachments` gains a nullable column pointing at one,
    so a file belongs to the job, an area or a set. Deleting an area or set
    UNLINKS its files rather than removing them; files change often. Fields are
    free text for now — no dropdowns. Nothing here reaches a customer.

    **Step 1 ✅ 2026-09-25** (`patch_custom_specs_schema.py`):
    `orders.custom_specs` jsonb, `order_attachments.spec_ref` text with an index
    on `(order_id, spec_ref)`, and the shape in `lib/data.ts` as types plus
    `readCustomSpecs` (total: an unknown `v` or a malformed document reads as no
    specs rather than throwing inside a modal) and `newSpecId`. **Proved against
    real PostgreSQL:** the nested document stores and reads back — area 2, set
    "Island", v 1 — a file links to a set, a job-level file keeps a null
    spec_ref, unlinking a set leaves both files in place, the index exists, and
    `door_style` stays NOT NULL DEFAULT ''.

    ⚠ **door_style and color were NOT made nullable.** Proposed on 2026-09-24
    and dropped: '' already means unset on every row, and null would add a
    second way to say it.

    **Step 2 ✅ 2026-09-25** (`patch_custom_specs_panel.py`):
    `components/CustomSpecsPanel.tsx` — rooms with Add Room / Group, style
    groups with Add Style Group, duplicate and remove on both, free-text fields,
    per-room explicit Save, and a revert to the last accepted document on
    refusal. The route accepts `custom_specs` for custom jobs only, normalises
    it server-side, refuses an archived row, and writes "Job specifications
    updated by X" to the trail. **Proved by driving the panel**: building a
    kitchen with two style groups sends one document with two distinct set ids
    and every field carried; a refused save leaves nothing changed on screen and
    surfaces the reason; read-only shows the specs with no editable input and no
    add, save, remove or duplicate anywhere. **And the route over eight cases**:
    a cabinet group and a warranty claim refused 422, a malformed document
    normalised rather than stored raw, an unknown version emptied, an archived
    job 409, other edits untouched.

    **Step 3a ✅ 2026-09-25** (`patch_quote_submission_panel.py`):
    `components/QuoteSubmissionPanel.tsx`, read-only, below the specs. **Proved
    against the document production actually stored** on 2026-09-28: every label
    rendered and no key leaked (`Raised Panel` not `raised_panel`, `$10,000 to
    $25,000` not `10k_25k`), the file name listed, the design-assistance line
    shown only when they asked, and zero buttons and zero inputs in the panel.
    **And over seven awkward shapes:** a null column, a string instead of a
    document, a submission with no choices, keys with no labels (falls back to
    the key rather than blank), a label array holding numbers, `files_meta` as a
    string, and design assistance "no".

    ⚠ **A correction to step 2's proof:** the typecheck target list never
    contained either panel — two edits to it had failed silently — so "typecheck
    clean" on 2026-09-25 did not cover `CustomSpecsPanel`. Both are in the list
    now and both compile with no errors. Check the list, not the exit code.

    **Step 3b (part 1) ✅ 2026-09-28** (`patch_retire_quote_info_panel.py`):
    `QuoteInfoPanel` retired. It parsed `notes` and showed keys — "10k_25k",
    ["raised_panel"] — which is what the screenshot on 2026-09-28 caught, and it
    REPLACED the customer-note textarea on any quote job, so a designer could not
    write a customer note on exactly the jobs they own. The preferences panel
    gained the contact block (name, phone, email, project address, read from the
    submission), because the order-details card carries only source, date, PO
    reference and type. **Proved:** the note field and its Save button are back,
    the function and its render site are gone with a note left where they were,
    the panel renders the contact plus the labels with no key leaking and no
    control, and the typecheck is clean.

    ⚠ **A bug in the patch engine, caught by that typecheck:** the range deletion
    took the LAST occurrence of its end anchor, so it swallowed everything to the
    file's final matching block, `StageInputsCard` included. It now takes the
    first occurrence AFTER the start. A deletion that removes more than it names
    is why the typecheck runs before the commit.

    ⚠ **A DATA-LOSS BUG, fixed 2026-09-28** (`patch_shape_order_carries_specs.py`).
    `shapeOrder` never mapped `custom_specs` or `quote_submission`, so both were
    `undefined` in the browser however full the columns were. The preferences
    panel rendered nothing — which is what the 09-28 screenshot showed — and the
    specs panel opened EMPTY on a job with specs, so pressing Save room would
    have written that emptiness over them. The stored specs survived; nobody
    saved from an empty panel. **Proved:** before the fix both fields come out
    undefined, after it a row's areas and its budget label arrive, a row without
    the columns carries nulls rather than junk, and nothing else in the shaping
    moved. ⚠ The type did not catch it and could not: both fields are optional,
    so a mapper that skips them compiles.

    ✅ **The customer note is the customer's again — 2026-09-28**
    (`patch_quote_notes_and_alignment.py`). The webhook stopped writing the
    submission prose into `notes`, and `migrations/2026-09-28-clear-quote-prose.sql`
    cleared it from the rows already written. The preferences panel also lost the
    top margin that pushed it out of line with the specs card beside it.
    **Proved:** the route before and after on the same payload — the note goes
    from a six-line dump to "Please call me Thursday." and nothing else, an empty
    message leaves an empty note, and the submission still carries the budget
    label. **And the cleanup against real PostgreSQL:** the customer's message
    survives, the prose goes, a row without `quote_submission` keeps its prose
    (for those it is the only copy), a designer's own note is untouched, and a
    second run changes nothing.

    ⚠ **Three variables in the webhook are now unused** — `extractedBudget`,
    `cabinetLine`, `doorStyle` — left in place because removing them means
    unpicking the legacy parse chain they come from. Worth doing when that
    parser is next touched.

    ✅ **The panel follows the form's own sections — 2026-09-28**
    (`patch_preferences_sections.py`): Contact, Project, Style and finish, Files
    and notes, in the order the customer filled them in, read from the Liquid
    rather than invented. A section with nothing in it is not drawn.

    ✅ **Customer and designer files are separate — 2026-09-28**
    (`patch_customer_vs_designer_files.py`). The quote webhook marks both of its
    inserts `kind: "customer_upload"` — ⚠ it had set no kind at all, so those
    rows took the default and were indistinguishable from a designer's packing
    slip. The Files pane shows two bins with counts, uploads only under
    Designer, and a per-bin empty state.

    ⚠ **AND IT BROKE CUSTOMER UPLOADS FOR TWO DAYS.**
    `order_attachments.kind` has a CHECK allowing only `general` and
    `proof_of_delivery`; nobody extended it, so every quote upload after the
    deploy was rejected — file in storage, no row, nothing in the pane. Found
    2026-09-30 by a real submission, named exactly by the webhook's own activity
    line ("uploaded but DB row failed: ... violates check constraint"). Fixed by
    hand the same day and committed as
    `migrations/2026-09-30-attachment-kind-customer-upload.sql`. ⚠ The rule: a
    new value in a constrained column is the writer AND the constraint, and only
    one of them is in the code.

    ⚠ **SHIPPED WITHOUT A TYPECHECK OR A RENDER TEST.** The container running
    the harnesses reset mid-build, so the evidence was structural only: anchors
    verified, applies twice, bins wired, rows read from the visible bin, both
    webhook inserts marked, brackets balanced. `npx tsc --noEmit` on the box was
    the backstop, and it runs before the commit. Worth re-testing the pane when
    the room bins land. Re-tested 2026-10-01: rendered and driven by step 2's
    suite and step 4's.

    **The Files work, decided 2026-09-30.** A custom job needs its own Files
    view; `ProjectFiles` stays for Shopify purchases, where it solves a problem
    custom jobs do not have (finding a receipt across a project's groups). Since
    step 2 it reads the shared list, and a group that failed to load says so.
    - Tabs: **Customer attachments**, **Designer attachments**, then ONE PER ROOM
      built from `custom_specs`, so bins appear as rooms are added.
    - A file attached to a STYLE GROUP shows under its ROOM's tab, labelled with
      the group name — otherwise a kitchen with four groups becomes five tabs and
      the point of bins is lost.
    - Upload lives in the tab and writes `spec_ref`; the attachment routes must
      ACCEPT and CLEAR it (second place — see the section above).
    - Deleting a room or style group UNLINKS its files (`spec_ref` to null) so
      they fall back to Designer. Files change often; losing a drawing to a
      renamed room is the worse failure.
    - The Overview attachments card STAYS: the acknowledgment flow reaches
      `AttachmentsPanel` through an imperative handle that must remain mounted.
      It shows the SAME bins as the Files tab (Garrett, 2026-10-01), and on a
      custom job the Files tab is that same panel. Built in step 4, Designer
      first, as the pane has been since 2026-09-28.

    **Not built yet:**
    moving a file to another room, and filing under a style group from a
    screen (the route already accepts a style group's id). The
    Shopify product picker in `NewOrderModal` was to go when room filing
    landed, and it has, so it is next — a custom
    job has no SKUs, and the picker reads an admin-only endpoint, so it shows
    an empty list to anyone else. Verified unused: the one manual row has zero
    sku_items.

    **The Files work, in order (agreed 2026-09-30), each step its own commit.**
    It could not start where this file said it could: the specs files would hang
    on were not safe to point at.
    1. ✅ **Specs save one room at a time** (`patch_specs_one_room.py`,
       migration `2026-09-30-custom-specs-rooms.sql`, run BEFORE the deploy).
       What it is: OMS-STATE §3. Why: OPERATIONS §10.
    2. ✅ **The attachments client** (`patch_attachments_shared.py`, 2026-09-30).
       `lib/attachments`: one list per order for every view, every request
       ticketed so only the newest writes, and a view mounting refetches.
       `AttachmentsPanel` reads it; a delete leaves the screen only on a 2xx; a
       failed load, a refused upload and a refused download each say why, in the
       route's words; read-only on somebody else's claim; Receipt only where
       `lib/requirements` ever asks for one. `ProjectFiles` reads it too. The one
       visible change beyond the fixes: a work-queue row that opens the modal to
       attach a file no longer pops the picker for somebody who could not upload
       — it used to, and the upload was refused. **Proved**, with the real
       module, panel, `ProjectFiles` and `lib/requirements` against a fake server
       answering as the routes do: two views mounting make one request and an
       upload in one is in the other; a refused delete stays in both with the
       claim's own message and no enrichment refetch; an accepted one leaves
       both; a stale list landing after an upload does not erase it; a 500 says
       so and Retry recovers; read-only offers nothing and the pickers are safe;
       Receipt on cabinet groups only; reopening shows a colleague's upload; two
       files with one refused, a refused download, a null date, and a project
       with one failed group. Typecheck strict over the new files, and with
       `OrderModal` against stubs; a planted error caught in each.
    3. ✅ **Upload accepts `spec_ref`** (`patch_spec_ref_upload.py`, 2026-09-30):
       custom jobs, `general` files, ids that resolve against the STORED specs,
       checked before a byte reaches storage; `specRefResolves` in `lib/data` is
       the one reading of a ref. The race left open — a room removed between the
       check and the insert — leaves the file reading as the job's; closing it
       would mean inserting through a locking function. **Proved** through the
       real route, `lib/auth`, `lib/archived` and `lib/data` against 17.6 with
       the step-1 functions: filed under a room and under a style group; none
       and empty both mean the job; a room the job lacks, a malformed id, a
       receipt, a Shopify group, somebody else's claim and an archived job each
       refused with its own reason and nothing written, row or object; removing
       Kitchen unlinked both its files, the style group's included; filing under
       it afterwards refused. `attachmentBin()` — one function deciding the bin
       for every view, an unresolvable ref falling back to the job — comes with
       step 4, where a view first reads `spec_ref`.
    4. ✅ **The Files view** (`patch_files_by_room.py`, 2026-10-01). A bin per
       room of the SAVED specs, in the Overview card and the Files tab alike —
       the same component; `attachmentBin` decides every file's bin.
       Uploading in a room's bin files it there; where an upload goes is set
       by whatever opened the picker and forgotten once read, so the modal's
       own calls always file under the job. **Proved** with two panels of one
       job against a fake server recording each `spec_ref`: identical bins and
       counts in both; a style group's file in its room's bin, tagged; an
       upload in Kitchen filed under Kitchen and in the other view's Kitchen;
       an empty room's dropzone names and files to it; Designer and the
       modal's picker file under the job even with Kitchen on screen; a target
       never carries over; Customer offers no upload; a room removed elsewhere
       falls back to Designer with its not-yet-unlinked file, and a rename
       shows at once; read-only says "Nothing filed under Pantry." and offers
       nothing; a cabinet order keeps two bins. Step 2's whole suite again,
       unchanged, against the new panel.
    5. ✅ **Promote writes `customer_upload`**, with the data fix by
       `uploaded_by = 'Customer (claim form)'` — done inside item 27, 2026-10-01.

    **Step 1 proved** on PostgreSQL 16 and on 17.6 — production's version, from
    the npm registry's binaries — with production's `orders` policies and grants:
    conversion keeps every document but `v` and the added `rev`; a second run
    changes nothing; four unreadable documents are named and nothing is written;
    every room operation, including a stale save, a different room right after, a
    dropped set unlinking its file, duplicate ids, archived, Shopify group and a
    missing order; two saves of one room at once serialize and the second gets
    409; anon can call none of the three functions. The reader over 1,502
    generated documents and 25 malformed ones: every accepted one read back field
    for field, every malformed one refused, the reader never threw. The route,
    through the real `lib/auth` and `lib/archived` to the real functions: 20
    cases, among them an admin's override row written after the room row on
    success and not at all on a conflict, an old tab's PATCH refused, and a
    notes-only PATCH unchanged. The panel, through the route to the database: 11
    scenarios. The patch: apply, re-run, changed anchor, partial tree, and a panel
    differing from the copy read — the last three write nothing. A type error
    planted in each of the six files was caught six times.

    ⚠ **PRODUCTION HAD NO SPECS TO CONVERT.** 2026-09-30: one custom job,
    `count(custom_specs) = 0`, no `spec_ref` ever set. `CST-1788985171138`, believed
    this session to hold a real Kitchen/Island document, was deleted through the
    app on 2026-09-24 at 22:23 UTC by `battles45` — the day BEFORE the column
    existed; the Kitchen/Island shape is step 1's own proof, run on a test
    database. The migration was proved against production's real state instead:
    nothing changed, and the job's first room saved as v2, rev 1.

    ⚠ **UNVERIFIED:** the 2026-09-28 data-loss note above says the panel "opened
    EMPTY on a job with specs" and "the stored specs survived". No production row
    has specs, and no code can null the column. A test database or a job deleted
    since — do not cite it as production fact.
23. ⚠ **The public quote endpoint was open, and is now guarded — 2026-09-24.**
    `POST /api/webhooks/quote-form` takes a customer's details and up to five
    files from anyone on the internet. Its only check was a shared `secret`
    written `if (secret) { ... }` — and `QUOTE_WEBHOOK_SECRET` was EMPTY in
    production, so nothing was checked. Confirmed by posting with no secret and
    getting a 201. **The website team found it**, in a note dated 2026-09-24,
    after we told them the path used HMAC. It does not, and never did.

    **Done the same day:** `QUOTE_WEBHOOK_SECRET` set (401 without it,
    verified); Cloudflare Turnstile verified server-side before any validation,
    upload or row (`patch_quote_form_turnstile.py`); file caps down from 10 × 20
    MB to **5 × 10 MB**, matching the form. **Proved** with the real route over
    seven cases: a valid token still returns 201 and writes its two rows; a
    missing token 400, a rejected one 403, an unreachable or 500-ing Cloudflare
    503 — each writing nothing; the shared-secret and honeypot paths unchanged;
    and a missing `TURNSTILE_SECRET_KEY` refuses with 503 rather than skipping
    the check.

    ✅ **Finished the same day** (`patch_quote_capture.py`): `quote_submission`
    jsonb and `submission_id` with a partial unique index; the whole payload
    kept instead of flattened into `notes`; a retry returns the first job and
    writes nothing; stored filenames generated (`<uuid>.<ext>` from the SNIFFED
    type, the sender's name kept only as the label); JPEG metadata stripped by
    `lib/stripExif.ts`, which walks the marker structure and drops Exif, XMP,
    IPTC and comments without re-encoding or adding a dependency; and
    `door_style`/`color` no longer written from the form. **Proved:** a
    hand-built JPEG loses its Exif and comment while keeping JFIF and its pixel
    bytes, a PNG and an unparseable file come back untouched, and the real route
    keeps every field, generates the path, refuses to duplicate a retry, and
    leaves the designer's columns empty. Spec sent to the website team as
    `oms-to-website-turnstile-2026-09-24.md`.

    ⚠ **The lesson is not "add Turnstile".** An optional check with an empty
    key looks identical to a working one from inside the code, and identical to
    an open door from outside. `if (secret)` is the shape to distrust — the
    same shape that let the payment hold read a copy nobody wrote.
22. **Customer-facing claim and stage wording, to match the website** (from
    the website team, 2026-09-21). Their copy dropped freight terms:
    "missing pieces or short shipment" → "anything missing from the order",
    "concealed damage and defects" → "damage found after unpacking, or
    defects", "ships to a local cross dock" → "ships to a local delivery
    depot". The ask: wherever a message a CUSTOMER reads describes a claim type
    in words, use the new wording. **Nothing in the contract moved** — the form
    still sends `shortage` and `concealed` to `POST /api/public/claims`, the
    `website` and `elapsed_ms` fields stand, and database values, internal
    names and staff-facing labels do not change. Not urgent before the claims
    endpoint; worth doing before the first real claim.

    ✅ **Checked 2026-09-21, nothing to change.** All five customer-facing
    files read whole:
    - `lib/customerFacing.ts` is the only place a stage becomes customer words.
      No claim-type wording at all, and "At cross dock" already reads "Arrived
      at our delivery partner" — with a comment insisting on "our delivery
      partner, never 'we'".
    - `app/api/public/claims`: `shortage` and `concealed` appear ONLY as
      accepted values. Every message a customer can see is generic — "the type
      of claim", the photo-count, size and format errors, "We could not record
      your claim." On success it redirects to the website's own
      `claim-received` page, so that confirmation's wording is the website's.
    - `app/api/public/lookup` takes its labels from `customerFacing.ts`.
    - `app/api/claim-submissions` and its promote route are staff-facing.

    So the OMS never describes a claim type in words to a customer, and never
    says "cross dock" to one either. **Decision:** the website says "delivery
    depot" and we say "Arrived at our delivery partner"; both avoid the
    internal term, which was the ask, and the two are close enough that no
    customer is misled — left as they are. ⚠ **The rule to keep:** a
    customer-visible string describing a claim type or that place belongs in
    `lib/customerFacing.ts`, not inline in a route, so the next person changing
    wording has one file to read.
25. **Found 2026-09-30, outside item 24, NOT fixed.**
    - ✅ ~~A customer's HEIC, WEBP or GIF keeps its metadata, GPS included~~ —
      fixed 2026-10-05 by narrowing: the quote form takes JPEG, PNG and PDF, as
      the website's own form already did, so nothing is stored that cannot be
      scrubbed, and nothing under a wrong `.pdf` name. Item 27 step 6.
    - ✅ ~~The quote route tells a customer "(max 20 MB)"~~ — the message reads
      the limit from its constant since 2026-10-05.
    - The quote route leaves the storage object when its row insert fails (the
      staff route cleans up) — which is where the 09-28→30 orphans came from.
    - ✅ ~~`promote` writes a customer's claim photos as `general`~~ — fixed in
      item 27, with the rows already written.
    - ⚠ **The metadata scrubber dropped a JPEG's Orientation** with the rest of
      its Exif, from 2026-09-24: a phone's portrait photo then displayed on its
      side. And it scrubbed nothing from a PNG, GPS included. Both proven
      against the real function and fixed in item 27; HEIC, WEBP and GIF were
      accepted unscrubbed on the QUOTE form until item 27's step 6 (2026-10-05).
    - ✅ ~~`AttachmentsPanel`: delete ignores the answer; not claim-aware;
      Receipt on custom jobs.~~ Fixed in item 24 step 2, with the Files tab's
      "Project tab" copy.
    - ⚠ **`lib/ackStatus`'s `invalidateAck` race is PROVEN**, not only read: with
      the real module, the newest verdict (green) was on screen and the older
      one (red) landed after it and replaced it. After an acknowledgment upload,
      the panel can show the verdict from before it. The fix is
      `lib/attachments`' tickets.
    - A Shopify project's Files tab (`ProjectFiles`) lists files it cannot open:
      no download. (A custom job's Files tab is the panel, Download included.)
    - ⚠ `xlsx` installs from `cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`: the
      next dependency rebuild after a SheetJS release should fail `npm ci` on
      the lockfile's integrity hash. Pin a versioned URL. OMS-STATE §7.
    - `NewOrderModal` styles one input with `var(--font-geist-mono, monospace)`;
      nothing defines `--font-geist-mono` (a create-next-app leftover), so it is
      `monospace` — which is probably what was meant. Say so, or drop the var.
    - ✅ ~~Check after the fonts deploy~~ — done 2026-10-01: production serves
      `DMSans_wght300_600-s.p.0roqa3ab3xhnr.woff2`, the exact content-hashed name
      the verified build produced, and Garrett checked the screens by eye. No
      pixel comparison was run.
    - Deleting an order leaves its files in storage (rows cascade, objects do not).
    - Two near-simultaneous promotes both create a claim; the second's update
      matches nothing without an error and answers 201.
    - The attachment DELETE skips its archived check if its `orders` read fails.
    - Stale comments: ~~the upload route's `ATTACHMENT_KINDS` "MUST match" the
      CHECK~~ (fixed in item 24 step 3, with the caps comment beside it);
      `archivedVia`'s doc comment sits above `activityDate`;
      `isStageOfferedForType` says samples run New → Entered → Delivered;
      ~~`ProjectFiles` sends people to a "Project tab" labelled Overview~~
      (fixed in item 24 step 2).
    - The quote webhook has SEVEN unused variables, not three: add `color`,
      `city`, `state`, `zip`.
    - `app/api/realtime-token` says a username "IS the user id"; `lib/auth` says
      the id is the immutable `team_members.id` and a username can be changed.
      It matters the day a policy filters on `sub`.
    - `lib/useRealtimeOrders.ts` opens by saying it feeds `setOrders` /
      `setWarranties`, which no longer exist.
26. **Documents known wrong, found 2026-09-30, NOT corrected** — each wants its
    own look rather than a line in somebody else's commit.
    - ✅ ~~OPERATIONS §5: `QUOTE_WEBHOOK_SECRET` "Deliberately EMPTY"~~ —
      corrected 2026-10-01, the table row and the empty-by-design list both.
    - OPERATIONS §2 says `POST /api/public/lookup` is "not built yet", and §12 that
      the warranty question "blocks the public intake work". Both routes exist.
    - ✅ ~~OPERATIONS §2 disagreed with `lib/customerFacing.ts`~~ — corrected
      2026-10-01 from the code: Entered → "Order has been processed", At cross
      dock → "Arrived at our delivery partner".
    - "Four checks … of eleven" (OMS-STATE §6, OPERATIONS §3 and §6) predates
      `check-registry-token.sh`; OPERATIONS §7 has no Monday 15:00 row for it.
    - OPERATIONS §5 puts the Graph secret in `.env.kamal`; §12 says it is not there.
    - Item 9 and OPERATIONS §9 say "the one NO ACTION edge"; item 14, read from
      the database later, names two.
    - Item 20 still reads "in progress" with every step done; Open item 1's "see
      below" points above.
27. **The claims endpoint, to the website's 2026-10-01 contract**
    (`website-to-oms-open-items-2026-10-01.md`; the only item left on the
    website's critical path to launch). Decisions, all Garrett's, 2026-10-01: a
    short reference; flagged submissions kept, not dropped; Help Scout handles
    every reply and the OMS sends no email; Turnstile in one shared module;
    email claims entered as submissions; quote uploads narrowed to JPG, PNG and
    PDF.
    1. ✅ **The endpoint** (`patch_claims_contract.py`, migration
       `2026-10-01-claim-submissions-ref.sql`, run BEFORE the deploy). What it
       is: OMS-STATE §2. **Proved** through the real route, `lib/auth`,
       `lib/turnstile`, the new scrubber and `lib/fileValidation` against 17.6
       with both claims migrations: a genuine claim answers 201 `CR-1004` with
       CORS and every field stored; both storefront hosts, and no CORS for any
       other; the secret sent to Cloudflare is the CLAIMS widget's, never the
       quote form's; no token, a quote-form token, the wrong action, another
       host and Cloudflare down each give exactly the answer the page acts on,
       and only the missing token's 400 says "turnstile"; seven photos, 11 MB, a
       GIF, a missing name and an unreadable form are refused as "anything
       else"; none of those writes a row or a photo; the secret missing answers
       503 and logs it; a filled honeypot and a 0.8 s send are kept, flagged;
       the eleventh request in a minute gets 429 with CORS and Retry-After.
       Stored photos: a rotated GPS-tagged JPEG keeps Orientation 6 and loses
       its location and camera, a PNG loses its eXIf and text, both
       pixel-identical to the upload. The migration: refs given to existing rows,
       a second run changes nothing, a bad flag and a hand-set number refused.
       The quote route against its own old self through all eight Turnstile
       outcomes: status, body, CORS and log lines identical. Promotion, through
       the real route and database: the photos filed `customer_upload`, the
       notes opening with the reference, the report date carried.
    2. ✅ **The claims widget's secret** — set 2026-10-05, a production key
       (`0x`), length 35 in the running app; a post without a token now answers
       400 `turnstile_missing`.
    3. **The reply to the website**, by number, once deployed.
    4. ✅ **The joint test** (their item 10), 2026-10-05: a genuine claim from the
       live page answered 201 and the received page showed `CR-1003`; it arrived
       with every field and its photo, and promoted to `WRN-1052-1` with the
       reference in its notes and the photo filed `customer_upload`. ⚠ **It came
       in flagged `honeypot`**: Garrett filled the form with Chrome's autofill,
       which filled the hidden field labelled "Company website". Kept, as
       decided — the old route would have binned it. From 2026-10-05 the flag
       keeps what the field held (`patch_screening_value.py`). **The website's
       to fix:** a name and label autofill does not recognise, or no honeypot,
       since Turnstile runs first and is the control.
    5. **Email claims entered as submissions**, the email's arrival time as
       `received_at`, so the report date keeps one path. Not on the website's
       critical path.
    6. ✅ **Quote uploads narrowed to JPG, PNG and PDF**
       (`patch_quote_types_note_label.py`, 2026-10-05). The website's form had
       already narrowed in its picker and its own check, so nothing it offers is
       refused. **Proved** through the real quote route before and after: a HEIC
       accepted, then refused 415 naming "JPEG, PNG or PDF"; an 11 MB JPEG's
       message "max 20 MB", then "max 10 MB"; a JPEG accepted both times. The
       `.pdf` naming is exact with only these three.
    7. ✅ **The customer-note label** says "written to the Shopify order" only
       on an order with a `shopify_id` (same script, 2026-10-05). The website
       asked where a customer could see a claim's note; the answer was nowhere —
       the PATCH route writes notes to Shopify only for a row with a Shopify
       order, the public lookup never returns notes — but the label said so on
       every order. `Order` gained `shopify_id` for it: GET /api/orders always
       sent the column, and `shapeOrder` dropped it.

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

**⚠ THE FULL RULE, since fixing deletions broke insertions the same day:** an
edit is APPLIED when `new` is present once AND `old` is either gone or contained
in `new`. "`new` present" alone misreads a deletion; "`old` gone" alone misreads
an insertion, where `old` stays in place by design. The script's own second run
caught the second mistake as PARTIAL — which is what the second run is for.

**⚠ "SUCCESS. NO ROWS RETURNED" IS NOT EVIDENCE A MIGRATION APPLIED.** The
Supabase SQL editor shows it for a statement that changed something, a statement
that changed nothing, and a SELECT that matched nothing. On 2026-09-16 a
constraint migration reported it and had added nothing; only the listing query
showed that. **After every migration, run the query that lists what it should
have created, and read the rows.**

**⚠ ASK THE SQL EDITOR QUESTIONS THAT ALWAYS RETURN A ROW.** The same message
answers a SELECT that matched nothing. On 2026-09-30 it was the first sign that
the specs this session believed in did not exist, and it could not say so. Wrap a
check in `count(*)` or `coalesce(json_agg(...), '[]')`, so empty is a visible 0 or
`[]`. The editor also shows only the LAST statement's result: one query per run.

**⚠ A CHECK'S FUNCTION MUST BE EXECUTABLE BY EVERY ROLE THAT WRITES THE TABLE**,
or that role cannot write ANY row — Postgres checks the permission before the
constraint's own `is null` short-circuits (proven 2026-09-30). Which roles write
is decided by RLS: read `pg_policies` before choosing the grant.

**⚠ THE `grep` EXIT CODE BIT A TEST RUNNER TOO** (2026-09-30): a clean fixture
load printed nothing, `grep -v` exited 1, and the `&&` chain skipped the seed —
the first run tested an empty table, and passed. A proof prints the row counts of
every database it creates.

**⚠ PUBLISHED IS NOT DELIVERED.** A table in the realtime publication reaches a
browser only if the browser's role may SELECT it. 2026-09-15 checked the
publication and not the policy, and for two weeks every trail row but a stage
move or an archive needed a refresh — which came to look like how it worked.
Verify a realtime change with a SECOND TAB that did not make the change.

**⚠ A MIGRATION ENDS WITH ITS OWN CHECK.** On 2026-09-30 the specs migration
took three runs to land in the SQL editor. The first two did not apply, and why
was never established; the one that did answered only "Success. No rows
returned" — the words a run that does nothing also gives. Put the verifying
SELECT last in the file, so one run answers with the evidence. Prefer `if not
exists` to DROP: the editor may stop to question a DROP, which is one unconfirmed
explanation for the two runs that did not apply.

**⚠ A BUILD THAT FETCHES FROM A THIRD PARTY FAILS FOR REASONS NO COMMIT HOLDS.**
2026-10-01: the deploy of `e027ee9` failed in `next/font/google`'s download of
DM Sans, and a retry of the same commit built. How that was told apart from a
code fault: the same commit, the same unchanged lockfile under `npm ci
--frozen-lockfile` (so the same packages), and nothing the commit touched
anywhere near the error — leaving only what Google answered. **Read the build
log's error and its import trace before reverting anything.** The fonts are in
the repo now (OMS-STATE §7); `xlsx` still comes from a moving URL.

**⚠ A FIXTURE CARRIES PRODUCTION'S GRANTS, OR IT TESTS SOMETHING ELSE.**
2026-10-01: the claims route answered 500 in the proof, because the test database
lacked Supabase's default grant of a new table to `service_role`. Read the grants
production actually has (`information_schema.role_table_grants`) and give the
fixture the same.

**⚠ AN ASSERTION CHECKS THE TYPE FIRST.** The same day, "the reference fits the
page" passed on `undefined`: the regex matched the string "undefined". Assert
`typeof x === "string"` before what the string looks like.

**⚠ A CHECK CONSTRAINT PASSES WHEN ITS EXPRESSION IS NULL.** 2026-10-05: `check
(value is null or (screening = 'honeypot' and ...))` let a value in with NO flag,
because with `screening` null the comparison is NULL, not false. A constraint
refuses only on false. Compare a nullable column with `is not distinct from`, and
test the row the constraint exists to refuse.

**⚠ A TYPECHECK THROUGH AN `any` STUB CHECKS NOTHING THAT FLOWS FROM IT.**
2026-10-05: the first build of the note-label fix read `liveOrder.shopify_id`,
which `Order` did not declare. The proof passed, because its stand-in store
returned `any`, and `liveOrder` derives from the store. The box's `npx tsc
--noEmit` refused it before the commit, as the deploy chain is built to. A
stand-in must carry the real TYPES of what flows from it; prove it by making
the change that failed on the box fail locally first.

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

## ⚠ The shape of every bug on 2026-09-28 to 09-30

Three in three days, all the same shape: **a change with a second place that
also had to change, and only one of them was checked.**

| The change | The second place | How it showed |
|---|---|---|
| `custom_specs` and `quote_submission` added to the `Order` type | `shapeOrder`, which maps columns field by field | Both `undefined` in every browser; the specs panel opened empty and a Save would have overwritten real specs |
| Two panels added to the repo | the typecheck target list, which is a literal array | "typecheck clean" reported twice on files that were never compiled |
| The webhook started writing `kind: "customer_upload"` | the CHECK constraint listing allowed values | Every customer upload rejected for two days — file in storage, no row, nothing in the pane |

**Before claiming a change works, ask what else has to know about it.** A type
does not enforce a mapper. A test list does not update itself. A column accepts
what its constraint allows, not what the code writes. Each of these is one query
or one `grep -c` away from being certain instead of assumed.

**2026-09-30 found four more of the same shape**, three before they shipped:
`rev` added to the specs document, and `readCustomSpecs`, which copies field by
field, would have dropped it in every browser; the specs moved to their own
route, and PATCH would have answered 200 for them had the field merely been
deleted; a CHECK calling a function, and every role that writes the table needs
EXECUTE on it. The fourth was live until 2026-10-05: the quote form accepted
HEIC, WEBP and GIF, which `stripImageMetadata` cannot scrub (Open 25; item 27
step 6 narrowed it). **And a fifth**, live since
2026-09-15 and found after the step-1 deploy: `order_activity` added to the
realtime publication, and the read policy Realtime also needed.

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
patch_remove_order_importer.py
patch_docs_remove_order_importer.py
patch_archived_at_matches.py
patch_docs_registry_check.py
patch_digest_skips_archived_purchases.py
patch_docs_digest_and_wording.py
patch_docs_claim_wording_checked.py
patch_quote_form_turnstile.py
patch_docs_quote_form_turnstile.py
patch_quote_capture.py
patch_docs_quote_capture.py
patch_custom_specs_schema.py
patch_custom_specs_panel.py
patch_docs_custom_specs_panel.py
patch_quote_submission_panel.py
patch_docs_quote_submission_panel.py
patch_retire_quote_info_panel.py
patch_docs_retire_quote_info.py
patch_shape_order_carries_specs.py
patch_docs_shape_order.py
patch_quote_notes_and_alignment.py
patch_docs_quote_notes.py
patch_preferences_sections.py
patch_customer_vs_designer_files.py
patch_docs_file_bins.py
patch_attachment_kind_constraint.py
patch_system_map_redrawn.py
patch_docs_handoff_next_session.py
patch_specs_one_room.py
patch_docs_specs_one_room.py
patch_activity_readable.py
patch_docs_activity_readable.py
patch_attachments_shared.py
patch_docs_attachments_shared.py
patch_spec_ref_upload.py
patch_docs_spec_ref_upload.py
patch_files_by_room.py
patch_docs_files_by_room.py
patch_brand_fonts_local.py
patch_docs_brand_fonts_local.py
patch_claims_contract.py
patch_docs_claims_contract.py
patch_screening_value.py
patch_docs_screening_value.py
patch_quote_types_note_label.py
patch_docs_quote_types_note_label.py
```

⚠ **The list above is checked, not remembered.** On 2026-09-30 a pass over it
found `patch_system_map_redrawn.py` missing — the patch that redrew the map had
updated an item and never added itself here. Search this file for a script's
name before assuming it is recorded.

Outside git, in `~/cron-jobs/`: `check-registry-token.sh` (sha256
`a6c2f3dda6a95976eaa2e04bffa0a19d7583c0fdc883c61781f7c8eb267571a7`).

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
