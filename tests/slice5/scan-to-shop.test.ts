/**
 * CFV1-SL5 — the scan-to-shop measurement, and what makes it evidence.
 *
 * Criterion: `slice5/scan-to-shop-measured-with-distribution`. The slice exists
 * because the product's central claim is low friction, and this is where that
 * claim stops being asserted. So the thing under test here is not the pipeline —
 * six other files prove that — it is the RECORD: whether the committed figures
 * are a real end-to-end measurement of the whole corpus, or a summary that has
 * drifted from the runs it claims to summarise.
 *
 * Three ways a measurement passes a check while proving nothing, each guarded
 * below rather than trusted:
 *
 * - **It was never paid for.** The harness runs offline against fakes, and a
 *   fake run produces a perfectly well-formed distribution of numbers that say
 *   nothing about the model path. So the record must name a model and carry the
 *   token counts of real calls.
 * - **A component timing stands in for the journey.** The item's `What NOT`
 *   forbids exactly that. The summary is therefore recomputed from the per-run
 *   TOTALS here, with the same function the run used, so a summary built from
 *   the submit leg alone cannot agree with it.
 * - **The slow runs were dropped.** Choosing a subset after seeing the times is
 *   how a tail disappears. The record must cover the corpus `METHOD.md`
 *   registered, contiguously, and the population size is read out of that
 *   document rather than copied into this file — a number written down twice
 *   agrees with itself.
 *
 * `METHOD.md` was committed before any figure existed and is quoted, not
 * paraphrased: if the method is edited after the fact to fit the result, these
 * proofs go red, which is the whole point of writing it down first.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { distribution, nearestRank } from "../../spikes/sl5-scan-to-shop/distribution.mjs"

const spikeDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "spikes",
  "sl5-scan-to-shop",
)
const METHOD = readFileSync(join(spikeDir, "METHOD.md"), "utf8")
const RECORD = readFileSync(join(spikeDir, "measurements.json"), "utf8")

interface Run {
  readonly photo: string
  readonly bytes: number
  readonly outcome: string
  readonly totalMs: number
  readonly submitMs: number
  readonly handoffMs: number
  readonly detail?: string
}
interface Record_ {
  readonly measuredAt: string
  readonly providers: string
  readonly photos: number
  readonly outcomes: { shoppable: number; refused: number; failed: number }
  readonly endToEnd: Record<string, number>
  readonly breakdown: { submit: Record<string, number>; handoff: Record<string, number> }
  readonly modelCalls?: { calls: number; inputTokens: number; outputTokens: number }
  readonly runs: readonly Run[]
}

const record = JSON.parse(RECORD) as Record_
const shoppable = record.runs.filter((r) => r.outcome === "shoppable")

/**
 * The population, read out of the document that fixed it before the run.
 *
 * Written down here as well it would be a copy agreeing with a copy: a record
 * covering nine photographs would pass against a `9` somebody edited into this
 * file at the same time. METHOD.md names the corpus in prose, so the prose is
 * the thing parsed, and a failure to parse it FAILS rather than falling back to
 * a default — a corpus size nobody could read is not a corpus size that matches.
 */
const WRITTEN_NUMBERS: Record<string, number> = { nine: 9, ten: 10, eleven: 11, twelve: 12 }
function declaredCorpusSize(): number {
  const word = /\bthe ([a-z]+) images from the S1 gate run\b/.exec(METHOD)?.[1]
  if (word === undefined) {
    throw new Error("METHOD.md no longer states the corpus in the form this proof reads it from")
  }
  const size = WRITTEN_NUMBERS[word]
  if (size === undefined) throw new Error(`METHOD.md names an unrecognised corpus size: ${word}`)
  return size
}

