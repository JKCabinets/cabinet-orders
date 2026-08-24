# JK Cabinets OMS — Session Handoff

**Written 2026-08-20 · for the next OMS session, picking up cold**

This is a **pickup document**, not a reference. It covers every piece of OMS
work still outstanding — the order modal redesign first, because it is the
largest — with every decision already made so the next session can build
rather than re-litigate.

**Scope: the OMS only.** The storefront side — public claims intake, the chat
widget, Help Scout wiring and the `/api/public` surface — is a separate effort
with its own document, **HANDOFF-WEBSITE-TEAM-2026-08-20.md**. The two meet at
exactly one seam, described there.

**Read these first, in this order:**

1. **HANDOFF-2026-08-20-BUILD.md** — the codebase, the patch workflow, known-wrong code
2. **OPERATIONS-2026-08-20.md** — services, credentials, incidents, why things are as they are
3. **System Map 2026-08-20** (SVG) — the shape of it all on one page
4. This document

**⚠ Read the "How to work on it" section of the build handoff before writing a
single patch.** The patch-writing lessons there are not style preferences —
each one is a failure that cost real time on 2026-08-19–20.

---

# PART 1 — THE MODAL REDESIGN

## Why it is a rewrite, not a patch

`components/OrderModal.tsx` is **1,183 lines**. The redesign changes the
render wholesale: tabs replacing one long scroll, a restructured header, an
ORDER INFO grid, and a Recent Activity section. Anchor-patching that would
mean twenty fragile anchors against a file being reshaped anyway.

So it ships as a **whole-file replacement**, which raises the bar: every
behaviour that is not visual has to survive. §1.4 is the inventory.

⚠ **Reproducing a large file from pasted text is exactly what went wrong on
2026-08-03**, when an unrelated session regenerated `config/deploy.yml` from a
stale paste and silently dropped four secrets. Pull the file fresh, in three
chunks, and diff the behaviour inventory against the result before shipping.

```bash
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && sed -n '1,400p' components/OrderModal.tsx"    > ~/Downloads/oms-modal-1.txt
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && sed -n '401,800p' components/OrderModal.tsx"  > ~/Downloads/oms-modal-2.txt
ssh garrett@5.78.220.153 "cd ~/cabinet-orders && sed -n '801,1200p' components/OrderModal.tsx" > ~/Downloads/oms-modal-3.txt
```

## 1.1 The target layout

Two mockups exist (`Modal_Full_Order_page_Mock_Up.png`,
`Modal_Redeing_Mock_up_.png`). Garrett approved both layouts as drawn. What
follows is the written specification, because a PNG is not a spec.

### Header

```
ORDER
Garrett Battles                    [Past SLA 13d] [Unclaimed] [Claim order] [⋯] [✕]
SHO-1034 · Shopify · Aug 5, 2026
```

- Eyebrow "ORDER" above the customer name
- Customer name large, in the display face
- Meta line: order id · source · order date
- Right cluster: SLA badge (only when flagged), owner state, primary action,
  overflow menu, close

### Order progress

A five-dot stage rail with the current stage highlighted, its age beneath, and
a card below split into CURRENT STAGE and NEXT ACTION with the primary action
button on the right.

⚠ **Two corrections to the mockups.** Both draw wording that is no longer true:

- The mockups say **"13 days in stage"**. New measures from the **order
  date**, not the stage clock — deliberately, so a backward move cannot reset
  it. Render "13 days old" for New and warranty's New claim; "in stage"
  everywhere else. `SlaRule.measureFrom` tells you which.
- The mockups say **"SLA target: 24h per stage"**. Targets are not uniform.
  In production and At cross dock only run a clock while their dates are
  missing; Delivered, Parts ordered, Shipped and Resolved have no rule at all.
  Read the target from `slaRuleFor(order)` and say "no SLA on this stage" when
  there is none.

### Tabs

```
Overview | Full Order (54) | Files (0) | Activity
```

⚠ The mockup labels the second tab **"Items"**. Garrett asked for **"Full
Order"**. Use that.

### Overview tab

- **ORDER INFO** — an eight-cell grid with an Edit affordance: Source, Order
  date, Owner (with inline Claim), Order type, SKU, **PO / Reference**,
  Delivery target, Last updated
- **ORDER ITEMS** — a short preview with "View all →" that switches to the
  Full Order tab
- **CUSTOMER NOTE** and **INTERNAL NOTE** side by side, each with Add note.
  Internal keeps its STAFF ONLY pill and the "visible on the export PDF" line
- **ATTACHMENTS** — count, Upload, and the empty state as drawn
- **RECENT ACTIVITY** — the two or three latest entries with "View all →" to
  the Activity tab

### Full Order tab

