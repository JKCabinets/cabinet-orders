# Session handoff — 2026-08-26

For whoever picks this up next, including a fresh assistant chat with no memory
of it.

**Read `docs/OMS-STATE-2026-08-26.md` first.** That is what the system IS — the
data model, the five pipelines, the gates, the monitoring. This document is what
happened, what is left, and how to work on it without breaking things.

**One home per fact — the split is in `OPERATIONS`, in the header block above
§1, and only there.** It was agreed at the end of this session after finding the
same stale table in two documents, and then written into three with three
different row counts, which is the same mistake at one remove. This handoff owns
what changed, what remains, and how to work on it.

⚠ `HANDOFF-2026-08-20-BUILD.md` still carries a copy of the model in §3. It is
accurate as of today. **Amend `OMS-STATE` going forward** and let §3 shrink to a
pointer next time anyone is in there.

---

# 1. What shipped today

## Flows

**Samples** became `New → Shipped → Delivered`. "Entered" was our bookkeeping
word; a customer tracking an order sees *shipped*.

**Hardware** became `New → Ordered → Shipped → Delivered` — it had no `New`
stage at all, so an ingested group arrived reading as already placed with the
vendor.

⚠ **A tracking number is what makes a group "Shipped".** Not a button. Entering
one in the modal advances it; so does a Shopify fulfilment carrying one. One
rule, both doors. The webhook previously decided the stage itself and would
advance a group on a fulfilment carrying **no number at all**.

Samples needed their own stage array as a result. They had shared
`ORDER_STAGE_ORDER`, and that sharing was load-bearing — it gave them
backward-move detection and date clearing for free. `FLOW_BY_TYPE.sample` still
reports `"order"` deliberately so they keep clearing the delivery date on a
reversal; the calendar reads it.

## The three list clients collapsed

`SamplesClient`, `CustomClient` and `WarrantyClient` are gone. **~580 lines
deleted.** All three were `OrdersHubClient` written again.

⚠ **The gates were never in those files** — they live in `OrderTable`'s action
column, in `PATCH /api/orders/[id]`, and in the flow maps. That is why merging
five different pipelines into one list component is safe, and why three copies
meant one bug appeared three times: each passed a `"__none__"` sentinel on its
All tab, which matched no branch, so `/samples` and `/custom` rendered the
sentinel in the Status column of every row.

⚠ **`UpdateStatusActions` now branches on the ROW, not the table.** It used to
return null whenever the prop did not describe the row — and its own comment
listed the two reasons it had broken. Both were the prop being *wrong about this
row*. Refusing was never the answer; asking `order.stage` was. Refusing is what
emptied the action column on every All view and drove three files to invent a
sentinel.

## System health

`/api/health-summary` (any signed-in user, three rolled-up statuses) and
`/api/admin/health` (admin, the full list).

⚠ **The rollup is server-side.** Sending eleven checks and hiding the names in
the component would put the list in a non-admin's browser. Hiding it in the UI
is not access control.

⚠ **Four of the eleven checks watch anything.** The first version grouped all
eleven and reported "Catalog sync · Healthy · 5 checks" when four of those five
could not report anything else. See §3.

## Also

- **The tracking field exists** — carrier and number on sample and hardware
  groups. When the next stage is `Shipped` it **replaces** the next-action
  button, because typing the number *is* the action. A refused move opens the
  modal with the field glowing and focused.
- **The dashboard is a launchpad**: four action tiles linking into `/work` with a
  reason preselected, needs-attention, pipeline snapshot, SLA health, system
  health. Fits one screen at 1080p.
- **`isStageAllowedForType`** turned out to be closed already — one caller,
  already checking both predicates. The two stage maps now match exactly for
  every type, and `lib/stageLogic.ts` asserts it at module load in development.
- **Projects table respaced**, address dropped from the rows (still searchable).

---

# 2. ⚠ The six-day monitoring outage

Fixed. **The incident is in `OPERATIONS` §9**, which owns history, and **the
rules it left in force are in `OMS-STATE` §5**. It is not repeated here: writing
it in three places is the failure this document set exists to prevent.

Read it before touching cron or healthchecks, because the shape recurs and the
lesson generalises: **the jobs ran, cron logged `rc=0`, the container logged
success, and the dead-man's switch was dead for six days.**

---

# 3. ⚠ Things found by reading, not by grepping

Three corrections came out of a full read of the operations doc at the end of the
session. **All three were invisible to search.** One was a bug shipped hours
earlier.

