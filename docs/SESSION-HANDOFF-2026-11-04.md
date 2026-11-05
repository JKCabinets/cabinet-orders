# Start here — session handoff, 2026-11-04

⚠ **THE START POINT.** Supersedes `SESSION-HANDOFF-2026-11-03.md` as where a
session starts; that file stays the RECORD of the 2026-11-03/04 session (§6 and
§7 above all), and this one points into it rather than copying it. Everything
built this session is deployed and tested live: feature 11, feature 12 and item
5 part 1.

## 0. A new session, first

1. **Snapshot, on the box**, after this file's commit:
   ```bash
   cd ~/cabinet-orders && git archive --format=tar.gz -o ~/repo29.tar.gz HEAD && cd ~ && sha256sum repo29.tar.gz > repo29_tar_gz.sha256
   ```
2. **Upload** `repo29.tar.gz`, `repo29_tar_gz.sha256`, this file, and the
   harness archive `harness-2026-11-05.tar.gz` with its
   `harness-2026-11-05.tar.gz.sha256` (⚠ since item 5 part 2; this said
   `-11-04`). Check both hashes.
3. **Read this file whole**, then the method (§3), before any change.

## 1. Where things stand

⚠ **AS OF ITEM 5 PART 3's COMMIT (2026-11-05):** `HEAD` is *"Item 5, part 3: the
payment-status backfill and its button deleted -- the app's last REST call"*,
`HEAD~1` `841fe89` (its design record). **The next chain checks: `HEAD`'s
subject is part 3's, tree clean.** The running image is part 3's commit from its
deploy (the image check reads DEPLOYED). The paragraph below was true at this
file's commit.

**The box** (`5.78.220.153`, `~/cabinet-orders`, `main`): after this docs
commit `HEAD~1` is `3dd7d6e`, item 5 part 1 (deployed). **The next chain
checks: `HEAD~1` = `3dd7d6e`, tree clean.** ⚠ **The running image is
`3dd7d6e`**; against this docs `HEAD` the image check reads MISMATCH until the
next deploy, by design. This session's commits, oldest first: `6674d44`
(feature 11 part 1), `8f1522d` (feature 11 part 2), `d5962aa` (docs), the
incident commit, `245032a` (feature 12), the item 5 design commit, `3dd7d6e`
(item 5 part 1), this one — `git log --oneline e936001..HEAD`.

**Production's database** — this session's migrations, each RAN with its
check row as expected: `2026-11-03-consent-record.sql` (feature 11) and
`2026-11-04-claim-submission-id.sql` (feature 12; lost with the claims table
and re-applied verbatim by its repair — 11-03 §7.4). ⚠ `claim_submissions` was
rebuilt that day: its structure is the original's exactly, it holds no rows
(every claim was a test), and the next claim is CR-1018.

**The GHCR token** — renewed 2026-11-03, expires **2027-01-02 21:39:50 UTC**; the
Monday check turns red from its 2026-12-21 run. The renewal chain is in
OPERATIONS §5.

**Cron** — the seven jobs of `scripts/cron/crontab`, unchanged. Item 5 part 2
adds an eighth (§4) — ⚠ in the repo's crontab from part 2's commit,
`sync-shopify-catalog` at 10:00 UTC; installed on the box 2026-11-05 (eight jobs).

**Shopify** — the order writers write over GraphQL `2026-04` (item 5 part 1),
and the webhooks deliver `2026-04`. REST `2024-01` is left in the catalogue
sync (part 2) and the payment-status backfill (part 3). ⚠ **NO LONGER: none is
left** — the catalogue sync went to GraphQL with part 2, the backfill was
deleted with part 3.

**The website team** has confirmed: Turnstile passes on both forms; both
forms now answer in about two seconds; a 201 with `duplicate: true` is success
to them, and they retry a 503 once with the same `submission_id`. They will
confirm when the claims form's `submission_id` is live.

## 2. Built this session — all deployed, all live-tested

- **Feature 11 — the consent record completed** (`6674d44`, `8f1522d`; 11-03
  §6.2): the Refund Policy's date, and the checkout's IP and browser as
  Shopify records them, written by the webhook and shown on the consent row.
- **Feature 12 — the public forms answer within seconds and never save twice**
  (`245032a`; 11-03 §7.3, as built §7.5): the answer once saved, files after
  it with retries, `submission_id` on claims, CORS on every answer.
- **Item 5 part 1 — both order writers through one guarded GraphQL write**
  (`3dd7d6e`; 11-03 §6.3): nothing written if the order cannot be read, so a
  failed read can no longer erase an order's consent.
