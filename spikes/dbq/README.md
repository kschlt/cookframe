# CFV1-DBQ — the three deciding queries

**Result: [`ADR-0015`](../../docs/adr/ADR-0015-postgres-jsonb-documents-with-extracted-projections.md)
— PostgreSQL, JSONB documents, with an extracted projection where a query is measured to need one.
`OQ-03` and `OQ-04` are closed.**

`ADR-0003` deferred the database and the physical shape and named the test that would decide them:
write the library list, the shopping aggregation and a side-by-side comparison of two normalization
runs against both a document and a relational shape, over real data, and compare. This directory is
that test.

## Three shapes, one engine

Measuring only a pure document shape against a fully relational one would leave `ADR-0003`'s own
hypothesis — "Postgres with validated JSONB documents plus extracted query columns" — untested, so
there are three. All three live in the **same PostgreSQL server, one schema each**, because a
comparison across engines measures the engines.

| | what it is |
|---|---|
| `schema-document.sql` + `document-shape.ts` | one validated JSONB document per version; every query traverses it |
| `schema-hybrid.sql` + `hybrid-shape.ts` | the document, plus ONE extracted table — the ingredient projection, written in the same transaction and rebuildable from the documents alone |
| `schema-relational.sql` + `relational-shape.ts` | the whole ontology in columns, complete enough that a version read back equals the version that went in |

## The pieces

| File | Role |
|---|---|
| `db.ts` | Connect, and reset one shape's schema. `DATABASE_URL`, or a local default. |
| `stores.ts` | `ADR-0003`'s repository interface over each shape, plus query 1. The queries go through the interface, not beside it. |
| `queries.ts` | Query 2 (shopping) as SQL per shape, and query 3 (run comparison) over `readTwoRuns`. |
| `reprocess-run.ts` | Produces the SECOND normalization run, by calling the product's own `reprocess` over already-stored snapshots. Needs `OPENAI_API_KEY`. |
| `evaluate.ts` | Runs everything and reports per query and per shape. Regenerates every number in the record. |

Query 3 is deliberately the same code for every shape: it is expressed over `readTwoRuns`, so what
differs is what a shape has to do to hand over two whole recipes, which is the question.

## Where the data lives

The corpus is the S1 photo gate's output: real photographs of real, third-party recipe pages. It is
under `evals/fixtures/private/`, which `.gitignore` excludes, and it stays there. **No page content
may be committed** — the record carries counts, rates and timings only, and so does anything this
directory prints.

`tests/dbq/` therefore proves the *mechanics* on the committed public fixture: every shape is
writable, readable without loss, and answers all three queries identically. The *measurement* is
made once, by `evaluate.ts`, over the private corpus, and is what the record cites. CI runs the
tests against a real PostgreSQL service container.

## Reproducing

```bash
# a server, anywhere: a local one, or a container
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres

# the mechanics, on committed fixtures
npm run test:dbq

# the measurement, over whatever corpus you point it at
npx tsx spikes/dbq/evaluate.ts --in evals/fixtures/private/s1-gate
```

## One thing worth knowing before reading any number here

The first version of the shopping query carried the ~20 KB JSONB document as a column through its
CTE into the aggregation. It ran in **218 ms** against the relational shape's 1.1 ms, which reads as
"the document shape is 200x slower at aggregation". Selecting identifiers first and joining the
document back afterwards brought the same query, over the same data, to **1.5 ms**. The cost was the
query's and not the shape's, and a measurement published a few minutes earlier would have been a
false finding with a plausible story attached to it. Both document-shape queries carry a comment
saying so.
