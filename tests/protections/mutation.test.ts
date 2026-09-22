/**
 * protections/the-instrument-refuses-to-guess — the thing that measures every
 * other guard is itself measured.
 *
 * On 2026-09-22 this repository's mutation harness reported eleven of eleven
 * mutants killed. Four were alive. The harness had been pointed at a source file
 * rather than a test file, vitest matched nothing and exited 1, and "non-zero"
 * was read as "the guard objected". Nothing about the output looked wrong — a
 * perfect score never does. The question that found it was "did that run execute
 * any tests at all", asked because the target was not a test file.
 *
 * So the instrument gets the same treatment as everything it measures: each of
 * its three refusals has the violation planted against it here, and must object.
 * A harness trusted on inspection is the one kind of guard whose failure makes
 * every other guard's evidence worthless at once.
 *
 * The first half drives the pure decisions with fixture readings — no
 * subprocess, because a harness whose own correctness depended on running it
 * would have the problem it exists to solve. The second half runs the real thing
 * end to end over a temporary suite, because `score.py` learned the hard way
 * that driving only the pure helpers leaves the wiring unguarded.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  decideBaseline,
  decideMutant,
  type Mutation,
  plant,
  type Reading,
  type Runner,
  readRun,
  runMutations,
  vitestRunner,
} from "./mutation.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const reading = (over: Partial<Reading> = {}): Reading => ({
  passed: 10,
  failed: 0,
  failing: [],
  reportedATally: true,
  ...over,
})

const mutation = (over: Partial<Mutation> = {}): Mutation => ({
  name: "a rule is narrowed",
  find: "const WIDE = /a|b/",
  replace: "const WIDE = /a/",
  mustFail: "the detector is precise",
  ...over,
})

/** Vitest's real output shape, as the harness must read it. */
const VITEST_GREEN = `
 ✓ tests/x/y.test.ts (10 tests) 84ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
`

const VITEST_RED = `
 ❯ tests/x/y.test.ts (10 tests | 1 failed)
   × the detector is precise > it misses nothing 12ms

 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
`

/**
 * The same green run as vitest actually emits it from inside a worker: in
 * colour. Captured from a real nested run, not written by hand — a fixture
 * invented from memory would have had the escapes in the wrong place, which is
 * the only place they matter.
 */
const VITEST_GREEN_IN_COLOUR =
  "\n\u001B[1m\u001B[46m RUN \u001B[49m\u001B[22m \u001B[36mv3.2.7 \u001B[39m\n\n" +
  " \u001B[32m✓\u001B[39m detector.test.mjs \u001B[2m(\u001B[22m\u001B[2m1 test\u001B[22m\u001B[2m)\u001B[22m\n\n" +
  "\u001B[2m Test Files \u001B[22m \u001B[1m\u001B[32m1 passed\u001B[39m\u001B[22m\u001B[90m (1)\u001B[39m\n" +
  "\u001B[2m      Tests \u001B[22m \u001B[1m\u001B[32m1 passed\u001B[39m\u001B[22m\u001B[90m (1)\u001B[39m\n"

/** What vitest prints when the target matches no test file: loud, and empty. */
const VITEST_NO_MATCH = `
 No test files found, exiting with code 1
 filter:  tests/protections/mutation.ts
 include: tests/**/*.test.ts
`

