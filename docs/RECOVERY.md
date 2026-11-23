# Disaster Recovery Plan

Last updated: 2026-05-20 · reviewed 2026-10-29 · corrected 2026-11-03 (the
cron scripts are in the repo) · checked in part and corrected 2026-11-23 (item
11)

⚠ **CHECKED IN PART 2026-11-23 — A RESTORE STILL NEVER RUN** (item 11,
`SESSION-HANDOFF-2026-11-06.md` §6.10–6.11). Checked: the files that exist
only on the box and their copies; Hetzner's and Supabase's backups exist and
run daily; nothing in the database acts on its own; Kamal's kept containers.
Found and corrected: the laptop's `.env.kamal` copy was six months old, 12 of
its 24 keys missing or different — refreshed; the password manager this
document relied on never existed; a box restored from a backup comes up LIVE
(Scenario 2); Scenario 1 has a faster path. **Not run:** a test restore of
either backup — each needs a temporary paid copy (a server, a project), and
Garrett declined both for now (2026-11-23: *"I don't want to create a new
server just to test"*). (It said "REVIEWED 2026-10-29 — AND NEVER
EXERCISED"; corrected that day: the domain replaced the sslip.io addresses,
and the cron scripts and point-in-time recovery were recorded as gaps.)

This document is the playbook for recovering the cabinet-orders app
when something has gone seriously wrong. Read top to bottom.

## What we're protecting against

Recovery scenarios, in rough order of likelihood:

1. **Bad deploy on Hetzner** — most common. App is broken, need to roll back.
2. **Server compromise or disk failure on Hetzner** — server is gone or
   suspect. Need to rebuild from scratch on a new server.
3. **Database corruption or accidental data loss on Supabase** — need to
   restore the database to a previous state.
4. **Loss of laptop and all local backups** — extreme worst case. Need to
   rebuild from GitHub + Hetzner + Supabase only. ⚠ There is no password
   manager (2026-11-23); this said "from password manager + GitHub + …".

Each scenario has a section below.

## Where things live (the architecture diagram in prose)

- **Code:** GitHub at `github.com/JKCabinets/cabinet-orders`, branch `main`
- **App container image:** GHCR (GitHub Container Registry) at
  `ghcr.io/jkcabinets/cabinet-orders`. Tagged with git commit SHAs.
- **App runtime:** Hetzner Cloud server `jk-cabinets-oms` (CPX31, Hillsboro
  OR). IPv4: `5.78.220.153`. Login: `ssh garrett@5.78.220.153`.
- **HTTPS proxy:** kamal-proxy container on the same server, ports 80/443.
- **Database:** Supabase project (see Supabase dashboard for the project
  ref). Pro tier: seven days of daily PHYSICAL backups, taken about 06:36 UTC
  (checked 2026-11-23). **Point-in-time recovery (PITR) is OFF** — inferred
  2026-11-23: the daily backups run, and Supabase stops them when PITR is on.
  (This said PITR was "UNCONFIRMED".)
- **Attachments:** Supabase Storage — `order-attachments`, `claim-photos`,
  `team-avatars`. In NO backup: Supabase's backups hold only metadata about
  them (its Backups page says so). Known gap — item 14, to design
  (2026-11-23).
- **DNS:** ordersjkcabinets2you.com — A record points to Hetzner IP.
- **Deploy tooling:** Kamal 2.x running ON the server at
  `/home/garrett/cabinet-orders/`. Run `kamal deploy` from there.
- **Secrets file:** `/home/garrett/cabinet-orders/.env.kamal` (mode 600,
  gitignored). Backup copy: the laptop, `~/backups/cabinet-orders/` — ⚠ **THE
  ONLY COPY OFF THE BOX** besides Hetzner's seven days of backups. There is
  no password manager (Garrett, 2026-11-23); this said "password manager as
  secure note", which never existed. A second copy off the laptop: declined
  for now (Garrett, 2026-11-23: *"Lets do 3 for now, and maybe later we can
  add a password manager"*). `~/.cron-secret` is the `CRON_SECRET` line of
  `.env.kamal` (checked 2026-11-23). Keep the copy current: below.
- **Cron jobs:** user crontab on Hetzner, scripts in
  `/home/garrett/cron-jobs/` — ⚠ IN THE REPO SINCE 2026-11-02 (item 65):
  `scripts/cron/` holds `run-cron.sh`, `check-registry-token.sh` and the
  `crontab`. `healthchecks.map` is NOT in the repo (its URLs are credentials
  in effect): it is on the box, in its 7-day Hetzner backup, and since
  2026-11-23 on the laptop beside `.env.kamal`. The schedule is OMS-STATE
  §6's table. (This said it "mirrors original `vercel.json`", which no longer
  exists.)

