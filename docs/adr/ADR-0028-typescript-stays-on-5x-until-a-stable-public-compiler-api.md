---
id: "ADR-0028"
title: "TypeScript stays on 5.x until there is a stable public compiler API"
status: superseded
date: 2026-09-22
tags: ["dependencies", "tooling", "guards"]
related_to: ["ADR-0002", "ADR-0012"]
superseded_by: ["ADR-0034"]
---

## Context

Dependabot grouped three development-dependency majors into one pull request (#67):
`@types/node` 22→26, `vitest` 3→5, and `typescript` 5→7. The first two were taken as their
own units. This record is about the third, which is not a routine bump.

`typescript@7` is the native port (project "Corsa"): a reimplementation of the compiler in Go
with a deliberately different published surface. The default export of `"typescript"` is no
longer the compiler namespace — it is reduced to `{ version, versionMajorMinor }` — and the
programmatic compiler API is moved to a separate, explicitly unstable entry point
(`typescript/unstable/*`).

Five checks in this repository parse source with that API rather than grepping it, because a
regex over source text reports a false match for the same word in a comment or a string and a
guard that cries wolf gets switched off. Each imports `ts` from `"typescript"` and reaches into
the compiler namespace:

- `tests/run/mounted-apps.test.ts` — `ts.createSourceFile`, `ts.forEachChild`,
  `ts.canHaveModifiers`, `ts.getModifiers`, `ts.SyntaxKind`, and the `ts.isX` node predicates.
- `tests/unit/response-header-record.test.ts` — `ts.forEachChild`, the `ts.isX` predicates,
  `ts.SyntaxKind`.
- `tests/protections/configured-database.ts` — `ts.createSourceFile`,
  `SourceFile.getLineAndCharacterOfPosition`, the `ts.isX` predicates, `ts.SyntaxKind`,
  `ts.ScriptTarget`.
- `tests/slice2/render.test.ts` — `ts.preProcessFile`.
- `tests/slice6/generation-policy.test.ts` — `ts.preProcessFile`.

None of that surface is reachable through `typescript@7`'s default export. Taking the bump
therefore breaks the typecheck for five guards at once, and the only way to make them compile
again is to move them onto the `unstable/*` entry point — trading a load-bearing check for a
dependency on an API the vendor names unstable, or weakening the checks to something a regex can
do. The project's standing rule is that a guard is never weakened to let a dependency bump pass,
so neither is acceptable here.

`package.json` already carries `typescript: "^5.7.0"`, whose caret caps below `6.0.0`, so `npm`
will not install `7.x`. The caret is the pin. What it does not stop is Dependabot reopening the
same major every week inside the grouped development-dependencies pull request — where a bump
that cannot be taken keeps the whole group churning through the serial-merge rebase cycle.

## Decision

**TypeScript stays on `5.x`, and Dependabot is told to stop proposing its major.**

- The pin is the existing `typescript: "^5.7.0"` caret in `package.json` — no change is needed
  there; it is named here so the pin has a recorded reason rather than looking like an oversight.
- `.github/dependabot.yml` gains one `ignore` entry for `typescript` at
  `version-update:semver-major` in the `npm` update block, so the ignored major no longer reopens
  and the development-dependencies group stops going stale on it. Minor and patch updates to
  TypeScript still flow.
- The `ignore` entry carries a comment naming this record, so a reader of the automation config
  reaches the reasoning. That comment is prose in a YAML file, not a record citation the id check
  can see (`tests/records/` scans record `.md` files and `docs/open-questions.md`, not YAML), so
  it is a convenience for the human reader and nothing enforces it.

**Revisit condition.** This is lifted when TypeScript publishes a *stable* public compiler API —
the parser (`createSourceFile`), the visitor (`forEachChild`), the import preprocessor
(`preProcessFile`), the position lookup, and the node predicate / `SyntaxKind` surface — under a
supported (non-`unstable`) entry point. At that point the five guards migrate to it and the
`ignore` and the caret both come off in one unit. Until then a TypeScript major is a decision,
not a bump, and this record is where it is reconsidered.

## Consequences

### Positive

- The five source-parsing guards keep compiling and keep guarding. Nothing is weakened to pass a
  bump, and nothing is moved onto an API its own vendor labels unstable.
- The grouped development-dependencies pull request stops churning on a major it can never take,
  so the group's serial-merge rebases are spent on updates that can actually land.

### Negative

- A TypeScript major that carried a security fix would not open a pull request on its own. This is
  the real cost of the `ignore`, and it is why the revisit condition is written as a condition to
  watch rather than a date: a security-relevant major is a reason to do the migration, not a
  reason the `ignore` failed.
- The pin is now expressed in two places for two audiences — the caret that stops the install and
  the `ignore` that stops the proposal — and a future caret bump to `^6` (were `6.x` ever a
  classic-API release) would have to remember the `ignore` too. Stated here so the pair is found
  together.

## Alternatives considered

**Take `typescript@7` and move the guards onto `typescript/unstable/*`.** Rejected: the vendor
names that entry point unstable, so a guard built on it inherits a surface that can change under a
minor, and a guard that reads a library's internals can quietly stop guarding after a bump while
still reporting success. Trading a load-bearing check for that is the opposite of the trade this
project makes.

**Take `typescript@7` and rewrite the five guards to grep source text instead of parsing it.**
Rejected: a regex over source matches the same token in a comment or a string literal, which is
exactly the false-positive that gets a guard switched off, and it cannot express what these
checks assert (a header set inside a particular function, an unexported composition root, a
`DATABASE_URL` read with no stand-in). This is weakening a guard to pass a bump.

**Cap the caret and add no `ignore`.** Rejected: the caret already stops the install, but
Dependabot reopens the major inside the grouped pull request every week, and one member of a
group that can never merge keeps the whole group cycling through rebases. The `ignore` is what
makes the pin quiet.

**Pin TypeScript to an exact version instead of a caret.** Rejected: it would also freeze the
minor and patch updates this record deliberately keeps flowing, for no gain — the caret already
holds the line at the major, which is the only boundary that matters here.