- **Checks, nothing changed:** the Turnstile keys (11-03 §7.1). **Found:**
  Supabase Storage's incident of 2026-11-04 behind the forms' 504s (§7.2).
- ⚠ **An incident, repaired:** the claims table dropped by a harness file run
  in production, and rebuilt exactly (11-03 §7.4).

## 3. Method — what holds

The full method is in `SESSION-HANDOFF-2026-09-15.md`; then 10-29 §2, 11-02 §2
and §3.8, 11-03 §3 and the rules of 11-03 §7.4. In brief: read whole; design
before code, decided by Garrett and committed before the build; build in parts,
each proven against the deployed code as the control; ship as an anchored,
pinned patch script; a migration probed, transcribed and proven first.

**This session's lessons, each paid for once:**
- ⚠ **A harness file never leaves the sandbox loose** — only inside the harness
  archive — and every harness database file refuses to run unless the
  database is the sandbox's (`hx.sandbox`, set only by `hx/fresh.sh`).
- **Every step Garrett runs comes with its full commands**, the hash check
  included; anything shown that is not his to run says so.
- **A failure both trees share is the test's**, not the code's: the harness's
  Supabase stand-in answered a set-returning function with one value (fixed).
- **Ask the data before the theory.** The forms' slowness looked like a
  connection problem and was Supabase Storage: proxy timings, then the rows'
  own times, then uploads timed from the container AND the host.
- **A function's fingerprint normalises line endings** (production's lease
  differed from the repo's only by CRLF); **production's column order is the
  probe's**, not the migration files'.
- **A check that prints "untouched" must read it**, and **a comparison must see
  a planted change** — both caught real gaps in this session's own proofs.
- **Bound every search and split long work:** a tool call ends at 300 s, an
  unbounded edit search hung on a trailing deletion, and the sandbox ends
  background processes after each command.
- **REST hides variants beyond 100 a product:** GraphQL read 85 more (§4).

## 4. Open

1. **Item 5 part 2 — DESIGNED AND AGREED, build it first** (11-03 §6.3, part 2):
   the catalogue sync over GraphQL; the product webhook reading Shopify's own
   answer; the sync daily at 10:00 UTC, 3 AM Arizona, with its own
   healthchecks check (Garrett creates it, both integrations).
   ⚠ **SETTLED FURTHER 2026-11-04** — what reading it whole found, Shopify's
   webhook policy, production's table probed, and Garrett's rulings: 11-03
   §6.3, "Part 2, settled before the build". Read it before the code.
   ⚠ **BUILT AND PROVEN 2026-11-04** (11-03 §6.3, "Part 2, as built and
   proven"), committed with its docs. **Its deploy steps:** the deploy; the
   healthchecks check `sync-shopify-catalog` (`0 10 * * *` UTC, both
   integrations) and its `healthchecks.map` line; the crontab installed; the
   first run through `run-cron.sh`, timed — predicted `synced 2622, removed 0,
   discontinued 0`; the probe again (2,622 current, none without options).
   Then its record. ⚠ **LIVE 2026-11-05** (11-03 §6.3, "Part 2, LIVE"): the first
   run exactly as predicted; the product webhook's first live update still to
   be seen. **Next: item 5 part 3 (item 2 below).**
2. **Item 5 parts 3 and 4:** delete the payment-status backfill and its button;
   then one API version constant, the webhooks route's payload version its own
   step (11-03 §6.3). Item 67's comment fixes ride with part 4. ⚠ **Part 3
   DESIGNED AND AGREED 2026-11-05** (11-03 §6.3, "Part 3, the design"); BUILT AND
   PROVEN the same day ("Part 3, as built and proven"), committed with its docs.
3. **Item 4, Garrett's ruling:** the "Delivered" and "Delivery date changed"
   emails, per line or per order (11-03 §6.4).
4. **The storage sweep** (admin): two test photos and whatever the 504 attempts
   left in Storage are named by no record; safe to sweep.
5. From the 11-03 list (§4 there), still open: 7 (webhook-health's `graphql()`
   and a 200 carrying `errors`), 8 (UTC "today"), 9, 10, and 11 (RECOVERY has
   never been exercised).

## 5. Where each fact lives

`README.md` points here. `docs/OMS-STATE-2026-08-26.md` — what the system IS.
`docs/OPERATIONS-2026-08-26.md` — the business, services, credentials, cron,
checks, and why. `docs/RECOVERY.md` — when it has gone badly wrong. The
handoffs — each session's decisions; this session's are in
`SESSION-HANDOFF-2026-11-03.md` §6–§7. One fact, one home.