## Keeping the copies off the box current

The laptop holds a dated copy of each file that exists only on the box:
`.env.kamal`, `.cron-secret` and `healthchecks.map`. **Re-copy them after any
change to `.env.kamal` or the map** — the next is the GHCR token, due before
2027-01-02 (OPERATIONS §5). On 2026-11-23 the only copy was from 2026-05-20,
and 12 of the 24 keys in it were missing or different: a rebuild from it would
not have deployed, verified a Shopify webhook, reached Help Scout, served
either website form, synced Avis or posted the digest.

From the laptop (Git Bash), each copy checked against the box's own hash:

    D=~/backups/cabinet-orders && S=$(date +%Y%m%d) \
    && for f in cabinet-orders/.env.kamal .cron-secret cron-jobs/healthchecks.map; do n=$(basename "$f"); ssh garrett@5.78.220.153 "cat ~/$f" > "$D/$n.$S" && [ "$(ssh garrett@5.78.220.153 "sha256sum < ~/$f" | cut -d' ' -f1)" = "$(sha256sum < "$D/$n.$S" | cut -d' ' -f1)" ] && echo "OK $n.$S" || { echo "MISMATCH or failure on $n -- delete $D/$n.$S and run again"; break; }; done; ls -A "$D"

Expect three `OK` lines. Nothing is printed but names.

## Scenario 1: Bad deploy on Hetzner (rollback)

Most likely scenario. You deployed code with a bug, app is misbehaving.

**Fastest: switch back to a container Kamal kept** (added 2026-11-23, item
11). Kamal keeps the stopped containers of the last five deploys beside the
running one, each tagged with its commit's full SHA — on 2026-11-23 they
reached two weeks back. `kamal rollback` starts one without building, so it
works even when the build or GHCR is the thing that is broken:

    ssh garrett@5.78.220.153
    cd ~/cabinet-orders
    docker ps -a --filter label=service=cabinet-orders --format '{{.Image}}  {{.Status}}'
    kamal rollback <the full SHA of the last good one>

Then the image check reads that SHA, and `main` is unchanged: fix forward, and
the next deploy replaces it. ⚠ Not yet rehearsed here (item 11's part D, not
run). Time to recover: about a minute.

**If the good version is older than the kept containers:** re-deploy its
commit.

    ssh garrett@5.78.220.153
    cd ~/cabinet-orders
    git log --oneline -20          # find the last known good commit
    git checkout <SHA>
    kamal deploy                   # builds and deploys this commit

After verifying the app is healthy again:

    git checkout main              # return to the branch
    # Then either revert the bad commit on main and push,
    # or leave the rollback in place and investigate the bug

⚠ Until `git checkout main`, `HEAD` is detached and every deploy chain's first
check refuses it. Time to recover: 3-5 minutes (most layers cache).

## Scenario 2: Server compromised or destroyed

Server is gone, suspect, or unrecoverable. Build a new one.

⚠ **A BOX RESTORED FROM A HETZNER BACKUP IS LIVE THE MOMENT IT BOOTS** (found
2026-11-23, item 11). Its crontab runs, and `run-cron.sh` calls production's
own address (`APP_URL`, line 55) with the real cron secret and pings the real
checks; Docker starts the app and kamal-proxy. Beside a running production, a
copy would run its jobs a second time — claims to Help Scout within 15
minutes; at 15:00 UTC the cabinet fulfilment, which marks lines shipped in
Shopify — and ping checks green from the wrong machine.

**From a backup** (the quicker path, when a backup is good and the account is
reachable):
1. Hetzner console → Firewalls → Create Firewall: inbound TCP 22 (and ICMP);
   outbound ONE rule, ICMP — any outbound rule makes every other outbound
   connection drop. ⚠ **Apply to must be EMPTY**: on 2026-11-23 the form
   showed the production server selected there; applied to production, this
   firewall closes the site and cuts it off from Supabase and Shopify.
2. The server → Backups → the backup's ••• menu → Create new Server, with that
   firewall chosen IN the create form (no firewall offered: stop). "Rebuild"
   from a backup instead OVERWRITES the server's disk.
3. SSH in; check the files (`.env.kamal`, `~/.cron-secret`,
   `~/cron-jobs/healthchecks.map`) and `git log -1`.
