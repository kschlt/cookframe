/**
 * The statistic the scan-to-shop measurement reports (CFV1-SL5).
 *
 * It lives in its own module so the proof can call the same function the run
 * called. A summary recomputed by a second implementation written beside the
 * check would agree with itself whatever either one does; the point of the
 * check is that the numbers in the record are the ones THIS function produces
 * from the runs in that same record.
 *
 * Nearest-rank, as `METHOD.md` fixed it before any figure existed: sort
 * ascending, take the value at index `floor(q · n)`, clamped to the last
 * element. With n around ten, `p90` is the second-slowest run and is reported
 * as a rank rather than as an estimate of a population quantile. Changing this
 * changes what METHOD.md promised, which is a finding to record beside the
 * result, not an edit to make before publishing it.
 */

/**
 * The rule itself, exported so it can be checked against the definition rather
 * than only through the summary it produces.
 *
 * Every figure below goes through it, `minMs` and `maxMs` included. That is not
 * tidiness: an `at(1)` that reads `sorted[n]` is off the end, so routing the
 * maximum through here is what makes the clamp a live part of the rule instead
 * of a line no call ever reaches — and a guard nothing exercises is the defect
 * this repository keeps finding in its own proofs.
 */
export function nearestRank(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
}

/** `n`, `minMs`, `p50Ms`, `p90Ms`, `maxMs` — milliseconds, over the values given. */
export function distribution(values: readonly number[]): Record<string, number> {
  return {
    n: values.length,
    minMs: nearestRank(values, 0),
    p50Ms: nearestRank(values, 0.5),
    p90Ms: nearestRank(values, 0.9),
    maxMs: nearestRank(values, 1),
  }
}
