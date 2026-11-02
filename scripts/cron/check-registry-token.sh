#!/bin/bash
# Weekly: is the GHCR registry token still accepted, and when does it expire?
#
# ⚠ WHY THIS EXISTS. The token Kamal pushes images with is a GitHub classic PAT,
# and it expires. When it does, `kamal deploy` fails at its FIRST step with
# `denied: denied` -- harmless (nothing is built or replaced) but always found
# mid-deploy. It happened on 2026-08-18 and again on 2026-09-16. This turns the
# surprise into a warning two weeks ahead.
#
# WHAT IT CHECKS, with one call to the GitHub API:
#   - the token is accepted at all                (HTTP 200 from /user)
#   - it still carries write:packages             (x-oauth-scopes header)
#   - how long until it expires                   (github-authentication-token-
#                                                   expiration header)
# and fails when the token is rejected, lacks the scope, or expires within
# WARN_DAYS. A token with no expiry passes, and says so in the log.
#
# WHERE THE TOKEN COMES FROM: ~/cabinet-orders/.env.kamal, read with the same
# grep | cut the Kamal loader uses (.kamal/secrets), so this checks exactly the
# value `kamal deploy` will send. The token is never logged, and it is passed to
# curl on stdin (-K -), not on the command line, so it does not show in `ps`.
#
# REPORTING: like run-cron.sh -- a line in cron.log every run, and a ping to the
# healthchecks.io URL mapped to "registry-token" in healthchecks.map: <url> on
# success, <url>/fail on failure. A malformed URL goes to stderr, which cron
# mails. With no mapping it still logs, it just is not watched off-box.

set -u

ENV_FILE="$HOME/cabinet-orders/.env.kamal"
MAP="$HOME/cron-jobs/healthchecks.map"
LOG="$HOME/cron-jobs/cron.log"
KEY="registry-token"
WARN_DAYS=14
TS=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

log() { echo "[$TS] ${KEY} $*" >> "$LOG"; }

RC=0
DETAIL=""

TOKEN=""
if [ -r "$ENV_FILE" ]; then
  TOKEN=$(grep '^KAMAL_REGISTRY_PASSWORD=' "$ENV_FILE" | cut -d '=' -f 2-)
fi

if [ -z "$TOKEN" ]; then
  RC=1
  DETAIL="no KAMAL_REGISTRY_PASSWORD in $ENV_FILE"
else
  # Headers only. -D - writes them to stdout; the body goes nowhere.
  # curl is the LAST command in this pipeline, so $? is curl's own status.
  # (With `| tr` on the end it was tr's, and a network failure logged rc=0.)
  RAW=$(printf 'header = "Authorization: token %s"\n' "$TOKEN" \
    | curl -sS -K - -o /dev/null -D - --max-time 20 \
        -H "User-Agent: jk-cabinets-registry-check" \
        https://api.github.com/user 2>&1)
  CURL_RC=$?
  HEADERS=$(printf '%s\n' "$RAW" | tr -d '\r')
  STATUS=$(printf '%s\n' "$HEADERS" | awk 'toupper($1) ~ /^HTTP\// {code=$2} END {print code}')
  SCOPES=$(printf '%s\n' "$HEADERS" | awk -F': ' 'tolower($1)=="x-oauth-scopes" {print $2}')
  EXPIRY=$(printf '%s\n' "$HEADERS" | awk -F': ' 'tolower($1)=="github-authentication-token-expiration" {print $2}')

  if [ "$CURL_RC" -ne 0 ] || [ -z "$STATUS" ]; then
    RC=1
    DETAIL="could not reach api.github.com (curl rc=${CURL_RC})"
  elif [ "$STATUS" != "200" ]; then
    RC=1
    DETAIL="token REJECTED (HTTP ${STATUS}) -- replace it in .env.kamal before the next deploy"
  else
    case ",${SCOPES// /}," in
      *,write:packages,*) ;;
      *) RC=1; DETAIL="token lacks write:packages (scopes: ${SCOPES:-none})" ;;
    esac
    if [ "$RC" -eq 0 ]; then
      if [ -z "$EXPIRY" ]; then
        DETAIL="ok, no expiry reported"
      else
        EXP_S=$(date -d "$EXPIRY" +%s 2>/dev/null) || EXP_S=""
        if [ -z "$EXP_S" ]; then
          RC=1
          DETAIL="could not parse expiry '${EXPIRY}'"
        else
          DAYS=$(( (EXP_S - $(date +%s)) / 86400 ))
          if [ "$DAYS" -lt "$WARN_DAYS" ]; then
            RC=1
            DETAIL="token expires in ${DAYS} day(s), on ${EXPIRY} -- replace it in .env.kamal"
          else
            DETAIL="ok, expires in ${DAYS} days, on ${EXPIRY}"
          fi
        fi
      fi
    fi
  fi
fi
unset TOKEN

log "rc=${RC} ${DETAIL}"

PING_URL=""
if [ -r "$MAP" ]; then
  PING_URL=$(awk -v k="$KEY" '$1==k {print $2; exit}' "$MAP")
fi
if [ -n "$PING_URL" ]; then
  case "$PING_URL" in
    https://hc-ping.com/[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*-[0-9a-f]*) ;;
    *)
      echo "[$TS] ${KEY} MONITOR MISCONFIGURED: ping URL is not a well-formed hc-ping.com URL (length ${#PING_URL}). Check $MAP." >&2
      log "monitor_misconfigured ping_url_length=${#PING_URL}"
      PING_URL=""
      ;;
  esac
fi
if [ -n "$PING_URL" ]; then
  if [ "$RC" -eq 0 ]; then TARGET="$PING_URL"; else TARGET="${PING_URL}/fail"; fi
  PING_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$TARGET" 2>/dev/null) || PING_CODE="000"
  case "$PING_CODE" in
    2*) ;;
    *)  log "ping_failed http=${PING_CODE}" ;;
  esac
fi

exit "$RC"