describe("slice5/scan-to-shop-measured-with-distribution", () => {
  it("is a real run against the model, not the offline fakes", () => {
    // A `--fake` run writes `providers: "fake"` and omits `modelCalls`. It
    // produces a complete, well-shaped distribution and measures nothing about
    // the path this criterion is about, so it is the first thing ruled out.
    expect(record.providers).not.toBe("fake")
    expect(record.providers.length).toBeGreaterThan(0)
    expect(record.modelCalls).toBeDefined()
    expect(record.modelCalls?.calls).toBeGreaterThan(0)
    expect(record.modelCalls?.inputTokens).toBeGreaterThan(0)
    expect(record.modelCalls?.outputTokens).toBeGreaterThan(0)
  })

  it("names when it was measured and what against, so a later run can be compared", () => {
    expect(Number.isNaN(Date.parse(record.measuredAt))).toBe(false)
    // METHOD.md lists a different model as one of the things that makes two
    // runs incomparable, so the model belongs in the record, not in a memory.
    expect(METHOD).toContain("a different model")
  })

  it("covers the whole corpus METHOD.md registered, with no gap and no selection", () => {
    expect(record.runs).toHaveLength(declaredCorpusSize())
    expect(record.photos).toBe(record.runs.length)
    // Contiguous positions from 1: a dropped row would leave a hole here even
    // if the count were padded elsewhere.
    expect(record.runs.map((r) => r.photo)).toEqual(
      record.runs.map((_, i) => `photo-${String(i + 1).padStart(2, "0")}`),
    )
  })

  it("carries no camera filename, only a position", () => {
    // The corpus is private and stays out of this repository. The record is
    // committed, so the whole document is scanned rather than the field that
    // was meant to carry the name.
    expect(RECORD).not.toMatch(/IMG[-_]?\d/i)
    expect(RECORD.toLowerCase()).not.toContain(".jpeg")
    expect(RECORD.toLowerCase()).not.toContain(".heic")
  })

  it("reports a distribution rather than a single figure", () => {
    expect(Object.keys(record.endToEnd).sort()).toEqual(["maxMs", "minMs", "n", "p50Ms", "p90Ms"])
    expect(record.endToEnd["minMs"]).toBeLessThanOrEqual(record.endToEnd["p50Ms"] as number)
    expect(record.endToEnd["p50Ms"]).toBeLessThanOrEqual(record.endToEnd["p90Ms"] as number)
    expect(record.endToEnd["p90Ms"]).toBeLessThanOrEqual(record.endToEnd["maxMs"] as number)
    // A tail is the point, so the corpus must actually have produced a spread.
    expect(record.endToEnd["maxMs"]).toBeGreaterThan(record.endToEnd["minMs"] as number)
  })

  it("summarises the END TO END totals, not one leg of them", () => {
    // Recomputed with the function the run used, from the per-run totals in the
    // same record. A summary built from `submitMs` — a component timing in the
    // journey's place, which the item forbids — cannot survive this.
    expect(record.endToEnd).toEqual(distribution(shoppable.map((r) => r.totalMs)))
    expect(record.breakdown.submit).toEqual(distribution(shoppable.map((r) => r.submitMs)))
    expect(record.breakdown.handoff).toEqual(distribution(shoppable.map((r) => r.handoffMs)))
    // And the legs are a breakdown OF the total: every one of them adds up.
    for (const run of shoppable) {
      expect(run.submitMs + run.handoffMs).toBeCloseTo(run.totalMs, 6)
    }
  })

  it("counts refusals and failures separately instead of dropping them", () => {
    const counted = {
      shoppable: record.runs.filter((r) => r.outcome === "shoppable").length,
      refused: record.runs.filter((r) => r.outcome === "refused").length,
      failed: record.runs.filter((r) => r.outcome === "failed").length,
    }
    expect(record.outcomes).toEqual(counted)
    // Every run is accounted for under one of the three, so a fourth outcome
    // cannot appear and be quietly uncounted.
    expect(counted.shoppable + counted.refused + counted.failed).toBe(record.runs.length)
    // Only served runs contribute to the end-to-end figure — a page that never
    // became shoppable has no scan-to-shop time — and each refusal still says why.
    expect(record.endToEnd["n"]).toBe(counted.shoppable)
    for (const run of record.runs.filter((r) => r.outcome !== "shoppable")) {
      expect(run.detail).toBeTruthy()
    }
  })

  it("records no threshold, because METHOD.md fixed that none is invented here", () => {
    // "A figure recorded now is what later work regresses against; what counts
    // as too slow is a product decision nobody has taken." An exact key set,
    // rather than a search for likely names, so anything added has to be read.
    expect(METHOD).toContain("It does not name a threshold")
    expect(Object.keys(record).sort()).toEqual([
      "breakdown",
      "endToEnd",
      "measuredAt",
      "modelCalls",
      "outcomes",
      "photos",
      "providers",
      "runs",
    ])
    for (const run of record.runs) {
      expect(Object.keys(run).every((k) => k !== "pass" && k !== "verdict")).toBe(true)
    }
  })
})

describe("slice5/scan-to-shop-measured-with-distribution — the statistic itself", () => {
  /**
   * The rule the record is summarised by, checked against the definition rather
   * than against itself. Recomputing the numbers with the shipped function
   * proves the summary matches the runs; it cannot prove the function computes
   * what METHOD.md promised. These cases are worked out by hand from the
   * document's own words: index `floor(q · n)` into the ascending sort, clamped
   * to the last element.
   */
  it("takes the value at floor(q · n) in the ascending sort", () => {
    const shuffled = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6]
    // n = 10: floor(0·10) = 0, floor(0.5·10) = 5, floor(0.9·10) = 9.
    expect(nearestRank(shuffled, 0)).toBe(1)
    expect(nearestRank(shuffled, 0.5)).toBe(6)
    expect(nearestRank(shuffled, 0.9)).toBe(10)
    // n = 4: floor(0.5·4) = 2, floor(0.9·4) = 3.
    expect(nearestRank([40, 10, 30, 20], 0.5)).toBe(30)
    expect(nearestRank([40, 10, 30, 20], 0.9)).toBe(40)
  })

  it("clamps to the last element rather than running off the end", () => {
    // `floor(1 · n)` is n, one past the last index. Unclamped it reads nothing
    // and the maximum becomes NaN — a hole that prints as a number.
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1)).toBe(10)
    expect(nearestRank([7], 1)).toBe(7)
    expect(nearestRank([3, 1, 2], 2)).toBe(3)
  })

  it("sorts numerically, not as text", () => {
    // `[...v].sort()` without a comparator orders 100 before 9. The tail is the
    // point of this measurement, so that mistake would hide exactly the runs it
    // exists to report.
    expect(nearestRank([9, 100, 20], 1)).toBe(100)
    expect(nearestRank([9, 100, 20], 0)).toBe(9)
  })

  it("builds every reported figure out of that one rule", () => {
    // Including the ends: a `minMs` or `maxMs` computed beside the rule rather
    // than by it is a second definition that can drift from the one METHOD.md
    // registered, and the clamp above would then guard a line nothing reaches.
    const values = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6]
    expect(distribution(values)).toEqual({
      n: values.length,
      minMs: nearestRank(values, 0),
      p50Ms: nearestRank(values, 0.5),
      p90Ms: nearestRank(values, 0.9),
      maxMs: nearestRank(values, 1),
    })
    expect(distribution(values)).toEqual({ n: 10, minMs: 1, p50Ms: 6, p90Ms: 10, maxMs: 10 })
    expect(distribution([7])).toEqual({ n: 1, minMs: 7, p50Ms: 7, p90Ms: 7, maxMs: 7 })
  })
})
