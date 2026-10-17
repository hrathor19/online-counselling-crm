#!/usr/bin/env bash
#
# Calls one of the CRM's scheduled endpoints from system cron.
#
#   ./scripts/run-cron.sh email-reports
#   ./scripts/run-cron.sh reassign-leads
#
# The shared secret is read from .env.local at call time rather than written
# into the crontab, so rotating CRON_SECRET does not silently leave cron
# authenticating with the old value and getting 401s nobody is watching for.
#
# Output goes to the journal (`journalctl -t crm-cron`), not to a file. An
# appended logfile grows without limit, and this box has already run out of
# disk twice; the journal is rotated for us.
#
# Talks to 127.0.0.1:3000 directly rather than through nginx: it is the same
# app, one less moving part, and it keeps working while a certificate renewal
# or an nginx reload is in flight.

set -euo pipefail

JOB="${1:-}"
case "$JOB" in
  email-reports|reassign-leads) ;;
  *)
    echo "usage: $(basename "$0") {email-reports|reassign-leads}" >&2
    exit 2
    ;;
esac

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env.local"
TAG="crm-cron"

log() { logger -t "$TAG" -- "$*"; }

if [[ ! -r "$ENV_FILE" ]]; then
  log "$JOB: cannot read $ENV_FILE"
  exit 1
fi

# Strip surrounding quotes, tolerate `KEY = value`, ignore comments.
SECRET="$(sed -n 's/^[[:space:]]*CRON_SECRET[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'' | tr -d '[:space:]')"

if [[ -z "$SECRET" ]]; then
  log "$JOB: CRON_SECRET is empty in $ENV_FILE — refusing to call"
  exit 1
fi
# The placeholder that shipped in the example file. Calling with it would get a
# 401, so say which problem it actually is.
if [[ "$SECRET" == "<generated>" ]]; then
  log "$JOB: CRON_SECRET is still the literal placeholder <generated>"
  exit 1
fi

# --max-time so a wedged request cannot overlap the next tick. The
# re-assignment job is the slow one; 300s matches its route's maxDuration.
RESPONSE="$(curl -sS --max-time 300 -w '\n%{http_code}' \
  -X POST "http://127.0.0.1:3000/api/cron/$JOB" \
  -H "x-cron-secret: $SECRET" 2>&1)" || {
    log "$JOB: curl failed — $RESPONSE"
    exit 1
  }

STATUS="$(printf '%s' "$RESPONSE" | tail -1)"
BODY="$(printf '%s' "$RESPONSE" | sed '$d')"

if [[ "$STATUS" == "200" ]]; then
  # Logged even on success: "it ran and did nothing" and "it never ran" look
  # identical afterwards otherwise.
  log "$JOB: ok — $BODY"
else
  log "$JOB: HTTP $STATUS — $BODY"
  exit 1
fi
