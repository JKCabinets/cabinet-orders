# HANDOFF — 2026-08-25 · Projects, claims, and the work-first rework

**Read this before `HANDOFF-2026-08-20-BUILD.md`.** That document describes the
Project Orders model as it stood on the 24th. Everything below either extends
it or contradicts it, and where they disagree, this is current.

Two things landed today that change how the whole app is read:

1. **A purchase is the unit of ownership.** It is archived as a whole, claimed
   as a whole, and shown as a whole. Its orders are how it gets worked.
2. **Every page answers "what needs a person" from one derivation.** Not from
   its own filter.

---

# 1. The attention engine — `lib/attention.ts`

**The single answer to "why does this need somebody".** The dashboard tiles, the
needs-attention table, the work queue and the sidebar badges all read it. Not
one of them carries a predicate of its own.

That is not tidiness. This codebase produced **four instances in six days** of
one rule enforced in two places with a clause missing from the second — the
bulk delivery gate, the bulk attachment gate, the client-side ack gate, and the
flow guard. Every one failed silently because both sides still returned a
plausible answer. A fifth would have been the dashboard disagreeing with the
queue about how much work there is.

```
attentionFor(order, enrich?)      → reasons for ONE row
attentionForProject(p, groups)    → reasons for a PURCHASE
attentionCounts(orders)           → the dashboard's buckets
```

**Reason kinds:** `payment_hold`, `ack_missing`, `receipt_missing`,
`sla_breached`, `sla_due_soon`, `blocked_missing_data`, `unclaimed`.

⚠ **"Blocked" is not a new concept.** It is `SlaRule.clockRuns` returning true,
which already means *the data that would let this move is absent*. Naming it for
what a person can do about it, rather than inventing separate predicates.

⚠ **The buckets OVERLAP, deliberately.** A purchase blocked for sixty hours is
counted in Blocked AND Past-SLA AND Needs-attention. They are four questions
about the same rows, not a partition. Making them exclusive would drop a row out
of "Blocked" the moment it also breached — which is when you most want it there.

⚠ **`enrich` exists because two reasons cannot be read off a row.** A missing
manufacturer acknowledgment lives in `order_acknowledgments`; a missing signed
receipt in `order_attachments`. Callers that have that data pass it in; callers
that do not get *fewer* reasons rather than wrong ones. The alternative was a
second implementation for the enriched case, which is the thing the file exists
to prevent.

**Tunable in one place:** `DUE_SOON_HOURS = 6`, `UNCLAIMED_AFTER_HOURS = 24`
(matched to the soft SLA tier rather than picked).

---

# 2. Archiving moved to the PROJECT

`migrations/2026-08-25-project-archive.sql`

A Shopify checkout is archived as a whole purchase. The archive fills with
**hundreds of purchases rather than thousands of groups**, and a cabinet group
can no longer be archived off the board at stage New while its project is live.

⚠ **`orders.archived` IS NOT SET on project-linked rows.** A group is hidden
because its PROJECT is archived, resolved by lookup in the store. Two columns
carrying one fact is two columns that can disagree, and the second is the one
that gets forgotten.

`orders.archived` remains in use for **standalone rows** — custom jobs. Warranty
claims are not archived at all: `Resolved` and `Denied` are their folders.

## The gate — `PATCH /api/projects/[id]`

**Every group at the last stage of its OWN flow**, read from
`STAGE_LIST_BY_TYPE`. Not `stage === "Delivered"` as a string: hardware's
terminal stage is reached by a different route, and a string comparison would be
a second copy of the stage maps.

**A refunded project may be archived regardless of stage.** A refund on a
checkout whose cabinets never shipped means those groups will never reach
Delivered; a strict rule would strand it on the board forever. The refund IS the
ending.

**An unrecognised type is refused, not assumed finished.** A type with no known
flow cannot be proven complete, and archiving on the strength of one hides a bug.

⚠ **Enforced server-side, not by hiding the button.** Same lesson as the
delivery-proof check that `/api/orders/bulk` skipped entirely.

---

# 3. Claiming moved to the PROJECT

