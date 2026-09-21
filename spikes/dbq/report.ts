/**
 * CFV1-DBQ — the per-query, per-shape reading, rendered from results.
 *
 * Its own module, and a pure function, for one reason: the acceptance criterion
 * "results are reported per query and per shape rather than as a single
 * aggregate verdict" was written into `evaluate.ts`'s `main()`, entangled with
 * a live PostgreSQL connection, so nothing could test it. The proof NAMED for
 * that criterion built its own results in-test and asserted the shapes agreed —
 * a good test of agreement, but collapsing the report to one aggregate verdict
 * would have left it green.
 *
 * That is the second time on this item that a proof did not guard the rule it
 * was named for. The fix is the same one: move the thing that actually carries
 * the rule somewhere a test can call it.
 */
import type { Shape } from "./db.js"

/** What one shape cost on each of the three queries. */
export interface ShapeReading {
  readonly libraryRows: number
  readonly libraryMs: number
  readonly librarySqlChars: number
  readonly shoppingLines: number
  readonly shoppingMs: number
  readonly shoppingSqlChars: number
  readonly comparisonDifferences: number
  readonly comparisonStatements: number
  readonly comparisonMs: number
}

/** The three query labels, in the order ADR-0003 names them. */
export const QUERY_LABELS = ["1 library list", "2 shopping", "3 run comparison"] as const

/**
 * The reading table: one row per query per shape, and no aggregate verdict.
 *
 * Returns the rows rather than printing them, so a caller writes the report and
 * a test reads it.
 */
export function renderPerQueryPerShape(
  shapes: readonly Shape[],
  readings: Readonly<Partial<Record<Shape, ShapeReading>>>,
): string[] {
  const out: string[] = [
    "## Reading — per query, per shape",
    "",
    "| query | shape | result | statements per call | median ms | SQL (chars) |",
    "|---|---|---|---|---|---|",
  ]
  const row = (query: string, shape: Shape, cells: readonly (string | number)[]): string =>
    `| ${query} | ${shape} | ${cells.join(" | ")} |`
  for (const shape of shapes) {
    const r = readings[shape]
    if (r === undefined) continue
    out.push(row(QUERY_LABELS[0], shape, [`${r.libraryRows} rows`, 1, r.libraryMs.toFixed(2), r.librarySqlChars]))
  }
  for (const shape of shapes) {
    const r = readings[shape]
    if (r === undefined) continue
    out.push(row(QUERY_LABELS[1], shape, [`${r.shoppingLines} lines`, 1, r.shoppingMs.toFixed(2), r.shoppingSqlChars]))
  }
  for (const shape of shapes) {
    const r = readings[shape]
    if (r === undefined) continue
    out.push(
      row(QUERY_LABELS[2], shape, [
        `${r.comparisonDifferences} differing leaves`,
        r.comparisonStatements,
        r.comparisonMs.toFixed(2),
        "—",
      ]),
    )
  }
  out.push("")
  return out
}
