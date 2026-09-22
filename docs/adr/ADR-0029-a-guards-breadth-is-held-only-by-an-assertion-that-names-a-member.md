---
id: "ADR-0029"
title: "A guard's breadth is held only by an assertion that names a member"
status: accepted
date: 2026-09-22
tags: ["testing", "guards", "process"]
related_to: ["ADR-0007", "ADR-0010", "ADR-0020"]
---

## Context

This repository defends several of its architectural decisions with *structural guards*: a test
that reads the tree, decides which text is a violation, and fails when it finds one. ADR-0007's
containment and ADR-0010's single chokepoint are each held by one, as is the rule that no module
may name a hosting platform.

A guard has two halves that can be wrong independently.

- Its **aim**: which files it reads, and what it does with what it finds.
- Its **breadth**: how many spellings of the violation its detection actually catches, and how
  much of the tree its walk actually reaches.

The aim is easy to check and is checked everywhere here. The breadth has been silently unheld four
separate times, each one found by somebody planting a mutation by hand and never by the tree:

1. **CFV1-WIRE** widened `ENVIRONMENT_READ` in `tests/run/containment.test.ts` from one spelling to
   four. The widening was proved by planting each spelling and watching the scan go red. That proof
   left with the session; narrowing the pattern back afterwards left the whole gate green.
2. **CFV1-MOUNT** and the response-header record had the same shape, and #61 gave all three
   fixture tables.
3. **#75** found it in a *matcher* rather than a detector: `usesAction(step, action)` replaced four
   prefix matches with a full-name comparison, ten plantings against `ci.yml` went red — and
   turning the helper back into `startsWith(action)`, the exact form the change removed, ran 30/30
   green.
4. **#82** found two promises of ADR-0010 that no proof held at all: that the connector binds to
   the *validated* address, and that a redirect without a `Location` is refused.

Four instances, three of them found only because somebody was looking. The precedent existed three
times over and the rule existed nowhere, so the fourth was found the same expensive way as the
first. This record is that rule.

### What the sweep measured

CFV1-BRD2 narrowed thirteen guards, one at a time, against the whole gate at `4cbf371`. Seven of
the thirteen narrowings left it green.

| narrowed | gate |
| --- | --- |
| `containment`: walk reads `.ts` only, not `.mts` | **green** |
| `response-header-record`: walk reads `.ts` only | **green** |
| `network-primitives`: walk reads `.ts` only | **green** |
| `repository-claims`: walk stops descending | **green** |
| `repo-config`: walk stops descending | **green** |
| `containment`: platform deny list cut to one of its six platforms | **green** |
| `repo-config`: Zod-shape detection cut to its literal spelling | **green** |
| `containment`: walk stops descending | red |
| `network-primitives`: walk stops descending | red |
| `response-header-record`: walk stops descending | red |
| `containment`: `ENVIRONMENT_READ` cut to its one original spelling | red |
| `postgres-store`: `pg`-import detection cut to one punctuation | red |
| `network-primitives`: `NETWORK_PATTERNS` cut to `fetch(` | red |

The five that went red are the rule, and so are the eight that did not.

### The counterexample that arrived by itself

While this sweep was being written, `CFV1-MUT` landed an **eighth** copy of the same recursive walk
on `main`, in `tests/protections/configured-database.ts`, with a ninth answer to the extension
question (`.ts` by `endsWith`). Written independently, the same day, by someone who had no way to
know the other seven existed.

It is **not** a violation of the rule below, and that is why it is here. Narrowing it fails the
build: remove its descent and it is red, change its extension and it is red. What holds it is one
proof, `protections/a-test-runs-on-what-was-configured`, whose assertion names a file the walk has
to reach. Nothing about the walk was made careful; the assertion was made specific, and the walk
inherited it.

Two things follow. The duplication is a maintenance cost and not a correctness one, so
consolidating a copy is a judgement about upkeep rather than an obligation of this record. And the
misattribution is worth seeing: narrowing that walk's *extension* reddens the proof about its
*depth*, because the named file simply stops being found. The guard is held, and its failure
message points at the wrong half — which is the second defect shape, surviving inside a guard that
is otherwise correct.

## Decision

**A structural guard's breadth is held only by an assertion that names something the breadth is
needed to find. Everything else is a comment.**

Three consequences follow, and the sweep above is each one's evidence.