describe("protections/the-instrument-refuses-to-guess", () => {
  describe("reading a run", () => {
    it("reads the tally and the failing names out of real vitest output", () => {
      const green = readRun({ exitCode: 0, output: VITEST_GREEN })
      expect(green).toMatchObject({ passed: 10, failed: 0, reportedATally: true })

      const red = readRun({ exitCode: 1, output: VITEST_RED })
      expect(red).toMatchObject({ passed: 9, failed: 1, reportedATally: true })
      expect(red.failing.join(" ")).toContain("the detector is precise")
    })

    it("reads a tally that arrives in colour, which is how a nested run sends it", () => {
      // Without this the harness refuses every healthy run: vitest colours its
      // output when invoked from inside a worker, and `^\\s*Tests` then matches
      // nothing. Refusing is the safe direction to fail, and still useless.
      expect(readRun({ exitCode: 0, output: VITEST_GREEN_IN_COLOUR })).toMatchObject({
        passed: 1,
        failed: 0,
        reportedATally: true,
      })
    })

    it("reports NO TALLY for a run that matched no test file, though it exited 1", () => {
      // The incident, in one assertion. This output is what the lying harness
      // read as "red".
      expect(readRun({ exitCode: 1, output: VITEST_NO_MATCH })).toMatchObject({
        reportedATally: false,
        passed: 0,
        failed: 0,
      })
    })
  })

  describe("refusal 1 — a measured green baseline, through the same command", () => {
    it("accepts a baseline that ran tests and passed them", () => {
      const verdict = decideBaseline(reading())
      expect(verdict.usable).toBe(true)
      // The count is IN the summary, so a baseline that silently shrank to one
      // test is visible in the report rather than merely "green".
      expect(verdict.usable && verdict.summary).toContain("10 passed")
    })

    it("refuses a run that executed nothing, whatever it exited with", () => {
      const verdict = decideBaseline(readRun({ exitCode: 1, output: VITEST_NO_MATCH }))
      expect(verdict.usable).toBe(false)
      expect(verdict.usable === false && verdict.refusal).toContain("no test tally")
    })

    it("refuses a run that reported a tally but passed nothing", () => {
      // A tally of all-skipped is not a baseline: nothing was working, so
      // nothing can be shown to break.
      expect(decideBaseline(reading({ passed: 0 })).usable).toBe(false)
    })

    it("refuses an already-red baseline, because a kill could not be attributed", () => {
      expect(decideBaseline(reading({ failed: 2 })).usable).toBe(false)
    })
  })

  describe("refusal 2 — the text to replace must occur exactly once", () => {
    it("plants when the text is there exactly once", () => {
      const outcome = plant("before\nconst WIDE = /a|b/\nafter", mutation())
      expect(outcome.planted).toBe(true)
      expect(outcome.planted && outcome.source).toContain("const WIDE = /a/")
    })

    it("refuses when the text is absent — it would report a survivor forever", () => {
      const outcome = plant("a subject that has moved on", mutation())
      expect(outcome.planted).toBe(false)
      expect(outcome.planted === false && outcome.refusal).toContain("has moved")
    })

    it("refuses when the text occurs twice — the plant would change more than it names", () => {
      const twice = "const WIDE = /a|b/\nconst WIDE = /a|b/"
      const outcome = plant(twice, mutation())
      expect(outcome.planted).toBe(false)
      expect(outcome.planted === false && outcome.refusal).toContain("occurs 2 times")
    })
  })

  describe("refusal 3 — the verdict comes from the reported failure, not the exit code", () => {
    it("counts a kill only when the NAMED assertion is among the failures", () => {
      const r = reading({ failed: 1, failing: ["the detector is precise > it misses nothing"] })
      expect(decideMutant(r, mutation()).outcome).toBe("killed")
    })

    it("calls a green mutant a survivor", () => {
      expect(decideMutant(reading(), mutation()).outcome).toBe("survived")
    })

    it("refuses to call a mutant that never ran a test KILLED, though it exited 1", () => {
      // This is the whole incident. An exit-code harness scores this as a kill.
      const verdict = decideMutant(readRun({ exitCode: 1, output: VITEST_NO_MATCH }), mutation())
      expect(verdict.outcome).toBe("inconclusive")
      expect(verdict.outcome === "inconclusive" && verdict.why).toContain("no test tally")
    })

    it("refuses a kill when the failure is somewhere other than the named assertion", () => {
      // The second recurring defect shape of this project: the planted violation
      // fails, but not at its own assertion — so it measured a different rule.
      const r = reading({ failed: 1, failing: ["some other suite > an unrelated case"] })
      const verdict = decideMutant(r, mutation())
      expect(verdict.outcome).toBe("inconclusive")
      expect(verdict.outcome === "inconclusive" && verdict.why).toContain(
        "failing somewhere other than at its own assertion",
      )
    })

    /**
     * The verdict must not be able to consult the exit code, because the exit
     * code is what made the original harness lie. A pure-reading verdict is the
     * property; this pins it by showing the same reading decides the same way
     * whatever the process claimed.
     */
    it("decides identically for exit 0 and exit 1 on the same reported output", () => {
      const m = mutation()
      expect(decideMutant(readRun({ exitCode: 0, output: VITEST_RED }), m)).toEqual(
        decideMutant(readRun({ exitCode: 1, output: VITEST_RED }), m),
      )
      expect(decideMutant(readRun({ exitCode: 0, output: VITEST_GREEN }), m)).toEqual(
        decideMutant(readRun({ exitCode: 1, output: VITEST_GREEN }), m),
      )
    })
  })

  /**
   * The consequence of refusal 1, which is the whole reason it exists: a
   * baseline that cannot be trusted stops the run, rather than being noted in
   * the report while every mutant is judged anyway.
   *
   * This was a SURVIVOR. `decideBaseline` was proved thoroughly and the early
   * return that acts on it was proved by nothing — deleting the `if` left all
   * fifteen other proofs green. The condition existed; the fixture had never
   * been written, which is the second answer to "a condition whose removal kills
   * no fixture has nothing behind it".
   *
   * A runner is injected rather than a real suite run, because the property is
   * "nothing happens after a bad baseline" and a real run cannot show absence as
   * crisply: the fake counts its own invocations, so a second call is visible.
   */
  describe("a baseline that cannot be trusted stops the run", () => {
    const subjectFile = (contents: string): string => {
      const dir = mkdtempSync(join(tmpdir(), "cf-mut-base-"))
      const path = join(dir, "subject.ts")
      writeFileSync(path, contents)
      return path
    }

    const only = (output: string, exitCode = 1): { runner: Runner; calls: () => number } => {
      let calls = 0
      return {
        runner: () => {
          calls += 1
          return { exitCode, output }
        },
        calls: () => calls,
      }
    }

    const theMutation: Mutation = {
      name: "a plant that must never happen",
      find: "KEEP",
      replace: "GONE",
      mustFail: "whatever",
    }

    it("judges nothing, plants nothing, and leaves the subject alone", () => {
      const path = subjectFile("const x = KEEP")
      const { runner, calls } = only(VITEST_NO_MATCH)

      const report = runMutations(path, [theMutation], "some-target", runner)

      expect(report.baseline.usable).toBe(false)
      expect(report.results, "a mutant was judged against an untrustworthy baseline").toEqual([])
      expect(report.refusals).toEqual([])
      // The suite was invoked ONCE — for the baseline — and never again.
      expect(calls(), "the run continued past a refused baseline").toBe(1)
      // And the subject on disk is untouched, so nothing was planted.
      expect(readFileSync(path, "utf8")).toBe("const x = KEEP")
      rmSync(dirname(path), { recursive: true, force: true })
    })

    it("stops on an already-red baseline too, not only on an empty one", () => {
      // The other way a baseline goes bad. Without this entry, narrowing the
      // early return to the no-tally case alone would pass.
      const path = subjectFile("const x = KEEP")
      const { runner, calls } = only(VITEST_RED)

      const report = runMutations(path, [theMutation], "some-target", runner)

      expect(report.baseline.usable).toBe(false)
      expect(report.results).toEqual([])
      expect(calls()).toBe(1)
      rmSync(dirname(path), { recursive: true, force: true })
    })
  })

  /**
   * End to end, against a real suite on disk — the half `score.py` added after
   * finding that driving only the pure helpers left the wiring unguarded.
   *
   * A throwaway subject and a throwaway test for it, a runner that really shells
   * out, and then the properties that only the composition can show: that the
   * subject is restored afterwards, that a real narrowing is caught at its own
   * assertion, and that a mutation naming absent text is refused rather than
   * counted.
   */
  describe("end to end, over a real suite", () => {
    it("runs mutants against a real file and restores it, judging each by its own assertion", () => {
      const dir = mkdtempSync(join(tmpdir(), "cf-mut-"))
      try {
        const subject = join(dir, "detector.mjs")
        const spec = join(dir, "detector.test.mjs")
        writeFileSync(
          subject,
          ["export const WIDE = /alpha|beta/", "export const hit = (s) => WIDE.test(s)"].join("\n"),
        )
        writeFileSync(
          spec,
          [
            `import { describe, expect, it } from "vitest"`,
            `import { hit } from "./detector.mjs"`,
            `describe("the detector is precise", () => {`,
            `  it("catches both spellings", () => {`,
            `    expect(hit("alpha")).toBe(true)`,
            `    expect(hit("beta")).toBe(true)`,
            `  })`,
            `  it("spares a neighbour", () => { expect(hit("gamma")).toBe(false) })`,
            `})`,
          ].join("\n"),
        )
        // A real vitest, rooted at the temp directory so the repo's own config
        // and include globs do not decide what this fixture suite is.
        // The SHIPPED runner, not a copy of it. This is the part that actually
        // starts a process and captures its streams, and it is the part that was
        // wrong first: a stdout-only capture, and then a capture that did not
        // strip the colour a nested run emits. A proof that drove a
        // purpose-built stand-in here would have proved the stand-in. Rooted at
        // the temp directory so the repository's own config and include globs do
        // not decide what this fixture suite is.
        const runner = vitestRunner(repoRoot, ["--root", dir])

        const before = readFileSync(subject, "utf8")
        const report = runMutations(
          subject,
          [
            {
              name: "the detector is narrowed to one spelling",
              find: "/alpha|beta/",
              replace: "/alpha/",
              mustFail: "catches both spellings",
            },
            {
              name: "a mutation whose text is not there",
              find: "/this text is not in the subject/",
              replace: "/x/",
              mustFail: "catches both spellings",
            },
          ],
          basename(spec),
          runner,
        )

        // The baseline was measured and is reported, not assumed.
        expect(report.baseline.usable, JSON.stringify(report.baseline)).toBe(true)
        expect(report.baseline.usable && report.baseline.summary).toContain("2 passed")

        // The real narrowing died at the assertion that names it...
        expect(report.results).toHaveLength(1)
        expect(report.results[0]?.verdict.outcome).toBe("killed")

        // ...and the mutation describing absent text was REFUSED, never counted
        // as a kill. An exit-code harness reports this one as a pass.
        expect(report.refusals).toHaveLength(1)
        expect(report.refusals[0]).toContain("has moved")

        // The subject is back exactly as it was. A SIGPIPE once left a mutated
        // file in this repository's tree; the restore is not decoration.
        expect(readFileSync(subject, "utf8")).toBe(before)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }, 180_000)
  })
})