- Summary chips: Items · Vendors · Modified · Issues
- Search box and a Filters control
- Table: SKU · Description · Vendor · Qty · Stage/Status · Notes/Mods · Actions
- Pagination with a per-page selector

### Footer

`View receipt` on the left; `Close` and `Update order` on the right, plus an
overflow.

## 1.2 PO / Reference — a derived value, no column

**Format: `Battles-SHO-1045`** — the customer's last name, a hyphen, the order
id. Garrett's reason: it makes tracking an order through the manufacturer far
easier than an opaque id.

It is **derived, not stored**. A helper in `lib/data.ts` beside `shapeOrder`:

```
poReference(order) = `${lastName(order.name)}-${order.id}`
```

**Two edge cases must be handled** rather than discovered:

- **A single-word name.** "Cher" has no last token distinct from the first.
  Use the whole name.
- **A company.** "Sunrise Builders LLC" would yield "LLC", which is useless.
  Garrett has not ruled on this. Suggested: strip a trailing legal suffix
  (LLC, Inc, Ltd, Co) before taking the last token, and if the result is
  empty fall back to the whole name.

Not decided: whether it should ever be overridable per order. Currently no.

## 1.3 Item grouping — DESIGN NOT FINISHED, DO NOT GUESS

Garrett's requirement, in his words: cabinets grouped together; hardware, if
present, in **its own category and its own table** with its own **status and
tracking number**; and a sample ordered alongside cabinets grouped the same
way. He described this as the real use of the "job" concept.

**This is a data-model change, not a layout one.** It gives line-item groups
their own lifecycle: hardware from Top Knobs ships on a different timeline
from cabinets from Waypoint, and needs a tracking number the cabinet pipeline
has no field for.

**Three questions must be answered before any code:**

1. **Does a hardware group need a full stage, or just a status plus tracking?**
   Garrett's description sounds like the latter — ordered / shipped /
   delivered with a tracking number, not the five-stage cabinet pipeline.
2. **What does the ORDER's stage mean when its groups differ?** Cabinets In
   production, hardware Delivered — what does the row say on `/orders/[stage]`,
   and which one drives the SLA clock?
3. **Where does the category come from?** The Shopify product vendor, a
   product type, or a SKU pattern? Note the sample products carry vendor
   "JK Cabinets 2 You" and **empty SKUs**, so a SKU-based rule would not see
   them.

Until those are answered, build the Full Order tab as a **single table** and
leave the grouping for a later piece. The tab structure makes adding it
straightforward.

## 1.4 ⚠ BEHAVIOUR INVENTORY — everything the rewrite must preserve

Compiled by reading all 1,183 lines. **Diff against this before shipping.**

**Store and session**
`moveStage`, `updateOrderDetails`, `updateNotes`, `updateInternalNotes`,
`archiveOrder`, `unarchiveOrder`, `deleteOrder`, `allOrders`, `team`,
`claimOrder` (wrapped with the conflict-toast UX shared with OrderTable),
`useSession` for `currentUserId`, `useToast`.

**The live-row lookup.** The modal finds its row in `allOrders`, not from the
prop. A previous version picked between `orders` and `warranties` from a prop
and silently showed a stale snapshot for any row in neither. Do not
reintroduce that.

**State**
`claimBusy`, `reDecodeBusy`, `notes` + `notesChanged`, `internalNotes` +
`internalNotesChanged`, `enteredGateError`, `checkingAttachments`,
`exportVendors`, `pendingStage`, `adminPin`, `pinError`, `showGateBanner`.

**Refs**
`pinInputRef` (focused when the PIN dialog opens), `overlayRef` (click-outside
to close), `attachmentsRef` → `AttachmentsPanelHandle`, `ackPanelRef` →
`AcknowledgmentPanelHandle`, `attachmentsAnchorRef` (scroll target).

**Behaviours that are easy to drop**

- **Admin PIN dialog.** A backward move from this view requires the override
  code. `pendingStage` holds the target, the dialog captures the PIN, Escape
  cancels it *before* closing the modal.
- **`consumeAckPicker(liveOrder.id)`** — after an acknowledgment upload
  elsewhere, opens the ack picker on mount, once. It is a consume, not a peek.
- **`initialReason === "needs-attachment"`** — scrolls to the attachments
  anchor and opens the file picker after ~350ms.
- **`checkAttachmentGate`** before a New → Entered move, with
  `enteredGateError` surfacing the failure.
- **Notes dirty-tracking.** Both editors track changes separately and save
  independently.
- **Escape and overlay click** both close — but only when no dialog is open.
- **Re-decode** with its own busy state.
- **Archive / unarchive / delete**, delete being irreversible.

**Panels rendered, with their props**

- `AcknowledgmentPanel` — `ref`, `orderId`, `orderName`, `eligible`,
  `onAdvance`, `onAdvanceOverride`. ⚠ **Not rendered for samples**
  (`liveOrder.type !== "sample"`) — they ship from JK stock and have no
  manufacturer acknowledgment.
