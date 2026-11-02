#!/bin/bash
# Hits a cron endpoint on the locally-running app with auth.
# Usage: ./run-cron.sh /api/cron/production-complete
#
# ⚠ TWO COPIES, ONE TRUTH (2026-10-29, item 65). This file is committed as
# scripts/cron/run-cron.sh; the copy cron RUNS is ~/cron-jobs/run-cron.sh on the
# box. The deploy chain diffs the two, so a change made on the box alone is
# caught. healthchecks.map is NEVER committed: it holds the ping URLs.
#
# Reads CRON_SECRET from ~/.cron-secret (kept out of git, mode 600).
# Logs to ~/cron-jobs/cron.log so failed runs leave a trail.
#
# Dead-man's switch (healthchecks.io):
#   After the endpoint runs, this pings an external monitor so a job that
#   FAILS — or never runs at all — raises an alert off-box. The 64-day cron
#   outage was invisible precisely because nothing external was watching.
#
#   Ping URLs live in ~/cron-jobs/healthchecks.map (mode 600, NOT in git),
#   one line per endpoint:
#       /api/cron/production-complete https://hc-ping.com/<uuid>
#       /api/cron/sync-avis-catalog   https://hc-ping.com/<uuid>
#       /api/cron/teams-digest        https://hc-ping.com/<uuid>
#   An endpoint with no mapping simply isn't monitored (no error) — so this
#   script stays usable for ad-hoc/dry-run calls that shouldn't ping.
#
#   On success we ping <url>; on failure <url>/fail, so a run that executes
#   but errors alerts immediately instead of waiting for the grace timeout.
#   A missing ping (job never ran) is caught by healthchecks' own schedule.
#
#   ⚠ THE PING ITSELF IS NOW CHECKED (2026-08-26). Three entries carried
#   angle brackets from a paste -- <https://hc-ping.com/uuid> -- so every ping
#   returned 400 and `|| true` threw it away. Six days of silent monitoring
#   failure, with every other layer reporting success. A malformed URL now
#   goes to stderr (cron mails it); a failed ping is logged.

set -u

ENDPOINT="${1:-}"
if [ -z "$ENDPOINT" ]; then
  echo "Usage: $0 /api/cron/PATH" >&2
  exit 1
fi

if [ ! -r "$HOME/.cron-secret" ]; then
  echo "ERROR: $HOME/.cron-secret not readable" >&2
  exit 1
fi

CRON_SECRET=$(cat "$HOME/.cron-secret")
# ⚠ THE APP'S ADDRESS, NAMED ONCE (2026-10-29, item 65). It was written inline in
# the URL below. A hard-coded host is the shape of the 64-day outage -- an
# sslip.io host that stopped being the app, with nothing watching. A wrong
# address now fails loudly (the call fails, the check gets /fail), but it is
# named here, on its own line, where the deploy chain's diff shows any change.
APP_URL="https://www.ordersjkcabinets2you.com"
# Strip any query string when matching the monitor map: "/api/cron/x?dry=1"
# should map to the same check as "/api/cron/x".
ENDPOINT_PATH="${ENDPOINT%%\?*}"
URL="${APP_URL}${ENDPOINT}"
TS=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
MAP="$HOME/cron-jobs/healthchecks.map"

# Resolve this endpoint's ping URL, if it has one. Missing map or missing entry
# is fine — the job just runs unmonitored.
PING_URL=""
if [ -r "$MAP" ]; then
  # First field = endpoint path, second = ping URL. Ignore comments/blanks.
  PING_URL=$(awk -v e="$ENDPOINT_PATH" '$1==e {print $2; exit}' "$MAP")
fi

