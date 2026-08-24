# JK Cabinets — Operations & Systems Reference

**As of 2026-08-20 · supersedes OPERATIONS-2026-08-18.md**
**Companion to HANDOFF-2026-08-20-BUILD.md**

Everything that is **not** about writing code: what the business does, which
services it runs on, what it costs, what it has promised customers, which
credentials expire, and why decisions were made.

**The document set:** `HANDOFF-2026-08-20-BUILD.md` (the OMS codebase) ·
`SESSION-HANDOFF-OMS-2026-08-20.md` (what to build next) ·
`HANDOFF-WEBSITE-TEAM-2026-08-20.md` (the storefront side) · the System Map.

---

# 1. The business, briefly

JK Cabinets sells kitchen cabinetry through a Shopify storefront
(`jkcabinets2you.com`) and manages every order after checkout in a custom
order-management system (`ordersjkcabinets2you.com`) — the OMS.

Small internal team. Admin user: Garrett. Queen Creek, Arizona;
`America/Phoenix` throughout. **The storefront is not yet live.**

## Vendors and who does what

| Vendor | Also called | Ships how | Who contacts the customer |
|---|---|---|---|
| **Waypoint** | "Select Cabinetry" | Manufacturer → local delivery agent | The agent arranges the appointment |
| **HCI** | — | Direct | The manufacturer contacts the customer |
| **J&K** | — | Direct | The manufacturer contacts the customer |
| **JK Cabinets 2 You** | Own stock | Direct from JK | Samples — no delivery appointment |

Only an order whose **every** line is "JK Cabinets 2 You" counts as a sample.
Mixed orders are standard.

⚠ **The two sample products have EMPTY skus** in `shopify_products`
(ids `51966355210540`, `51875356508460`). Classification works from the
payload's per-line vendor rather than the SKU, so this is fine — but SKU
decoding does nothing useful for them, and **a new sample product must carry
the vendor string exactly** or its orders ingest as standard.

## Product reference

**Door styles (6):** Shaker 410F · Vista 470F · Gilbert 460F · Slab 530S ·
Arizona 570F · Slim Shaker 580F

**Colours (11):** Painted Linen PL · Painted Vanilla PV · Painted Harbor PH ·
Painted Oat PO · Painted Sage PS · Painted Navy PN · Painted Black PB ·
Maple Rye MR · Maple Latte ML · Maple Truffle MT · Maple Slate MS

**Modifications:** reduce/increase depth → `RD-n`/`ID-n`; recessed toe kick →
`RTKL`/`RTKR`/`RTKB`.

---

# 2. The customer journey, and what we have promised

## At checkout

The Shopify order confirmation fires immediately, carrying a customised
"What happens next" block that scans **every** line item:

- **Made-to-order warning** — cannot be changed or cancelled once in
  production, usually within about 24 hours
- **Estimated lead time**, from a product metafield — time to factory
  dispatch, with delivery scheduled after that
- **Who will contact them**, by vendor mix
- **On delivery day** — delivered into the garage, an adult must sign the
  receipt, inspect before signing, and **visible shipping damage must be
  reported within 48 hours**

That 48-hour window is **Terms §12.3**, which makes the reporting windows
conditions precedent to a claim. The OMS delivery gate now captures the signed
receipt that backs it.

## ⚠ The promise that is not yet kept

> *"We will notify you when your order has finished production and is on its
> way to you."*

**Nothing sends that notification.** It goes to every cabinet order.

## Planned notifications

Each requires a staff **confirm/deny prompt**:

1. Estimated production finish date set
2. Production date changed
3. Estimated delivery date scheduled, with what to prepare for
4. Delivery date changed
5. Delivery accepted and signed for

Plus a **scheduled** one on the last day of the production range — the heads-up
that cabinets are on the way. That fires from the existing
`production-complete` cron, which already evaluates the right condition, and is
the only trigger with nobody present to confirm it.