**A guard whose assertion is "this set of violations is empty" holds no breadth at all.** A narrower
guard produces the same empty set, so nothing downstream can notice it narrowing. Every green row
above is this: the walk that returns fewer files, the deny list that names one platform instead of
six, the pattern that matches one spelling instead of three. This is why `postgres-store` is red
while `containment`'s platform proof was green — the two are the same shape of guard, and the only
difference is that one asserts `toEqual(["src/persistence/postgres-store.ts"])` and the other
asserts `toEqual([])`. **It is the assertion's shape that decides, not the guard's.**

**A guard that names a member but lets a helper decide which one holds its aim and not its
breadth.** This is #75's case and it is the subtler half: the assertion does name something, so the
guard is not vacuous — but a re-narrowed helper can reach a *different* member that satisfies the
assertion just as well. `startsWith("actions/checkout")` finds `actions/checkout-fork@v1` and then
`fetch-depth: 0` is asserted about a step nobody vouched for.

**A guard's walk is as much its breadth as its pattern is.** #61 closed the breadth of
`ENVIRONMENT_READ` and left the walk four lines above it reading two of the four extensions the
toolchain compiles. Seven suites had their own copy of that walk and the copies gave four different
answers to "which files are source" — invisible while `src/` holds nothing but `.ts`, and silent the
first moment it does not.

### What that obliges

- **Cut the detection out as a pure function of its input** and give it a table of positives and
  negatives. The table must run the *same* predicate the enforcement scan runs. A table over a
  private copy of the pattern shows that some regular expression is broad; it does not show that
  the guard uses it.
- **Hold the table against several deliberately wrong reference implementations**, each of which
  must fail it. Plantings against the *input* prove the guard reads its input correctly; they never
  prove it has the shape its text claims. Only a wrong implementation that the table rejects proves
  that.
- **Ask of every negative entry: which entry dies if I drop this condition?** If no entry dies, the
  table spares that case for a reason nobody chose, and it measures nothing. Entries that are
  redundant may stay — a table whose rows each matter exactly once stops discriminating the moment
  one more candidate is added — but the redundancy is stated in the comment rather than left to be
  discovered.
- **Where breadth genuinely cannot be held, say so** in the guard's own comment, so its text does
  not imply a promise the tree does not keep. An observed-but-not-closed note is a smaller debt than
  a sentence a reader takes for a guarantee.

This is an obligation on a guard being *written or widened*, not a campaign to retrofit every guard
in the tree. The cost is real — a fixture table is a second detector to keep correct — and the
judgement about when it is worth paying is the one CFV1-BRDTH made: pay it where a guard has already
been walked past in practice, and where its breadth is the thing the record it defends actually
promises.

## Consequences

### Positive

- The four instances above shared one cause, and it now has a name a review can cite instead of
  being rediscovered by whoever happens to plant a mutation.
- The seven copies of the source walk are one module, `tests/support/tree.ts`, whose own breadth is
  held by a planted tree naming one file per extension. Widening the set widens every structural
  scan at once, and `containment` gained `.cts`/`.tsx` coverage it had been missing.
- Two guards that asserted only emptiness — the platform deny list and the Zod-shape detection —
  now have tables that go red in both directions, at the narrowed and at the over-widened form.

### Negative

- Every fixture table is a second thing to keep correct, and a wrong table is worse than none
  because it reports success. The obligation above is deliberately scoped to guards being written
  or widened for that reason.
- The breadth of five guards' walks is now held in one place rather than five, which is the point,
  and also means one mistake there is five guards wrong at once. `tests/support/tree.test.ts` is
  the file that has to be read adversarially from now on; the plantings that hold it are named in
  its own comments so a later reader does not have to rediscover which of them matter.
- All seven green rows above are closed by this unit, so the table is a record of a state that no
  longer holds. It is kept because the rule is only legible from the measurement that produced it,
  and because re-running those seven narrowings is how a later reader checks that this record is
  still true rather than taking it on trust.

## Alternatives considered

**Require a fixture table for every structural guard.** Rejected as the blanket form, for the reason
CFV1-BRDTH already gave: a meta-proof is a second detector, and several guards here defend a
property no one has ever tried to walk past. The rule above is the same judgement made once instead
of per pull request.

**Assert the guard's pattern text instead of its behaviour** — pin the regular expression's source
string so narrowing it fails. Rejected: it pins the spelling rather than the property, so a
correct rewrite fails and an incorrect one with the same text passes. It is the shape this record
warns about, one level up.

**Leave it as review practice.** That is what the last four instances were, and it worked each time
— at the cost of a review round each time, and only because the reviewer happened to ask. A rule
that lives only in a reviewer's habit is held by exactly the thing this record says does not hold
anything.