- `AttachmentsPanel` — `ref`, `orderId`. Carries both the general upload and
  the **Receipt** upload (`kind: "proof_of_delivery"`).
- `OrderDetails` — the SKU table. Gated on `type !== "warranty"`.
- `QuoteInfoPanel` — when `source === "Manual"` and the notes contain
  "QUOTE REQUEST".
- `VendorExportPills` — ⚠ **not for samples**, same reason as the ack panel.
- `DateEditor` — takes `updateOrderDetails`.
- **`PaymentHoldBanner`** — added 2026-08-20. Refund / void banner with the
  acknowledgement control. See §2.1.

**Local components in the file**: `QuoteInfoPanel` (line ~866), `DateEditor`
(~955), `PaymentHoldBanner`. `STAGE_COLOR` at ~38 is a **private copy** of
`STAGE_ACCENT` from `lib/data.ts` — the rewrite should delete it and import
the shared one.

## 1.5 Suggested build order

1. Pull the file in three chunks; confirm the line count still matches
2. Write the new file, working section by section against §1.1
3. Diff against §1.4 — every item, explicitly
4. `tsc --noEmit`, then a click-through of every behaviour in §1.4
5. Ship as a whole file, not a patch

---

# PART 2 — WHERE THINGS STAND

## 2.1 Just shipped (2026-08-20, late session)

- **Dashboard uses the shared SLA table** — `SlaHealthByType` now renders on
  both `/sla` and the dashboard. The private `SlaCategory` interface is gone.
- **teams-digest migrated** off the legacy API. Reports by order **type**, not
  by stage — nineteen stages across four flows would be unreadable. Covers all
  four types. Sends even when all-clear, because a digest that only arrives
  with bad news is indistinguishable from one that has broken.
- **The legacy SLA API is deleted.** `SLA_TARGETS`, `daysInStage`, `isOverdue`
  are gone. They did not merely duplicate the rule model, they **contradicted**
  it: `SLA_TARGETS.New` was 3 days where the rules call it hard-overdue at 48
  hours.
- **Payment hold.** A refunded, partially refunded or voided order cannot move
  **forward** until acknowledged with a reason. Backward moves, archiving and
  date edits stay open — a refunded order usually needs walking back.
  `payment_hold_cleared_for` stores *which* status was acknowledged, so
  clearing a partial refund does not pre-clear a later full one.

## 2.2 Decisions made, not yet built

**Admin metrics — BLOCKED on a schema change.**

⚠ **`orders` has no money column of any kind.** Verified 2026-08-20 against
`information_schema`: no numeric, no price, no total. Sell totals are
impossible today.

Decisions taken:

- **Store the total at ingest**, not query Shopify live. The webhook payload
  already carries the figures and discards them. A metrics page that depends
  on a third party is a metrics page that breaks when they do.
- **Four columns**, all `numeric(12,2)` and **nullable**: `subtotal_price`,
  `total_tax`, `total_shipping`, `total_price`. Nullable matters — null means
  unknown, zero means actually zero, and free shipping is genuinely zero.
- **Custom orders: hand-entered.** They have no Shopify counterpart. The form
  should require only the total; the breakdown is optional.
- **A "job" is one order.** Garrett's reasoning, which is sound: the store
  allows mixed colours and door styles in one order, and a follow-up order
  days later has its own production timeline, acknowledgment and delivery.
  Grouping them would invent a relationship the operation does not have.
- **Refunded orders must be excluded from sell totals** — which is what
  prompted the payment-hold work.
- **`orders/updated` must refresh the figures**, so a later refund does not
  leave a stale total inflating the month forever.
- **Backfill** through the existing `/admin/shopify` import tool.
- **No currency column.** Everything is USD. Adding one retroactively means
  backfilling every row, so this is a deliberate choice rather than an
  oversight.

**Notifications — infrastructure ready, nothing built.**

Microsoft Graph is configured and **scoped to the No-Reply mailbox only**
(see OPERATIONS §8). Still to build: `lib/graphMail.ts`, a send log keyed on
**order + trigger** so a retry or a backward-then-forward move cannot
double-send, the confirm/deny queue, and templates.

Five triggers, each with a staff confirm/deny prompt: production finish date
set · production date changed · delivery date scheduled · delivery date
changed · delivery accepted and signed for.

Plus a **scheduled** sixth: on the last day of the production range, from the
existing `production-complete` cron — the only trigger with nobody present to
confirm it, and the one the confirmation email already promises.

⚠ **Four of the five are date-field changes**, and all date edits flow through
`PATCH /api/orders/[id]`. One hook point, not four.

**Health status in the app.**