**Four of eleven healthchecks watch anything.** `OPERATIONS` §6 says "Four
checks, one per cron job"; §12 lists the other seven for deletion, each with a
365-day period so they report "up" forever. The panel shipped that morning
grouped all eleven. The seven are now ignored **by name**, not merely left
ungrouped — ungrouped is where a genuinely new check lands, and burying that
signal under seven meaningless ones defeats the safeguard.

**`rateLimitOr429` fails open**, answering a question open since 2026-08-19.
`lib/auth.ts`: *"Redis transient failure — fail open to avoid locking out legit
users."*

**The auth gate is `proxy.ts`, not `middleware.ts`.** A search for
`middleware.ts` finds nothing and reads as "no path guard exists", which cost a
wrong diagnosis. Both `PUBLIC_PATHS` and `ADMIN_PREFIXES` match on a `/`
boundary — `normalized === p || normalized.startsWith(p + "/")` — so
`/api/health-summary` correctly does NOT match the public `/api/health`.

**And an appendix written this session claimed the three-file secret requirement
was undocumented.** It is documented in build handoff §2 and `OPERATIONS` §5,
including the exact line about `.kamal/secrets` failing loudly. Publishing that
would have put a false claim inside the document that exists to correct false
claims.

---

# 4. ⚠ What is left, ranked

| | Piece | Notes |
|---|---|---|
| 1 | **The column drop** | `shopify_id`, `ship_to`, `customer_phone`, `customer_email`, `payment_status`, `payment_hold_cleared_*` are still on `orders` after being copied to `projects`. **109 references across 18 files.** Not urgent — ingest writes both sides so they do not drift — but code first, verified, THEN the migration. `orders.name` stays until warranty linking exists. **Its own session.** |
| 2 | **Rate limiting is keyed by IP** | `` `${bucket}:${ip}` `` — everyone behind one office IP shares one allowance on **every** rate-limited route, so one person working quickly can 429 a colleague, and a 429 body is not the shape any caller expects. Best candidate for the health panel reading "Not configured" for a non-admin, though never proven. Needs a decision about the bucket and a pass over every caller's limit. **Its own session.** |
| 3 | **Notifications** | Graph is configured and scoped. The order confirmation already promises *"we will notify you when your order has finished production and is on its way"* and **nothing sends it.** Five triggers each need a staff confirm/deny prompt, plus one scheduled from the `production-complete` cron. Four of five are date-field changes and all date edits flow through one PATCH route — **one hook point, not four.** |
| 4 | **Public intake** | Claims intake and `POST /api/public/lookup`. The contract is in `OPERATIONS` §2 — it returns a **project**, so it needs a status per category. |
| 5 | **Historic money backfill** | Projects ingested before the money columns sum as zero; `/admin` says how many. Backfill via `/admin/shopify`. |
| 6 | **Delete the seven stray healthchecks** | Carefully — four real ones share the account. Then shrink `IGNORED_CHECKS` in `app/api/health-summary/route.ts` to match. |
| 7 | **`/projects?filter=archived`** | The sidebar links to it; the page reads its filter from state, not the URL, so it lands on All. A nav link that does not do what it says. |
| 8 | **`SamplesClient` is gone but `OrderTable` spacing is not done** | The projects table was respaced; the other list pages render through `OrderTable`, which is a `<table>` and needs its own pass. |
| 9 | **Known-wrong code** | `override_ack` is client-supplied, unlogged and has no role check, unlike every other gate — **small fix, see below** · the calendar fetches orders itself, bypassing the store · concurrent identical webhook deliveries can race on insert · two private stage-colour copies remain. |

**⚠ On `override_ack` (item 9).** It is now named as known-wrong in
`OPERATIONS` §10, `OMS-STATE` §3 and here. That stops the next reader inferring
a policy from the delivery gate's "an override needs a reason" — it does **not**
reduce the inconsistency. It is still a control anyone can set from the client,
on a gate the other two enforce server-side with a logged reason. **The fix is
small:** read the role from the session, require a reason, write the activity
row. It matches two implementations that already exist, so it is a short job for
whoever is next in that route. Item 9 is the right rank while it is the
acknowledgment gate; it would not be if it were delivery or payment.

## Bigger than any of the above, and not code

- ⚠ **Garrett is the sole admin on every service.** No second credential holder,
  no break-glass procedure.
