# SESSION HANDOFF — 2026-10-13

Covers 2026-10-06 → 2026-10-13: items 29–47 of the running record. **Start
here.** Successor to `docs/SESSION-HANDOFF-2026-09-15.md`, which stays as the
detailed record — items 0–47 in full, every decision with its reasoning, and
the process lessons — and is still true wherever this file does not say
otherwise.

⚠ **THIS FILE HOLDS THE OPEN LIST FROM NOW ON** (§6). The old file's "Open"
section is the record of how each item got there; the list continues here,
re-sorted, every still-open entry carried over. One home, or a correction
lands on one copy and misses the other.

**Read in this order before touching anything:**

1. `docs/OMS-STATE-2026-08-26.md` — what the system IS: data model, flows,
   gates, monitoring. Its header lists every amendment, newest first.
2. `docs/OPERATIONS-2026-08-26.md` — the business, services, credentials,
   customer commitments, §10 decisions and why, §12 what is still unknown,
   §13 chargeback evidence. Its header table says which document owns what.
3. This file.
4. `docs/SESSION-HANDOFF-2026-09-15.md` — "The standard", "Pulling files",
   "Deploying", "Process" and "The patch scripts" are the full method; §2 below
   is the summary.

Then pull whole files for whatever you are about to edit. Never work from
snippets or from memory of a file: this session found the deployed file
different from the assumption more than once.

---

## 1. The project in one screen

- **What:** the JK Cabinets 2 You order management system (OMS) — cabinet
  orders, samples, hardware, custom jobs and warranty claims, from Shopify
  checkout or by hand, through to delivery; vendor acknowledgments; claims;
  Help Scout; files.
- **Stack:** Next.js **16.4.0, pinned exactly** · React 19.3 · Supabase
  (Postgres, Storage, Realtime) · Kamal → the Hetzner box `5.78.220.153` ·
  `https://www.ordersjkcabinets2you.com`.
- **Repo:** `~/cabinet-orders` on the box, every commit on `main`. Garrett is
  the sole admin of every service (OPERATIONS §12 — the largest single risk).
- **Pre-launch.** Every order is a test order (Garrett, 2026-10-13); test data
  may be deleted. Consent, claims and the health checks are nonetheless built
  and proven as if live.
- **Time:** `America/Phoenix` wherever a person reads a time — UTC-7 all year,
  no daylight saving. Stored ISO; shown MM/DD/YYYY (OMS-STATE §3).
- **Integrations:** Shopify (the webhook ingests `orders/create`, `updated`,
  `cancelled`, `delete`); Help Scout (inbox **373175**, "JK Cabinets 2 You":
  every website claim, claim progress notes, consent obtained by email);
  healthchecks.io (six checks, OPERATIONS §6); Waypoint acknowledgments
  (`.xlsx`, reconciled); the website team (storefront, claims form, consent).

## 2. How work is done here

The full method is in the 2026-09-15 handoff. In short:

1. **Pull whole files** from the box: `tar` over ssh, with a `wc -l` listing
   uploaded beside it; check every count. Pull again before editing a file
   another commit may have touched.
2. **Change by patch script** — never by hand on the box. Each script applies
   ANCHORED edits (the old text occurs exactly once; the new text is absent
   before and occurs exactly once after; nothing empty — a deletion leaves a
   one-line note) and whole-file replacements GUARDED by the deployed file's
   sha256. A re-run prints `ALREADY APPLIED`; any miss prints `MISS` and writes
   NOTHING. Every code change has a `patch_docs_*.py` in the same commit.
3. **Prove it before it ships, against the real code:**
   - the real route or module, driven with RECORDING stand-ins that log every
     operation in order (files before rows; nothing written on a refusal);
   - a migration on a real Postgres, **run twice**, over existing rows;
   - components rendered (jsdom), clicked and typed into;
   - a **control**: the DEPLOYED version through the same harness, to show
     the bug or false alarm exists before claiming a fix;
   - a strict typecheck of every changed file, its error set compared with the
     deployed files' in the same tree (stand-in noise cancels), and a planted
     error per file to prove each was read;
   - the script applied to a box-shaped tree: `APPLIED`, re-run
     `ALREADY APPLIED`, every written file byte-identical to the tested one,
     and a GENUINELY broken anchor leaving the tree byte-identical.
