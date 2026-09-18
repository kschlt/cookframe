/**
 * Eval-harness test (CFV1-SL0, proof: slice0/eval-harness-runs). The harness
 * must run against the committed public fixtures and report them all valid; a
 * regression in either the schema or a fixture turns this red.
 */
import { describe, expect, it } from "vitest"
import { runEvals } from "../../evals/harness.js"

describe("slice0/eval-harness-runs", () => {
  it("validates every public fixture against the contract", () => {
    const { total, failures } = runEvals()
    expect(total).toBeGreaterThan(0)
    expect(failures, failures.map((f) => `${f.file}: ${f.message}`).join("\n")).toHaveLength(0)
  })
})
