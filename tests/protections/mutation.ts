/**
 * The instrument that measures every other guard, and the three ways it must
 * refuse to answer.
 *
 * Every structural claim in this repository is settled the same way: plant the
 * violation the guard names, and require the guard to go red AT ITS OWN
 * ASSERTION. Reading the guard and believing it is not evidence. That discipline
 * is only as good as the thing running the plants — and on 2026-09-22 the thing
 * running the plants lied. A harness pointed at a source file that is not a test
 * file made vitest match nothing and exit 1; the harness read "non-zero" as
 * "red" and reported all eleven mutants killed. The result looked perfect. Four
 * of the eleven were alive. A perfect mutation score is exactly where suspicion
 * belongs, and the question that caught it was not "does this look wrong" but
 * "did that run execute any tests at all".
 *
 * The design here is carried over from `spikes/s1-capture-quality/score.py`,
 * where the same three refusals were worked out first and are still in service.
 * It is deliberately NOT a second invention:
 *
 *  1. **A measured green baseline, through the exact command.** Before any
 *     mutant is judged, the unmutated subject runs through the identical
 *     invocation and must come back green with tests actually executed. Without
 *     this every number afterwards is worthless, and the baseline reading is
 *     part of the report so that its absence is visible rather than assumed.
 *
 *  2. **Refuse unless the text to replace occurs exactly once.** Zero means the
 *     mutation describes a subject that has moved on, and it would be reported
 *     as a survivor forever. More than one means the plant changed something
 *     besides what it names, and the verdict would be about the wrong edit.
 *
 *  3. **Judge from the REPORTED FAILURE, never from the exit code.** A mutant
 *     that dies of a syntax error, a bad import, or a path that matches no test
 *     exits non-zero too. Non-zero therefore proves nothing about the rule: the
 *     mutant must be seen to have run its tests to the end AND to have failed at
 *     the named assertion. This is the refusal that was missing in the incident
 *     above, and it is the one that costs nothing to leave out and everything to
 *     have left out.
 *
 * The decisions are pure functions over a reading, so the refusals themselves
 * are provable by fixture without starting a subprocess — a harness whose own
 * correctness rested on running it would have the problem it exists to solve.
 * `runMutation` is the thin shell that actually invokes vitest.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

/** One planted violation: what to change, and which proof must object. */
export interface Mutation {
  /** What this plant breaks, in words — it appears in the report. */
  readonly name: string
  /** The exact text to replace in the subject. Must occur exactly once. */
  readonly find: string
  /** What to put there instead. */
  readonly replace: string
  /**
   * The name (or a distinctive part of it) of the test that must report
   * failing.
   *
   * A NAME, never source text: a mutation that could rewrite its own marker
   * would be judged against a target it had just moved. This is the same reason
   * `score.py` reads its rule line off the function instead of restating it.
   */
  readonly mustFail: string
}

/** What a run of the suite reported, reduced to what a verdict may rest on. */
export interface Reading {
  /** Tests vitest reported passing. */
  readonly passed: number
  /** Tests vitest reported failing. */
  readonly failed: number
  /** The names of the failing tests, as reported. */
  readonly failing: readonly string[]
  /**
   * Did the run get far enough to report a test tally at all?
   *
   * False for a syntax error, an import that throws at collection, or a target
   * that matched no test file — every one of which also exits non-zero.
   */
  readonly reportedATally: boolean
}

/** The raw result of invoking the suite. */
export interface RunReport {
  readonly exitCode: number
  readonly output: string
}

/**
 * Strip ANSI escape sequences.
 *
 * Not a nicety. Vitest colours its output whenever it thinks something can
 * render colour, and when this harness runs from inside a vitest worker — which
 * is where its own end-to-end proof runs it — the nested process does exactly
 * that. The tally then arrives as `\x1b[2m      Tests \x1b[22m …`, so a pattern
 * anchored with `^\s*Tests` matches nothing, and every run reads as "no tally".
 * The harness would refuse rather than lie, which is the right direction to
 * fail, but it would refuse on a perfectly healthy repository and be useless.
 *
 * Found by measuring what the runner actually received rather than by reasoning
 * about it: the same command answered plainly from a shell and in colour from
 * inside a worker.
 */
