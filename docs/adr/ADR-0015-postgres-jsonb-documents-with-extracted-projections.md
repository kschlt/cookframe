---
id: "ADR-0015"
title: "Persistence is PostgreSQL: JSONB documents with extracted projections where a query needs one"
status: accepted
date: 2026-09-21
tags: ["persistence", "boundaries", "reprocessing"]
constrained_by: ["PDR-0001"]
related_to: ["ADR-0001", "ADR-0002", "ADR-0003"]
decides: ["OQ-03", "OQ-04"]
---

## Context

`ADR-0003` deferred the database technology (`OQ-03`) and the physical persistence shape
(`OQ-04`), and named the test that would close them: write the three hardest queries — the library
list, total ingredient requirements for shopping, and a side-by-side comparison of two
normalization runs — against both a document shape and a relational shape, over real data, and
compare. It also warned what happens if that test is never run: "a provisional store can quietly
become permanent by neglect."

That data now exists. Slice 1 ingested eleven of the maintainer's own photographs of real recipes
through the product's own capture and normalization path, and `CFV1-DBQ` produced a second
normalization run over the same stored snapshots by calling `reprocess`, exactly as the product
would. The corpus the queries were measured against is **20 Canonical Recipe versions over 10
recipes, all 10 with two independent normalization runs, plus their 10 Source Snapshots**. It is
real: real photographs, real third-party recipe text, real `sourceRefs`, two runs that differ
because two model calls differ. It is not in this repository and will not be — the pages are
third-party and the photographs are personal (`evals/fixtures/private/` is git-ignored by design),
so what is quoted here is counts, rates and timings, and never page content.

Three shapes were measured, not two. Measuring only a pure document shape against a fully
relational one would have left `ADR-0003`'s actual hypothesis — "Postgres with validated JSONB
documents plus extracted query columns" — untested, and that hybrid is what anyone had actually
proposed. All three were built in the **same PostgreSQL 16 server, one schema each**, so that
nothing in the comparison is an engine difference:

- **document** — one validated JSONB document per version; every query traverses it.
- **hybrid** — the same document as the record of truth, plus ONE extracted table: the ingredient
  projection the shopping aggregation groups over. Written in the same transaction, and
  rebuildable from the documents alone.
- **relational** — the whole ontology extracted into columns, complete enough that a version read
  back out equals the version that went in.

## Decision

**`OQ-03`: PostgreSQL.** **`OQ-04`: validated JSONB documents, with an extracted projection added
where a measured query needs one — and only there.** That is the hybrid shape, and it is
`ADR-0003`'s expected outcome, now carried by evidence rather than by reasoning.

Three commitments follow from the evaluation rather than from taste:

1. **The document is the record of truth.** A Canonical Recipe version and a Source Snapshot are
   each stored whole, as one validated JSONB document. Reading a version reads the document.
2. **An extracted table is a cache with a contract, never a second source of truth.** It is
   written in the same transaction as the document it derives from, and dropping and rebuilding it
   from the documents must be a no-op — proved by `dbq/hybrid-extraction-is-derived`.
3. **An extraction is added when a query is measured to need it, not in advance.** Today that is
   exactly one: the ingredient projection.

`ADR-0003`'s durable commitment — the narrow repository interface, no storage type outside its
implementation, validate before write — is unchanged and is what made this evaluation cheap: all
three shapes were implemented behind the same interface.

### What the three queries measured

Every number below is the median of seven runs over the real corpus, in one server, after a warm
call. All three shapes returned **identical results for all three queries**, which is what makes a
difference in cost mean anything at all.

| query | document | hybrid | relational |
|---|---|---|---|
| 1 — library list | 0.41 ms | 0.36 ms | **0.13 ms** |
| 2 — shopping requirements (74 lines) | 2.02 ms | **1.08 ms** | 1.11 ms |
| 3 — comparison of two runs, 10 recipes | 9.94 ms | **7.90 ms** | 62.55 ms |
| 3 — statements issued per comparison | 3 | 3 | 47 |

| structural cost | document | hybrid | relational |
|---|---|---|---|
| tables | 2 | 3 | 24 |
| DDL lines | 11 | 26 | 304 |
| shape module lines (write + read) | 38 | 88 | 652 |
| INSERT statements to load the corpus | 30 | 50 | 1805 |

**Performance did not decide this.** At the scale `ADR-0003` itself names — "a single-user library
of a few dozen recipes" — all three shapes answer all three queries in single-digit to
tens-of-milliseconds. What decided it is the third row of the first table together with the whole
of the second: the relational shape is the only one that is both slower where it matters and an
order of magnitude more code, more tables and more writes.

### Four findings worth keeping

**`ADR-0003`'s own hint is wrong, and measurably so.** It said the comparison query "is where a
document shape most often disappoints". It is the opposite: comparing two runs needs two WHOLE
recipes, which a document shape hands over in one statement each and a relational shape must
reassemble from 23 tables — 47 statements and 6.3x the time. The one query that was expected to
sink the document shape is the one it wins by the widest margin.

