# Deploying to Fly.io with an agent

A runbook for a coding agent that has been told to "set up Cookframe on Fly". A person can follow
it too; [`deploy-fly.md`](deploy-fly.md) explains the same path and why. This is the maintainer's
reference-instance path (PDR-0010), not a promise of platform support.

## Rules for the agent

- Never print, log, commit or paste a secret: the database URL, the OpenAI key, the two Cookframe
  credentials, a Fly token. They live in `.env.local` (git ignores it) and in Fly's secret store.
- Ask the person before anything that costs money or goes live: creating the Fly app, the first
  deploy, publishing a release. Say what it will do first.
- Do not edit `ci.yml` or add a deploy step to it. Deploys from CI are `deploy.yml`, behind the
  `production` environment, and the person approves each run.
- Stop and report on the first failure. Do not retry a deploy in a loop.

## Steps

1. **Check the machine.** `fly version` and `fly auth whoami` must work. If not, tell the person to
   install `flyctl` (https://fly.io/docs/flyctl/install/) and run `fly auth login` themselves;
   the login is theirs.
2. **Collect three values** and write them to `.env.local` in the repository root, one per line, in
   quotes. Ask the person for each; do not invent them:
   - `FLY_APP`: an app name nobody else holds (`cookframe` is the maintainer's).
   - `DEPLOY_DATABASE_URL`: a Neon **direct** connection string (no `-pooler` in the host), project
     in Frankfurt. Neon can archive an idle branch, and the first connection wakes it.
   - `OPENAI_API_KEY`.
3. **Run the setup script**, after the person agrees: `scripts/fly-setup.sh --deploy`. Add
   `--release-deploys` if they want deploys from GitHub Releases and `gh auth status` succeeds. The
   script creates the app and volume, generates the two credentials into `.env.local`, stages the
   four secrets, deploys, and smoke-tests. The release command applies the database migrations.
4. **Read the result.** The smoke test must print `200`. A `404` without the library credential is
   deliberate, not a failure. If the deploy failed, read `fly logs --app <FLY_APP>`: a missing
   secret, an unreachable database or a missing table each name themselves. Report the message.
5. **Commit the `fly.toml` change** (the app name and public address) on the person's fork. Never
   commit `.env.local`.
6. **Hand over.** Tell the person where the credentials are (`.env.local`), that the ingest
   credential goes into the iOS Shortcut (`shortcut/Capture Recipe.plist`) together with
   `https://<FLY_APP>.fly.dev`, and that the library credential opens the library.

## Later deploys

`fly deploy --ha=false --app <FLY_APP>`, or publish a GitHub Release if step 3 used
`--release-deploys`; the person approves the run under Actions. Migrations run as part of the deploy.