`migrations/2026-08-25-project-claim.sql` and `-project-claim-functions.sql`

**One owner per purchase.** Groups were claimed separately, so a designer who
had finished the cabinets could not close the purchase while somebody else sat
on the hardware. Garrett's framing: *one contact for that entire order*.

⚠ **THE GROUP COLUMN WAS CLEARED, not left behind** — the opposite of what the
archive migration did with `orders.archived`, and deliberately so. No group had
ever been archived, so leaving that column untouched left no ambiguity. Groups
**were** claimed, so leaving those values would have meant two populated columns
describing one fact. Backfill up, then clear down: exactly one source.

`orders.claimed_by` remains in use for **standalone rows only**.

## The mechanism

`claim_project()` / `release_project()` mirror `claim_order()` /
`release_order()`: `SELECT ... FOR UPDATE` so concurrent claims serialise, first
writer wins, and the loser is **told who holds it**.

Two deliberate differences from the order version:

- **No dead `wrong_stage` branch.** `claim_order()` carries one commented out
  with its return values pre-written — an invitation to uncomment a rule nobody
  has thought about since. A project spans several flows at once, so "which
  stage" has no single answer here anyway.
- **An admin may release anyone's claim.** One owner per purchase means a claim
  left by somebody on holiday would strand the whole thing. The admin flag is
  decided **in the route from the session**, never from the body — the SQL
  function trusts it, which is why it is service-role only.

## Where the claim is read

Seven places read `orders.claimed_by` directly before this. All now resolve
through the project for a Shopify group:

| | |
|---|---|
| `OrderTable` | `ownerOf(order, projects)` — a free function, because three of its consumers are plain renderers without the hook |
| `OrderModal` | claims the project; control available at **any** stage now |
| `Sidebar` | My Work counts purchases you own that need something |
| `WorkClient` | entries are purchases |
| `ProjectsClient` | group chips and expanded rows |
| `DashboardClient` | rebuilt on the attention engine |

⚠ **The modal's claim control is no longer New-only.** That rule belonged to
per-group claims: a group past New had been worked, so its claim was spent. A
PURCHASE is owned for its whole life. Standalone rows keep the old rule.

⚠ **Claiming is NOT done from the stage tables.** A Claim button on a cabinet
row would quietly take the samples and hardware with it. `useRowActions`
refuses **loudly** rather than silently — a call getting that far means a
control was rendered that should not have been.

---

# 4. Pages

## `/work` — the work queue

Rows are **purchases**, matching the claim. Custom jobs and warranty claims
appear as single rows alongside.

**Column order IS the hierarchy:** why I care → what → where → who. The stage
pages lead with the customer, which is right when looking up an order and wrong
when working a queue.

⚠ **TWO SCOPES, ASYMMETRIC ON PURPOSE.**

- **My work** — everything you own, whether or not anything is wrong. It is a
  hub, not an exception list. An empty My Work used to mean "nothing you own
  needs anything" while reading as "you own nothing".
- **Unclaimed** — exceptions only. Something nobody owns and nothing is wrong
  with is not work, it is just an order.

The tab counts mirror their own filters exactly. `?scope=` and `?reason=` are
read from the URL so dashboard tiles land on the right filter.

**An unowned row leads with "Unclaimed"**, not its breach — the breach is a
consequence of nobody having picked it up.

## `/projects` — the hub

One row per purchase, expandable to its orders. Filters: All · Active · Needs
attention · Complete · Refunded · Archived. Archived rows appear **only** under
their own filter, including being excluded from All.

⚠ **Archive and claim controls are `div role="button"`**, not `<button>` — they
sit inside the row's expand button, and nesting buttons is invalid HTML.

⚠ **A missing total renders `$0.00`, by decision.** The unknown/zero distinction
is preserved where it changes an answer: `/admin` counts unpriced projects
separately.

## `/orders/[slug]` — the orders hub

**One component, generic over type.** `cabinets` and `hardware` open on All;
the legacy `new`, `entered`, `in-production`, `at-cross-dock`, `delivered` slugs
resolve to the **same page** with that stage preselected. They were never
separate pages; retiring them later is deleting entries from `stageSlugs.ts`.

