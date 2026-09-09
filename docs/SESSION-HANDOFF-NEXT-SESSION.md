# Start here — session handoff, 2026-09-08

You are picking up work on the JK Cabinets OMS. This file is written to be the
first thing you read and to be enough on its own to start safely.

**Read next, in this order:**

| File | Owns |
|---|---|
| `docs/OMS-STATE-2026-08-26.md` | what the system IS |
| `docs/OPERATIONS-2026-08-26.md` | how it is run, its history, its decisions |
| `docs/SESSION-HANDOFF-2026-09-08.md` | what happened on 2026-09-08 and why |
| `handoff-website-to-oms-2026-09-01.md` | what the storefront expects of us |
| `jk-order-status-page.liquid` | the lookup response contract, in its header |

⚠ **One home per fact.** The document-set split lives in `OPERATIONS`, in the
header block above §1, and only there. If you find the split restated
elsewhere, that copy is the problem.

---

# 1. How we work

This section is not preamble. Every rule in it exists because something broke.

## The loop

Garrett is the only person with access to the box. **You have no shell on it.**
Everything you learn about the running system, you learn by asking him to run a
command and paste the output.

```
box     garrett@5.78.220.153, repo at ~/cabinet-orders
local   Windows, Git Bash, /c/Users/garre/Downloads
```

⚠ **Only `scp` runs locally.** Everything else runs on the box over `ssh`.

⚠ **Always give the deploy and verification commands with the file.** A patch
handed over without them is not finished work. This was corrected mid-session
and it is a standing expectation.

## Reading code

⚠ **WORK FROM WHOLE FILES. NEVER FROM SNIPPETS.**

```bash
# LOCALLY
cd /c/Users/garre/Downloads
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && tar -czf - path/one.ts path/two.tsx" > pull.tar.gz
```

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && wc -l path/one.ts path/two.tsx"
```

⚠ **`wc -l` IS ITS OWN COMMAND**, and you check the extracted counts against it.
A truncated transfer looks exactly like a shorter file.

⚠ **Bracketed paths must be single-quoted**: `'app/api/orders/[id]/route.ts'`.
Bash treats `[id]` as a character class otherwise.

⚠ **DO NOT GREP TO DECIDE WHAT TO ASK FOR, AND DO NOT REASON FROM A GREP.**
Using `grep` or `git ls-files` to *navigate* a file you already hold is fine.
Using it to decide what a file does is not. On 2026-09-08 a `NextActionCard`
component sat in a file three separate regions of which had been read — it was
found only by accident, at the moment a new component was about to collide with
its name.

⚠ **A file you pulled earlier is stale after any deploy.** Re-pull before
writing anchors against it. This cost two round trips in one session.

## Writing changes

**Edits to existing files → an idempotent, anchor-based Python patch script.**
**New files → shipped whole, with a `shasum -a 256`.**

A patch script must:

- take the repo root as `sys.argv[1]` and live in `~/`, never in the repo — this
  is what stopped one being swept into a commit
- **check "already applied" BEFORE its guards.** A guard asserts the *unpatched*
  shape, so running it first makes a correct second run report a MISS. A re-run
  has to be boring, or the first run's output means nothing
- validate every anchor and **write nothing at all if any one misses**
- apply steps **sequentially in memory** — a step anchored on an earlier step's
  output must be able to match
- **strip comments before counting**, so a guard cannot fire on its own prose
- carry **post-conditions**: assert the thing you were trying to achieve is
  true, and refuse to write if not

⚠ **A marker that is a PREFIX of untouched text reports "already applied" on a
file that was never patched.** Include enough surrounding context to be unique.

⚠ **Count elements, not strings.** `export function attentionFor` is a prefix of
`attentionForProject`. `attentionFor(o)` legitimately appears more than once.
Both cost a wasted round trip on 2026-09-08.

## Verifying

```bash
# ON THE BOX
cd ~/cabinet-orders
shasum -a 256 <every file you touched>
python3 ~/patch_name.py .
npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"
git status --short
```

⚠ **`EXIT: 1` MEANS CLEAN** — `grep` found no errors. `EXIT: 0` means it found
some.

⚠ **CHECKSUM LOCALLY BEFORE `scp`, NOT ONLY AFTER.** Twice in one session a file
failed to transfer and the stale copy was diagnosed by `tsc` instead. One
`shasum` on the sending side catches it first.

⚠ **`esbuild` parses; `tsc` understands.** A parse check is a floor, not a
ceiling. Example: a `.select()` string split across lines with `+` compiles
fine and silently breaks supabase-js's row-type inference — **keep every
`.select()` on ONE string literal however long it gets.**

## Deploying

⚠ **THERE IS NO STAGING. Every deploy goes straight to production.**

```bash
cd ~/cabinet-orders
git add <named files>          # ⚠ NEVER `git add -A`
git commit -m "..."
git push origin main && kamal deploy 2>&1 | tee kamal-deploy.log
echo "=== ERRORS: $(grep -cE 'ERROR \(' kamal-deploy.log) ==="
```

```bash
cd ~/cabinet-orders
HEAD_FULL=$(git rev-parse HEAD)
docker ps --filter label=service=cabinet-orders --format '{{.Image}}' | grep -q "$HEAD_FULL" \
  && echo "DEPLOYED — image matches HEAD ($HEAD_FULL)" \
  || { echo "MISMATCH"; docker ps --filter label=service=cabinet-orders --format '{{.Image}}  {{.Status}}'; echo "HEAD: $HEAD_FULL"; }
