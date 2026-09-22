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
 *
 * Moving it was not sufficient on its own. The first version of the proof here
 * checked the row COUNT, that every value appeared somewhere, and that every
 * shape was named — all of which a renderer passes while carrying one shape's
 * measurements on another shape's row. That misattribution is the criterion's
 * own failure mode, and the worst one, because a decision record quotes this
 * table and a wrong number under a correct label reads as evidence. The proof
 * now pins each row WHOLE, so a value can only appear where it belongs.
 *
 * `statements per call` is carried per shape rather than written here. It was
 * literal `1` for queries 1 and 2, which was false: both `listLibrary` and
 * `shoppingRequirements` issue `set search_path` before their select. A
 * renderer that states a cost it did not measure is the same defect one level
 * down.
 */
import type { Shape } from "./db.js"

/** What one shape cost on each of the three queries. */
export interface ShapeReading {
  readonly libraryRows: number
  readonly libraryStatements: number
  readonly libraryMs: number
  readonly librarySqlChars: number
  readonly shoppingLines: number
  readonly shoppingStatements: number
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
    out.push(
      row(QUERY_LABELS[0], shape, [
        `${r.libraryRows} rows`,
        r.libraryStatements,
        r.libraryMs.toFixed(2),
        r.librarySqlChars,
      ]),
    )
  }
  for (const shape of shapes) {
    const r = readings[shape]
    if (r === undefined) continue
    out.push(
      row(QUERY_LABELS[1], shape, [
        `${r.shoppingLines} lines`,
        r.shoppingStatements,
        r.shoppingMs.toFixed(2),
        r.shoppingSqlChars,
      ]),
    )
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

/** A finished run's verdict: what to exit with, and which queries disagreed. */
export interface RunOutcome {
  readonly exitCode: number
  readonly disagreeing: readonly string[]
}

/**
 * The verdict, given whether each query's shapes agreed.
 *
 * Pure, and here rather than in `main()`, for the same reason the table is: the
 * rule — a run whose shapes disagree must not LOOK successful, because that is
 * how timings from an invalid run get quoted into a decision record — lived
 * inside `main()` behind a live PostgreSQL connection. Nothing under `tests/`
 * could reach it, so the acceptance claim rested on reading the code, which a
 * review rightly called a gap rather than a met criterion.
 *
 * Fails CLOSED: a query whose agreement was never recorded counts as a
 * disagreement, so a reporting path that forgets to set one cannot produce a
 * successful-looking run.
 */
export function runOutcome(agreement: Readonly<Record<string, boolean>>): RunOutcome {
  const disagreeing = QUERY_LABELS.filter((q) => agreement[q] !== true)
  return { exitCode: disagreeing.length === 0 ? 0 : 3, disagreeing }
}

/** One query's measurement for one shape, as the run collects it. */
export interface QueryTiming {
  readonly count: number
  readonly ms: number
  readonly statements: number
}

/**
 * What a run has measured for one shape, before it becomes a row.
 *
 * Every part is explicitly `| undefined`: absence is the case this type exists
 * to make visible, not one to be papered over at the point of use.
 */
export interface RawMeasurements {
  readonly library: QueryTiming | undefined
  readonly shopping: QueryTiming | undefined
  readonly comparison: QueryTiming | undefined
  readonly librarySqlChars: number | undefined
  readonly shoppingSqlChars: number | undefined
}

/**
 * The parts, read off the contract rather than hand-listed.
 *
 * Typed as a total record over `RawMeasurements`'s own keys, so adding a part
 * to that interface without listing it here does not compile, and a key that is
 * absent from the object altogether is still checked — which `Object.entries`
 * would have missed.
 */
const RAW_PARTS = Object.keys({
  library: true,
  shopping: true,
  comparison: true,
  librarySqlChars: true,
  shoppingSqlChars: true,
} satisfies Record<keyof RawMeasurements, true>) as readonly (keyof RawMeasurements)[]

/**
 * One shape's row inputs, or an error — never a plausible-looking zero.
 *
 * The assembly used to sit in `evaluate.ts` as eleven `?? 0` defaults. A shape
 * whose query never ran therefore rendered `0 rows`, `0.00` ms and `0` SQL
 * chars: a full row of measurements, correctly labelled, measuring nothing. The
 * table is quoted into a decision record, and `0.00 ms` reads as "fastest", so
 * the failure mode of that default is a wrong conclusion rather than a gap.
 *
 * Fails CLOSED, like `runOutcome`: a missing part stops the report instead of
 * being rendered as a number.
 */
export function toReading(shape: string, m: RawMeasurements): ShapeReading {
  const missing = RAW_PARTS.filter((k) => m[k] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `no reading for ${shape}: ${missing.join(", ")} never recorded — ` +
        `a row of zeroes would read as a measurement`,
    )
  }
  const library = m.library as QueryTiming
  const shopping = m.shopping as QueryTiming
  const comparison = m.comparison as QueryTiming
  return {
    libraryRows: library.count,
    libraryStatements: library.statements,
    libraryMs: library.ms,
    librarySqlChars: m.librarySqlChars as number,
    shoppingLines: shopping.count,
    shoppingStatements: shopping.statements,
    shoppingMs: shopping.ms,
    shoppingSqlChars: m.shoppingSqlChars as number,
    comparisonDifferences: comparison.count,
    comparisonStatements: comparison.statements,
    comparisonMs: comparison.ms,
  }
}
