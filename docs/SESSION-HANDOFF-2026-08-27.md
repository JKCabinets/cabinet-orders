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
| 1 | **The column drop** | `shopify_id`, `ship_to`, `customer_phone`, `customer_email`, `payment_status`, `payment_hold_cleared_*` still on `orders` after being copied to `projects`. **109 references across 18 files.** Not urgent — ingest writes both sides so they do not drift, confirmed this session at webhook lines 622/678 and 765/802 — but code first, verified, THEN the migration. `orders.name` stays until warranty linking exists. **Its own session.** |
| 2 | **Rate limiting is keyed by IP** | `` `${bucket}:${ip}` `` — everyone behind one office IP shares one allowance on every rate-limited route. Confirmed this session that `rateLimitOr429` **fails open**. Needs a decision about the bucket and a pass over every caller's limit. **Its own session.** |
| 3 | **Notifications** | The order confirmation promises *"we will notify you when your order has finished production and is on its way"* and nothing sends it. **The one hook point is confirmed** — `PATCH /api/orders/[id]` is the sole writer of all four date fields, because every UI goes through the route. `POST /api/orders` writes no dates and only accepts custom and warranty. **Read the email from `projects`**, not from `orders`, or the column drop gets worse. **Trigger 5 must gate on the receipt existing**, not on the stage — the delivery override reaches Delivered with no receipt, and "signed for" would be false in writing. **Add the old values to the existing `currentRow` SELECT** and set-vs-changed falls out with no new query. `production-complete` fires at **1am Phoenix**. |
| 4 | **Public intake** | Claims intake and `POST /api/public/lookup`. ⚠ **Warranty claims have customer-facing copy and no way to reach a customer** — the translation table gives all five warranty stages wording, the endpoint returns a *project*, and warranty is standalone. Now in `OPERATIONS` §12 Critical. Decide before building. |
| 5 | **Historic money backfill** | Projects ingested before the money columns sum as zero; `/admin` says how many. Backfill via `/admin/shopify`. |
| 6 | **Delete the seven stray healthchecks** | ⚠ **BY EXACT NAME, NEVER BY PATTERN** — all seven are `jk-`-prefixed and so is `jk-webhook-health`, which is real and caught the genuinely missed order #1038. Names are in `OPERATIONS` §12. Then shrink `IGNORED_CHECKS`. |
| 7 | **`/projects?filter=archived`** | The sidebar links to it; the page reads its filter from state, not the URL, so it lands on All. |
| 8 | **`OrderTable` spacing** | The action column was fixed this session; the SPACING pass was not. It is a `<table>` and needs its own. |
| 9 | **The acknowledgment half of one truth per item** | An ack tested against a real order should REPLACE the last one, not accumulate. Same rule as the tracking number. Needs `AcknowledgmentPanel.tsx`, `lib/acknowledgments.ts`, `lib/ackStatus.ts` and `app/api/orders/[id]/acknowledgment/route.ts` — none read this session. ⚠ **Decide first whether "the last ack" means one per ORDER or one per VENDOR**; a cabinet order can span several manufacturers. |
| 10 | **Known-wrong code** | `override_ack` is client-supplied, unlogged and has no role check — the fix is small and is described below · the calendar fetches orders itself, bypassing the store, and its `saveDelivery` swallows its own failure (`catch {}`, no `res.ok` check) ten lines below a `saveProductionDates` that checks both · concurrent identical webhook deliveries can race on insert · one private stage-colour copy remains, location unknown · a project-linked group at `New` renders a **Claim** button whose only outcome is a warning toast, because `claimIfStandalone` refuses every project-linked row — the release **X** has the same problem · the `Delivered` branch offers **Archive Order**, which writes `orders.archived`, but a purchase archives as a whole through `/api/projects/[id]` · the modal's `DateEditor` still offers production dates on samples. |

**⚠ On `override_ack`.** Named as known-wrong in `OPERATIONS` §10, `OMS-STATE` §3
and here. That stops the next reader inferring a policy from the delivery gate's
"an override needs a reason" — it does **not** reduce the inconsistency. **The
fix is small:** read the role from the session, require a reason, write the
activity row. It matches two implementations that already exist. It is the right
rank while it is the acknowledgment gate; it would not be if it were delivery or
payment.

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