- **Supabase PITR status and retention are unknown.** The Hetzner backup covers
  the box, not the database.
- **The Hetzner restore has never been tested.**
- **What `jk-sku-builder` is** — a second application, its own Supabase project,
  ~9% of the monthly bill, documented nowhere.

---

# 5. How to work on this

**The assistant has no shell on the box.** It builds and tests in a sandbox,
delivers files, and Garrett runs them. Edits ship as **idempotent, anchor-based
Python patch scripts** validating every anchor first and writing nothing on any
miss. New files ship whole with `shasum -a 256`.

```bash
cd ~/cabinet-orders
python3 patch_whatever.py
npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"   # EXIT:1 = clean
rm patch_whatever.py                                          # BEFORE git add
git add -A && git commit -m "…" && git push origin main && kamal deploy 2>&1 | tee kamal-deploy.log
echo "=== ERRORS: $(grep -cE 'ERROR \(' kamal-deploy.log) ==="
```

⚠ `"Finished all"` prints on aborts. `grep -c 'ERROR (SSHKit'` reports zero on a
config error. Use `grep -cE 'ERROR \('`.

## ⚠ Work from WHOLE FILES, never snippets

Every anchor failure this session traces to reasoning about a partly-visible
file: a duplicate `style` attribute that could not be seen, a blank line that was
assumed, a second call site nobody knew existed. Pull the file, check the length
against `wc -l`, then patch.

Large files come across as base64 when a plain paste keeps arriving empty:

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && base64 -w0 path/to/file" > ~/Downloads/file.b64
```

## Lessons that each cost real time

**A secret needs THREE files.** The value in `.env.kamal`, a line in
`.kamal/secrets` reading it out, the name under `env.secret` in
`config/deploy.yml`. Missing the second fails the deploy loudly. Missing the
third reaches nothing, silently.

**esbuild parses; `tsc` understands.** A sandbox parse will not catch a
duplicate JSX attribute (TS17001), an undeclared import, or a name that does not
resolve. Three missing-import errors this session were invisible to it.

**Two call sites can need opposite treatment.** `if (stage === "New") { const
claimedBy = …` appeared in two components; one needed a helper, the other
already had the value in scope and would have been **shadowed** by the rewrite.
Four attempts. Split the file at function boundaries rather than matching text.

**Count elements, not strings.** A guard counting `"AvatarWithProfile"` read 5
where there were 3 renders — the import line contains the name twice.

**A replacement that is a PREFIX of its anchor skips silently.** "Already
applied" is derived from the replacement being present; a prefix is present
before the step runs. Cost one unapplied fix.

**Guards that scan for a string will fire on their own comments.** Three did.
Strip comments before scanning code.

**A CSS grid cannot draw a line across cells.** `borderTop` on each cell draws
under *that cell*, so a row whose short flow leaves cells empty gets a line that
stops halfway. Use an element spanning `1 / span N`.

**`fr` units hide small changes.** At a 1660px row there are hundreds of spare
pixels, so moving `0.85fr` to `0.9fr` shifts columns by single digits. Fixed px
for predictable content, `minmax()` only where content varies.

**A ternary branch takes ONE expression**, exactly like `{cond && (…)}`. A
comment plus an element is two children in both.

**When a patch is abandoned mid-way, write down its unapplied steps.** Twice
this week a patch was abandoned, the problem fixed, and only the part being
looked at rebuilt. The rest did not fail — it stopped existing, unnoticed for
hours. "All Work" stayed in the sidebar for a full day that way.

**A description of a fix needs one home too.** This session fixed a duplication
— the same stale table in two documents — by writing the rule against
duplication into all three, with three different row counts, each claiming to
solve exactly that. The instinct to make every document self-explaining is what
creates the copies that drift. The split now lives in `OPERATIONS` alone and
everything else points at it.

## ⚠ The failure mode this system actually has

Not crashes. **Silence.**

A tag overwrite that ran for weeks. A 64-day cron outage hidden by a duplicate
code path. Six days of dead monitoring with every layer reporting success. Seven
fields that existed in the database and in the API while being invisible to
every typed caller.

Two habits catch these. **Read the thing end to end rather than grepping it for
what you expect to find** — three corrections in this session, including a bug
shipped the same day, were invisible to search and obvious on a full read. And
when a rule matters, **make something notice**: a CHECK constraint, a type, a
guard in the patch, an assertion at module load. A rule that lives only in a
comment is a rule that will be broken by someone who never read it.
