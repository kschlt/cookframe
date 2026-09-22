---
id: "ADR-0034"
title: "The TypeScript pin names what hangs on it in a checked table"
status: accepted
date: 2026-09-22
tags: ["dependencies", "tooling", "guards"]
supersedes: ["ADR-0028"]
related_to: ["ADR-0002", "ADR-0012", "ADR-0029", "ADR-0033"]
---

## Context

ADR-0028 kept TypeScript on `5.x`. `typescript@7` no longer exports the classic compiler API from
its default entry point and moves it behind `typescript/unstable/*`. ADR-0028 also said when the pin
comes off: when a stable public API covers what the guards here use. It listed that use in prose,
as five files and five surfaces: the parser, the visitor, the import preprocessor, the position
lookup, and the node predicates with `SyntaxKind`.

A revisit condition is only as good as that list, and the list went stale the same day. Measured on
`main` at `5d3e2b2` with the type checker, over every TypeScript source in the repository:

| file | in ADR-0028 | runtime surface used |
| --- | --- | --- |
| `tests/run/mounted-apps.test.ts` | yes | 8 |
| `tests/unit/response-header-record.test.ts` | yes | 7 |
| `tests/protections/configured-database.ts` | yes | 7 |
| `tests/slice2/render.test.ts` | yes | 1 |
| `tests/slice6/generation-policy.test.ts` | yes | 1 |
| `tests/protections/ingest-entry-points.ts` | no | 9 |
| `tests/protections/proof-names.ts` | no | 6 |
| `tests/protections/scan-retention-wiring.ts` | no | 6 |
| `tests/protections/url-capture-wiring.ts` | no | 7 |
| `tests/run/shopping-handoff.test.ts` | no | 4 |
| `tests/protections/seam-fields.ts` | no | 33 |
| `tests/protections/seam-fields.test.ts` | no | 4 |

So twelve files, not five. The surface also grew by more than ADR-0033's two additions. It now takes
in a whole program with a type checker (`createProgram`, `getTypeChecker` and ten `TypeChecker`,
`Type` and `Signature` methods), a compiler host (`createCompilerHost` and six host methods), config
parsing (`readConfigFile`, `parseJsonConfigFileContent`, `ts.sys`), and `Node.getText` and
`Node.forEachChild`. Even the day ADR-0028 was written, its revisit condition was narrower than its
own list: `canHaveModifiers` and `getModifiers` appear under `mounted-apps.test.ts` and in none of
the five surfaces the condition names.

**Nothing went red.** The list was prose in a record that is never rewritten, and no check compared
it with the tree. ADR-0033 noticed half of the gap and could only state it. Read on its own, the
pin could have been lifted the day a stable API covered the five listed surfaces, and seven files
would then have stopped compiling. This is the ADR-0029 shape: a record whose claim is aimed and
whose breadth nothing holds.

## Decision

**The pin stands as ADR-0028 set it. The list of what it protects moves out of prose into a table
that a guard holds to the tree.**

1. **The pin itself does not change.** `typescript: "^5.7.0"` in `package.json` caps the install.
   The `ignore` for `typescript` at `version-update:semver-major` in `.github/dependabot.yml`
   stops the proposal. That file's comment now names this record and the table. ADR-0028's
   reasons stand and are not repeated here: the rejection of `unstable/*`, of rewriting guards as
   regexes, of a caret with no `ignore`, and of an exact pin.

2. **The revisit condition is the table.** The pin is lifted when TypeScript publishes a stable
   public compiler API, under a supported entry point that is not `unstable`, that covers every
   entry in `COMPILER_API_IN_USE` in `tests/protections/compiler-surface.test.ts`. The table
   names each file that calls the compiler API and what it calls, by where the compiler declares
   it: `ts.createSourceFile`, `SourceFile.getLineAndCharacterOfPosition`,
   `TypeChecker.getContextualType`. This record does not copy the table, so there is one list to
   keep current.