`archived` is archive mode: no stage cards, since an archived row keeps whatever
stage it was archived at.

⚠ **`SamplesClient` is a second copy of this component** and can adopt it in a
one-line change. Not done yet.

## `/dashboard` — a launchpad

Four action tiles → needs-attention table → pipeline snapshot → SLA/data health
→ system health.

**Every tile links into `/work` with its own filter.** That is the difference
between a dashboard and a report.

**Tile subtitles carry a second, genuinely different figure** — a subset or an
age, never a restatement of the number above.

⚠ **The pipeline snapshot merges custom's "In production" and "At cross dock"
FOR DISPLAY ONLY.** `CUSTOM_STAGES` still has six entries and must:
the rail, backward-move detection, `fieldsToClearOnBackwardMove` and the SLA
rules all read it. `DISPLAY_MERGE` is data-driven so a second merge is an entry,
not a branch.

⚠ **The snapshot is one grid for all rows, sized by the LONGEST flow.** A
three-stage row leaves trailing cells empty rather than being its own flex line
— that is what keeps hardware's "Ordered" aligned under cabinets' "New".
`minmax(104px, 1fr)` fills the width and scrolls only below a readable floor.

**System health says "Not configured"** until a healthchecks.io key exists in
`.env.kamal`. A green tick nobody verified is worse than an honest blank in the
one panel meant to report breakage.

## Sidebar

Overview (Dashboard, My Work) · Shopify (Projects, Cabinets, Hardware, Samples)
· Offline/service (Custom Jobs, Warranty Claims) · Operations (SLA, Calendar,
Archive, Team, Admin).

**The five cabinet stages left the sidebar.** They are stage cards inside the
Cabinets hub, so the pipeline lives where the orders are.

⚠ **Category badges count LIVE rows** — not archived, not terminal — with a
separate green "N new" badge for first-stage rows. Counting first-stage only
made Cabinets read 6 while a seventh sat at cross dock.

⚠ **The My Work badge counts what NEEDS something; the My Work tab lists
everything you own.** They differ on purpose. A badge reading 12 when nothing is
wrong trains people to ignore it.

---

# 5. Also landed today

- **`orders.total_price`** with `orders_total_price_standalone_only` — a
  project-linked row physically cannot carry a total, so revenue is
  `sum(projects.total_price) + sum(orders.total_price)` with no overlap
  possible. Postgres enforces it, not a comment.
- **`/admin` revenue panel** — month and year to date, **dated by when the order
  was placed**, with unpriced projects reported separately rather than summing
  as zero.
- **Hardware SLA** — 24/48h at `Ordered`, measured on **missing tracking**
  rather than elapsed time, matching how In-production and At-cross-dock work.
- **Manual creation restricted** to custom jobs and warranty claims.
  `MANUAL_CREATABLE_TYPES` in `lib/data.ts`. Cabinet, sample and hardware rows
  are groups of a Shopify project; a hand-made one would have no project, no
  `shopify_id` and no line items while sitting on the stage pages looking real.
- **The delivery gate now explains itself.** The rule, the override and the
  activity row had existed since August; the modal never asked and never read
  the answer, so the row bounced back with `console.error` under a comment
  reading *"since we don't have a toast system"*. `useToast` is imported twelve
  lines away.
- **The modal pipeline rail is admin-only.** Team members advance orders through
  the tools that enforce the gates.
- **Backward-move clearing is a per-flow DECISION**, not a deferral. Custom
  orders do not clear: the flow is a designer's notebook, dates typed in after a
  phone call, and nothing automated reads them. The arithmetic was generalised
  anyway — a known-wrong calculation behind a guard is inherited by whoever
  narrows that guard.
- **Custom `Ordered` lost its SLA rule** — waiting on a manufacturer, same as
  warranty's `Parts ordered`.

---

# 6. ⚠ Silent drops — now SEVEN

A column exists in the database and in the API routes, and the TypeScript type
never learned about it. Every typed caller is blind to real data and **nothing
errors**.