```

⚠ **A container being up proves only that a container is up.** `"Finished all"`
prints on aborts, and `grep -c 'ERROR (SSHKit'` reports zero on a config error —
hence `grep -cE 'ERROR \('`. The image tag is the full 40-character SHA, so
compare against `rev-parse HEAD`, not the short form.

⚠ Documentation-only commits need **no deploy**. Say so rather than issuing one.

## Database

Migrations run in the **Supabase SQL editor**, and a copy is saved to
`migrations/` and committed. Nothing on the box executes SQL.

⚠ **THE SQL EDITOR RUNS AS `postgres` AND BYPASSES RLS.** It cannot tell you
what an anonymous client sees. The only check that means anything is a request
made with the anon key from outside:

```bash
CID=$(docker ps -q --filter label=service=cabinet-orders)
docker exec "$CID" node -e '
const url = process.env.SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
(async () => { for (const t of ["projects","orders"]) {
  const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  console.log(t.padEnd(12), "HTTP", r.status, (await r.text()).slice(0, 120));
}})();'
```

⚠ **The container has no `curl`.** Use `node -e` with global fetch.

⚠ **A NEW TABLE GETS RLS IN THE SAME TRANSACTION AS ITS `create table`, before a
row exists.** Supabase's default privileges grant ALL to `anon`; RLS is what
makes that harmless. The window between the two statements is the entire
vulnerability — see `OPERATIONS` §9.

## Working with Garrett

- **Clean over quick.** Nothing is live yet — the storefront is password
  protected and there are no real customers. Prefer the correct build to the
  fast one. This is a standing instruction.
- **Ask before deciding to move on from something.** If you find dead code,
  clean it up rather than filing it for later; that is how it gets missed.
- **Do not hand off work you can do.** Say plainly when you are stopping and
  why, but do not manufacture reasons to stop.
- He will correct you on domain facts. Take the correction — his are usually
  about how the business actually runs, which is not in the code.

## The failure this codebase keeps having

**One rule, written twice, with a clause missing from the second.** It happened
four times in six days before `lib/attention.ts` existed, and it has happened
repeatedly since: three warranty id generators, two enrichment shapes, a client
gate stricter than its server, eleven stale comments describing flows that no
longer exist.

⚠ **When you find a rule in two places, the job is to make it one — not to make
the copies agree.**

---

# 2. What the system is, in one page

A Shopify storefront (`jkcabinets2you.com`, **not yet live**) and a custom
order-management system (`ordersjkcabinets2you.com`). Next.js 16, Supabase,
Kamal → Docker → one Hetzner box. Small internal team, Queen Creek Arizona,
`America/Phoenix` throughout.

**A checkout is a PROJECT. Its lines split into GROUPS.** One customer buying
cabinets and a sample produces one `projects` row and two `orders` rows, each
with its own stage, its own SLA clock and its own timeline. `OMS-STATE` §2 is
the real description and you should read it before touching anything.

**Five flows, and stage names are NOT globally unique.** `Shipped` appears in
three. Always resolve against the row's `type`.

**Two public endpoints**, both unauthenticated by construction because
`proxy.ts` exempts the `app/api/public/` directory rather than named files:

- `POST /api/public/lookup` — customer order status
- `POST /api/public/claims` — the warranty claim form

⚠ **Both run as the SERVICE ROLE.** The `public_api` role that was designed to
be the real boundary does not exist. Until it does, **the explicit select list
in each route is the only thing keeping `customer_phone`, `ship_to` and
`internal_notes` out of a public response.** Treat those select lists as a
security control.

---

# 3. Your immediate task: finish the next-action panel

This is the one piece with work already done against it, and it stopped
deliberately mid-way.

## The problem

Three notes from Garrett using the OMS, all one cause:

1. **Submit / Resubmit acknowledgment renders twice** — in
   `components/AcknowledgmentPanel.tsx` and in the modal's next-action slot.
2. **The production-dates prompt is in the wrong place** — `DateEditor`, lower
   down, instead of the slot.
3. **At Entered the slot's button advanced without dates.** ✅ The server half
   is fixed and deployed; the UI half is this work.

The cause: the slot is a **hand-written branch per case**, so every gate has to
be taught to it separately, and a gate it does not know about is simply not
shown.

## What exists already

⚠ **`NextActionPanel.tsx` IS NOT IN THE REPO AND NOT ON THE BOX.** It was
written on 2026-09-08 and deliberately never copied, because a component
nothing imports is dead code — the exact thing this session was cleaning up.
Garrett has the file locally in `/c/Users/garre/Downloads`. **Ask him for it
before rebuilding it from scratch.** If it cannot be found, §3 below describes
it completely enough to rewrite.

**`NextActionPanel.tsx`** is written and **NOT deployed**. It
generates a checklist from `requirementsFor(order)` — one row per requirement,
tick from `state()`, remedy as a button, move button disabled until all met —
with inline date fields, because setting the dates *is* the action at Entered.

⚠ **IT HAS A KNOWN BUG.** It patches `delivery_date`; `DateEditor` writes
`scheduled_delivery_date`. Fix before wiring.

⚠ Its `unknown` handling is deliberately the OPPOSITE of `attention.ts`:
outstanding, move button disabled. A queue that guesses sends somebody to redo
finished work; a modal that guesses is corrected a second later by the person
looking at it.

## What you must do first

⚠ **READ `components/OrderModal.tsx` END TO END. 2,574 lines.** Roughly 900 of
them were never read on 2026-09-08, and that is exactly why this stopped.

## What the patch has to do

- **Delete the dead local `NextActionCard` at ~2172.** Verified dead: one
  occurrence repo-wide, rendered nowhere. It is an earlier version of this same
  card, inlined into the grid at ~1128 and left behind.
- **Drop whatever becomes unused with it** — it uses `STAGE_ACCENT`,
  `slaRuleFor`, `slaAgeHours`, `hoursInStage`, `slaTier`, `formatStageAge`,
  `nextStageFor` and a `claimSlot` prop. ⚠ **`noUnusedLocals` is OFF**, so `tsc`
  will not tell you. That is the same mechanism that let `storedType` sit unused
  since August.
- **Replace the live slot**: the `glass-sage` three-cell grid at ~1128 —
  *Current stage · Next action · owner*. Replace the middle cell only.
- **Strip `AcknowledgmentPanel`'s duplicate buttons.** ⚠ It is also the picker
  the panel opens, so breaking it breaks both.

## Things the modal gives you

```
updateOrderDetails(id, details)   from useStore — how a field is saved
doMoveStage(stage, pin)           already runs the client Entered gate and
                                  handles the delivery-proof refusal
