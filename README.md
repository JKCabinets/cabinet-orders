# JK Cabinets OMS

The order management system for **JK Cabinets 2 You** — cabinet orders,
samples, hardware, custom jobs and warranty claims, from Shopify checkout or
by hand, through to delivery. Staff only, at
`https://www.ordersjkcabinets2you.com`.

⚠ **This page is a pointer, not a description.** The facts live in the
documents below, one home each; a summary here would be the copy that drifts.
Until 2026-10-29 this README was the original scaffold's — Next.js 14, a
Vercel deploy, `// TODO` database stubs — and every instruction in it was
wrong.

## Start here

1. `docs/SESSION-HANDOFF-2026-10-29.md` — where things stand, how work is done
   safely, and what is next.
2. `docs/OMS-STATE-2026-08-26.md` — what the system IS: data model, flows,
   gates, monitoring.
3. `docs/OPERATIONS-2026-08-26.md` — the business, services, credentials,
   customer commitments, and why decisions were made. Its header table says
   which document owns what.
4. `docs/RECOVERY.md` — when something has gone badly wrong.

## In one breath

Next.js 16.4.0 (pinned exactly) · React 19 · TypeScript · Tailwind · Supabase
(Postgres, RLS, Realtime, Storage) · Kamal → Docker → one Hetzner CPX31,
`5.78.220.153`, behind kamal-proxy. **No staging: every deploy is production.**

**How a change ships:** an anchored patch script, proved before it ships;
then, on the box, apply → `npx tsc --noEmit` → commit → `git push` →
`kamal deploy`. A migration runs in the Supabase SQL editor before the deploy
that needs it, and a copy lives in `migrations/`. The handoffs give the whole
method. ⚠ Never Vercel.

**Configuration:** the values live in `.env.kamal` on the box (gitignored);
`.kamal/secrets` is a loader that reads them and holds none; `config/deploy.yml`
names every one the container receives. OPERATIONS §5 lists each and what its
failure looks like. ⚠ `npm run build` fails without the real secrets, and that
is not a bug (OMS-STATE §7).