| | Found by |
|---|---|
| `orders.shopify_id` | still true — `shapeOrder` has never mapped it |
| `SkuItem.vendor` | tsc, when the Full Order table read it |
| `Order.total_price` | tsc, writing into a typed object |
| `store.addOrder`'s payload whitelist | a field silently not arriving |
| `Project.archived` | tsc, in the store memo |
| `Project.claimed_by` | tsc, same |
| `orders.claimed_by` read in 7 places | a screenshot showing "Unclaimed" beside a named owner |

**`addOrder` was the dangerous one** — it built an explicit payload object, so a
missing field was dropped with no error and no type failure. It spreads now.

**The pattern is not forgetfulness.** A column with N readers and no single
accessor will be read directly by N-1 of them. `ownerOf()` exists for this
reason; `orders.shopify_id` still does not have one.

---

# 7. ⚠ Patching discipline — additions

Supplements the appendix in `HANDOFF-2026-08-20-BUILD.md`.

## Anchors that cannot distinguish two call sites

`if (stage === "New") { const claimedBy = order.claimed_by ?? null;` appears in
**both** `StatusLabel` and `UpdateStatusActions`, and the two needed **opposite**
treatment — one is a plain renderer needing a helper, the other has the hook and
already had `claimedBy` in scope, so rewriting it there both referenced a missing
binding and shadowed the correct value. **Four attempts.**

Split the file at function boundaries and treat each occurrence by which
function it is in.

## A replacement that is a PREFIX of its anchor

"Already applied" is derived from the replacement being present. If the
replacement is a prefix of the anchor, it is present *before* the step runs, so
the step **silently skips** and reports success. Cost one unapplied fix on
2026-08-25. The runner refuses this now.

## Guards that read their own prose

Three separate guards fired on comments the patch itself had written — scanning
for `ORDER_STAGE_ORDER.indexOf`, `__none__` and `<button>` inside text
explaining why each was wrong. **Strip comments before scanning code.**

## Prop shape: pass the answer, not the lookup

`StatusLabel` was given the whole `projects` map so it could resolve an owner
its callers had already resolved. Every caller then needed `projects` in scope,
and two could not satisfy it. Passing `claimedBy: string | null` fixed it — one
value, resolved once, at the level that already knew it.

## ⚠ An abandoned patch loses its unapplied steps

Twice on 2026-08-25 a patch was abandoned mid-way (stale fixtures), the problem
fixed, and **only the part being actively looked at** rebuilt. The rest did not
fail — it stopped existing, unnoticed for hours. "All Work" stayed in the
sidebar for a full day this way.

**When abandoning a patch, write down its unapplied steps.** Same failure shape
as every silent drop above, one level up.

## esbuild parses; tsc understands

The sandbox parse catches structure. It does **not** catch: a duplicate JSX
attribute (TS17001), an undeclared type import, or a comment placed where JSX
forbids it. `npx tsc --noEmit` on the box remains the gate.

---

# 8. Still outstanding

- ⚠ **The column drop** — `shopify_id`, `ship_to`, `customer_phone`,
  `customer_email`, `payment_status`, `payment_hold_cleared_*` are still on
  `orders`. **109 references across 18 files.** Not urgent: ingest writes both
  sides so they do not drift. Code first, verified, THEN the migration.
  `orders.name` should stay regardless until warranty linking exists.
- **`/projects?filter=archived`** from the sidebar lands on All — the page reads
  its filter from state, not the URL. A nav link that does not do what it says.
- **`isStageAllowedForType`** still accepts a stage outside the UI flow. Needs a
  second predicate reading `STAGE_LIST_BY_TYPE`; the index map cannot be
  narrowed without breaking backward-move detection. **Partly addressed** —
  `isStageOfferedForType` exists and PATCH requires both — but other callers of
  the old one were not audited.
- **`SamplesClient`** duplicates `OrdersHubClient`.
- **Claim buttons still render on stage tables** and refuse loudly. Left visible
  deliberately so any unexpected placement surfaces; hiding them is a follow-up.
- **healthchecks.io key** for the system-health panel.
- **Per-member workload** — Garrett wants active-order counts per team member.
  Suggested home: `/admin/team`, which is already the permanent record of who is
  who.