4. Only once the old server is gone or stopped: remove the firewall from the
   new one, change DNS (below), and `kamal deploy` from `main`.

⚠ **Backups are deleted with their server** (Hetzner's documentation). If the
server itself may be deleted, convert a backup to a snapshot first — a
snapshot is kept until deleted. A test of this path needs a temporary server
at a small hourly charge; not run yet (2026-11-23).

**From scratch**, when no backup will do:

### Provision new server

1. Hetzner Cloud console → New Server
2. Same specs: CPX31, Ubuntu 26.04 LTS, location of choice (Hillsboro
   for low US latency)
3. SSH key: add your laptop's public key during provisioning
4. **Enable backups** (extra ~20%/mo)
5. After boot, note new IPv4

### Bootstrap the new server

SSH in as root (or use Hetzner's web console), create `garrett` user:

    adduser garrett
    usermod -aG sudo garrett
    mkdir -p /home/garrett/.ssh
    cp /root/.ssh/authorized_keys /home/garrett/.ssh/
    chown -R garrett:garrett /home/garrett/.ssh
    chmod 700 /home/garrett/.ssh
    chmod 600 /home/garrett/.ssh/authorized_keys

Lock down SSH (`/etc/ssh/sshd_config.d/99-lockdown.conf`):

    PermitRootLogin no
    PasswordAuthentication no
    PubkeyAuthentication yes

Reload sshd: `systemctl reload ssh`

Set up firewall:

    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw enable

Install fail2ban, unattended-upgrades, Docker. Then SSH out, SSH back in
as garrett.

### Install Kamal and clone

    sudo apt install -y ruby ruby-dev build-essential
    sudo gem install kamal
    cd ~
    git clone https://github.com/JKCabinets/cabinet-orders.git
    cd cabinet-orders

### Restore .env.kamal

From your laptop:

    scp ~/backups/cabinet-orders/.env.kamal.YYYYMMDD garrett@NEW.IP:~/cabinet-orders/.env.kamal

Set mode 600: `chmod 600 ~/cabinet-orders/.env.kamal`. If the laptop is also
gone, there is no other copy — no password manager (2026-11-23): Scenario 4's
last paragraph. (This said to paste it from the password manager's secure
note.)

`.kamal/secrets` comes back with the clone: it is tracked in git and holds no
values — a loader that reads `.env.kamal` (OPERATIONS §5).

### Generate server's own SSH key for Kamal localhost SSH

    ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
    cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys

### Update Hetzner IP in deploy.yml

If it's a new server, the IP changed. Edit `config/deploy.yml`:

    servers:
      web:
        hosts:
          - <NEW_HETZNER_IP>

Leave `NEXTAUTH_URL` alone: it is the domain,
`https://www.ordersjkcabinets2you.com`, and stays so — only the host above and
DNS change. (This once set an sslip.io address, from before the domain
cutover.)

### Restore cron jobs

⚠ **The scripts and the crontab come from the repo (since 2026-11-02, item
65); the map does not.** Copy `scripts/cron/run-cron.sh` and
`scripts/cron/check-registry-token.sh` into `~/cron-jobs/` (`chmod +x`), and
install `scripts/cron/crontab` (`crontab scripts/cron/crontab`). Restore
`~/cron-jobs/healthchecks.map` from the laptop's copy (since 2026-11-23) or
the Hetzner backup (7 days) — or, if both are gone, rebuild it from
healthchecks.io's checks (one line per route). Then
check the schedule against OMS-STATE §6's table. (This once said to copy
`run-cron.sh` "from this repo" when it was not there, and to see
`vercel.json`, which does not exist.)

    grep '^CRON_SECRET=' ~/cabinet-orders/.env.kamal | cut -d '=' -f 2- > ~/.cron-secret
    chmod 600 ~/.cron-secret

### Deploy

    cd ~/cabinet-orders
    kamal setup

### Update DNS

In your DNS provider, change the A record for `ordersjkcabinets2you.com`
(and `www`) to the new server IP. Propagation takes 5-60 minutes
depending on TTL.

Time to recover: 1-2 hours, mostly waiting for build steps.

## Scenario 3: Database corruption or accidental data loss

You need to restore Supabase to a previous point in time.

Seven days of daily physical backups, taken about 06:36 UTC; point-in-time
recovery OFF (both 2026-11-23). The database has no `pg_cron` and no `pg_net`
(2026-11-23), so a copy of it acts on nothing by itself.

### First: restore to a NEW project (production untouched)

Database → Backups → **Restore to new project** (beta, 2026-11-23): the chosen
backup copied into a new project — the database, its roles and auth users;
not Storage, API keys or auth settings. The cost shows before you confirm.
Look at the copy, take what was lost from it, or decide a full restore is
needed; then delete the copy (while it exists it is a second full copy of the
customer data). Not run yet: it needs a temporary project at a small hourly
charge (2026-11-23).

### Restoring from Pro tier backup — OVER production

⚠ This replaces production's database: everything since the backup is lost,
and the project is down while it runs.

1. Supabase dashboard → your project → Database → Backups
2. Choose the most recent backup taken BEFORE the data loss
3. Click Restore (may require confirming via email or 2FA)
4. Restoration takes ~5-30 minutes depending on DB size
5. App may need restart after restoration completes:
   `ssh garrett@5.78.220.153 && cd ~/cabinet-orders && kamal deploy`

### Point-in-time recovery (PITR)

⚠ **PITR is OFF** (2026-11-23), so this does not apply. Adding it is a cost
decision — about $100 a month for seven days (Supabase, 2026-11-18) — and
with it the daily backups stop. (This said "unconfirmed".) If it is ever
enabled, for losses you discovered quickly:

1. Supabase dashboard → Database → Point-in-time Recovery
2. Choose a time just BEFORE the loss and follow Supabase's prompts. (The steps
   beyond the first were never written down here; use Supabase's own
   documentation at the time.)

