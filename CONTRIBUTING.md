# Contributing to Cookframe

Thanks for your interest. This document covers how to set up, what the checks are, and the
few rules that keep the project coherent.

## Setup

Requires Node 22 or newer.

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

CI runs six check jobs (typecheck, lint, unit, schema-contract, normalization-invariant,
url-fetch-security) plus a secret scan, and jobs with a PostgreSQL service for the store proofs
(`persistence`) and the DBQ spike (`dbq`). A failure in any one fails the build.

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
- **Architecture and product decisions are records.** See `docs/adr/` and `docs/pdr/`. An
  accepted record is never rewritten; it is superseded by a new one.

## Pull requests

Keep a change to a single concern with its tests. Describe what a reader would see before
and after. CI must be green before review.