4. **Deploy** (inside `tmux new -As deploy`): verify both hashes on Windows
   (Git Bash) and on the box → clean tree → apply → `npx tsc --noEmit` → a
   migration is run in the Supabase SQL editor **before** deploying (its last
   statement is its own check) → `git add` the exact files → nothing unstaged
   or untracked → `git diff --cached --stat` (the count is given) → commit →
   push → `kamal deploy | tee` → the `DEPLOYED`/`MISMATCH` check.
   ⚠ `npm run build` FAILS in a plain shell — no `SUPABASE_URL` — and that is
   not a bug: build the image with `--secret id=NAME,env=NAME` for every id the
   Dockerfile mounts (OMS-STATE §7; the full command is in old item 38).
5. **Deliver:** present every file — twice this session one was written and
   not presented, and Garrett had to ask. Give a migration's SQL INLINE in the
   message as well as in the script.

## 3. Lessons this session paid for

Add these to the old handoff's "Process" list when it is next touched.

- **Account for every count.** Two test cases counted one discrepancy more than
  expected; chasing it found `phoneKey` reading an address's house number and
  ZIP as a phone, which would have turned acknowledgments red. A number you
  cannot explain is a bug until it is explained.
- **A stand-in generator must never touch a real declaration.** A loosened
  condition appended `any` onto the store's and the mappings' real types;
  `skipLibCheck` hid the duplicates and the typecheck quietly checked less.
- **Stand-ins need the real shape.** A `parseModifications` returning an array
  for an object, a `requirementsFor` returning nothing for a list: each failed
  the test, not the code. And esbuild's CommonJS interop copies OWN keys, so a
  `Proxy` stand-in exports nothing — generate real named exports.
- **Configuration read at module load must be set before the process starts.**
  The webhook read its secret at import; setting it in the test body was too
  late, and every request was correctly rejected.
- **A pre-check must model the script's own rule** — exactly once, non-empty,
  absent before. "At least once" passed an edit whose result appeared twice,
  and the script refused its own re-run.
- **A miss test must actually break the anchor.** Appending text after an
  anchor leaves it a substring; change a character INSIDE it.
- **Tooling traps:** `cut -c` splits UTF-8 (read with Python); brace expansion
  and process substitution need `bash`, not `sh`; the sandbox's Postgres stops
  between steps (start it each time) and is 16 — production is 17.6.

## 4. What shipped this session

Each is in the old handoff's Open section by number, with its proof.

| # | Script | What |
|---|---|---|
| 29 | `patch_claim_submission_claims.py` | Claim submissions are claimed like orders; one claim per promote |
| 30 | `patch_emailed_claims.py` | Claims that arrive by email are entered from their Help Scout link |
| 31 | `patch_request_size_and_error_keys.py` | 64 MB requests; every claim refusal keyed |
| 32 | `patch_pill_actions.py` | Every action is a pill, nothing inside another clickable |
| 33 | `patch_picker_removed_map_pills.py` | The Shopify product picker gone from `NewOrderModal` |
| 34 | `patch_claim_progress_notes.py` | A claim's progress as Help Scout internal notes |
| 35 | `patch_claim_delete_closes.py` | Deleting a claim closed its conversation (superseded by 44) |
| 36–37 | `patch_ack_tickets.py` | `xlsx` pinned 0.20.3; the acknowledgment verdict race fixed |
| 38 | (dependencies) | Next 16.4.0 pinned exactly; `npm audit --omit=dev` clean |
| 39 | `patch_vendor_pdf_design.py` | The vendor PDF redesigned to Garrett's mockup |
| 40 | `patch_discrepancies_full_order.py` | Acknowledgment discrepancies on their lines; Full Order header |
| 41 | `patch_ack_explained_phone.py` | Discrepancies say WHAT is wrong; the phone a red check |
| 42 | `patch_terms_consent.py` | The website's terms consent kept with every order |
| — | `patch_consent_cutoff.py` | The consent cut-off set from the orders: 21:40 UTC 2026-10-08 |
| 43 | `patch_order_files.py` | Files go with their order; the two-step storage sweep |
| 44 | `patch_claim_close.py` | A claim is closed — Approved or Denied — never deleted |
| 45 | `patch_claim_next_actions.py` | A claim's own next actions; "Ship from factory" |
| 46 | `patch_record_consent.py` | Consent obtained by email, recorded against its conversation |
| 47 | `patch_shopify_removal.py` | Shopify orders removed in Shopify; webhook-health skips cancels |
| — | `patch_docs_handoff_2026_10_13.py` | This file; the documents' known-wrong sentences corrected |

