#!/usr/bin/env bash
# First-time Fly.io setup for a Cookframe instance: app, volume, secrets.
#
# Usage: scripts/fly-setup.sh [app-name] [--deploy]
#
# Run it from the repository root, after `fly auth login`. It never prints or
# stores your database URL or OpenAI key (it reads them without echo), it
# generates the two instance credentials, prints them ONCE, and stages every
# secret so nothing restarts until the deploy. See docs/deploy-fly.md.
set -euo pipefail

APP="cookframe"
DEPLOY=0
for arg in "$@"; do
  if [ "$arg" = "--deploy" ]; then DEPLOY=1; else APP="$arg"; fi
done
REGION="fra"

command -v fly >/dev/null || { echo "flyctl is not installed: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required to generate credentials" >&2; exit 1; }
[ -f fly.toml ] || { echo "run this from the repository root (fly.toml not found)" >&2; exit 1; }
fly auth whoami >/dev/null 2>&1 || { echo "not logged in: run 'fly auth login'" >&2; exit 1; }

# The app name appears twice in fly.toml: the app line and the public address.
if [ "$APP" != "cookframe" ]; then
  sed -i.bak -e "s|^app = .*|app = \"$APP\"|" \
    -e "s|PUBLIC_BASE_URL = .*|PUBLIC_BASE_URL = \"https://$APP.fly.dev\"|" fly.toml && rm -f fly.toml.bak
  echo "fly.toml now names the app \"$APP\" (review and commit this change)."
fi

if fly apps list --json 2>/dev/null | grep -q "\"Name\": *\"$APP\""; then
  echo "app $APP already exists, reusing it"
else
  fly apps create "$APP"
fi

if fly volumes list --app "$APP" 2>/dev/null | grep -q cookframe_data; then
  echo "volume cookframe_data already exists, reusing it"
else
  fly volumes create cookframe_data --region "$REGION" --size 1 --yes --app "$APP"
fi

read -r -s -p "DATABASE_URL (direct Neon connection, NOT the pooler): " DATABASE_URL; echo
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "that does not look like a PostgreSQL URL" >&2; exit 1 ;;
esac
case "$DATABASE_URL" in
  *-pooler*) echo "that is a pooled connection; use the direct one (docs/deploy-fly.md)" >&2; exit 1 ;;
esac
read -r -s -p "OPENAI_API_KEY: " OPENAI_API_KEY; echo
[ -n "$OPENAI_API_KEY" ] || { echo "OPENAI_API_KEY is empty" >&2; exit 1; }

INGEST="$(openssl rand -hex 24)"
LIBRARY="$(openssl rand -hex 24)"

# --stage: secrets are stored but no machine is restarted before the first deploy.
fly secrets set --stage --app "$APP" \
  "DATABASE_URL=$DATABASE_URL" \
  "OPENAI_API_KEY=$OPENAI_API_KEY" \
  "COOKFRAME_INGEST_CREDENTIAL=$INGEST" \
  "COOKFRAME_LIBRARY_CREDENTIAL=$LIBRARY" >/dev/null

cat <<MSG

Secrets are staged. Save these two now, they are not shown again:

  COOKFRAME_INGEST_CREDENTIAL  (the iOS Shortcut)   $INGEST
  COOKFRAME_LIBRARY_CREDENTIAL (opens the library)  $LIBRARY

MSG

if [ "$DEPLOY" = 1 ]; then
  fly deploy --ha=false --app "$APP"
  echo
  echo "Smoke test (expects 200; without the header the answer is a deliberate 404):"
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $LIBRARY" "https://$APP.fly.dev/"
else
  echo "Next: fly deploy --ha=false --app $APP   (or re-run with --deploy)"
fi
