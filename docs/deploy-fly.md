# Deploying an instance to Fly.io

This is the maintainer's reference-instance guide. It records how the maintainer's own instance is
deployed (ADR-0026), written down so a second person can repeat it. It is **not** a promised or
supported deployment path: the documented way to self-host Cookframe stays `docker compose` on a
machine you control (PDR-0002), and a platform account holds your machine and data in a way that
path does not. Use this if you accept that trade.

## Other ways to run an instance

Cookframe is one container (`Dockerfile.runtime`) that needs a PostgreSQL database, a directory for
photographs and four secrets. Anything that provides those works:

- **Your own machine or VPS with `docker compose`** — the documented path (README, "Running an
  instance"). You hold machine, data and credentials.
- **Fly.io with Neon** — this guide. Scale-to-zero: the machine stops when idle and the database
  sleeps, so an unused instance costs close to nothing.
- **Any other container host** — replace `fly.toml` and set the same values. ADR-0026's portability
  cuts keep the platform to one file.

The rest of this page is the Fly path only.

## What you need

- A [Fly.io](https://fly.io) account with a payment method (Fly creates no apps without one) and
  `flyctl` installed (`brew install flyctl`), then `fly auth login`.
- A [Neon](https://neon.tech) project in Frankfurt (`aws-eu-central-1`), the same region as the Fly
  machine.
- An OpenAI API key. Captures are paid model calls; set a budget at the provider.
- This repository, cloned: `fly deploy` needs `fly.toml` and `Dockerfile.runtime`.

## The short way

```bash
scripts/fly-setup.sh my-cookframe --deploy
```

It creates the app and the volume, asks for your database URL and OpenAI key without echoing them,
generates the two credentials, stages all four secrets, deploys, applies migrations and smoke-tests
the result. It prints the two credentials once; save them. Pass your own app name, because
`cookframe` is a name only one Fly user can hold: the script then updates the app name and
`PUBLIC_BASE_URL` in `fly.toml`, which you should commit on your own fork.

The steps below are what it does, for when you want to run them yourself or something fails.

## 1. Database

Create a Neon project in Frankfurt and copy its **direct** connection string, not the one with
`-pooler` in the host. The instance is one process with its own connection pool, and a pooler in
front of it is a second pool with different session rules. It ends in `?sslmode=require`.

Neon can archive an idle branch. The first connection wakes it, which can take several seconds; if
the first deploy fails to connect, run it again.

You do not apply the SQL yourself. `npm run migrate` applies the migrations a database is missing
and skips the rest, and the deploy runs it (`release_command` in `fly.toml`). To run it by hand:

```bash
DATABASE_URL='postgres://…' npm run migrate
```

A database that predates a migration (an older instance upgrading) is brought forward by the same
command. A database it cannot classify, for example one with a later migration's table but not an
earlier one, stops it with a message rather than being guessed at.

## 2. App and volume

```bash
fly apps create my-cookframe
fly volumes create cookframe_data --region fra --size 1 --app my-cookframe
```

Fly warns that a volume is pinned to one host and asks to confirm. One volume is intended
(ADR-0026): no high availability, an outage is acceptable. The volume holds captured photographs;
`fly.toml` mounts it at `/data`, which equals `STORAGE_ROOT`.

## 3. Secrets

Four values, set with `fly secrets set`, never in `fly.toml` (that file is public) and never in
chat or issues:

| Secret | What it is |
| --- | --- |
| `DATABASE_URL` | the direct Neon connection string |
| `OPENAI_API_KEY` | never leaves the server |
| `COOKFRAME_INGEST_CREDENTIAL` | what the iOS Shortcut presents to submit a capture |
| `COOKFRAME_LIBRARY_CREDENTIAL` | what opens the library; **a different value** |

Both credentials need at least 32 characters, and the instance refuses to start if they are equal or
short. Generate them with `openssl rand -hex 24`. Use `--stage` so nothing restarts before the first
deploy, and quote the URL:

```bash
fly secrets set --stage --app my-cookframe "DATABASE_URL=postgres://…"
```

## 4. Deploy

```bash
fly deploy --ha=false --app my-cookframe
```

`--ha=false` keeps a single machine. The release command runs `npm run migrate` against your
database first; if it fails the deploy fails and nothing changes.

## 5. Check it

`GET /` without a credential answers **404 on purpose**: the instance does not confirm what it
serves. A smoke test needs the library credential:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $COOKFRAME_LIBRARY_CREDENTIAL" https://my-cookframe.fly.dev/
```

Expect `200`. The first request after an idle period waits for a cold start of a few seconds.
`fly logs --app my-cookframe` shows why a machine exited: a missing secret, an unreachable database
and a missing table each name themselves before the port opens (ADR-0027).

Then import `shortcut/Capture Recipe.plist` on your phone and give it the address and the ingest
credential.

## Later deploys

A deploy is `fly deploy --ha=false` from your machine, or, once set up, publishing a GitHub Release.
Either way the migrations run as part of it.

### Deploying from a release

`.github/workflows/deploy.yml` deploys when a release is published. CI deliberately does not deploy
(the repository is public, the workflow token is read-only and `ci.yml` holds no secrets,
CFV1-SL0), so this is a separate workflow with its own narrow trigger and the repository's first
secret. It is inert until you set that up:

1. Create a deploy token for the one app: `fly tokens create deploy --app my-cookframe`.
2. In the repository, Settings, Environments, create `production`, add yourself as a required
   reviewer, and add the token as the environment secret `FLY_API_TOKEN`.
3. Publish a release. The job pauses for your approval, builds on Fly's builder (`--remote-only`,
   so GitHub only waits), runs the migrations as the release command and swaps the version in. A
   failed migration fails the job and leaves the running version in place.

Cost: one job of a few minutes per release, which is free on a public repository. Tests are not
repeated, since a release is cut from a green `main`. Pull requests, forks and pushes cannot
trigger it, and without the environment's approval the token cannot be read. Fork this repository
and the workflow runs on your fork's releases with your own token, or delete the file.
