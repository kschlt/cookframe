/**
 * CFV1-DBQ — the acceptance criterion about REPORTING, proved against the code
 * that does the reporting.
 *
 * Previously the proof carrying this criterion's name built three results
 * in-test and asserted the shapes agreed. That is a real property and it is
 * still proved (`dbq/shapes-agree-on-every-query`), but it is not this
 * criterion: collapsing the report to a single aggregate verdict would have
 * left it green, because it never touched the reporting code at all.
 *
 * These need no database. That is deliberate — the criterion is about the shape
 * of the report, not about what a server returns, and a proof that skips
 * without PostgreSQL would be one more rule guarded only when someone
 * remembers.
 */
import { describe, expect, it } from "vitest"
import { SHAPES, type Shape } from "../../spikes/dbq/db.js"
import {
  QUERY_LABELS,
  type RawMeasurements,
  renderPerQueryPerShape,
  runOutcome,
  type ShapeReading,
  toReading,
} from "../../spikes/dbq/report.js"

/** Readings that differ in every field, so nothing can be collapsed unnoticed. */
const readings = (): Partial<Record<Shape, ShapeReading>> => {
  const out: Partial<Record<Shape, ShapeReading>> = {}
  SHAPES.forEach((shape, i) => {
    const n = i + 1
    out[shape] = {
      libraryRows: 10 * n,
      libraryStatements: 20 + n,
      libraryMs: 0.11 * n,
      librarySqlChars: 100 * n,
      shoppingLines: 70 + n,
      shoppingStatements: 30 + n,
      shoppingMs: 1.01 * n,
      shoppingSqlChars: 500 + n,
      comparisonDifferences: 400 + n,
      comparisonStatements: 3 * n,
      comparisonMs: 7.01 * n,
    }
  })
  return out
}

const bodyRows = (lines: readonly string[]): string[] =>
  lines.filter((l) => l.startsWith("| ") && !l.startsWith("| query |") && !l.startsWith("|---"))

// Why this criterion lives HERE and not in `queries.test.ts`, where its name
// used to sit. The name is declared in the backlog spec (CFV1-DBQ), so it is
// part of the contract and has to keep resolving — but the test that carried it
// never touched the reporting code, and it sat inside
// `describe.skipIf(needsDb)`. With no database on a normal run that whole block
// skips, so the declared criterion reported PASS while executing nothing: a
// vacuous proof of exactly the kind this repo keeps finding. Moving it here
// switches it ON — these three cases run with no database and exercise the
// renderer itself. The agreement property that the old test really did check is
// still checked, under its own honest name (`dbq/shapes-agree-on-every-query`),
// still behind the database gate where it belongs.
//
// So this is not a rename that orphaned a criterion; reverting it would put the
// criterion back behind the skip and turn it off again.
describe("dbq/results-reported-per-query-and-shape", () => {
  it("emits one row for every query and every shape, not an aggregate", () => {
    const rows = bodyRows(renderPerQueryPerShape(SHAPES, readings()))
    expect(rows).toHaveLength(QUERY_LABELS.length * SHAPES.length)
    for (const query of QUERY_LABELS) {
      for (const shape of SHAPES) {
        expect(
          rows.filter((r) => r.startsWith(`| ${query} | ${shape} |`)),
          `exactly one row for ${query} on ${shape}`,
        ).toHaveLength(1)
      }
    }
  })

  it("binds each shape's numbers to that shape's own row", () => {
    // The criterion's WORST failure, and the one the first version of this proof
    // missed: labels all correct, numbers belonging to a different shape. A
    // decision record quotes this table, so a misattributed cell is a wrong
    // conclusion wearing a correct-looking source.
    //
    // Checking that every value appears SOMEWHERE in the rendered table cannot
    // catch that — rotating each shape's reading onto the next shape's rows
    // leaves every value present and every label right. So each row is pinned
    // WHOLE, cell for cell, which also pins the column order and the units.
    // Mutation-checked: the rotation turns this case red and no other.
    const r = readings()
    const rows = bodyRows(renderPerQueryPerShape(SHAPES, r))
    const rowFor = (query: string, shape: Shape): string => {
      const found = rows.filter((l) => l.startsWith(`| ${query} | ${shape} |`))
      expect(found, `exactly one row for ${query} on ${shape}`).toHaveLength(1)
      return found[0] as string
    }
    for (const shape of SHAPES) {
      const mine = r[shape]
      if (mine === undefined) throw new Error(`no reading for ${shape}`)
      expect(rowFor(QUERY_LABELS[0], shape), `${shape} library row`).toBe(
        `| ${QUERY_LABELS[0]} | ${shape} | ${mine.libraryRows} rows | ${mine.libraryStatements} | ${mine.libraryMs.toFixed(2)} | ${mine.librarySqlChars} |`,
      )
      expect(rowFor(QUERY_LABELS[1], shape), `${shape} shopping row`).toBe(
        `| ${QUERY_LABELS[1]} | ${shape} | ${mine.shoppingLines} lines | ${mine.shoppingStatements} | ${mine.shoppingMs.toFixed(2)} | ${mine.shoppingSqlChars} |`,
      )
      expect(rowFor(QUERY_LABELS[2], shape), `${shape} comparison row`).toBe(
        `| ${QUERY_LABELS[2]} | ${shape} | ${mine.comparisonDifferences} differing leaves | ${mine.comparisonStatements} | ${mine.comparisonMs.toFixed(2)} | — |`,
      )
    }
  })

  it("states a statement count it was given rather than one of its own", () => {
    // `statements per call` was the literal 1 for queries 1 and 2 while both
    // functions issue `set search_path` before their select, so the table
    // asserted a cost nobody measured. The renderer must carry the reading's
    // number, whatever it is.
    const r = readings()
    const rows = bodyRows(renderPerQueryPerShape(SHAPES, r))
    for (const shape of SHAPES) {
      const mine = r[shape]
      if (mine === undefined) throw new Error(`no reading for ${shape}`)
      const cell = (query: string): string =>
        (rows.find((l) => l.startsWith(`| ${query} | ${shape} |`)) as string).split(
          " | ",
        )[3] as string
      expect(cell(QUERY_LABELS[0]), `${shape} library statements`).toBe(
        String(mine.libraryStatements),
      )
      expect(cell(QUERY_LABELS[1]), `${shape} shopping statements`).toBe(
        String(mine.shoppingStatements),
      )
      expect(cell(QUERY_LABELS[2]), `${shape} comparison statements`).toBe(
        String(mine.comparisonStatements),
      )
    }
  })

  it("names every shape it was given, so a dropped shape cannot pass silently", () => {
    const rendered = renderPerQueryPerShape(SHAPES, readings()).join("\n")
    for (const shape of SHAPES) expect(rendered).toContain(`| ${shape} |`)
  })
})

