---
id: "ADR-0012"
title: "Biome as the single lint and format toolchain"
status: accepted
date: 2026-09-18
tags: ["toolchain", "linting", "formatting", "ci", "developer-experience"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0002", "ADR-0005"]
---

## Context

Slice 0 (`CFV1-SL0`) requires "one lint and format toolchain, not several", but deliberately
does not pick it in passing. This record picks it.

Cookframe is a single-package TypeScript project on Node 22 (`ADR-0002`), with no monorepo tooling
until a second deployable exists (`ADR-0005`). The repository is public and open to contribution,
so contributor onboarding and CI speed are part of the toolchain's job, not incidental. The project
also does correctness-sensitive async I/O — network fetches guarded at the connector (`ADR-0010`),
filesystem persistence, normalization invariants — so a forgotten `await` on a promise is a real,
common production bug, which makes type-aware linting (e.g. `noFloatingPromises`) genuinely
valuable here rather than a nicety.

Two candidates:

- **ESLint + typescript-eslint + Prettier** — the long-standing default. Mature, huge plugin
  ecosystem, and full type-aware linting via typescript-eslint. Costs: two tools plus glue
  (`eslint-config-prettier`), more dependencies and config surface, flat-config migration churn,
  and type-aware rules make it markedly slower because they run the TypeScript checker.
- **Biome** — a single Rust-based tool that both lints and formats, with one config and one
  dependency. Historically its objection was no type-aware linting. As of Biome v2 ("Biotype",
  v2.3 in January 2026) it performs type-aware linting through its own type inference without
  invoking `tsc`: roughly 75–85% of typescript-eslint's rules, including `noFloatingPromises`
  (~75–85% of cases), at 10–20x the speed of ESLint + Prettier.

The historical reason to prefer ESLint here — type-aware safety on an async backend — has largely
closed: Biome now covers the highest-value type-aware rules, and the remaining gap is a minority of
rules at a fraction of the runtime cost.

## Decision

Use **Biome** as the single lint and format toolchain: one tool, one configuration, one
dependency, for both linting and formatting. Enable its type-aware rules, `noFloatingPromises`
among them. Rely on a strict `tsconfig` (strict mode and its family) for the correctness guarantees
that belong to the type checker rather than the linter. Do not run ESLint, typescript-eslint or
Prettier alongside it.

This decision is revisitable: if a specific, high-value type-aware rule that Biome cannot express
turns out to be necessary, adopting a narrowly-scoped typescript-eslint pass for that rule is an
additive, later decision — not a reason to carry the full ESLint + Prettier stack pre-emptively now.

## Consequences

### Positive

- Satisfies Slice 0's "one lint and format toolchain" literally: a single tool, not a lint tool
  plus a formatter plus glue.
- Fast CI and fast local runs (10–20x over ESLint + Prettier), which keeps the public-repo
  contributor loop tight and pre-commit checks cheap.
- One config file and one dependency to maintain and to onboard a contributor to — fewer moving
  parts, in keeping with the project's ethos.
- Keeps the high-value type-aware guard (`noFloatingPromises`) that matters for this async,
  network- and filesystem-touching backend.

### Negative

- Type-aware coverage is ~75–85% of typescript-eslint's, so a minority of type-aware rules have no
  Biome equivalent yet; strict `tsconfig` and review cover part of that gap, and the decision is
  revisitable if a specific missing rule bites.
- Smaller plugin ecosystem than ESLint; a future need for a specialized third-party lint plugin
  could force a targeted reconsideration.
- Biome is less familiar to some contributors than ESLint/Prettier, a one-time learning cost
  against a simpler day-to-day setup.

## Alternatives considered

- **ESLint + typescript-eslint + Prettier.** Rejected as the default: full type-aware coverage and
  the largest ecosystem, but two tools plus glue, more config and dependencies, and 2–3x slower
  linting once type-aware rules are on — against a project that explicitly wants one toolchain and
  minimal moving parts, and whose highest-value type-aware rules Biome now covers.
- **Biome for formatting + ESLint for linting.** Rejected: it reintroduces two tools and two
  configs, the exact "several toolchains" Slice 0 warns against, for a type-aware margin that no
  longer justifies the split.