function withoutColour(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC byte is the point
  return text.replace(/\u001B\[[0-9;]*m/g, "")
}

/**
 * Reduce vitest's output to a reading.
 *
 * Reads the tally line (`Tests  3 failed | 7 passed (10)`) and the failing test
 * names. A run with no tally line reported nothing — whatever its exit code.
 */
export function readRun(report: RunReport): Reading {
  const output = withoutColour(report.output)
  const tally = /^\s*Tests\s+(.+?)\s*$/m.exec(output)
  if (tally === null || tally[1] === undefined) {
    return { passed: 0, failed: 0, failing: [], reportedATally: false }
  }
  const count = (label: string): number => {
    const m = new RegExp(`(\\d+)\\s+${label}`).exec(tally[1] as string)
    return m?.[1] === undefined ? 0 : Number.parseInt(m[1], 10)
  }
  // Vitest marks each failing test with `×` in its per-test listing.
  const failing = output
    .split("\n")
    .filter((line) => line.includes("×"))
    .map((line) => line.slice(line.indexOf("×") + 1).trim())
    .map((line) => line.replace(/\s+\d+ms$/, "").trim())
    .filter((line) => line.length > 0)
  return {
    passed: count("passed"),
    failed: count("failed"),
    failing,
    reportedATally: true,
  }
}

/** Why a baseline was refused, or that it stands. */
export type BaselineVerdict =
  | { readonly usable: true; readonly summary: string }
  | { readonly usable: false; readonly refusal: string }

/**
 * Refusal 1. The unmutated subject must run green, through the same command,
 * with tests actually executed.
 *
 * "Executed" is a separate condition from "green": a run that matched no test
 * file fails nothing and passes nothing, and calling that green is precisely the
 * incident this module exists because of.
 */
export function decideBaseline(reading: Reading): BaselineVerdict {
  if (!reading.reportedATally) {
    return {
      usable: false,
      refusal:
        "the baseline run reported no test tally at all — the command matched no test file, or died before running one; every verdict after this would be meaningless",
    }
  }
  if (reading.passed === 0) {
    return {
      usable: false,
      refusal: `the baseline run executed no passing test (passed=0, failed=${reading.failed}); a mutant cannot be shown to break something that was never working`,
    }
  }
  if (reading.failed > 0) {
    return {
      usable: false,
      refusal: `the baseline run is already red (${reading.failed} failing); a mutant's failure would not be attributable to the mutation`,
    }
  }
  return { usable: true, summary: `baseline green: ${reading.passed} passed` }
}

/** The outcome of trying to write a mutation into a subject. */
export type PlantOutcome =
  | { readonly planted: true; readonly source: string }
  | { readonly planted: false; readonly refusal: string }

/**
 * Refusal 2. Write `mutation` into `source`, or refuse.
 *
 * The count must be exactly one. Zero means the mutation names text the subject
 * no longer contains, and it would report a survivor for as long as nobody
 * looked. More than one means the plant edits something besides what it names,
 * so whatever the suite then says is about a different change.
 */
export function plant(source: string, mutation: Mutation): PlantOutcome {
  const occurrences = source.split(mutation.find).length - 1
  if (occurrences !== 1) {
    return {
      planted: false,
      refusal:
        occurrences === 0
          ? `"${mutation.name}": the text to replace is not in the subject — the mutation describes code that has moved, and would report a survivor forever`
          : `"${mutation.name}": the text to replace occurs ${occurrences} times — the plant would change more than it names`,
    }
  }
  return { planted: true, source: source.replace(mutation.find, mutation.replace) }
}

/** What a mutant proved, if anything. */
export type MutantVerdict =
  /** The guard objected, at the assertion the mutation names. */
  | { readonly outcome: "killed" }
  /** The guard stayed green: the rule is not held where it claims to be. */
  | { readonly outcome: "survived" }
  /**
   * The run proves nothing either way, and must not be counted as a kill.
   * This is the verdict an exit-code-only harness cannot express.
   */
  | { readonly outcome: "inconclusive"; readonly why: string }

/**
 * Refusal 3. Judge a mutant from what the run REPORTED.
 *
 * `exitCode` is deliberately not a parameter. It is the input that made the
 * original harness lie, and the verdict is sound without it: a run that reported
 * a tally and named the expected test among its failures is a kill, whatever it
 * exited with, and a run that reported no tally is inconclusive however loudly
 * it exited.
 */
export function decideMutant(reading: Reading, mutation: Mutation): MutantVerdict {
  if (!reading.reportedATally) {
    return {
      outcome: "inconclusive",
      why: `"${mutation.name}": the mutant reported no test tally — it died before the rule was ever reached. A non-zero exit here proves nothing about the rule.`,
    }
  }
  if (reading.failed === 0) return { outcome: "survived" }
  const hit = reading.failing.some((name) => name.includes(mutation.mustFail))
  if (!hit) {
    return {
      outcome: "inconclusive",
      why:
        `"${mutation.name}": ${reading.failed} test(s) failed, but not ${JSON.stringify(mutation.mustFail)} — ` +
        `the planted violation is failing somewhere other than at its own assertion, which is a different defect from the one being measured. Failing: ${reading.failing.join(" | ")}`,
    }
  }
  return { outcome: "killed" }
}

/** One line of the report, per mutation. */
export interface MutationResult {
  readonly mutation: Mutation
  readonly verdict: MutantVerdict
}

/** How to run the suite. Separated so the proofs can drive it without vitest. */
export type Runner = (target: string) => RunReport

/**
 * Invoke vitest for real.
 *
 * `spawnSync` rather than `execFileSync`, because it returns both streams
 * whether the command succeeded or failed; `execFileSync` hands back stdout on
 * success and the rest only by throwing.
 *
 * Both streams are concatenated because WHICH ONE carries the tally is not a
 * thing this harness should have an opinion about. Measured here on 2026-09-22,
 * vitest 3.2.7 writes its summary to STDOUT — and that is worth writing down
 * precisely because an earlier draft of this comment asserted the opposite. The
 * first green run came back with no tally in it, "it must be on stderr" was the
 * obvious explanation, and it was wrong: the run was nested inside a vitest
 * worker, and the real cause was the ANSI colour that `withoutColour` now
 * strips. Merging the streams is cheap insurance against a version or a platform
 * that differs; the sentence explaining it was a guess presented as a fact,
 * which is the failure this whole module exists to make harder.
 *
 * KNOWN SURVIVOR, deliberately. Dropping `result.stderr` here kills no test,
 * because on this platform stderr is empty and the tally is on stdout, so no
 * fixture this suite can honestly build would notice. It stays for the reason
 * above, and it is recorded here rather than papered over with a fixture that
 * asserts the merge by re-implementing it — that would prove the fixture. The
 * mirror mutation (capturing stderr ALONE) is caught, so the capture is pinned
 * to a stream that actually carries output.
 *
 * Never piped, either: routing this through `head` once killed the process with
 * SIGPIPE mid-run and left a mutated file in the tree.
 */
export const vitestRunner =
  (cwd: string, extraArgs: readonly string[] = []): Runner =>
  (target: string): RunReport => {
    const result = spawnSync("npx", ["vitest", "run", ...extraArgs, target], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    return {
      exitCode: result.status ?? 1,
      output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    }
  }

/** Everything a run of the harness produced. */
export interface HarnessReport {
  readonly baseline: BaselineVerdict
  readonly results: readonly MutationResult[]
  /** Refusals from planting, which are neither kills nor survivals. */
  readonly refusals: readonly string[]
}

/**
 * Run every mutation against `subjectPath`, judging each by the rules above.
 *
 * The subject is restored in a `finally`, and the caller is never asked to pipe
 * the output anywhere: piping this through `head` once killed the process with
 * SIGPIPE mid-run and left a mutated file in the tree, which the next run's
 * baseline check is what caught.
 */
export function runMutations(
  subjectPath: string,
  mutations: readonly Mutation[],
  target: string,
  runner: Runner,
): HarnessReport {
  const original = readFileSync(subjectPath, "utf8")
  const baseline = decideBaseline(readRun(runner(target)))
  if (!baseline.usable) return { baseline, results: [], refusals: [] }

  const results: MutationResult[] = []
  const refusals: string[] = []
  try {
    for (const mutation of mutations) {
      const outcome = plant(original, mutation)
      if (!outcome.planted) {
        refusals.push(outcome.refusal)
        continue
      }
      writeFileSync(subjectPath, outcome.source, "utf8")
      results.push({ mutation, verdict: decideMutant(readRun(runner(target)), mutation) })
    }
  } finally {
    writeFileSync(subjectPath, original, "utf8")
  }
  return { baseline, results, refusals }
}

/**
 * The report, as text. The baseline line is always first and always printed, so
 * that a missing baseline is visible instead of inferred.
 */
export function formatReport(report: HarnessReport): string {
  const lines: string[] = []
  lines.push(
    report.baseline.usable
      ? `✓ ${report.baseline.summary}`
      : `✗ BASELINE REFUSED — ${report.baseline.refusal}`,
  )
  if (!report.baseline.usable) return lines.join("\n")
  for (const { mutation, verdict } of report.results) {
    const mark =
      verdict.outcome === "killed"
        ? "✓ killed"
        : verdict.outcome === "survived"
          ? "✗ SURVIVED"
          : "? INCONCLUSIVE"
    lines.push(`  ${mark}  ${mutation.name}`)
    if (verdict.outcome === "inconclusive") lines.push(`      ${verdict.why}`)
  }
  for (const refusal of report.refusals) lines.push(`  ! REFUSED  ${refusal}`)
  const survivors = report.results.filter((r) => r.verdict.outcome === "survived").length
  const unclear = report.results.filter((r) => r.verdict.outcome === "inconclusive").length
  lines.push(
    `\n${report.results.length} judged, ${survivors} survived, ${unclear} inconclusive, ${report.refusals.length} refused`,
  )
  return lines.join("\n")
}