## Rules for anything customer-facing

**Never show internal stage names.** Translate: New → Order received ·
Entered → Confirmed with the manufacturer · In production → In production ·
At cross dock → **Arrived in Arizona** · Delivered → Delivered ·
New claim → Claim received · In review → In review · Parts ordered → Parts
ordered · Shipped → Parts shipped · Resolved → Resolved.

**Never return a delivery date the customer has not already been given.**

## Order numbers

The customer sees **`ORDER #1035`**; the OMS stores **`SHO-1035`**. Shopify's
internal id (`8515280404780`) is never customer-facing. Normalise input by
stripping `#`, trimming, uppercasing, prepending `SHO-`.

---

# 3. Services and subscriptions

**≈ $188/month total.** Verified 2026-08-19 from billing.

| Service | What it does | Plan | Cost/mo |
|---|---|---|---|
| **Hetzner CPX31** | The box: app, cron, everything. 4 vCPU, 8 GB, 160 GB | CPX31 | **$30.59** ($24.99 + ~$5.00 backups + IPv4) |
| **Supabase** | Postgres, RLS, Realtime, Storage | Pro | **$34.97** proj. ($25 + 2× micro compute − $10 credits) |
| **Shopify** | Storefront, checkout, order source | Basic | $39.00 |
| **Shopify apps** | Aris Product Options $24 · TnC Terms Checkbox $12.99 · Workflow Transactional Email $0 | | $36.99 |
| *(Shopify tax)* | AZ state 5.60% + county 1.10% + Queen Creek 2.25% | | ~$6.80 |
| **Help Scout** | Helpdesk: email, live chat, knowledge base | Standard, 1 user | **$32.57** inc. tax — trial to Sep 1, **first charge Sep 2** |
| **`jk-sku-builder`** | ⚠ A SECOND application — see below | | ~$7.00 proj. |
| **Upstash Redis** | Rate limiting (`rateLimitOr429`) | **Free tier** | $0.00 |
| **GitHub + GHCR** | Repo and container registry | **Free** | $0.00 |
| **healthchecks.io** | Dead-man's switch, 4 checks | **Free** | $0.00 |
| **GoDaddy** | Two domains — see §4 | | annual |
| **Microsoft 365** | Tenant, Outlook, `no-reply@` shared mailbox | Shared mailboxes need no licence | existing |
| **Avis Plus API** | Waypoint option catalogue, 60 req/min | | |
| **Tidio** | Current chat widget — **to retire** | | |

⚠ **`jk-sku-builder` is a second application nobody has documented.** It has
its own Supabase project (micro compute, $9.91) and its own host (~$7/month
projected, platform unidentified). Roughly 9% of the monthly total, and it
appears nowhere in the build handoff or the system map. **What is it, is it
live, does it touch the same Shopify store, and does the OMS depend on it?**

**Upstash is doing ~301 commands a month** — about ten a day. Zero cost, but
worth knowing it is a whole vendor and network dependency for that volume.
Also unverified: whether `rateLimitOr429` fails open or closed when Upstash is
unreachable.

---

# 4. Domains

**Registrar: GoDaddy.** Auto-renew ON, privacy ON, locked.

| Domain | Renews | Role |
|---|---|---|
| `jkcabinets2you.com` | **25 Jan 2027** | Storefront |
| `ordersjkcabinets2you.com` | **21 Apr 2027** | OMS |

Also held, not in use by these systems: `jkkitchencabinets2you.com`,
`jkoutdoorliving.com`, `kitchencabinets2you.com`.

---

# 5. ⚠ Credentials — everything that expires or fails silently