### Caveat: storage attachments

Supabase database backups do NOT include the storage buckets
(`order-attachments`, `claim-photos`, `team-avatars`). If your data loss
involved files, the rows that name them are restorable but the files
themselves may not be. Known gap — item 14, to design (2026-11-23).

## Scenario 4: Lost laptop and all local backups


Worst case. Recovery uses only cloud-hosted resources.

### Inventory of what you still have

- GitHub: all code, all commit history
- GHCR: container images for every deployed commit

- Hetzner: server with current `.env.kamal` (assuming it's up)
- Supabase: data + backups
- ⚠ No password manager (Garrett, 2026-11-23). This listed "`.env.kamal`
  contents as a secure note", which never existed. The SSH key and the
  copies of `.env.kamal`, `.cron-secret` and `healthchecks.map` were on the
  laptop only.

### Recovery steps


1. Get a new laptop
2. Install Git, Git Bash, SSH client
3. Make a new SSH key; there is no other copy of the old one
4. Use Hetzner's web console to add the new key for `garrett`, then SSH in
5. Pull the repo to your new laptop; copy `.env.kamal`, `.cron-secret` and
   `healthchecks.map` from the server into a new `~/backups/cabinet-orders/`
   ("Keeping the copies off the box current", above)
6. Resume operations

If the server is also gone — and its Hetzner backups go with it: rotate all
secrets to new values, re-acquire keys from the Supabase, GitHub, Shopify,
Help Scout, Turnstile, Upstash and healthchecks.io dashboards and from Avis,
rebuild `.env.kamal`, deploy. Sessions invalidated; webhooks briefly fail.
(This said "If the password manager is also lost".)

## Verification checklist after any recovery

After recovering from any scenario above:

- [ ] `curl https://www.ordersjkcabinets2you.com/api/health` returns
  `{"status":"ok",...}` (no auth, by design)
- [ ] Browser load works: page renders, no 502s
- [ ] Login works for a test user
- [ ] Orders list loads with current data
- [ ] Move an order forward and backward (PIN gate works)
- [ ] One Shopify webhook fires successfully
- [ ] Cron jobs are scheduled: `crontab -l`
- [ ] Most recent `cron.log` entries show successful runs
- [ ] Shopify's webhook subscriptions reach the app: signed in as an admin,
  `/api/shopify/webhooks` lists five topics (OPERATIONS §8)
- [ ] healthchecks.io: all eight checks green within a day, each with both
  integrations ("OMS Health", "OMS Health Email") attached (OPERATIONS §6;
  seven since 2026-11-02, `cabinet-fulfilment`; eight since 2026-11-04,
  `sync-shopify-catalog`)

## Maintaining this doc

Update this file when:

- Architecture changes (new server, new database)
- Recovery steps change because tooling changed
- Backup strategy changes
- After any actual recovery, with notes on what was harder than expected

And after any change to `.env.kamal` or `healthchecks.map`, re-copy them to the
laptop ("Keeping the copies off the box current").

The best disaster recovery doc is one that's been used at least once.
