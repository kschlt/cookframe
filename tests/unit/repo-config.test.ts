/**
 * Repository-configuration tests (CFV1-SL0). Each `it` names the acceptance
 * criterion it proves. These assert repository *content* — the files a
 * reviewer can see in the PR. The three GitHub platform settings (push
 * protection, Dependabot, branch protection) and this instance's `commands.*`
 * seams are CFV1-PROT and are deliberately not asserted here.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...p: string[]) => readFileSync(join(repoRoot, ...p), "utf8")

describe("slice0/toolchain-commands-run", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>
  }
  it("documents typecheck, lint, format check and the test runner", () => {
    for (const s of ["typecheck", "lint", "format:check", "test"]) {
      expect(pkg.scripts[s], s).toBeTruthy()
    }
  })
})

describe("slice0/security-and-contributing-present", () => {
  it("SECURITY.md and CONTRIBUTING.md exist at the repo root", () => {
    expect(existsSync(join(repoRoot, "SECURITY.md"))).toBe(true)
    expect(existsSync(join(repoRoot, "CONTRIBUTING.md"))).toBe(true)
  })
})

describe("slice0/env-example-placeholders-only", () => {
  it(".env.example exists and holds only placeholders", () => {
    const text = read(".env.example")
    const values = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#") && l.includes("="))
      .map((l) =>
        l
          .slice(l.indexOf("=") + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      )
    expect(values.length).toBeGreaterThan(0)
    // A placeholder is empty or an obvious stand-in — never a long opaque token.
    const placeholderish =
      /^(|<.*>|your[-_].*|change[-_ ]?me|replace[-_ ]?me|\.\/.*|placeholder|example.*|https?:\/\/localhost.*|https?:\/\/example\..*)$/i
    for (const v of values) {
      const looksReal = v.length >= 20 && /^[A-Za-z0-9+/_-]+$/.test(v) && !placeholderish.test(v)
      expect(looksReal, `value "${v}" looks like a real secret`).toBe(false)
    }
  })
})

describe("CI workflow (ci.yml)", () => {
  const workflow = parseYaml(read(".github", "workflows", "ci.yml")) as {
    on: Record<string, unknown>
    jobs: Record<string, { steps?: Array<Record<string, unknown>> }>
  }
  const jobNames = Object.keys(workflow.jobs)

  it("slice0/ci-job-coverage — all six check jobs are present", () => {
    for (const job of [
      "typecheck",
      "lint",
      "unit",
      "schema-contract",
      "normalization-invariant",
      "url-fetch-security",
    ]) {
      expect(jobNames, job).toContain(job)
    }
  })

  it("slice0/ci-job-coverage — the check jobs run build-failing commands", () => {
    const runsOf = (job: string) =>
      (workflow.jobs[job]?.steps ?? [])
        .map((s) => s.run)
        .filter((r): r is string => typeof r === "string")
        .join("\n")
    // A non-zero exit from any of these fails the job (no continue-on-error),
    // which fails the build.
    expect(runsOf("typecheck")).toMatch(/npm run typecheck/)
    // The lint job runs `npm run check` (`biome check`), not `npm run lint`:
    // the narrower command does not run the import-organisation assist, so a
    // push could be green here and red where `biome ci` runs. Asserting the
    // superset keeps the two from drifting apart again.
    expect(runsOf("lint")).toMatch(/npm run check/)
    expect(runsOf("schema-contract")).toMatch(/test:schema-contract/)
    expect(runsOf("normalization-invariant")).toMatch(/test:normalization-invariant/)
    expect(runsOf("url-fetch-security")).toMatch(/test:url-fetch-security/)
    const noContinueOnError = Object.values(workflow.jobs).every((j) =>
      (j.steps ?? []).every((s) => s["continue-on-error"] !== true),
    )
    expect(noContinueOnError).toBe(true)
  })

  it("capture-quality/selftest-runs-in-ci — the scorer's discrimination proof is actually run", () => {
    // VERDICT.md offers `score.py --selftest` as one of the four committed
    // things that decide what the S1 rates mean. It is Python, under `spikes/`,
    // so no npm script reaches it: without a step here it is a proof the gate
    // never runs, and "selftest passes" would be a claim nothing checks.
    const runs = Object.values(workflow.jobs)
      .flatMap((j) => j.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    expect(runs, "no CI job runs the S1 scorer's self-test").toMatch(/score\.py --selftest/)
  })

  it("ci/scorer-selftest-job-exists — the self-test runs unconditionally, under a Python pinned in that same job", () => {
    // CFV1-CIPY. The self-test is the scorer's discrimination proof, and it is
    // Python under `spikes/`, so no npm script reaches it. A step must run it,
    // a non-zero exit must fail the build, and the step must actually RUN — a
    // job that skips is worse than none, because it reports success.
    //
    // Both halves of that were asserted too loosely at first, and a review
    // caught it by mutation. The Python pin was searched for across EVERY job,
    // so moving `setup-python` from `unit` to `lint` left all tests green while
    // the self-test ran under whatever interpreter the runner happened to
    // carry — and the pin is the one constraint this item states explicitly.
    // And only `continue-on-error` was asserted, never `if`, so `if: false` on
    // the step also left every test green, while in CI the step would be
    // skipped and the job would still report success — precisely the failure
    // this comment claims to rule out. Both are now tied to the ONE job that
    // carries the step, and both mutations turn this red.
    const carries = (j: { steps?: Array<Record<string, unknown>> }) =>
      (j.steps ?? []).some((s) => typeof s.run === "string" && /score\.py --selftest/.test(s.run))
    const entry = Object.entries(workflow.jobs).find(([, j]) => carries(j))
    expect(entry, "no CI job runs `score.py --selftest`").toBeTruthy()
    const [jobName, job] = entry as [string, { steps?: Array<Record<string, unknown>> }]
    const steps = job.steps ?? []
    const step = steps.find(
      (s) => typeof s.run === "string" && /score\.py --selftest/.test(s.run),
    ) as Record<string, unknown>

    expect(
      step["continue-on-error"] ?? false,
      `the self-test step in \`${jobName}\` may fail without failing the build`,
    ).toBe(false)
    // A step or job that never runs reports success, which is the failure mode
    // this proof exists to exclude. Neither may be conditional.
    expect(
      step["if"],
      `the self-test step in \`${jobName}\` is conditional, so it can be skipped and still pass`,
    ).toBeUndefined()
    expect(
      (job as Record<string, unknown>)["if"],
      `the job \`${jobName}\` that runs the self-test is conditional, so it can be skipped and still pass`,
    ).toBeUndefined()

    // The Python is pinned IN THE SAME JOB. A pin in some other job does not
    // reach this one — each job is a fresh runner.
    const pin = steps.find(
      (s) => typeof s.uses === "string" && (s.uses as string).startsWith("actions/setup-python"),
    )
    expect(
      pin,
      `the job \`${jobName}\` that runs the self-test does not pin its Python`,
    ).toBeTruthy()
    expect(
      (pin as { with?: Record<string, unknown> }).with?.["python-version"],
      `setup-python in \`${jobName}\` names no version`,
    ).toBeTruthy()
  })

  it("ci/scorer-selftest-enforces-discrimination — `--selftest` fails unless a broken scorer fails AT THE RULE", () => {
    // Why the container may skip the Python-gated proof below without leaving a
    // gap: `score.py --selftest` enforces the discrimination itself. This reads
    // the source and pins that machinery, and it runs in EVERY environment,
    // Python present or not, because it only reads the file the `unit` job runs.
    const source = readFileSync(join(repoRoot, "spikes", "s1-capture-quality", "score.py"), "utf8")

    // The line the mutation replaces is DERIVED from `selected_truth_times`, not
    // restated. Restating it put the same text in the file twice, so the
    // mutation rewrote its own marker constant alongside the rule.
    expect(source, "`--selftest` no longer derives the rule line from the function").toMatch(
      /inspect\.getsource\(selected_truth_times\)/,
    )
    const rule = source.match(/\ndef selected_truth_times\([\s\S]*?\n( {4}return [^\n]*)\n/)?.[1]
    expect(rule, "cannot find the rule line in `selected_truth_times`").toBeTruthy()
    const occurrences = source.split((rule as string).trim()).length - 1
    expect(
      occurrences,
      "the rule line appears more than once, so the mutation rewrites its own marker",
    ).toBe(1)

    expect(source, "`--selftest` no longer re-applies the narrowing it exists to catch").toContain(
      'for k in ("prep", "cook", "total")',
    )
    expect(source, "`--selftest` does not run the mutant under --selftest-core").toContain(
      "--selftest-core",
    )
    expect(source, "score.py exposes no --selftest-core entry point").toMatch(/args\.selftest_core/)

    // A non-zero exit is NOT enough, and pinning only that is what let a mutant
    // die of a SyntaxError while the proof printed PASS. The proof must require
    // the mutant to have RUN its checks and to have failed at the rule itself.
    expect(source, "`--selftest` does not gate on the mutant's exit code").toMatch(
      /returncode\s*!=\s*0/,
    )
    expect(
      source,
      "`--selftest` does not require the mutant to have run its checks to the end",
    ).toContain("self-test: FAIL")
    expect(
      source,
      "`--selftest` does not require the mutant to fail at the rule, only to die",
    ).toMatch(/_MUTANT_MUST_FAIL/)
  })

  it("ci/integration-selftest-enforces-discrimination — `--selftest` gates on the format-gate proofs too", () => {
    // The format gate (a `*_label` key in `times` blocks a PASS) is proved by two
    // mechanisms beyond the pure-helper checks: an integration self-test through
    // the real `score()` (`--selftest-integration`) and mutation proofs that plant
    // the three ways the gate can be defeated. Like the narrowing proof above,
    // those are worth nothing unless `--selftest` GATES on them — otherwise
    // rewriting the gate to `return 0 if ok else 1` drops them while they visibly
    // print FAIL, the one advisory the #49 review left open. A guard that is not
    // itself guarded is this project's most common defect, so it is pinned here.
    // This reads the source and runs in every environment, Python present or not.
    const source = readFileSync(join(repoRoot, "spikes", "s1-capture-quality", "score.py"), "utf8")

    // `selftest()`'s gating return must depend on BOTH new proofs. Removing either
    // name from the conjunction — the exact regression this pins — turns the
    // matching assertion red (verified by planting both deletions).
    const gate = source.match(/\n {4}return 0 if \(([^)]*)\) else 1\n/)?.[1]
    expect(gate, "`selftest()` no longer gates its return on a conjunction").toBeTruthy()
    expect(gate, "`--selftest` does not gate on the integration self-test result").toContain(
      "integ_ok",
    )
    expect(gate, "`--selftest` does not gate on the mutation proofs result").toContain("mut_ok")

    // …and each name must be BOUND to the proof it claims to run, not to a
    // constant that is always truthy.
    expect(source, "`integ_ok` is not the integration self-test's own result").toMatch(
      /integ_ok\s*=\s*selftest_integration\(\)\s*==\s*0/,
    )
    expect(source, "`mut_ok` is not the mutation proofs' own result").toMatch(
      /mut_ok\s*=\s*_integration_mutation_proofs\(source\)/,
    )

    // The integration self-test must be a real entry point `--selftest` can drive.
    expect(source, "score.py exposes no --selftest-integration entry point").toMatch(
      /args\.selftest_integration/,
    )

    // The mutation proofs must require each mutant CAUGHT — run to the end and
    // failed at its named assertion — not merely fatal, the same bar the
    // narrowing proof holds one level up.
    expect(source, "the mutation proofs do not gate on the mutant's exit code").toMatch(
      /returncode\s*!=\s*0/,
    )
    expect(
      source,
      "the mutation proofs do not require the mutant to have run its checks to the end",
    ).toContain("integration self-test: FAIL")
    expect(
      source,
      "the mutation proofs do not require the mutant to fail at its named assertion",
    ).toContain("must_fail in failed")
  })

  const python3 = spawnSync("python3", ["--version"], { encoding: "utf8" })
  const hasPython3 = python3.error === undefined && python3.status === 0

  it.skipIf(!hasPython3)(
    "ci/scorer-selftest-discriminates — a broken scorer fails the self-test rather than passing it",
    () => {
      // "The self-test passes" means nothing unless a broken scorer makes it
      // fail. This runs it twice: on the shipped file, which must pass, and on a
      // COPY with the narrowing re-applied, which must fail.
      //
      // Both mutation strings are asked of score.py itself rather than written
      // out here. An earlier version hardcoded them, so this proof and the
      // Python one carried two copies of the same strings with nothing asserting
      // they agreed — a rename on one side would have left this exercising a
      // scorer it no longer reached.
      const scorerDir = join(repoRoot, "spikes", "s1-capture-quality")
      const scorer = join(scorerDir, "score.py")
      const ask = spawnSync(
        "python3",
        [
          "-c",
          "import sys;sys.path.insert(0,sys.argv[1]);import score;" +
            "print(score._rule_line());print(score._DISCRIMINATION_NARROWING)",
          scorerDir,
        ],
        { encoding: "utf8" },
      )
      expect(ask.status, `could not read the mutation from score.py: ${ask.stderr}`).toBe(0)
      const [rule, narrowing] = ask.stdout.trimEnd().split("\n")
      expect(rule, "score.py reported no rule line").toBeTruthy()
      expect(narrowing, "score.py reported no narrowing").toBeTruthy()

      const source = readFileSync(scorer, "utf8")
      expect(source, "the rule score.py names is not in the file").toContain(rule as string)

      const runSelftest = (file: string) =>
        spawnSync("python3", [file, "--selftest"], { encoding: "utf8" })
      const pristine = runSelftest(scorer)
      expect(pristine.status, "the shipped scorer's self-test does not pass").toBe(0)

      const dir = mkdtempSync(join(tmpdir(), "cipy-mut-"))
      try {
        const broken = join(dir, "score.py")
        writeFileSync(broken, source.replace(rule as string, narrowing as string))
        const mutated = runSelftest(broken)
        expect(
          mutated.status,
          "the narrowing the self-test exists to catch did NOT make it fail",
        ).not.toBe(0)
        // and it failed BECAUSE of the rule, not because the copy would not run
        expect(
          mutated.stdout,
          "the mutant died without running its checks, so the rule was never tested",
        ).toContain("self-test: FAIL")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it("ci/scorer-rules-unchanged — the scorer and THRESHOLD.md both derive from the one bars declaration (CFV1-THR)", () => {
    // CFV1-CIPY made the scorer RUN and pinned that it must not change what the
    // scorer MEASURES; it did that by proving score.py's FIELD_BARS/EDGE_BARS
    // were byte-identical to THRESHOLD.md's tables. CFV1-THR consolidated those
    // two copies into ONE declaration (bars.json) that the scorer reads and the
    // document is generated from. The pin MOVES here rather than being bypassed:
    // it now proves both consumers agree with the declaration and neither keeps
    // an independent copy — so a bar cannot drift between them, which is exactly
    // what THR exists to make impossible. (That no bar VALUE moved, and that the
    // declaration cannot be edited in place, are the scorer-side unit's Python
    // proofs `thresholds/no-bar-value-changed` and `thresholds/in-place-edit-refused`.)
    const spike = join(repoRoot, "spikes", "s1-capture-quality")

    // The single source: bars.json's ACTIVE entries (those no later entry supersedes).
    const bars = JSON.parse(readFileSync(join(spike, "bars.json"), "utf8")) as {
      registrations: {
        seq: number
        bar: string
        kind: string
        value: number
        supersedes: number | null
      }[]
    }
    const superseded = new Set(
      bars.registrations.filter((r) => r.supersedes !== null).map((r) => r.supersedes),
    )
    const declField: Record<string, number> = {}
    const declEdge: Record<string, number> = {}
    for (const r of bars.registrations) {
      if (superseded.has(r.seq)) continue
      ;(r.kind === "field" ? declField : declEdge)[r.bar] = r.value
    }
    expect(Object.keys(declField).length, "no active field bars in bars.json").toBe(14)
    expect(Object.keys(declEdge).length, "no active edge bars in bars.json").toBe(4)

    // THRESHOLD.md's two generated tables must equal the declaration. Parse each
    // marked section on its own so a field and an edge bar of the same name
    // (`multiple_yields`) are never conflated.
    const md = readFileSync(join(spike, "THRESHOLD.md"), "utf8")
    const between = (a: string, b: string): string => {
      const i = md.indexOf(a)
      const j = md.indexOf(b)
      expect(i, `THRESHOLD.md missing ${a}`).toBeGreaterThanOrEqual(0)
      expect(j, `THRESHOLD.md missing ${b}`).toBeGreaterThan(i)
      return md.slice(i, j)
    }
    const tableBars = (section: string): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const line of section.split("\n")) {
        const m = line.match(/^\|\s*`([^`]+)`\s*\|[^|]*\|[^|]*\|\s*\**\s*≥\s*(\d+)%\s*\**\s*\|$/)
        if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = Number(m[2]) / 100
      }
      return out
    }
    const docField = tableBars(between("BEGIN GENERATED FIELD BARS", "END GENERATED FIELD BARS"))
    const docEdge = tableBars(between("BEGIN GENERATED EDGE BARS", "END GENERATED EDGE BARS"))
    expect(docField, "THRESHOLD.md field table differs from bars.json").toEqual(declField)
    expect(docEdge, "THRESHOLD.md edge table differs from bars.json").toEqual(declEdge)

    // The scorer reads its bars from the declaration and keeps no independent
    // copy: no hard-coded numeric FIELD_BARS/EDGE_BARS literal, and it loads them
    // through thresholds. A re-introduced literal would be a second source.
    const source = readFileSync(join(spike, "score.py"), "utf8")
    expect(source, "score.py still hard-codes a FIELD_BARS dict").not.toMatch(
      /FIELD_BARS\s*=\s*\{[^}]*[0-9]/s,
    )
    expect(source, "score.py still hard-codes an EDGE_BARS dict").not.toMatch(
      /EDGE_BARS\s*=\s*\{[^}]*[0-9]/s,
    )
    expect(source, "score.py does not read the bars from the declaration").toMatch(
      /thresholds\.field_bars/,
    )
    expect(source).toMatch(/thresholds\.edge_bars/)
  })

  it("thresholds/proofs-run-in-ci — the declare-once/freeze proofs and registry checks actually run", () => {
    // The THR proofs and the registry integrity + doc-generation checks are
    // Python under `spikes/`, like the scorer self-test, so only a CI step
    // reaches them. A proof the gate never runs is a proof nobody is checking
    // (CFV1-THR; same reasoning as capture-quality/selftest-runs-in-ci).
    const runs = Object.values(workflow.jobs)
      .flatMap((j) => j.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    expect(runs, "CI does not run the THR threshold proofs").toMatch(/test_thresholds\.py/)
    expect(runs, "CI does not check THRESHOLD.md is generated from bars.json").toMatch(
      /thresholds\.py gen-doc --check/,
    )
    expect(runs, "CI does not verify the bars registry integrity").toMatch(/thresholds\.py verify/)
    // The append-only check runs bars.json against its committed baseline, so an
    // in-place edit that also re-forged its hash (past the at-rest `verify`) is
    // still refused. Without a CI step it is a guard nobody reaches.
    expect(runs, "CI does not run the append-only check against the base").toMatch(
      /thresholds\.py append-only-check/,
    )
    // The append-only check can only read the committed baseline if ITS job
    // checks out enough history — it fails closed on an unresolvable base ref.
    // Tie fetch-depth: 0 to that specific job, not searched across all jobs: a
    // condition proved in the wrong job (or nowhere) is the CIPY failure mode.
    // Deleting fetch-depth from that checkout reddens this.
    const aoJob = Object.values(workflow.jobs).find((j) =>
      (j.steps ?? []).some(
        (s) => typeof s.run === "string" && /thresholds\.py append-only-check/.test(s.run),
      ),
    )
    expect(aoJob, "no job runs the append-only check").toBeTruthy()
    const checkout = (aoJob?.steps ?? []).find(
      (s) => typeof s.uses === "string" && (s.uses as string).startsWith("actions/checkout"),
    )
    expect(checkout, "the append-only-check job has no checkout step").toBeTruthy()
    expect(
      (checkout as { with?: Record<string, unknown> }).with?.["fetch-depth"],
      "the append-only-check job's checkout is not full-depth, so its base ref is unreachable and the guard cannot run",
    ).toBe(0)
  })

  it("dbq/ci-provides-the-database — the dbq job runs against a real PostgreSQL service", () => {
    // `tests/dbq/queries.test.ts` skips when no server answers, so without this
    // job the three deciding queries would be "proved" nowhere. The skip is a
    // local-machine convenience; CI is where it has to actually run.
    const job = workflow.jobs["dbq"] as
      | { services?: Record<string, { image?: string }>; env?: Record<string, string> }
      | undefined
    expect(job, "no `dbq` job in CI").toBeTruthy()
    expect(job?.services?.postgres?.image, "the dbq job has no postgres service").toMatch(
      /^postgres:/,
    )
    expect(job?.env?.DATABASE_URL, "the dbq job does not point the tests at the service").toContain(
      "postgres://",
    )
    const runs = (workflow.jobs["dbq"]?.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    expect(runs).toMatch(/npm run test:dbq/)

    // ...and that `test:dbq` still RUNS the dbq tests. Asserting the invocation
    // alone left a hole: a `test:dbq` script redefined to point somewhere else
    // keeps this green while the dbq proofs run nowhere, which is the exact
    // failure this whole test exists to prevent.
    const scripts = (
      JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
        scripts?: Record<string, string>
      }
    ).scripts
    expect(scripts?.["test:dbq"], "no `test:dbq` script for the CI job to run").toBeTruthy()
    expect(
      scripts?.["test:dbq"],
      "`test:dbq` does not run the dbq tests, so the CI job proves nothing",
    ).toMatch(/tests\/dbq/)
  })

  it("pg/ci-provides-the-database — the persistence job runs the durable store's proofs against a real PostgreSQL service", () => {
    // CFV1-PG. The store is PostgreSQL (ADR-0015), so its proofs need a server.
    // `tests/persistence/postgres-harness.ts` FAILS rather than skips once
    // DATABASE_URL is set — but that rule only bites where the variable is set,
    // so this job is the other half of it: with no job setting it, every proof
    // would skip and the build would be green with the durable store untested.
    const job = workflow.jobs["persistence"] as
      | { services?: Record<string, { image?: string }>; env?: Record<string, string> }
      | undefined
    expect(job, "no `persistence` job in CI").toBeTruthy()
    expect(job?.services?.postgres?.image, "the persistence job has no postgres service").toMatch(
      /^postgres:/,
    )
    expect(
      job?.env?.DATABASE_URL,
      "the persistence job does not point the tests at the service, so they would skip",
    ).toContain("postgres://")
    const runs = (workflow.jobs["persistence"]?.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    expect(runs).toMatch(/npm run test:persistence/)

    // ...and the script still runs the persistence tests. Asserting the
    // invocation alone leaves the same hole the dbq assertion above closed: a
    // script redefined to point elsewhere keeps this green while nothing runs.
    const scripts = (
      JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
        scripts?: Record<string, string>
      }
    ).scripts
    expect(
      scripts?.["test:persistence"],
      "no `test:persistence` script for the CI job",
    ).toBeTruthy()
    expect(
      scripts?.["test:persistence"],
      "`test:persistence` does not run the persistence tests, so the CI job proves nothing",
    ).toMatch(/tests\/persistence/)
  })

  it("protections/the-ci-job-runs-the-claims-proofs — the script it invokes still points at them", () => {
    // CFV1-PROT. That a `protections` job EXISTS and invokes
    // `npm run test:protections` is already held by
    // `ci/every-declared-test-script-runs-in-a-named-job` above, which reads the
    // script list off `package.json`. What that case cannot see is where the
    // script points: redefined to any other directory it keeps a green job with
    // a matching name while the claims proofs stop running, and those proofs
    // are the only thing standing between this repository and another published
    // claim nobody checked. Same hole, same shape, as the `test:persistence`
    // assertion directly above.
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>
    expect(scripts["test:protections"], "no `test:protections` script for the CI job").toBeTruthy()
    expect(
      scripts["test:protections"],
      "`test:protections` does not run the protections tests, so the CI job proves nothing",
    ).toMatch(/tests\/protections/)
  })

  it("pg/the-driver-is-a-runtime-dependency — `pg` is not a devDependency the instance would not get", () => {
    // It was a devDependency while it belonged to the DBQ spike, which was
    // right. It is now the store's driver, and `npm ci --omit=dev` on a
    // deployment would leave the instance unable to reach its own library.
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.["pg"], "`pg` is not a runtime dependency").toBeTruthy()
    expect(pkg.devDependencies?.["pg"], "`pg` is still a devDependency").toBeUndefined()
  })

  it("ci/every-declared-test-script-runs-in-a-named-job", () => {
    // Read the list off `package.json` rather than writing it here. A suite that
    // gets an npm script and no job is not unrun — `quality` runs every test —
    // but it reaches CI only inside the `container` job, so its failure reports
    // as a container failure, and a check with no name of its own cannot be
    // listed under branch protection. Both are how a suite stops being looked at.
    //
    // This guard found two gaps older than itself when it was added for
    // `slice5`: `slice3` and `slice4` had scripts and no job.
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>
    const declared = Object.keys(scripts).filter((n) => n.startsWith("test:") && n !== "test:watch")
    expect(declared.length, "no test script is declared at all").toBeGreaterThan(0)

    const runsAnywhere = Object.values(workflow.jobs)
      .flatMap((j) => j.steps ?? [])
      .map((st) => st.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    for (const script of declared) {
      expect(runsAnywhere, `\`${script}\` is declared and no CI job runs it`).toContain(
        `npm run ${script}`,
      )
    }
  })

  it("ci/merge-gate-job-cannot-be-silently-skipped — the merge check runs, and only where it can", () => {
    // CFV1-BASE. What the merge gate DOES is proved by running it against real
    // repositories in `tests/base/merge-gate.test.ts`, including both measured
    // incidents. This case is narrower and says so: it guards the WIRING, which
    // exercising the module cannot reach, against the one failure mode #37
    // already demonstrated — a job that skips reports success, so a disabled
    // check and a passing check look identical on a pull request.
    const carries = (j: { steps?: Array<Record<string, unknown>> }) =>
      (j.steps ?? []).some((st) => typeof st.run === "string" && /merge-gate\.ts/.test(st.run))
    const entry = Object.entries(workflow.jobs).find(([, j]) => carries(j))
    expect(entry, "no CI job runs the merge gate").toBeTruthy()
    // The NAME is load-bearing, unusually for a job. Branch protection lists a
    // required status check by name, so renaming this job does not break the
    // build — it silently stops the protection matching anything, and pull
    // requests merge without the check they are supposed to be waiting for.
    // Found by mutation: every other assertion here locates the job by what it
    // RUNS, so a rename passed them all.
    expect(entry?.[0], "the merge-gate job was renamed; branch protection names it").toBe(
      "merge-gate",
    )
    const [jobName, job] = entry as [
      string,
      { steps?: Array<Record<string, unknown>>; if?: unknown; "continue-on-error"?: unknown },
    ]
    const steps = job.steps ?? []
    const step = steps.find(
      (st) => typeof st.run === "string" && /merge-gate\.ts/.test(st.run),
    ) as Record<string, unknown>

    expect(
      step["continue-on-error"] ?? false,
      `the merge-gate step in \`${jobName}\` may fail without failing the build`,
    ).toBe(false)
    expect(
      job["continue-on-error"] ?? false,
      `the \`${jobName}\` job may fail without failing the build`,
    ).toBe(false)
    expect(step["if"], `the merge-gate step in \`${jobName}\` is conditional`).toBeUndefined()

    // The JOB is conditional, and that condition is load-bearing rather than a
    // switch: the check reads `pull_request` context a push to main does not
    // have. Pinning it to exactly that still lets `if: false` — the mutation
    // that got past #37 — turn this red.
    expect(job["if"], `the \`${jobName}\` job's condition is not the event guard`).toBe(
      "github.event_name == 'pull_request'",
    )

    // It computes the merge itself, which needs history. A shallow checkout
    // would make the merge impossible, and the failure would look like the
    // repository's rather than the checkout's.
    const checkout = steps.find(
      (st) => typeof st.uses === "string" && st.uses.startsWith("actions/checkout"),
    ) as { with?: Record<string, unknown> } | undefined
    expect(checkout?.with?.["fetch-depth"], `\`${jobName}\` checks out without full history`).toBe(
      0,
    )

    // And the base is fetched at run time. Reading the ref GitHub computed when
    // the PR was last pushed is the staleness this item exists to close.
    expect(
      steps.some((st) => typeof st.run === "string" && /git fetch .*origin/.test(st.run)),
      `\`${jobName}\` never fetches the current base tip`,
    ).toBe(true)
  })

  it("slice0/secret-scan-accepts-only-pinned-findings", () => {
    // `.gitleaksignore` is where an accepted finding is recorded, and it is one
    // edit away from becoming an allowlist. A fingerprint names ONE finding in
    // ONE commit: the same string on another line, in another file or in a later
    // commit has a different fingerprint and still fails. A bare path or a
    // regex would silently cover everything that comes after it, which is how a
    // secret scan stops being one.
    //
    // Checked by measurement, not by reading: both shapes were planted against
    // the real gitleaks with this file in place — the same string moved to
    // another file, and the same string back in its own file on a new line —
    // and both were still refused.
    if (!existsSync(join(repoRoot, ".gitleaksignore"))) return
    const lines = read(".gitleaksignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
    expect(lines.length, "the file exists and pins nothing").toBeGreaterThan(0)
    for (const line of lines) {
      expect(
        line,
        `\`${line}\` is not a pinned finding — a fingerprint is <sha>:<path>:<rule>:<line>`,
      ).toMatch(/^[0-9a-f]{40}:[^:]+:[^:]+:\d+$/)
    }
  })

  it("slice0/secret-scan-fails-build — a secret scan runs and blocks on a finding", () => {
    const scanJob = workflow.jobs["secret-scan"]
    expect(scanJob).toBeTruthy()
    const usesGitleaks = (scanJob?.steps ?? []).some(
      (s) => typeof s.uses === "string" && /gitleaks/i.test(s.uses),
    )
    expect(usesGitleaks).toBe(true)
    const blocks = (scanJob?.steps ?? []).every((s) => s["continue-on-error"] !== true)
    expect(blocks).toBe(true)
  })

  it("slice0/no-deploy-from-fork-prs — no deploy step anywhere, and no pull_request_target", () => {
    // pull_request_target would run fork PRs with our secrets and write token.
    expect(Object.keys(workflow.on)).not.toContain("pull_request_target")

    // A deploy can hide in a step inside an innocently-named job, not only in a
    // job called "deploy" — so scan every step's `uses` and `run`, not just job
    // names (the spec's Hint warns this is easy to reintroduce). `docker build`
    // and `docker run` are NOT deploys; `docker push` and *-push-action are.
    const deployUses =
      /deploy|-push-action|pages.*deploy|\bpublish\b|aws-actions|wrangler|netlify|vercel|flyctl|railway/i
    const deployRun =
      /\b(npm|pnpm|yarn)\s+publish\b|docker\s+push\b|\bgh\s+release\s+create\b|netlify\s+deploy\b|\bvercel\b|wrangler\s+(deploy|publish)\b|aws\s+s3\s+sync\b|flyctl\s+deploy\b|railway\s+up\b|terraform\s+apply\b/i

    const offenders: string[] = []
    for (const [job, def] of Object.entries(workflow.jobs)) {
      if (/deploy|publish|release/i.test(job)) offenders.push(`job:${job}`)
      for (const step of def.steps ?? []) {
        const uses = typeof step.uses === "string" ? step.uses : ""
        const run = typeof step.run === "string" ? step.run : ""
        if (uses && deployUses.test(uses)) offenders.push(`${job}:uses:${uses}`)
        if (run && deployRun.test(run)) offenders.push(`${job}:run`)
      }
    }
    expect(offenders, `deploy-like job/step found: ${offenders.join(", ")}`).toHaveLength(0)
  })
})

describe("slice0/no-monorepo-tooling", () => {
  it("no workspaces field and no monorepo config files", () => {
    const pkg = JSON.parse(read("package.json")) as Record<string, unknown>
    expect("workspaces" in pkg).toBe(false)
    for (const f of ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json", "rush.json"]) {
      expect(existsSync(join(repoRoot, f)), f).toBe(false)
    }
  })
})

describe("slice0/private-fixtures-ignored", () => {
  it("evals/fixtures/private/ is git-ignored", () => {
    const gitignore = read(".gitignore")
    expect(gitignore).toMatch(/evals\/fixtures\/private/)
  })
})

describe("slice0/schema-single-source-of-truth", () => {
  it("only schema/ declares the contract shape; no second copy in product code", () => {
    // The contract shape is declared with Zod object schemas. Assert no such
    // declaration lives in product code or the harness outside schema/ (tests
    // legitimately import the schema; fixtures are data, not shape).
    const declarers: string[] = []
    for (const dir of ["src", "evals"]) {
      const base = join(repoRoot, dir)
      if (!existsSync(base)) continue
      for (const file of walk(base)) {
        if (!file.endsWith(".ts")) continue
        if (/z\s*\.\s*object\s*\(/.test(readFileSync(file, "utf8"))) {
          declarers.push(relative(repoRoot, file))
        }
      }
    }
    expect(
      declarers,
      `contract shape declared outside schema/: ${declarers.join(", ")}`,
    ).toHaveLength(0)
  })
})

describe("slice0/container-builds-and-runs", () => {
  it("a Dockerfile pins Node 22 and installs dependencies for the documented commands", () => {
    const dockerfile = read("Dockerfile")
    expect(dockerfile).toMatch(/FROM\s+node:22/)
    expect(dockerfile).toMatch(/npm ci/)
  })

  it("CI actually builds the image and runs the quality gate inside it", () => {
    const workflow = parseYaml(read(".github", "workflows", "ci.yml")) as {
      jobs: Record<string, { steps?: Array<Record<string, unknown>> }>
    }
    const container = workflow.jobs["container"]
    expect(container, "no container job in ci.yml").toBeTruthy()
    const runs = (container?.steps ?? [])
      .map((s) => s.run)
      .filter((r): r is string => typeof r === "string")
      .join("\n")
    expect(runs, "container job does not build the image").toMatch(/docker build/)
    expect(runs, "container job does not run the quality gate").toMatch(
      /docker run .*npm run quality/,
    )
  })

  it("ci/gitleaks-ignores-are-pinned-to-one-commit", () => {
    // `.gitleaksignore` silences findings the secret scanner reported. It is the
    // one mechanism in this repository that can make a security check quieter,
    // so what it is ALLOWED to say is checked here rather than left to whoever
    // is unblocking a pull request at the time.
    //
    // Only a FINGERPRINT is admitted: `<40-hex commit>:<path>:<rule>:<line>`.
    // That pins each entry to one line of one file in one commit, so it cannot
    // hide a finding anywhere else, including in a commit that does not exist
    // yet. The entry this guard exists to refuse is the convenient one — a bare
    // path or glob such as `tests/**`, which silences the rule forever and
    // everywhere, and reads in a diff exactly like the narrow kind.
    //
    // Absent file is fine: nothing silenced is the best state.
    let text: string
    try {
      text = read(".gitleaksignore")
    } catch {
      return
    }

    const entries = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))

    const fingerprint = /^[0-9a-f]{40}:[^:]+:[^:]+:\d+$/
    for (const entry of entries) {
      expect(
        entry,
        `.gitleaksignore entry is not pinned to a single commit, file and line: ${entry}`,
      ).toMatch(fingerprint)
    }
  })
})

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