| Credential | Lives in | Expiry | Symptom when it dies |
|---|---|---|---|
| **Microsoft Graph client secret** | Entra → `.env.kamal` | ⚠ **RECORD THE DATE** — max 24 months | Customer notifications silently stop |
| **GHCR token** (GitHub PAT) | `KAMAL_REGISTRY_PASSWORD` | Set at creation; expired 2026-08-18 | `kamal deploy` → **`denied: denied`** at docker login |
| **`SHOPIFY_WEBHOOK_SECRET`** | `.env.kamal` | No expiry | Webhook HMAC fails closed — **orders stop ingesting** |
| **`SHOPIFY_WEBHOOK_SECRET_FALLBACK`** | `.env.kamal` | Empty when idle | Rotation slot — see below |
| **`SHOPIFY_CLIENT_ID` / `_SECRET`** | `.env.kamal` | — | Shopify API calls fail; stage sync stops |
| **`AVIS_API_TOKEN`** | `.env.kamal` | No expiry; never rotated | Nightly catalogue sync fails; healthchecks alarms |
| **`ADMIN_BACKWARD_PIN`** | `.env.kamal` | Rotated 2026-07-28 | Backward moves fail closed (correct) |
| **`SUPABASE_SERVICE_ROLE_KEY` / `_JWT_SECRET` / `NEXT_PUBLIC_*`** | `.env.kamal` | — | Everything stops / Realtime fails |
| **`NEXTAUTH_SECRET`** | `.env.kamal` | — | All sessions invalidated |
| **`CRON_SECRET`** | `~/.cron-secret` | — | All four crons 401; healthchecks alarms |
| **`QUOTE_WEBHOOK_SECRET`** | `.env.kamal` | ⚠ Deliberately EMPTY | Setting it breaks the quote form |
| **`UPSTASH_REDIS_REST_URL` / `_TOKEN`** | `.env.kamal` | — | Rate-limit behaviour unverified |

## The webhook secret can now be rotated without downtime

It never had been, because rotating it meant breaking ingestion. Since
2026-08-20 the handler accepts a primary and an optional fallback:

1. Put the CURRENT value in `SHOPIFY_WEBHOOK_SECRET_FALLBACK`, deploy
2. Change `SHOPIFY_WEBHOOK_SECRET` to the new value, deploy
3. Confirm from the logs that nothing reports `verified_by_fallback`
4. Clear the fallback, deploy

Proven on 2026-08-20 during the subscription migration.

## ⚠ Three ways a secret silently does not arrive

All three cost time on 2026-08-20:

1. **Not declared in `config/deploy.yml` under `env.secret`.** The value never
   reaches the container, however correct `.env.kamal` is. **No warning at
   deploy.** `kamal secrets print` will NOT catch it — the value is in the file.
2. **Edited but not redeployed.** Kamal reads `.env.kamal` at deploy time.
3. **Mistyped or partially pasted.** A 45-character value where 64 was expected
   produced no error at all — half the webhook deliveries simply stopped
   verifying.

**The only reliable check, after any secret change:**

```bash
docker exec "$(docker ps -q --filter label=service=cabinet-orders | head -1)" \
  sh -c 'echo "${#SHOPIFY_WEBHOOK_SECRET}"'
```

Lengths, never values. Check BEFORE deploying too:

```bash
awk -F= '/^SOME_KEY=/{print length($2)}' .env.kamal
```

**The safe direction:** declared in `deploy.yml` but MISSING from
`.kamal/secrets` fails loudly with `Kamal::ConfigurationError`.

## Reading a failed deploy

- **`Get "https://ghcr.io/v2/": EOF`** — transient. Retry.
- **`denied: denied`** — the GHCR credential expired.
- **`Kamal::ConfigurationError`** — a declared secret is missing.
- ⚠ **`grep -c 'ERROR (SSHKit'` reports ZERO on a config error.** Use
  **`grep -cE 'ERROR \('`**.
- **`"Finished all"` prints on aborts.**

---

# 6. Monitoring and alerting

**healthchecks.io**, free tier, deliberately **off-box** so a box outage cannot
silence its own alarm. Email alerting, verified. Ping-URL map at
`~/cron-jobs/healthchecks.map` (mode 600, not in git).

