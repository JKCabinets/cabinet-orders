# SESSION HANDOFF — 2026-09-14

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

Garrett, 2026-09-14: **custom has no gates, period — it is an organisation tool.**

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

### 7. Claims are enforced — server first

`app/api/orders/[id]/route.ts` refuses mutations to a row claimed by somebody
else with 409 `claimed_by_other`. Unclaimed is open (claiming is how you take a
row). Admins may proceed and it is written to the activity trail.

⚠ **Ownership resolves through the project.** `orders.claimed_by` is null on
every project-linked row since the claim moved up on 2026-08-25, so a check
reading it raw finds no owner on any Shopify purchase and enforces nothing on
the type with the most hands on it.

The modal hides what the server would refuse, and admins get an explicit **Edit
order** toggle that resets when the modal points at a different group. The UI is
the courtesy; **the route is the enforcement.** Read-only is not blank — the
checklist and stage still render, because somebody who cannot act on a row still
needs to see what it is waiting on.

### 8. Realtime on `projects`

The publication carried `orders` and `team_members` but not `projects`. Since
the claim lives on the project, **a claim taken by one person reached nobody
else's screen until they refreshed** — which defeats the entire purpose of
claims. The subscription in `lib/store.tsx` had been correct the whole time and
had nothing to receive. Recorded as `migrations/2026-09-14-realtime-projects.sql`.

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

---

## Decisions — keep the reasoning, not just the outcome

| Decision | Reasoning that must survive |
|---|---|
| Custom exempt from the receipt gate | Terms 12.3 is a Shopify-checkout agreement and does not reach custom jobs. The gate was enforcing the wrong document. |
| Custom has no gates at all, UI included | It is an organisation tool. A demand nothing enforces is worse than a gate. |
| Cabinet delivery date stays a client-side nudge | Garrett, 09-14: effectively gated because the row withholds Confirm Delivery until a date is entered. Not a server rule. |
| Warranty claims cannot be raised against custom jobs | Our warranty process is a Terms process — the 48-hour window, the conditions precedent, the evidence rules all derive from the checkout agreement a custom customer never accepted. The claim modal's picker already excludes custom; **that exclusion is correct and should say why.** Not yet recorded in the picker — see open items. |
| A warranty claim blocks deletion rather than being resolved | The claim is evidence; it should outlive the purchase record, and a person should decide. |
| Manual Push, not "Mark delivered anyway" | The stage page has always called it Manual Push. Two names for one action is how somebody concludes there are two. |

---

## Open — not done, deliberately

1. **Upload routes are not claim-gated.** Attachments and acknowledgments POST
   to their own routes, which commit 7 did not cover. The buttons are still
   offered on a claimed row **on purpose** — hiding them would make a UI-only
   rule, which is the thing that pair of commits exists to stop being. Gate the
   routes, then hide the buttons.
2. **`OrderTable` row actions are still live for non-owners** and now fail with
   a 409 toast. Needs `isAdmin` plumbed into that component; it has
   `currentUserId` but no notion of role.
3. **`order_activity` and `order_attachments` do not publish over realtime.**
   Adding them to the publication alone would broadcast to no listener — the
   client has no subscription for them. Code first, then the publication.
4. **Rail timestamps** (mockup 2) need a real per-transition time. The activity
   trail's `time` is a display string from `toLocaleDateString` — `"Aug 24"`,
   no clock time. Either the PATCH route starts writing a real timestamp per
   transition (better, and useful beyond the rail) or the rail shows dates only.
   Garrett is content to defer this.
5. **The remaining PATCH gates** are still hand-written: acknowledgment,
   production start date, tracking.
6. **The warranty-vs-custom exclusion is not yet documented in the picker.**
   Decision is made (see table); the comment and doc line are not written.
7. **No `webhook_events` table.** Webhook outcomes go to `console.warn` only,
   readable via `docker logs`. Three separate diagnoses today needed those logs.
   A persisted table would have made the 1051 investigation minutes instead of
   an hour.

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