describe("dbq/disagreeing-run-does-not-look-successful", () => {
  // A run whose shapes disagree is comparing answers that are not the same
  // answer, so its timings do not measure the shapes and must not be quoted.
  // The rule lived inside `evaluate.ts`'s `main()`, behind a live PostgreSQL
  // connection, so nothing under `tests/` could reach it — a review correctly
  // called the acceptance claim for it a code reference rather than a proof.
  // `evaluate.ts` is not even in the typecheck program (`tsconfig.json` includes
  // schema, src, evals and tests), so it was unguarded twice over. The decision
  // is now a pure function, and this is the proof.
  const allAgree = Object.fromEntries(QUERY_LABELS.map((q) => [q, true]))

  it("exits 0 and names nothing when every query agrees", () => {
    expect(runOutcome(allAgree)).toEqual({ exitCode: 0, disagreeing: [] })
  })

  it("exits 3 and names the query that disagreed", () => {
    const out = runOutcome({ ...allAgree, [QUERY_LABELS[1]]: false })
    expect(out.exitCode, "a disagreeing run must not exit 0").toBe(3)
    expect(out.disagreeing).toEqual([QUERY_LABELS[1]])
  })

  it("names every disagreeing query, in the order the record lists them", () => {
    const out = runOutcome({ ...allAgree, [QUERY_LABELS[0]]: false, [QUERY_LABELS[2]]: false })
    expect(out.exitCode).toBe(3)
    expect(out.disagreeing).toEqual([QUERY_LABELS[0], QUERY_LABELS[2]])
  })

  it("fails closed when a query's agreement was never recorded", () => {
    // A reporting path that forgets to set one must not produce a
    // successful-looking run: unknown is treated as disagreement, not as assent.
    const missing = { ...allAgree } as Record<string, boolean>
    delete missing[QUERY_LABELS[2] as string]
    const out = runOutcome(missing)
    expect(out.exitCode, "an unrecorded query must not pass as agreement").toBe(3)
    expect(out.disagreeing).toEqual([QUERY_LABELS[2]])
  })
})

describe("dbq/a-missing-measurement-is-not-rendered-as-zero", () => {
  // Eleven `?? 0` defaults in `evaluate.ts` turned "this shape was never
  // measured" into a complete, correctly-labelled row: `0 rows`, `0.00` ms, `0`
  // SQL chars. This table is quoted into a decision record and `0.00 ms` reads
  // as the fastest shape, so the default's failure mode is a wrong conclusion
  // wearing a measurement's clothes, not a visible gap.
  const full = (): RawMeasurements => ({
    library: { count: 12, ms: 1.5, statements: 2 },
    shopping: { count: 34, ms: 2.5, statements: 2 },
    comparison: { count: 56, ms: 3.5, statements: 4 },
    librarySqlChars: 111,
    shoppingSqlChars: 222,
  })

  it("carries every measurement through to the row it belongs in", () => {
    expect(toReading("document", full())).toEqual({
      libraryRows: 12,
      libraryStatements: 2,
      libraryMs: 1.5,
      librarySqlChars: 111,
      shoppingLines: 34,
      shoppingStatements: 2,
      shoppingMs: 2.5,
      shoppingSqlChars: 222,
      comparisonDifferences: 56,
      comparisonStatements: 4,
      comparisonMs: 3.5,
    })
  })

  // The list of parts is not written out here: it is read off the object the
  // compiler forces to be complete, so a part added to `RawMeasurements` is
  // covered by this case the moment `full()` typechecks again.
  it("refuses to build a row when any one part was never recorded", () => {
    const parts = Object.keys(full()) as (keyof RawMeasurements)[]
    expect(parts.length, "nothing to drop, so this proves nothing").toBeGreaterThan(0)
    for (const part of parts) {
      const m = { ...full(), [part]: undefined } as RawMeasurements
      expect(() => toReading("document", m), `a missing ${part} was rendered anyway`).toThrow(
        new RegExp(part),
      )
    }
  })

  it("says which shape and which part, so the run can be repaired", () => {
    const m = { ...full(), shopping: undefined } as RawMeasurements
    expect(() => toReading("hybrid", m)).toThrow(/no reading for hybrid/)
  })
})