⚠ **CORRECTION (2026-08-20).** Earlier documents said Teams alerting was
"blocked by the tenant". That was wrong. Teams worked at one point and was
**retired during migration cleanup** — it is not blocked, and a channel and
webhook can be recreated whenever wanted. The stale note would have sent
someone hunting for a restriction that does not exist.

**Four checks**, one per cron job:

| Check | Watches |
|---|---|
| `sync-avis-catalog` | Nightly Avis reconciliation |
| `production-complete` | In production → At cross dock |
| `teams-digest` | Silent until `TEAMS_WEBHOOK_URL` is set — now safe to enable |
| **`jk-webhook-health`** | **Shopify ingestion** — added 2026-08-20 |

## The ingestion check reconciles; it does not heartbeat

Its FIRST version asked "do the webhook subscriptions exist?" That was the
wrong question and it was wrong in **both directions** — it reported green
while ingestion was completely dead, and would have reported red forever once
the old subscriptions were removed.

It now asks Shopify for its ten most recent orders and confirms the OMS has
them. That catches a deleted webhook, a secret mismatch, a handler returning
500, and a Shopify delivery outage — all of which end the same way.

It stays quiet before launch because it only alarms on orders Shopify says
exist. Orders newer than `WEBHOOK_RECONCILE_GRACE_MINUTES` (default 15) are
ignored as possibly in flight.

