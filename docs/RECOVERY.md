# Disaster Recovery Plan

Last updated: 2026-05-20

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
   rebuild from password manager + GitHub + Hetzner + Supabase only.

Each scenario has a section below.

## Where things live (the architecture diagram in prose)

- **Code:** GitHub at `github.com/JKCabinets/cabinet-orders`, branch `main`
- **App container image:** GHCR (GitHub Container Registry) at
  `ghcr.io/jkcabinets/cabinet-orders`. Tagged with git commit SHAs.
- **App runtime:** Hetzner Cloud server `jk-cabinets-oms` (CPX31, Hillsboro
  OR). IPv4: `5.78.220.153`. Login: `ssh garrett@5.78.220.153`.
- **HTTPS proxy:** kamal-proxy container on the same server, ports 80/443.
- **Database:** Supabase project (see Supabase dashboard for the project
  ref). Pro tier with daily backups + PITR.
- **Attachments:** Supabase Storage, bucket `order-attachments`. NOT
  separately backed up (known gap).
- **DNS:** ordersjkcabinets2you.com — A record points to Hetzner IP.
- **Deploy tooling:** Kamal 2.x running ON the server at
  `/home/garrett/cabinet-orders/`. Run `kamal deploy` from there.
- **Secrets file:** `/home/garrett/cabinet-orders/.env.kamal` (mode 600,
  gitignored). Backup copies: laptop at `~/backups/cabinet-orders/`,
  password manager as secure note.
- **Cron jobs:** user crontab on Hetzner, scripts in
  `/home/garrett/cron-jobs/`. Schedule mirrors original `vercel.json`.

## Scenario 1: Bad deploy on Hetzner (rollback)

Most likely scenario. You deployed code with a bug, app is misbehaving.

Recovery: re-deploy a known-good earlier commit.

    ssh garrett@5.78.220.153
    cd ~/cabinet-orders
    git log --oneline -20          # find the last known good commit
    git checkout <SHA>
    kamal deploy                   # builds and deploys this commit

After verifying the app is healthy again:

    git checkout main              # return to the branch
    # Then either revert the bad commit on main and push,
    # or leave the rollback in place and investigate the bug

Time to recover: 3-5 minutes (most layers cache).

## Scenario 2: Server compromised or destroyed

Server is gone, suspect, or unrecoverable. Build a new one.

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

If laptop is also gone, restore from password manager: paste the contents
of the secure note into a new `.env.kamal` on the server. Set mode 600:
`chmod 600 ~/cabinet-orders/.env.kamal`.

### Generate server's own SSH key for Kamal localhost SSH

    ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""
    cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys

### Update Hetzner IP in deploy.yml

If it's a new server, the IP changed. Edit `config/deploy.yml`:

    servers:
      web:
        - <NEW_HETZNER_IP>

    env:
      clear:
        NEXTAUTH_URL: https://<NEW-IP-WITH-DASHES>.sslip.io

### Restore cron jobs

Copy `run-cron.sh` from this repo into `~/cron-jobs/run-cron.sh`, make it
executable, schedule via `crontab -e` (see `vercel.json` for the schedule).

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

### Restoring from Pro tier backup

1. Supabase dashboard → your project → Database → Backups
2. Choose the most recent backup taken BEFORE the data loss
3. Click Restore (may require confirming via email or 2FA)
4. Restoration takes ~5-30 minutes depending on DB size
5. App may need restart after restoration completes:
   `ssh garrett@5.78.220.153 && cd ~/cabinet-orders && kamal deploy`

### Point-in-time recovery (PITR)

For losses you discovered quickly:

1. Supabase dashboard → Database → Point-in-time Recovery
### Caveat: storage attachments

Supabase database backups do NOT include the `order-attachments` storage

bucket. If your data loss involved files, the database metadata about
them is restorable but the actual files may not be. Known gap.

## Scenario 4: Lost laptop and all local backups


Worst case. Recovery uses only cloud-hosted resources.

### Inventory of what you still have

- GitHub: all code, all commit history
- GHCR: container images for every deployed commit

- Hetzner: server with current `.env.kamal` (assuming it's up)
- Supabase: data + backups
- Password manager: `.env.kamal` contents as a secure note

### Recovery steps


1. Get a new laptop
2. Install Git, Git Bash, SSH client
3. Restore SSH private key from password manager
4. If you've lost SSH access entirely, use Hetzner's web console to add a
   new SSH key for `garrett`, then SSH in
5. Pull the repo to your new laptop, copy `.env.kamal` from server or
   password manager
6. Resume operations

If the password manager is also lost: rotate all secrets to new values,
re-acquire keys from Supabase/GitHub/Shopify dashboards, rebuild
`.env.kamal`, deploy. Sessions invalidated; webhooks briefly fail.

## Verification checklist after any recovery

After recovering from any scenario above:

- [ ] `curl -k https://5-78-220-153.sslip.io/api/health` returns
  `{"status":"ok",...}`
- [ ] Browser load works: page renders, no 502s
- [ ] Login works for a test user
- [ ] Orders list loads with current data
- [ ] Move an order forward and backward (PIN gate works)
- [ ] One Shopify webhook fires successfully
- [ ] Cron jobs are scheduled: `crontab -l`
- [ ] Most recent `cron.log` entries show successful runs

## Maintaining this doc

Update this file when:

- Architecture changes (new server, new database)
- Recovery steps change because tooling changed
- Backup strategy changes
- After any actual recovery, with notes on what was harder than expected

The best disaster recovery doc is one that's been used at least once.
