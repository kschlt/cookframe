#!/usr/bin/env bash
# Guided first-time Fly.io setup for a Cookframe instance.
#
# Usage: scripts/fly-setup.sh [--deploy] [--release-deploys]
#
#   --deploy            also run the first deploy and smoke-test it
#   --release-deploys   also set up deploys from GitHub Releases (needs `gh`)
#
# Run it from the repository root, after `fly auth login`. It walks through the
# steps in order and tells you where it is. Values come from `.env.local` (which
# git ignores) when present and are asked for otherwise, so it also runs
# unattended, from a console or an agent, when everything is in that file:
#
#   FLY_APP=my-cookframe                  the app name (default: cookframe)
#   DEPLOY_DATABASE_URL=postgres://...    the DIRECT Neon connection, not the pooler
#   OPENAI_API_KEY=sk-...
#
# The two instance credentials are generated, kept in `.env.local` (mode 600) so
# you can read them back later, and never printed to a log. Nothing is committed.
# See docs/deploy-fly.md.
set -euo pipefail

DEPLOY=0
RELEASE=0
for arg in "$@"; do
  case "$arg" in
    --deploy) DEPLOY=1 ;;
    --release-deploys) RELEASE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
TOTAL=5; [ "$RELEASE" = 1 ] && TOTAL=6
step() { echo; echo "[$1/$TOTAL] $2"; }

ENV_FILE=".env.local"
[ -f fly.toml ] || { echo "run this from the repository root (fly.toml not found)" >&2; exit 1; }
if [ -f "$ENV_FILE" ]; then set -a; . "./$ENV_FILE"; set +a; fi
APP="${FLY_APP:-cookframe}"
REGION="fra"

# Append or replace one KEY=value line in .env.local, kept private.
save() {
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

step 1 "Checking your tools and login"
command -v fly >/dev/null || { echo "flyctl is not installed: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required to generate credentials" >&2; exit 1; }
fly auth whoami >/dev/null 2>&1 || { echo "not logged in: run 'fly auth login' first" >&2; exit 1; }
echo "ok, app name: $APP"

step 2 "Naming the app in fly.toml"
if [ "$APP" != "cookframe" ]; then
  sed -i.bak -e "s|^app = .*|app = \"$APP\"|" \
    -e "s|PUBLIC_BASE_URL = .*|PUBLIC_BASE_URL = \"https://$APP.fly.dev\"|" fly.toml && rm -f fly.toml.bak
  echo "fly.toml now names the app \"$APP\" (commit this on your fork)."
else
  echo "keeping the default name"
fi

step 3 "Creating the app and its volume"
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

step 4 "Setting the four secrets (staged, nothing restarts yet)"
DB="${DEPLOY_DATABASE_URL:-}"
if [ -z "$DB" ]; then read -r -s -p "  Neon DATABASE_URL (direct connection, not the pooler): " DB; echo; fi
case "$DB" in postgres://*|postgresql://*) ;; *) echo "that does not look like a PostgreSQL URL" >&2; exit 1 ;; esac
case "$DB" in *-pooler*) echo "that is a pooled connection; use the direct one (docs/deploy-fly.md)" >&2; exit 1 ;; esac
KEY="${OPENAI_API_KEY:-}"
if [ -z "$KEY" ]; then read -r -s -p "  OPENAI_API_KEY: " KEY; echo; fi
[ -n "$KEY" ] || { echo "OPENAI_API_KEY is empty" >&2; exit 1; }
INGEST="${COOKFRAME_INGEST_CREDENTIAL:-$(openssl rand -hex 24)}"
LIBRARY="${COOKFRAME_LIBRARY_CREDENTIAL:-$(openssl rand -hex 24)}"
save COOKFRAME_INGEST_CREDENTIAL "$INGEST"
save COOKFRAME_LIBRARY_CREDENTIAL "$LIBRARY"
fly secrets set --stage --app "$APP" \
  "DATABASE_URL=$DB" "OPENAI_API_KEY=$KEY" \
  "COOKFRAME_INGEST_CREDENTIAL=$INGEST" "COOKFRAME_LIBRARY_CREDENTIAL=$LIBRARY" >/dev/null
echo "  secrets staged. The two credentials are saved in $ENV_FILE (private, git-ignored):"
echo "  COOKFRAME_INGEST_CREDENTIAL goes into the iOS Shortcut, COOKFRAME_LIBRARY_CREDENTIAL opens the library."

step 5 "Deploying"
if [ "$DEPLOY" = 1 ]; then
  fly deploy --ha=false --app "$APP"
  printf 'Smoke test (expects 200): '
  curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $LIBRARY" "https://$APP.fly.dev/"
else
  echo "skipped. Deploy with: fly deploy --ha=false --app $APP   (or re-run with --deploy)"
fi

if [ "$RELEASE" = 1 ]; then
  step 6 "Setting up deploys from GitHub Releases"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
    ME="$(gh api user --jq .id)"
    gh api -X PUT "repos/$REPO/environments/production" \
      -F "reviewers[][type]=User" -F "reviewers[][id]=$ME" >/dev/null
    fly tokens create deploy --app "$APP" | gh secret set FLY_API_TOKEN --env production --repo "$REPO"
    echo "environment 'production' (you as required reviewer) and secret FLY_API_TOKEN set on $REPO."
    echo "Publish a GitHub Release to deploy; approve the run under Actions."
  else
    echo "gh is not installed or not logged in. Do it by hand (docs/deploy-fly.md, 'Deploying from a release'):"
    echo "  1. fly tokens create deploy --app $APP"
    echo "  2. GitHub, Settings, Environments: create 'production', add yourself as required reviewer"
    echo "  3. add the token there as the secret FLY_API_TOKEN"
  fi
fi
echo; echo "Done."
