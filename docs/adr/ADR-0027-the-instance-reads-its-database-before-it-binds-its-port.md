---
id: "ADR-0027"
title: "The instance reads its database before it binds its port"
status: accepted
date: 2026-09-22
tags: ["persistence", "startup", "operations"]
constrained_by: ["PDR-0002", "ADR-0015"]
related_to: ["ADR-0003", "ADR-0018", "ADR-0024"]
---

## Context

`ADR-0015` made PostgreSQL the record of truth and `CFV1-PG` built the store behind
`RecipeRepository`. `CFV1-RUN` built the process that binds a port. This unit joins them: the
composition root now constructs `createPostgresStore(resolveDatabaseUrl())` instead of the
provisional in-memory store.

Joining them exposes a startup question neither unit had to answer, and it is not a question about
style.

**`pg` connects lazily.** `createPostgresStore(url)` builds a pool and issues no statement, so it
succeeds against a database that is unreachable, or reachable and empty — one the operator never
applied `migrations/0001-the-recipe-store.sql` to. Applying that migration is deliberately a manual
step (`ADR-0015`, and `.env.example` gives the operator the exact `psql` command), which makes an
empty database the single likeliest way this instance is ever misconfigured.

Without a check, such an instance **starts**. It binds its port, answers an unknown path with
`ADR-0024`'s equalized miss exactly as that record requires, passes any liveness probe that asks
whether the port answers — and returns 500 from the library page and every recipe page, because
those are the only routes that read. The operator learns nothing at start; the first person to open
their library learns it for them.

That is the failure shape this project names as the one it exists to prevent: configured wrongly,
running anyway, nothing in the output visibly wrong. `StoreNotMigratedError` already carries the
sentence "before starting the instance" — a promise only a composition root can keep, and until now
nothing was reading it at a start.

## Decision

**The composition root performs one real repository read before `startInstance`, and refuses to
start when it fails.**

- The probe is `listLibrary()` — an operation the instance actually performs, not a `select 1`. A
  query invented for the probe can pass against a database on which every real operation fails,
  which would make the check a ritual rather than a measurement.
- `StoreNotMigratedError` is rethrown **as itself**, so the refusal names
  `migrations/0001-the-recipe-store.sql` and the operator reads their own missing step rather than
  a driver's complaint about a relation.
- Anything else is wrapped as "the database at DATABASE_URL could not be read", with the driver's
  message kept as the cause.
- The pool is closed before either refusal, so a refusing process exits rather than lingering on an
  open handle.
- `DATABASE_URL` is **not** added to `REQUIRED_CONFIGURATION`. The store's own seam already refuses
  it by name and additionally rejects a URL no PostgreSQL driver could connect with, which a list of
  required names cannot check. One variable refused in two places is two places to keep in step.

## Consequences

**The process now needs its database reachable to come up at all.** A restart during a database
outage leaves the instance down instead of up and failing. This is the cost, and it is stated here
rather than discovered: for a single-user, operator-controlled instance (`PDR-0002`) that an
operator restarts themselves, down-and-saying-why beats up-and-500ing, and it is the same trade
`resolveDatabaseUrl` already made by refusing an absent URL rather than defaulting to a database
nobody chose.

**Every proof and CI job that starts the process now needs a database.** The `run` job gains a
`postgres:16` service; the `container` job gains one too and applies the migration with the same
`psql` command an operator is given, because a schema built any other way here is a schema nobody
will ever have. `tests/run/process.test.ts` decides skip-versus-fail with
`decideDatabaseAvailability` from the persistence harness rather than a second rule of its own, and
`run/ci-provides-the-database` requires the jobs to set the variable — a skip is honest only where
something always asks.

**The refusal is a startup-time cost on every start**, one round trip against an empty library. On
an instance that stops when idle (`ADR-0025`, proposed) that cost is paid on every wake. It is one
read; the alternative is a wake that serves 500s.

**What this does not decide:** the program still does not migrate itself. Applying the migration
remains the operator's step, and a program that migrates its own database is a different decision
that needs its own record.

## Alternatives considered

**Start anyway and let the routes fail.** The default, and what happens if nobody decides. Rejected
because it is indistinguishable from a healthy instance to everything except a person reading their
own library — the exact shape above.

**Start anyway, but fail a health endpoint.** Rejected for two reasons: this instance has no health
endpoint and `ADR-0024` makes adding one a question about what an unauthenticated caller may learn,
and a degraded-but-running instance is only useful where something can route around it. Nothing
here can.

**Probe with `select 1`.** Cheaper and reachable without the repository, and it proves the pool can
connect — which is not the claim. It passes against an empty database, the likeliest
misconfiguration of the two.

**Put `DATABASE_URL` in `REQUIRED_CONFIGURATION` as well.** It would group the refusal with the
others, at the price of two independent rules for one variable. The one that drifts is always the
one that stops failing.