**Verified in both directions on real incidents on 2026-08-20**: it caught a
genuinely missed order (#1038) that neither of us knew about, and returned to
green when resolved.

`run-cron.sh` now captures response bodies on failure, so `cron.log` carries
the reason — previously `curl -f` discarded it and logged only `error: 500`.

## Still not monitored

- **Refunds.** `payment_status` updates within seconds and now blocks forward
  movement, but nothing alerts — somebody has to open the order. Worth
  revisiting once order volume is real.
- Email send failures (once notifications exist)
- Credential expiry — all of §5
- The `jk-sku-builder` application
- Anything in the storefront

---

# 7. Scheduled jobs

| UTC | Phoenix | Job | What it does |
|---|---|---|---|
| 07:30 daily | 12:30am | `sync-avis-catalog` | Reconciles the option catalogue. Never writes a SKU code, never deletes, refuses an empty catalogue. |
| 08:00 daily | 1:00am | `production-complete` | In production → At cross dock once the estimated finish date passes. Sole owner of that transition. |
| 14:00 weekdays | 7:00am | `teams-digest` | **Posts nothing** — see below |
| **hourly at :20** | | **`webhook-health`** | **Reconciles Shopify's orders against the OMS** |

**`teams-digest` is silent** because `TEAMS_WEBHOOK_URL` is empty — but it is
now **safe to configure**. Migrated 2026-08-20: it uses the same SLA rules as
the app, covers all four order types, and reports **by type** rather than by
stage, because nineteen stages across four flows would be a wall nobody reads.

It sends even when everything is on track — a digest that only arrives with bad
news is indistinguishable from one that has silently stopped working.

To enable: create a Teams channel and an Incoming Webhook (Connectors) or a
Workflow, put the URL in `TEAMS_WEBHOOK_URL`, and deploy. The route allows both
host families and posts an Adaptive Card; if the first post is rejected, the
response body now lands in `cron.log`.

---

# 8. Third-party configuration

## Microsoft 365 / Graph — set up 2026-08-18

Outbound transactional email via **Graph, app-only auth**, from the
**`no-reply@jkcabinets2you.com`** shared mailbox (free — no licence).

- App registration: single tenant, no redirect URI (a daemon)
- `Mail.Send` as an **Application** permission, admin consent granted
- Client secret created — **expiry must be recorded**
- **`New-ApplicationAccessPolicy`** scoping the app to a mail-enabled security
  group, `oms-email-senders@jkcabinets2you.com`, containing only No-Reply

That last step is not optional: Microsoft describes app-only `Mail.Send` as
"Send mail as any user", and it is exactly that until scoped.

**Gotcha:** `PolicyScopeGroupId` will **not** accept a shared mailbox directly.
It needs a mail-enabled security group. The error is *"The identity of the
policy scope is not a security principal."* Propagation can take 30 minutes.

## Shopify webhooks

⚠ **App-created subscriptions do NOT appear in Shopify admin → Settings →
Notifications.** That page shows only admin-created ones. The two sets are
managed independently and both can deliver the same event.

**This single fact cost most of a day on 2026-08-19–20** — see §9.

The OMS now owns all five subscriptions, created through
`POST /api/shopify/webhooks` and visible at `GET /api/shopify/webhooks`. That
endpoint is the only reliable view.

- **Fulfilment notification: TURNED OFF.** The OMS will own everything after
  the order confirmation.
- Shopify still sends the **order confirmation** — tied to checkout, keep it.
- Point the store's customer-facing email at Help Scout so replies land there.

## Help Scout — chosen 2026-08-18

**Standard, 1 user, trial to Sep 1.** Channels: **Email, Live Chat, Help
Center**. SMS, WhatsApp and Social deliberately skipped — an unwatched channel
is worse than an absent one.

**Chosen for continuity, not volume.** A shared mailbox copes with ~50
emails/month; what it cannot do is tell you who is already replying.

**Gorgias was rejected**: its Shopify integration surfaces *Shopify* order
data, and customers ask about production dates and cross-dock — OMS data
Shopify never sees.

**Do not sync OMS orders into the helpdesk.** The seam is a read-only lookup
endpoint, called live.

Note "Powered by Help Scout" appears on the Beacon widget on Standard;
removing it needs Plus, as do custom sidebar apps.

---

# 9. Incident history

**64-day cron outage (2026-05-21 → 2026-07-24).** All three crons dead, 175
silent failures. `run-cron.sh` had a hardcoded `sslip.io` hostname orphaned by
the domain cutover. Unnoticed because a duplicate code path was doing the stage
advance anyway. → **Produced the off-box dead-man's switch.**

**Shopify tag overwrite.** Stage sync replaced the entire tag list, wiping
vendor tags, in three write paths. Fixed via one shared `mergeTags`.
**Historical damage not repaired.** → **Produced the "one implementation, never
copies" rule.**

**Vercel zombie.** An old deployment still live, sharing the production
database, running stale code. Retired 2026-07-28.

**Quote form silently broken.** `QUOTE_WEBHOOK_SECRET` got set during the Kamal
cutover, activating a check the browser-posted form never satisfied.
→ **Produced the "`.kamal/secrets` fails open" warning.**

**Supabase resize (2026-07-29).** Nano → micro, 1m59s of orderly downtime. Not
a fault.

**GHCR token expiry (2026-08-18).** Deploy failed `denied: denied` while
`git push` succeeded. → **Produced §5.**

**Unrelated-session config damage (2026-08-03).** Another chat regenerated
`.kamal/secrets` and `config/deploy.yml` from a stale paste, silently dropping
four keys and breaking `NEXTAUTH_URL`. Nothing deployed; `git reset --hard`
recovered it. → **Produced the rule that config is patched by anchor, never
regenerated.**

**`orders_type_check` (2026-08-19).** Alternate Orders widened the TypeScript
union across three phases; nothing widened the database CHECK. Invisible for
three weeks because nothing inserted a `custom` or `sample` row until phase 3
tried — then both halves 500'd. → **A widened union is not a widened column,
and the test that catches it is inserting a row, not compiling.**

**⚠ Ingestion outage (2026-08-19 → 2026-08-20).** The longest and most
instructive.

`GET /api/shopify/webhooks` returned zero subscriptions. That was read as "no
webhooks exist" and five were registered through the API. In fact **five
admin-created webhooks existed and were doing all the work** — they simply are
not visible to that endpoint.

The five new ones failed HMAC on every delivery, because Shopify signs
app-created subscriptions with the app's **client secret** while admin-created
ones use the **store webhook secret**. Nothing surfaced this until webhook
outcome logging was added the following morning.

Then, while testing the health check, the admin `orders/create` webhook was
deleted — **and ingestion stopped completely**, because it was the only working
path. One order (#1038) was lost. Restoring it fixed ingestion immediately.

**Resolved by migrating properly:** dual-secret verification, swap the primary
to the client secret, delete the admin webhooks, drop the fallback. The OMS now
owns its webhooks, and `GET /api/shopify/webhooks` finally tells the whole
truth.

**Three things this produced:** webhook outcome logging; the reconciliation
health check; and the knowledge that Shopify's admin UI hides app-created
subscriptions.

---

# 10. Decisions and why

**One `orders` table with a `type` discriminator**, not separate tables — the
warranty flow already worked this way and separate tables meant a union query
for every list, count and metric.

**Samples reuse the standard stage names**, so backward-move detection, date
clearing, the production-complete cron and the tag merge all work unchanged.

**Samples get their own page**, reversed mid-discussion once volume was
clarified: if samples are the highest-volume type, mixing them in buries the
cabinet orders that carry the money.

**Custom orders do not sync to Shopify.** A quote request IS a custom order at
stage New — the Custom Orders page filtered to New already is the triage queue,
so no staging table is needed for quotes (unlike claims).

**SLA: 24h/48h, but two stages measure missing data rather than elapsed time.**
An order can legitimately sit in production for 42 days; what is never
legitimate is sitting there with no dates, because then nothing can advance it.

**New measures from the order date**, so a bounced order cannot look newer than
it is.

**The delivery gate has an override, and the override needs a reason.** A gate
that can strand a genuinely delivered order gets routed around. The control is
not permission — anyone may override — it is accountability.

**Public form submissions land in staging tables, not `orders`** — except
quotes, above. Direct public writes would start SLA clocks on bot submissions.

**The assistant, if built, runs off the OMS box.** One CPX31, four vCPUs — a
scraper on a chat widget must not compete with order entry. Worth
reconsidering entirely now that Help Scout's AI Answers resolves from the
knowledge base at $0.75 a resolution.

**No CRM.** Claims and notifications belong in the OMS because the data lives
there; general enquiries belong in a helpdesk because they need threading.

**The digest goes to Teams — not email, not Help Scout.** Considered in that
order. Help Scout's model is conversations that get resolved; an internal daily
report would sit unresolved in the customer queue and train people to skip it.
Email was the fallback, but Teams gives per-channel routing and notification
control an inbox does not, and an alert you cannot route is the one that gets
ignored.

**A "job" is one order.** The store allows mixed colours and door styles in a
single order, and a follow-up order days later has its own production timeline,
acknowledgment and delivery. Grouping them would invent a relationship the
operation does not have — every stage gate, SLA clock and delivery here is
per-order.

**Order value is stored at ingest, not queried live.** A metrics page that
depends on Shopify is one that breaks when Shopify does, and 2026-08-20
demonstrated how that goes. Custom orders are hand-entered, having no Shopify
counterpart.

**A refund blocks forward movement but not backward.** A refunded order usually
needs walking *back*; blocking that would strand it exactly when someone is
undoing the damage. Acknowledgement is per-status rather than a boolean, so
clearing a partial refund cannot pre-clear a later full one.

**No consolidation of the current service list.** Reviewed 2026-08-19: eleven
services is lean for what this does, and the two genuine candidates (Upstash
into Postgres, the assistant into Help Scout) are small. **healthchecks.io must
stay off-box**, Graph-out and Help Scout-in are correct separation not
duplication, and Supabase must stay managed so the database has an independent
recovery story.

---

# 11. Infrastructure detail

## The box

- **Hetzner CPX31**, 4 vCPU, 8 GB RAM, 160 GB. `5.78.220.153`.
- **Single host — no failover, no staging environment.** Every deploy goes
  straight to production.
- **`kamal-proxy` v0.9.2** terminates TLS, automatic certificates, health check
  `/api/health` every 5s. `--buffer-requests --buffer-responses` — ⚠ the whole
  request is buffered before the app sees it, which matters for the planned
  60 MB claims uploads.
- **Container logs rotate at 10 MB** and are **not shipped anywhere**. That is
  where `[shopify-webhook]` and `[ack-reject]` land; a container replacement
  loses them.
- **Kamal keeps 5 old containers** — the practical rollback window.

## Backup and recovery

**Hetzner backs the server up every 24 hours, retaining 7 days.** That covers
`.env.kamal`, `~/.cron-secret`, `~/cron-jobs/` and the crontab — the files that
exist nowhere else.

Two caveats: **a 7-day window is short for a silent problem** — the failure
mode this system actually has — and **the restore has never been tested**.

⚠ **Supabase PITR status and retention are still unknown.** The Hetzner backup
covers the box, not the database, and the database is where the orders are.

---

# 12. ⚠ Information this document still needs

## Critical

- **⚠ Garrett is the sole admin on every service.** Confirmed 2026-08-18: OMS,
  Shopify, Supabase, Hetzner, GitHub, Microsoft 365, Help Scout, GoDaddy. No
  second holder of any credential, no break-glass procedure. **The largest
  single operational risk**, and a people problem rather than a technical one.
- **Supabase PITR status and retention.**
- **Test the Hetzner restore once.** An untested backup is a hypothesis.
- **What `jk-sku-builder` is**, whether it is live, and what depends on it.

## Important

- **⚠ `orders` has no money column of any kind.** Verified 2026-08-20. Order
  value lives only in Shopify, so **sell totals cannot be reported at all**
  until four columns are added. This blocks the admin metrics panel entirely;
  the decisions are recorded in SESSION-HANDOFF-OMS-2026-08-20.md §2.2.
- **Record the Graph client secret's expiry** somewhere other than the Azure
  portal.
- **Does `rateLimitOr429` fail open or closed** when Upstash is unreachable?
- **Delete the seven stray healthchecks.io checks** (`jk-sync-failure`,
  `jk-orphan-mapping`, `jk-option-rename`, `jk-new-option-values`,
  `jk-stale-sync`, `jk-storefront`, `jk-orders-overdue`) — carefully; four real
  ones share the account.
- **Point the Shopify store contact email at Help Scout.**
- **Retire Tidio** once the Beacon is live.
- **Confirm what the TnC Terms Checkbox app persists.** If it only gates the
  checkout button and writes nothing to the order, that is a silent gap in
  chargeback evidence.

## Useful

- **Legal entity name.** The M365 tenant is `JKCabinetsandDesign`; the
  storefront trades as "JK Cabinets 2 You".
- **Team roster** and whether any leaver still holds credentials.
- **Business hours**, and whether the SLA clock should respect business days.
  It currently runs on wall-clock hours including weekends: an order arriving
  Friday 5pm is hard-flagged by Sunday afternoon with nobody working.
- **Retention rules** for claim submissions and their uploads, before the
  public intake goes live.
- **Rotate** the Shopify webhook secret and the Avis token — now possible
  without downtime for the former.

---

# 13. Chargeback evidence — what to assemble per order

Terms acceptance record (timestamp, IP, exact text, policy version) · order
confirmation email and its delivery confirmation · AVS and CVV results · 3DS
result where applicable · signed design approval · **signed proof of delivery —
now captured by the OMS delivery gate** · communication log (Help Scout, once
live) · record of any replacement offered · prior order history.

**Two are cheap and disproportionately valuable:** logging the checkout terms
acceptance against the order, and **snapshotting the policy version with the
order**. Defending a December order in February by linking to a page that has
since changed is weak evidence.