**Two real runs of the same snapshot differ a great deal.** Across the 10 recipes, 2079 leaf values
were compared and **445 differed (21%)**, concentrated in `/instructionSections` (293),
`/ingredientGroups` (86) and `/equipment` (33). The comparison query is not a formality for a rare
reprocessing event; it is how anyone will ever see what a re-run changed.

**A relational shape pays a tax the ontology imposes, not one the modelling chose.** `sourceRefs`
hang off fourteen node types, so refs become either fourteen link tables or one polymorphic table
addressed by a JSON Pointer — and a pointer column is a document-shaped concession inside a
relational schema. `ValueExpression` appears at nine sites and is inlined as six columns each time.
That is what 24 tables and 304 lines of DDL buy: exactly the cost `ADR-0003` predicted when it
wrote that "a moving ontology makes fifteen tables expensive".

**One measurement nearly became a false finding, and the correction is the point.** The first
version of the shopping query carried the ~20 KB JSONB document as a column through its CTE into
the aggregation; it ran in 218 ms against the relational shape's 1.1 ms, and would have read as
"the document shape is 200x slower at aggregation". Selecting identifiers first and joining the
document back afterwards brought the same query to 1.5 ms. The cost was the query's, not the
shape's. Both document-shape queries carry a comment saying so, because the trap is easy to walk
back into.

### The provisional store

`ADR-0003`'s provisional store is `src/persistence/provisional-store.ts`: an in-memory,
append-only implementation of the repository interface, dependency-free, explicitly "the simplest
store that works" and explicitly deciding nothing. **This evaluation confirms its document shape
and replaces its storage.** The shape it persists — a whole validated Canonical Recipe per version,
appended, never mutated — is the shape this record adopts. What it does not survive is being in
memory: it has no durability, no second process, and no extraction.

So the transition is a narrowing, not a rewrite: the provisional store is replaced by a PostgreSQL
implementation of the same interface, and no caller changes, because no caller ever named it.

### What this record does NOT decide

- **The migration itself.** Moving Slice 1's data into the chosen store, and running the product
  against it, is follow-on work. `ADR-0003` warned that the gap between deciding and moving is
  where neglect lives, so it is named here rather than assumed: the provisional store stays in use
  until that work lands, and it stays marked provisional until then.
- **Deployment shape of the database** — managed, container, or on the same rented server as
  `ADR-0011`'s reference deployment. That is a hosting decision and does not change this one.
- **Any further extraction.** The second one gets added when a query is measured to need it, by the
  same method as the first.

## Consequences

### Positive

- `OQ-03` and `OQ-04` close on evidence from real data, which is what `ADR-0003` asked for and the
  condition it set for closing them.
- The repository interface survives untouched: three shapes were implemented behind it, and it
  needed no widening to serve queries 1 and 3.
- Reprocessing stays cheap. A new version is one INSERT and one small extraction, and earlier
  versions are untouched by construction.
- The comparison query — the reprocessing invariant's user-visible form — is the cheapest operation
  in the chosen shape rather than the most expensive.
- The evaluation is re-runnable: `spikes/dbq/evaluate.ts` regenerates every number in this record
  from whatever corpus it is pointed at.

### Negative

- **The interface has a hole this record does not fill.** The shopping aggregation is one of the
  three deciding queries and there is NO repository operation for it; it exists only as SQL per
  shape. `ADR-0003` predicted the interface "may need widening … when a real query demands it".
  One now does, and widening it is follow-on work rather than something to settle here.
- An extracted projection is derived data, and derived data can go stale. The mitigation is
  structural — same transaction, rebuildable, asserted by a test — but it is a rule that has to
  keep being obeyed.
- The corpus is 10 recipes and 20 versions. That is the target scale and not a toy, but nothing
  here extrapolates to thousands of recipes, and a future scale question needs its own measurement.
- Two stores exist until the migration lands, which is the cost `ADR-0003` already accepted.

## Alternatives considered

**A fully relational shape.** Rejected on its own numbers: 24 tables against 3, 652 lines of shape
code against 88, 1805 INSERTs to load the corpus against 50, and 6.3x the time and 15x the
statements on the comparison query. It is faster on exactly one query, the library list, by 0.23 ms
— on a page a human reads once. Its one real advantage, which this record acknowledges, is that
every field is a column a future query can filter on without an extraction being added first.

**A pure document shape with no extraction at all.** Not rejected on correctness — it answers all
three queries, agrees with the others everywhere, and is the smallest thing that works. Rejected as
the *recorded* decision because the shopping aggregation is already 1.9x the hybrid's cost at 10
recipes with the best formulation found, and the hybrid buys that back for one table and fifty
lines. The difference between these two is small and reversible in either direction, which is
itself a reason to prefer the one with headroom.

**SQLite**, which `ADR-0003` left open under `OQ-03`. Rejected: the decision above rests on JSONB
plus an extracted projection plus transactional consistency between them, and Postgres is where
that combination is strongest. SQLite's self-hosting advantage is real but `ADR-0011` already
commits to a rented single-tenant server, where running Postgres costs nothing extra.

**Deciding from the reasoning in `ADR-0003` without running the queries.** It would have reached
the same answer — and would have carried the wrong hint about the comparison query, the wrong
picture of what two normalization runs do to each other, and no way to tell a 218 ms query from a
218 ms shape.