**Done by hand, 2026-10-13:** ten test claim submissions (CR-1001 to CR-1010,
each `promoted` with its claim deleted) deleted after checking nothing
references `claim_submissions`; the sweep removed their 26 photos and the 32
orphaned attachment files. Storage then: `claim-photos` 0, `order-attachments`
4 (the live orders'), `team-avatars` 1. No purchase record without orders.

## 5. The state of things, by area

Each line points at the section that owns the detail.

- **Claims** (OMS-STATE §3). Closed — Approved (all kept) or Denied (a reason
  required; its files removed, BOTH copies: the claim's attachments and the
  submission's originals) — never deleted; DELETE refuses one, PATCH refuses
  archiving one bare, bulk skips them. Restoring reopens. Help Scout gets
  `closed`/`reopened` notes and the conversation is set Closed/Active. A
  claim's next actions keep ITS rules: Enter dates and Move at Parts ordered
  and Shipped; its dates and tracking number are a record that moves nothing
  (`typeRecordsTracking`, not `typeCarriesTracking`).
- **Acknowledgments** (OMS-STATE §3). Discrepancies are explained on their
  lines — a missing line and an extra one for the same cabinet are paired and
  told as colour, door style or quantity; one headline when uniform. The phone
  is its own red gate, compared on its last ten digits; `PHONE_RE` takes an
  optional US country code and is fenced against longer digit runs. The
  fingerprint covers the phone for acknowledgments since 2026-10-07 and
  `ackIsStale` accepts either recipe; `customer_phone` is REQUIRED of every
  caller, so forgetting it fails the typecheck.
- **The vendor PDF** (OMS-STATE §3). Lato, the logo inline, two cards, codes
  under every SKU, order issues and acknowledgment discrepancies in amber,
  the footer in the page margin, Arizona time, Keyed By a NAME.
- **Terms consent** (OMS-STATE §3). Read from Shopify's "Additional details",
  kept on the PROJECT as sent, never cleared; flagged — not blocked — on
  Shopify orders since 21:40 UTC 2026-10-08; staff record consent obtained by
  email against its Help Scout conversation, checked to be ours. The website
  refuses a checkout without it, so the flag should be rare.
- **Files** (OMS-STATE §3). Not cascaded: every delete path removes an order's
  files FIRST (`lib/orderFiles`); failed uploads clean up; the sweep
  (`/api/admin/storage-sweep`) is two-step, dry run then a confirmed count,
  through the storage API.
- **Deleting** (OMS-STATE §3). Only a custom job is deleted in the OMS. A
  Shopify order is removed in Shopify and the webhook removes all of it; a
  claim is closed.
- **Monitoring** (OPERATIONS §6–7). Six cron jobs, six checks, thirteen on the
  account (seven strays). `webhook-health` reconciles Shopify's newest ten
  orders against projects and skips cancelled ones.
- **Dates.** `production_est_finish_date` is shown as "Ship from factory" on
  every type. ⚠ The Shopify order attribute keeps its name, "Est. Production
  Finish" — the website may read it.

## 6. Open — the list, in order

### Bugs

1. **A new custom order shows TWICE** (found by Garrett 2026-10-13). ⚠ The
   database holds ONE row — a query for custom orders sharing a name and
   creation second returned nothing — so the duplicate is on screen. The
   cause, from the code: the store's `addOrder` prepends the created row with
   NO id check, while the realtime `onInsert` does check
   (`prev.some((o) => o.id === row.id)`), and the realtime INSERT often lands
   BEFORE the POST's own response — realtime first, then `addOrder` adds it
   again. Fix: the same id check in `addOrder`'s success path. In the same
   change, `addOrder`'s failure branch FABRICATES a local row after a failed
   POST (its own comment calls it the anti-pattern `addTeamMember` was fixed
   for) — remove it and surface the error; and `NewOrderModal`'s
   `handleSubmit` has no in-flight guard (it calls `addOrder` and closes at
   once) — disable submit until it resolves. Prove: reproduce on screen first;
   a reload shows one.
2. **A claim's Help Scout "Shipped" note misses its tracking number** when the
   number is entered after the move — which, for claims, is usual (item 45).
   A short note when a tracking number is added to a claim already at Shipped.
3. **The attachment DELETE skips its archived check if its `orders` read
   fails.**
4. **A Shopify project's Files tab (`ProjectFiles`) lists files it cannot
   open** — no download. A custom job's Files tab is the panel, with Download.

### Unbuilt, decided

5. **Moving a file to another room**, and **filing under a style group from a
   screen** (the route already accepts a style group's id) — item 24.
6. **`order_attachments` does not publish over realtime** — a subscriber
   calling `refreshAttachments(orderId)` and a read policy for
   `authenticated` (old Open 1).
7. **Rail timestamps** need a real per-transition time (old Open 2).
8. **Mockup parity** — two structural differences remain (old Open 8).
9. **Customer notifications.** Nothing sends the production notification
   promised on every cabinet order (OPERATIONS §2, "The promise that is not
   yet kept"); the planned list is there.

### Known gaps

10. **Nothing reconciles deletions** — a missed Shopify `delete` leaves the
    order in the OMS (old Open 5).
11. **Orphaned claims are unchecked** — `projects.claimed_by` holds two id
    formats (old Open 4).
12. **`orders.date` and `order_activity.time` are display strings, not ISO**
    (old Open 6).
13. **`fieldsToClearOnBackwardMove`** is the last consumer not deriving from
    the requirement table (old Open 7).
14. **`~/cron-jobs/cron.log` holds 196 non-zero `rc` runs** nobody has looked
    at (old Open 9).
15. **The SLA clock runs through weekends; the digest does not** — an order
    arriving Friday 5pm first appears Monday (OPERATIONS §7).
16. **Whether the public lookup should answer by claim number** (OPERATIONS
    §12).

### Housekeeping

17. **Seven stray checks** on healthchecks.io to delete, and
    `IGNORED_CHECKS` in `app/api/health-summary/route.ts` to shrink to match
    (OPERATIONS §6, §12).
18. **`teams-digest` posts nothing** until `TEAMS_WEBHOOK_URL` is set — safe
    to enable (OPERATIONS §7).
19. **Record the Microsoft Graph client secret's expiry** somewhere other than
    Azure (OPERATIONS §5, §12). It is not on the box.
20. **Stale code comments:** `archivedVia`'s doc comment sits above
    `activityDate`; `isStageOfferedForType` says samples run New → Entered →
    Delivered; `app/api/realtime-token` says a username "IS the user id"
    (`lib/auth`: the id is `team_members.id`); `lib/useRealtimeOrders.ts` names
    `setOrders`/`setWarranties`, which no longer exist.
21. **The quote webhook has seven unused variables**, `color`, `city`,
    `state`, `zip` among them.
22. **`NewOrderModal` keeps a WARRANTY branch nothing can reach** — the
    dashboard opens it for custom jobs only; claims use `WarrantyClaimModal`.
23. **An acknowledgment's phone written with an extension** ("ext 4") leaves
    that text in its address, which then differs — shown, not hidden.
24. **A favicon** — `/favicon.ico` is a 404.

### Waiting on someone

25. **Next 16.4.1** when released — 16.4.0 is pinned exactly; the same proof
    as item 38.
26. **Held back, each its own project:** Tailwind 4 (it alone clears the last
    nine audit entries, all build-time); TypeScript 7; ESLint 10; lucide-react
    1.x (icon renames).
27. **Renaming the Shopify attribute "Est. Production Finish"** to match "Ship
    from factory" — only with the website team, who may read it.

## 7. Facts that cost something to learn

- `CLAIM_MAX_REQUEST_BYTES` in `lib/claimIntake.ts` MUST EQUAL
  `experimental.proxyClientMaxBodySize` in `next.config.mjs` — both 64 MB.
- A table a trigger writes needs `service_role` granted OUTRIGHT; Supabase's
  defaults are not to be relied on.
- `xlsx` is pinned at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Storage buckets: `order-attachments`, `claim-photos`, `team-avatars`.
  Deleting `storage.objects` rows does NOT delete files — use the storage API.
- The consent cut-off, `CONSENT_REQUIRED_FROM`, is `2026-10-08T21:40:00Z`:
  SHO-1056 arrived without consent at 21:39:32, placed before the website's
  update; SHO-1057's customer agreed at 21:56:42.
- `webhook-health` reads a Shopify order with NO project as lost ingestion —
  which is why a project cannot simply be deleted while its order is still in
  Shopify, and why cancelled orders are skipped.
- The order route treats a claim's TYPE as its category; tracking rules live in
  `lib/categories` (`typeCarriesTracking` vs `typeRecordsTracking`).
- `lib/helpscoutLinks` is the one reader of a pasted Help Scout link and of an
  Arizona time typed by staff; it refuses a minute or hour that rolls over.
- The local test Postgres is 16; production is 17.6.
