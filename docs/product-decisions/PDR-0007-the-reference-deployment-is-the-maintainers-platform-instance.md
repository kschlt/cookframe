---
id: "PDR-0007"
title: "The reference deployment is the maintainer's platform instance; self-hosting stays possible and unproven"
status: accepted
date: 2026-10-30
tags: ["deployment", "self-hosting", "product", "posture"]
supersedes: ["PDR-0002"]
related_to: ["ADR-0026", "PDR-0002"]
---

## Context

`PDR-0002` made a self-hosted single-user instance on infrastructure the operator controls the
reference deployment, and said an edge or platform deployment is "not shipped and not documented for
V1". Two things have happened since.

`ADR-0026` chose a platform for the maintainer's own instance, with the maintainer's answer that
`PDR-0002` binds what is shipped and documented, not the instance they run themselves. And on
2026-10-30 that instance was deployed for real: Fly.io for the machine and volume, Neon for the
database. It is the only way of running Cookframe that has been operated in practice. The
self-hosted way is exercised by the test suite (the process starts and serves against a PostgreSQL,
the runtime image builds) but nobody has run it, and the repository ships no container composition,
which `PDR-0002` assumed.

The guide for the path that was actually run (`docs/deploy-fly.md`) is documentation of a platform
deployment, which `PDR-0002` rules out. Either the guide waits, or the posture is restated to match
what the project has done. This record does the second.

## Decision

The reference deployment is **the maintainer's instance on a platform with a managed database**, as
`ADR-0026` describes it, and the project documents that path. The documentation says plainly that
it is the path that has been operated, and that a platform account holds the operator's machine and
data in a way self-hosting does not.

Self-hosting on infrastructure the operator controls is **not withdrawn**. It remains possible, it
stays the answer for anyone who does not want a platform account, and the README keeps describing
it. It is documented as exercised by tests and not yet operated in practice, until someone has
run it. No second path is promised, tested or supported beyond that.

This record does not change what the product is for, its single-user scope, or any of
`PDR-0002`'s reasoning about why operator-held data matters; it changes which path the project can
vouch for.

## Consequences

### Positive

- The documentation says only what has been done, and `main` no longer contradicts an accepted
  record while documenting the maintainer's own deployment.
- Another person can repeat the deployment from a guide, a setup script and a release workflow
  instead of from the maintainer's terminal history.

### Negative

- The project now documents a path that makes the operator depend on a platform account, which
  `PDR-0002` was written to avoid. The mitigation is that the platform sits in one file
  (`ADR-0026`'s fourth cut) and the database is a URL.
- Self-hosting, still named as possible, has no worked and tested path until someone runs one and a
  composition is added.

### Neutral

- Nothing in the code changes. `PDR-0002` stays in the tree, superseded, with its body untouched.

## Alternatives considered

**Keep `PDR-0002` and document the platform path as an exception.** Rejected: an exception nobody
can find in the record is the contradiction this record exists to remove.

**Ship a container composition first and make self-hosting the proven path.** It would keep
`PDR-0002` true, but it is work that has not been done and would block documenting the path that has
been. It stays open as follow-up work, not as a condition of this record.