A panel on `/admin` and a dashboard banner reading healthchecks.io's API.
Needs a read-only key in `.env.kamal` **and declared in `config/deploy.yml`**.

⚠ **A convenience layer over email, never a replacement.** The dead-man's
switch works because it is off-box; if the box is down, so is the OMS, and an
in-app banner shows nothing.

## 2.3 Open backlog, ranked

| | Piece | Notes |
|---|---|---|
| 1 | **Modal redesign** | Part 1 of this document |
| 2 | **Money columns + admin metrics** | §2.2; migration first |
| 3 | **Item grouping** | §1.3; three questions first |
| 4 | **Notifications** | §2.2; largest remaining build |
| 5 | **Health status panel** | §2.2; small |
| 6 | **Public intake Phase 1 items 4–13** | See the storefront build plan |
| 7 | **Known-wrong code** | Build handoff §10 |

## 2.4 The known-wrong list, unchanged

From the build handoff, none of these are fixed:

- **`override_ack`** on New → Entered is client-supplied, unlogged, no role
  check. The delivery gate and the payment hold both do the opposite; this is
  the odd one out.
- **`claimed_by` / `entered_by` reset on a no-op stage write** — they fire on
  presence, not change. Same bug class as the fixed `stage_entered_at`.
- **`/admin/vendors` and `/admin/shopify` have no client gate.** Mutations are
  gated route-side, so the exposure is cosmetic.
- **`app/calendar/page.tsx` fetches orders itself**, bypassing the store. That
  is why three unmapped delivery fields went unnoticed for months.
- **Concurrent identical webhook deliveries can race** on insert.
- **Three private stage-colour copies** remain.
- **Dead code in `SLAClient`** after the redesign: `BarRow`, `StageAgingRow`,
  `OverdueStageBlock`, `OverdueRow`.

---

# PART 3 — THINGS THAT WILL BITE YOU

Condensed from the build handoff. Read that too, but do not start without
these.

**The deploy loop**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS"; echo "EXIT: $?"   # EXIT:1 = clean
git add -A && git commit -m "..." && git push origin main && kamal deploy 2>&1 | tee kamal-deploy.log
echo "=== ERRORS: $(grep -cE 'ERROR \(' kamal-deploy.log) ==="
```

⚠ **`grep -c 'ERROR (SSHKit'` reports ZERO on a Kamal config error.** Use
`grep -cE 'ERROR \('`. And "Finished all" prints on aborts.

**Secrets vanish in three ways, all silent**

1. Not declared in `config/deploy.yml` under `env.secret` → never reaches the
   container, no warning
2. Edited but not redeployed → Kamal reads `.env.kamal` at deploy time
3. Mistyped or partially pasted → a 45-character value where 64 was expected
   produced no error, just half the webhook deliveries failing

**The only reliable check:**

```bash
docker exec "$(docker ps -q --filter label=service=cabinet-orders | head -1)" \
  sh -c 'echo "${#SOME_SECRET}"'
```

Lengths, never values. `kamal secrets print` does **not** catch any of the
three.

**Patch-writing, learned expensively on 2026-08-19–20**

- Build fixtures from the **real file including neighbouring code**. Three
  anchor collisions came from fixtures assembled to make an anchor resolve.
- A marker testing for **presence** cannot detect a partially-applied change.
- Verify what the patch **did**, not what it left alone. Four false aborts
  came from sweeps asserting things about untouched code — including three
  that matched the patch's own explanatory comments.
- **Syntax-check generated TypeScript.** A comment-block insertion landing
  outside its comment produced 34 errors at the gate.
- Never let one constant be both "text to insert" and "text to delete".

**Stage names are not unique.** `"In review"` exists in both the warranty and
custom flows. Always resolve against the row's `type`. This is enforced in
three places now; do not add a fourth path that skips it.

---

# PART 4 — WHAT NOBODY HAS ANSWERED

These are not code problems. They need a person.

- **⚠ Garrett is the sole admin on all eleven services.** No second holder of
  any credential, no break-glass procedure. The largest operational risk in
  the system, and the Hetzner backup cannot restore it.
- **⚠ `jk-sku-builder`** — a second application with its own Supabase project
  and host, ~$17/month, roughly 9% of spend, documented nowhere. What is it,
  is it live, does anything depend on it?
- **Supabase PITR status and retention.** The Hetzner backup covers the box,
  not the database, and the database is where the orders are.
- **The Hetzner restore has never been tested.**
- **The Graph client secret's expiry is unrecorded** outside the Azure portal.
  Its failure mode is customer notifications silently stopping.
- **Does `rateLimitOr429` fail open or closed** when Upstash is unreachable?
- **Should the SLA clock respect business days?** It runs on wall-clock hours
  including weekends, so a Friday 5pm order is hard-flagged by Sunday
  afternoon with nobody working.
