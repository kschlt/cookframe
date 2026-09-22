---
id: "ADR-0030"
title: "A licence declaration is a link to the licence file"
status: accepted
date: 2026-09-22
tags: ["documentation", "guards", "licensing"]
related_to: ["ADR-0020", "ADR-0029"]
constrained_by: ["PDR-0006"]
---

## Context

[PDR-0006](../product-decisions/PDR-0006-the-project-is-licensed-under-the-agpl.md) moved the
project from MIT to `AGPL-3.0-or-later`, and it wrote down its own gap in its last Negative bullet:

> Nothing in the test suite enforces any of this. There is no check that `LICENSE`, `package.json`
> and the prose agree. A later drift between them will be found by a person reading, or not at all.

The gap collected its first casualty four minutes after that sentence was written. The first commit
of the licence change left the root entry of `package-lock.json` reading `"license": "MIT"` while
`LICENSE`, `package.json` and every prose statement had moved to the AGPL. Nobody was careless: the
lock file's root entry is a copy of the manifest's field that only `npm install` rewrites, and
nothing in the tree had any other reason to look at it.

The review thread then measured the gap rather than restating it. Two opposite violations were
planted on `main` — `package.json` back to MIT against an AGPL `LICENSE`, and `LICENSE` reduced to
an MIT stub against an AGPL `package.json` — and **both times the full gate stayed green, 1079
passed and 2 skipped**. A repository can say two different things about its own licence and pass
every check it has.

Closing that needs a guard, and a guard needs to know what a licence statement *is*. Two answers
were available and only one of them survives contact with this tree.

**Reading licence names out of prose does not work here.** Three places name a licence for reasons
that are not declarations and must never be forced to change:

- `docs/adr/ADR-0010-safe-url-fetch-is-guarded-at-the-connector.md` and
  `src/security/address-policy.ts` describe `ipaddr.js` as a "single-file, MIT" library.
- `docs/archive/discovery-decision-log.md` records the founding decision, `License: **MIT**`.
- `PDR-0006` itself quotes the licence it supersedes at length — the bullet it replaces, and several
  paragraphs weighing MIT against the AGPL.

An accepted record is never rewritten, so those mentions are permanent. A rule that read licence
names out of prose would either go red on all of them or need an exception list that grows with
every record added. The second is worse than it looks: a guard whose exception list grows is a guard
that can one day be quieted by adding one line to it, which is the same failure ADR-0029 describes
one level down — a guard whose breadth nobody holds.

## Decision

**A statement of this project's licence is written as a link to the repository's `LICENSE` file,
with the licence's name as the link's text.** Prose that names a licence and links nothing is not a
declaration, is not treated as one, and is free to name any licence it needs to.

In full, the places a licence statement may live, and the form each takes:

1. `LICENSE` — the licence text itself, recognised by its own heading.
2. `package.json` — the root `license` field.
3. `package-lock.json` — the `license` of the root entry, `packages[""]`, and that entry only. The
   lock file names a licence for several hundred dependencies and none of them is this project's.
4. Any markdown document — every link whose target resolves to the repository's `LICENSE`, taking
   the link's text as the licence it names. The licence's name is the text of a link to `LICENSE`,
   not a bolded phrase standing on its own.

The rule is enforced by `tests/protections/license.ts` and its proofs, which write out every
declaration site by name and require every one to state the same licence. Two documents were given
the link they were already describing so that they come under the rule —
`docs/open-source-self-hosting-principles.md` and the release-readiness line in
`docs/validation-and-evaluation.md` — rather than each being given a pattern of its own.

Two judgements inside that enforcement are recorded here because they are decisions and not
consequences:

- **The release-readiness checklist counts as a declaration.** Read strictly, the "license
  present" line in `docs/validation-and-evaluation.md` is an item to verify before publishing, not a
  statement of what the licence is, and counting it treats a list of things to check like a thing
  checked. It is counted anyway, because the line names the identifier and so has to move with the
  next licence change — which makes it a place that can drift.
- **GitHub's own `license.spdx_id` is a non-goal.** It is what an outsider actually sees on the
  repository page, it is derived by GitHub from `LICENSE`, and it lives nowhere in the tree. No
  guard in this repository can read it back. It is named here and in the guard's own comment so the
  next person looking for the check that covers it finds out in one place that there is none.

## Consequences

**Positive.**

- The drift that started this is red at every place it can occur, including the lock file's root
  entry, and the breadth of the check is itself planted: narrowing the list of files the rule reads
  fails, per ADR-0029.
- A record may quote, discuss and supersede licences without the guard objecting, which is what the
  never-rewritten rule requires.
- The rule cost nothing to follow through the change that motivated it. `PDR-0006` and the README
  rewrite landed while the guard was in review, and the guard recognised the new AGPL heading in
  `LICENSE` and the new link in `CONTRIBUTING.md` without an edit.

**Negative.**

- A document that names the licence in a sentence and links nothing is invisible to the rule. This
  is the deliberate cost of not reading prose. It is caught one step out rather than not at all: a
  second proof lists every file in the tree that names any licence at all and requires each to be
  classified by name, so a declaration in an unrecognised shape arrives as a file to classify rather
  than as silence.
- Writing a licence name as a link is a small constraint on prose, and someone will write one
  without the link. They will be told by a failing census entry, not by a reviewer.
- The rule reads link syntax and does not know about code spans. A document that quotes an example
  link to `LICENSE` inside backticks is counted as a declaration. That failure is loud — a new site
  appears that the written-out list does not name — and this record avoids it by describing the
  form in words instead of quoting it.
- The two judgements above are judgements. The checklist line is counted on a reading that a careful
  person could refuse, and the `license.spdx_id` non-goal means the statement the public actually
  reads is the one nothing here verifies.