3. **`protections/the-typescript-pin-names-what-hangs-on-it` holds the table to the tree.** It
   builds a program over every TypeScript source in the repository, including sources
   `tsconfig.json` leaves out such as spikes, and skips only `node_modules`, `.git` and `.aos`. It
   requires the measured set to equal the table in both directions, file by file and entry by
   entry. A guard that starts calling a new part of the API is red by name until the table says
   so. So is a new file that starts parsing source. An entry nothing uses any more is red too, so
   the table cannot overstate the pin either.

4. **What counts is stated in `compiler-surface.ts` and proved there.** A use is an identifier
   whose symbol, followed through imports and aliases, is declared in the compiler's own
   `typescript.d.ts` and is a runtime value: a function, a method, a variable or an enum. The node
   predicates count as one family, `ts.is*`, and an enum as itself rather than member by member,
   because a stable API ships each of those whole or not at all. Types used only as annotations are
   not counted, and neither are the syntax tree's data fields. A new use is a line in the table and
   a question for the pin: would a stable API cover this too?

## Evidence

Every condition the scan decides on was planted wrong through `tests/protections/mutation.ts` and
went red at the fixture proof named for it:

- Counting types.
- Counting declarations outside the compiler.
- Not following aliases.
- Naming each predicate on its own.
- Naming enum members one by one.
- Naming methods as namespace members.
- Ignoring a destructured name.
- Following only files that import the compiler themselves, which misses a node a helper module
  hands over.
- Each of the five module forms the reach step follows: import and export declarations,
  `import x = require()`, import types, and `import()`.

Against the walk, narrowing it to `.ts`, skipping `spikes/`, entering `node_modules`, and reading
every file are each red at the walk's own proof. Against its root, pointing the scan at `tests/`
alone, at `src/` and `tests/`, or leaving out `spikes/` is each red at the proof that names the
trees the scan reaches. Against the table, dropping an entry and claiming a use nothing makes are
both red.

Three plants survived the first draft, and none survives in this one:

- **A separate branch for renamed destructuring.** It was dead, because the checker resolves the
  property name itself, so the branch was removed.
- **The walk narrowed to `.ts`.** It survived because nothing in the tree that calls the compiler
  is `.mts`, `.cts` or `.tsx`. A proof over a planted directory now holds the walk's breadth.
- **The scan pointed at `tests/` alone**, found in review. Every entry in the table lives under
  `tests/`, so the table held the scan's aim and nothing held the tree it was pointed at. A new
  parser in `src/` would have gone unseen. The walk is now one value shared by the table proof and
  a proof that names the seven trees it reaches, so narrowing it is red.

One step is inert by design, and the scan says so beside it. Before resolving identifiers, the
scan finds the files whose imports reach the compiler, which cuts its time from about 4.4 s to
about 2.2 s. Removing that step changes no result, so no proof can hold it. Narrowing it does
change results, and that is red.

## Consequences

### Positive

- The pin's condition cannot silently describe less than hangs on it. The next guard that parses
  source is red until its use is written down, and whoever next considers `typescript@7` reads a
  list that is true by construction.
- ADR-0033's gap is closed, and closed where it could be. The record it could not correct is
  superseded, not edited.

### Negative

- The table moves with every guard that parses source. That is its purpose: a red here is a
  question about the pin, not a number to update.
- The proof builds a program with a type checker over the whole repository, about 2.2 s per run.
- The scan itself uses the compiler API. It is in its own table, so it counts itself.
- Carried over from ADR-0028: a TypeScript major that carried a security fix would not open a pull
  request on its own. And the pin is still expressed in two places, the caret and the `ignore`.

## Alternatives considered

- **List the surface in this record.** Rejected: that is what went stale. An accepted record is
  never rewritten, so every new guard would need a new record just to keep a list current.
- **One set for the whole repository instead of a table per file.** Rejected: it would hold the
  surface and not its breadth. A new file using only surfaces already listed would arrive
  unnoticed, and so would the last user of a surface going away.
- **Find users by grepping for `from "typescript"`.** Rejected: it misses a method called on a node
  that a helper module hands over, which is the most common way into the API after the import
  itself.
- **Count every declaration in `typescript.d.ts`, types included.** Rejected: a type used only in
  an annotation constrains nothing at runtime. Counting the syntax tree's data fields would turn
  the table into a transcript of the parser's output rather than a list of entry points.