# ⚠ VALIDATE THE URL BEFORE TRUSTING IT.
#
# On 2026-08-20 three entries were pasted from a client that wraps links in
# angle brackets: <https://hc-ping.com/uuid>. Angle brackets are not valid in a
# URL, so every ping returned HTTP 400 -- and `|| true` below swallowed it. The
# jobs ran fine, logged rc=0, and the dead-man's switch was dead for SIX DAYS.
# Nothing visible was wrong anywhere except a timestamp on a dashboard.
#
# A malformed entry is a mistake somebody just made, so it goes to STDERR --
# cron mails that, which would have surfaced it the next morning instead of the
# next time someone happened to look.
if [ -n "$PING_URL" ]; then
  case "$PING_URL" in
    https://hc-ping.com/[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*) ;;
    *)
      echo "[$TS] ${ENDPOINT} MONITOR MISCONFIGURED: ping URL is not a well-formed hc-ping.com URL (length ${#PING_URL}). Check $MAP for stray characters." >&2
      echo "[$TS] ${ENDPOINT} monitor_misconfigured ping_url_length=${#PING_URL}" >> "$HOME/cron-jobs/cron.log"
      PING_URL=""
      ;;
  esac
fi

# -s silent, -S show errors, -L follow redirects.
#
# NOTE: -f is deliberately NOT used. It makes curl exit 22 on a non-2xx and
# DISCARD the body -- so a failing job logged "curl: (22) ... error: 500" and
# threw away the route's own explanation of what was wrong. The health check
# names the missing order, its id and the command to diagnose; none of that
# survived. We now capture the body and judge success from the status code.
#
# -w appends the HTTP status on its own last line, which is then split off.
RAW=$(curl -sSL \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "User-Agent: hetzner-cron" \
  --max-time 60 \
  -w '\n%{http_code}' \
  "$URL" 2>&1)
CURL_RC=$?

if [ "$CURL_RC" -ne 0 ]; then
  # Transport failure -- timeout, DNS, TLS. There is no HTTP status; keep
  # curl's own exit code so the cause stays distinguishable.
  RESPONSE="$RAW"
  RC=$CURL_RC
else
  HTTP_CODE="${RAW##*$'\n'}"      # last line
  RESPONSE="${RAW%$'\n'*}"        # everything before it
  case "$HTTP_CODE" in
    2*) RC=0 ;;
    # 22 is what -f used to return, so cron and the ping logic below are
    # unchanged for anything that reads the exit status.
    *)  RC=22
        RESPONSE="HTTP ${HTTP_CODE} ${RESPONSE}"
        ;;
  esac
fi

# Keep the log line readable. The container log has the untruncated version.
if [ "${#RESPONSE}" -gt 1200 ]; then
  RESPONSE="${RESPONSE:0:1200}…[truncated]"
fi
echo "[$TS] ${ENDPOINT} rc=${RC} response=${RESPONSE}" >> "$HOME/cron-jobs/cron.log"

# Ping the dead-man's switch. Best-effort: a monitoring failure must never
# change the job's own exit status, and its own short timeout keeps a slow
# hc-ping from hanging cron.
if [ -n "$PING_URL" ]; then
  if [ "$RC" -eq 0 ]; then
    PING_TARGET="$PING_URL"
  else
    PING_TARGET="${PING_URL}/fail"
  fi

  # ⚠ STILL BEST-EFFORT -- the job's exit status is never touched by a
  # monitoring failure. But the RESULT IS NOW RECORDED.
  #
  # This was `curl ... || true`, which discarded everything including a
  # persistent HTTP 400. A ping that cannot report is exactly the case the
  # dead-man's switch exists for, and it was the one case it could not report.
  #
  # A transient failure (healthchecks.io briefly unreachable) is logged and
  # nothing more -- it is not worth an email. A MISCONFIGURED url is caught
  # above, where it is loud.
  PING_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PING_TARGET" 2>/dev/null) || PING_CODE="000"
  case "$PING_CODE" in
    2*) ;;
    *)  echo "[$TS] ${ENDPOINT} ping_failed http=${PING_CODE} target=${PING_TARGET%/*}/…" >> "$HOME/cron-jobs/cron.log" ;;
  esac
fi

exit "$RC"