ackPanelRef.current?.openFilePicker()
attachmentsRef.current?.openReceiptPicker()
useOrderEnrichment([liveOrder])   the SAME hook the work queue uses
```

⚠ Use that hook rather than reading `ackStatus` separately. It is what makes the
modal and the queue agree by construction instead of by coincidence.

---

# 4. The requirement model — read this before changing any gate

`lib/requirements.ts` is **the source** for what a row still needs, keyed on
`(type, stage)`. Built 2026-09-08.

```
lib/requirements.ts          the source
  ├── lib/sla.ts             clockRuns / waitingFor, overlaid in slaRuleFor
  ├── lib/attention.ts       the two join-backed reasons
  ├── app/work/WorkClient     3 call sites
  └── app/dashboard/…Client   4 call sites
        via lib/useOrderEnrichment.ts → POST /api/orders/enrichment
```

**Three states:** `met`, `unmet`, `unknown`. Unknown is what a join-backed
requirement reports when nobody fetched the enrichment.

**Still to migrate:** `fieldsToClearOnBackwardMove` in `stageLogic.ts`, and the
PATCH gates. Each is a behaviour change and should be argued on its own.

⚠ **A source table with no consumer is `AttentionEnrichment` again** — built,
documented, never fired. Ship each slice WITH its consumer.

## `POST /api/orders/enrichment`

Returns `{ackGreen, hasAttachment, hasProofOfDelivery}` for many rows in **five
queries regardless of row count**. It reimplements nothing: the four-layer
vendor chain is `resolveVendors`, the green-and-not-stale verdict is
`allVendorsGreen`, and both are the same functions the server gate calls.

---

# 5. Remaining work, ranked

1. **The next-action panel** — §3. Started, stopped deliberately.
2. **The `public_api` boundary.** Both public routes run as service role.
   supabase-js authenticates with an API key rather than a Postgres role, so
   this means signing a short-lived JWT with `role: "public_api"` using
   `SUPABASE_JWT_SECRET`, which is already in `.kamal/secrets`. Plus creating
   the role with narrow column grants, and reviewing the `qual=true` SELECT
   policy on `orders`.
3. **Notifications.** ⚠ **UNBUILT, not broken** — no Graph credential anywhere
   and no code that sends mail. Needs the Azure credential from Garrett before
   any code is worth writing. The Shopify order confirmation already promises
   every cabinet customer we will tell them when production finishes.
4. **Missing migrations** for `projects` and `order_acknowledgments`. Neither
   has creating SQL in the repo, so **the database cannot be rebuilt from git**
   — which is what the RLS exposure in `OPERATIONS` §9 cost.
5. **Eleven stale comments**, listed in `SESSION-HANDOFF-2026-09-08.md` §9. One
   mechanical patch across four files.
6. **Admin release for standalone claims.** `release_order()` has no admin
   override, unlike `release_project()`. Since stage changes stopped clearing
   claims, handing on a claim from somebody who has left needs an explicit
   `claimed_by` PATCH.
7. **Help Scout dependent items.** The subscription was kept (first charge
   2026-09-02). Two things still hang off it, both Garrett's in a console
   rather than ours in a patch: pointing the Shopify store contact email at
   Help Scout, and retiring Tidio once the Beacon is live.
8. **Review the Supabase API logs** for `anon` reads of `/rest/v1/projects`
   between 2026-08-25 and 2026-09-01, the window the table was exposed.

---

# 6. Traps

⚠ **`lookup_endpoint` and `form_endpoint`** are set by the website team in
Shopify Liquid, not by us. The lookup is live; claims still needs
`form_endpoint` pointed at `/api/public/claims`.

⚠ **The lookup fails CLOSED; the claims intake fails OPEN.** Deliberate. A read
that lets requests through during a Redis outage becomes an order-number
oracle. A refused claim costs a customer their claim inside a window Terms 12.3
makes a condition precedent.

⚠ **`orders.date` is a display string with no year** (`"Jul 22"`). Never derive
a real date from it. Customer-facing dates come from `projects.created_at`.

⚠ **The acknowledgment `.xlsx` is never stored as an attachment.** A green ack
normally means ZERO attachments, which is what broke the Entered gate in both
directions on 2026-09-08.

⚠ **A warranty claim is `WRN-1050-1`**, always suffixed, sequence per PURCHASE
not per group. `claim_submissions` rows are DRAFTS — not `orders` rows — and sit
on `/warranty` at New claim until somebody completes them.

⚠ **`claimed_by` stores `team_members.id`, not the username.** `created_by`
stores the username. `claim_order()` and `release_order()` compare against the
id.

⚠ **Eleven attention call sites, not five** — 3 in `WorkClient`, 4 in
`DashboardClient`, 4 in `Sidebar`. Sidebar is deliberately unenriched: its calls
ask only about `sla_breached` and `sla_due_soon`, both row-only.

---

# 7. An honest note on the last session

Four patch guards tripped during 2026-09-08. Every one was an anchor or a count
written from a half-remembered earlier read rather than from the file in front
of me — a miscounted `isWarranty`, a prefix-matching `attentionFor`, a doubled
`attentionFor(o)`, and a name collision with a dead component.

**The guards working is not the same as being careful.** They are the last line,
not the first. The first is reading the whole file.

That is also why the next-action panel is unfinished rather than half-shipped:
it deletes a component, drops orphaned imports, replaces a grid cell and edits a
second file, in 2,574 lines that had not been read through. Stopping was the
right call. Reading it end to end is the first thing to do.
