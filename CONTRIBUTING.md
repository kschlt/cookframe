# Contributing to Cookframe

Thanks for your interest. This document covers how to set up, what the checks are, and the
few rules that keep the project coherent.

## Setup

Requires Node 26 — the version `package.json` declares and the one CI and both
containers run.

```bash
npm ci
```

A container is provided for a reproducible environment:

```bash
docker build -t cookframe .
docker run --rm cookframe   # runs the full quality gate
```

## The checks

Run the same checks CI runs before you push:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript, strict, no emit |
| `npm run lint` | Biome lint (the single lint + format toolchain, ADR-0012) |
| `npm run format:check` | Biome format check |
| `npm run test` | The full test suite |
| `npm run eval` | The eval harness over the public fixtures |
| `npm run test:persistence` | The store proofs — needs a PostgreSQL server (see below) |
| `npm run quality` | typecheck + `biome ci` + tests, all at once |

### Running the store's proofs

The durable store is PostgreSQL (`ADR-0015`), so its proofs need a real server; nothing stands
in for one. Point `DATABASE_URL` at a database you do not mind being written to — the proofs
create a throwaway schema per test and drop it again:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres npm run test:persistence
```

**With `DATABASE_URL` unset they skip; with it set and nothing answering they FAIL.** That
asymmetry is deliberate: skipping is a convenience for a machine that has no server, and once a
database has been asked for, silence would mean a proof reporting success without running. CI
always sets the variable, so the skip can never be the normal case.

You do not apply the migration yourself for the tests — they apply
`migrations/0001-the-recipe-store.sql` into each throwaway schema, which is also how that file
stays the only declaration of the store's shape.

In CI these are split differently, so do not read the table above as a list of jobs. Most test
directories have a job of their own, a few have none and run only inside the whole-suite
`npm run quality` that `container` and `merge-gate` each execute, and the job list in
`.github/workflows/ci.yml` is the only current answer. A failure in any one fails the build.

Do not keep a second copy of that list here. This paragraph has already been wrong twice in one
day — once by going stale, once by generalizing without counting — and both times a contributor
would have believed it.

One job is not like the others: `merge-gate` runs the full gate against the *result* of merging
your branch into `main`, not against your branch (`ADR-0022`). Two pull requests that are each
green can still break `main` together, and that job is what catches it.

## Rules that are easy to miss

- **`schema/` is the single source of truth for the data contract.** Validation,
  persistence and the Schema.org mapping all import the shape from `schema/`. Do not
  declare a second copy of the shape anywhere else — a `z.object(...)` outside `schema/`
  will fail a test.
- **No monorepo tooling.** There is one deployable; there is no workspaces field and no
  monorepo config. Keep it that way until a second deployable actually exists.
- **Placeholders only, everywhere.** Never commit a real secret, not even in an example.
  Copy `.env.example` to `.env` and fill it locally.
- **Private eval fixtures stay private.** Real photos and personal recipes live under
  `evals/fixtures/private/`, which is git-ignored. Commit only `evals/fixtures/public/`.
- **Architecture and product decisions are records.** See `docs/adr/` and `docs/product-decisions/`. An
  accepted record is never rewritten; it is superseded by a new one.

## License and contributions

Cookframe is under the [GNU Affero General Public License, version 3 or later](LICENSE), and the
project's copyright is held by its maintainer alone. That single ownership is what leaves the door
open to licensing the same code commercially later, and one merged outside contribution closes it,
because the contributor then owns their part and nobody can license it without asking them.

So there is one condition on a change from outside: **it is merged only once its author has said,
in the pull request, that the maintainer may also license their contribution on other terms,
including commercially.** One sentence in the description is enough. Nobody is asked to give up
anything they keep — the contribution stays theirs and stays under the AGPL for everyone else.

This is the light form on purpose. If the project ever becomes a real business it will need a
proper contributor agreement; until then, this sentence is what keeps the option from being lost by
accident.

## Commit messages

Every commit a pull request brings, and the pull request's title, is a
[Conventional Commit](https://www.conventionalcommits.org/): `type(scope): description`, with an
optional `!` after the type or scope for a breaking change.

- **Types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style`, `test`. Nothing else — `spike`, `probe` and `review` appear in older history and are
  refused now.
- **The description** is at most 100 characters for the whole line, has no trailing period, and
  may be written in English or German. There is no rule on its case.
- **Merging `main` into your branch:** write the merge commit yourself, e.g.
  `chore: merge main into my-branch`. git's own `Merge branch 'main' into …` is also accepted, as
  the one exception, and only on a commit that really has two parents.

The `commits` job checks this on every pull request, against the base as it stands when the job
runs (`tests/commits/`, `ADR-0031`). Nothing checks history that is already on `main`, and it is
not rewritten.

`npm install` and `npm ci` also install a `commit-msg` hook (`.githooks/`, through
`core.hooksPath`) that applies the same rule before a commit exists, because a commit that has
been pushed can only be repaired by rewriting the branch. It takes the place of anything in
`.git/hooks/`, `git commit --no-verify` skips it, and the `commits` job still holds either way.

## Pull requests

Keep a change to a single concern with its tests. Describe what a reader would see before
and after. CI must be green before review.
