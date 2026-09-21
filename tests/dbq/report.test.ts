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
import { QUERY_LABELS, renderPerQueryPerShape, type ShapeReading } from "../../spikes/dbq/report.js"

/** Readings that differ in every field, so nothing can be collapsed unnoticed. */
const readings = (): Partial<Record<Shape, ShapeReading>> => {
  const out: Partial<Record<Shape, ShapeReading>> = {}
  SHAPES.forEach((shape, i) => {
    const n = i + 1
    out[shape] = {
      libraryRows: 10 * n,
      libraryMs: 0.11 * n,
      librarySqlChars: 100 * n,
      shoppingLines: 70 + n,
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

  it("carries each shape's own numbers rather than one number per query", () => {
    // The failure this guards is a report that averages the shapes, or quotes
    // only the best one. Every reading differs, so any collapse loses a value
    // that is asserted here to be present.
    const rendered = renderPerQueryPerShape(SHAPES, readings()).join("\n")
    const r = readings()
    for (const shape of SHAPES) {
      const reading = r[shape]
      if (reading === undefined) throw new Error(`no reading for ${shape}`)
      expect(rendered, `${shape}'s library timing`).toContain(reading.libraryMs.toFixed(2))
      expect(rendered, `${shape}'s shopping timing`).toContain(reading.shoppingMs.toFixed(2))
      expect(rendered, `${shape}'s comparison timing`).toContain(reading.comparisonMs.toFixed(2))
      expect(rendered, `${shape}'s differing-leaf count`).toContain(
        String(reading.comparisonDifferences),
      )
    }
  })

  it("names every shape it was given, so a dropped shape cannot pass silently", () => {
    const rendered = renderPerQueryPerShape(SHAPES, readings()).join("\n")
    for (const shape of SHAPES) expect(rendered).toContain(`| ${shape} |`)
  })
})
