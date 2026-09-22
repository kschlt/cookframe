/**
 * CFV1-SL6 — when a plan is generated (`PDR-0004`, `ADR-0008`).
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * The three criteria about what must NOT happen — no generation inside an
 * import, no policy that blocks the hand-off, no job mechanism — are proven on
 * the shape of the tree rather than on one run, for the reason Slice 2 gives
 * for its own structural proofs: a test that imports one recipe and finds no
 * plan says nothing about the next caller. A test showing the import path has
 * no door to plan generation says something about every caller. Imports are
 * read with the TypeScript compiler's own pre-processor, because a hand-rolled
 * pattern already had a hole in this repository that a multi-line import walked
 * through (`tests/slice2/render.test.ts`).
 *
 * The seam's half of `slice6/incomplete-generation-degrades-to-lazy` is here;
 * the request-level half lands with the cooking route.
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  cookingViewMustDerive,
  DEFAULT_PLAN_GENERATION_POLICY,
  importGeneratesPlan,
  PLAN_GENERATION_POLICIES,
  PLAN_GENERATION_POLICY_ENV,
  readPlanGenerationPolicy,
} from "../../src/cooking/index.js"
import { repoRoot } from "./fixtures.js"

const srcDir = join(repoRoot, "src")

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return tsFilesUnder(full)
    return entry.isFile() && entry.name.endsWith(".ts") ? [full] : []
  })

const importsOf = (file: string): string[] =>
  ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((i) => i.fileName)

describe("slice6/generation-follows-configured-policy", () => {
  it("ships lazy as the default, and reads it from nothing configured", () => {
    expect(DEFAULT_PLAN_GENERATION_POLICY).toBe("lazy")
    expect(readPlanGenerationPolicy({})).toBe("lazy")
    expect(readPlanGenerationPolicy({ [PLAN_GENERATION_POLICY_ENV]: "" })).toBe("lazy")
  })

  it("reads each supported value, and supports exactly the two PDR-0004 names", () => {
    expect([...PLAN_GENERATION_POLICIES]).toEqual(["lazy", "background"])
    for (const policy of PLAN_GENERATION_POLICIES) {
      expect(readPlanGenerationPolicy({ [PLAN_GENERATION_POLICY_ENV]: policy })).toBe(policy)
    }
  })

  it("reports an unrecognised value rather than silently obeying or crashing", () => {
    const seen: string[] = []
    expect(
      readPlanGenerationPolicy({ [PLAN_GENERATION_POLICY_ENV]: "backgroud" }, (v) => seen.push(v)),
    ).toBe("lazy")
    expect(seen).toEqual(["backgroud"])
  })

  it("offers no value that blocks the import request", () => {
    // `PDR-0004`: blocking generation inside the import request is forbidden by
    // the never-block rule and is not a supported value.
    expect([...PLAN_GENERATION_POLICIES]).not.toContain("eager")
    expect(readPlanGenerationPolicy({ [PLAN_GENERATION_POLICY_ENV]: "eager" })).toBe("lazy")
  })
})

describe("slice6/lazy-default-generates-nothing-at-import", () => {
  it("answers no for every supported policy, not just the default", () => {
    for (const policy of PLAN_GENERATION_POLICIES) {
      expect(importGeneratesPlan(policy)).toBe(false)
    }
  })

  it("gives the import path no way to reach plan generation", () => {
    const cookingModules = tsFilesUnder(join(srcDir, "cooking")).map((f) =>
      f.replace(srcDir, "").replace(/\.ts$/, ""),
    )
    expect(cookingModules.length, "there is no cooking module to be reached").toBeGreaterThan(2)
    for (const file of tsFilesUnder(join(srcDir, "pipeline"))) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} imports plan generation`).not.toMatch(/cooking/)
      }
    }
  })

  it("sees an import of the cooking modules when there is one", () => {
    // Without this the assertion above could be green because the scan is
    // broken rather than because the import path is clean.
    const tmp = join(repoRoot, "node_modules", ".slice6-scan-fixture.ts")
    writeFileSync(
      tmp,
      'import {\n  deriveCookingPlan,\n} from "../src/cooking/index.js"\nexport default deriveCookingPlan\n',
    )
    try {
      expect(importsOf(tmp).some((s) => /cooking/.test(s))).toBe(true)
    } finally {
      rmSync(tmp, { force: true })
    }
  })
})

describe("slice6/no-policy-blocks-import-or-handoff", () => {
  it("keeps the shopping hand-off clear of plan generation too", () => {
    for (const file of tsFilesUnder(join(srcDir, "shopping"))) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} imports plan generation`).not.toMatch(/cooking/)
      }
    }
  })

  it("makes the seam unable to block: it holds no store and no transport", () => {
    for (const file of tsFilesUnder(join(srcDir, "cooking"))) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} reaches outside the canonical and its wording`).toMatch(
          /^(\.\.?\/|node:)/,
        )
        expect(specifier, `${file} reaches persistence`).not.toMatch(/persistence|storage|http/)
      }
    }
  })
})

describe("slice6/no-job-mechanism-introduced", () => {
  /**
   * Each pattern with a line that is the mechanism it stands for, so the sweep
   * below cannot be green because a pattern never matches anything. Checked one
   * at a time rather than against one line carrying several of them: a single
   * planted line satisfies a count while leaving most patterns untested, which
   * is the defect S4's review caught in `admitsToStartNow`.
   */
  const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
    [/\bnew Worker\b/, 'const w = new Worker("./plan-job.js")'],
    [/worker_threads/, 'import { Worker } from "node:worker_threads"'],
    [/child_process/, 'import { fork } from "node:child_process"'],
    [/\bbullmq\b/, 'import { Queue } from "bullmq"'],
    [/\bamqp\b/, 'import amqp from "amqplib"'],
    [/\bsetInterval\b/, "setInterval(() => derivePending(), 60_000)"],
    [/\benqueue\b/, "await enqueue({ recipeId })"],
    [/\bcron\b/, 'cron.schedule("* * * * *", derivePending)'],
  ]

  it("introduces no queue, broker, worker or timer anywhere under src/cooking", () => {
    const files = tsFilesUnder(join(srcDir, "cooking"))
    expect(files.length).toBeGreaterThan(2)
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      for (const [pattern] of FORBIDDEN) {
        expect(pattern.test(source), `${file} matches ${pattern}`).toBe(false)
      }
    }
  })

  it("adds no dependency that is one", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    const names = Object.keys(manifest.dependencies).join(" ")
    for (const queue of ["bullmq", "bee-queue", "agenda", "amqplib", "kafkajs", "ioredis"]) {
      expect(names, `${queue} is a job mechanism`).not.toContain(queue)
    }
  })

  it.each(FORBIDDEN.map(([pattern, planted]) => [String(pattern), pattern, planted] as const))(
    "recognises %s when the mechanism is there",
    (_name, pattern, planted) => {
      expect(pattern.test(planted)).toBe(true)
      // And it is the mechanism being seen, not any line at all.
      expect(pattern.test("const plan = deriveCookingPlan(recipe)")).toBe(false)
    },
  )
})

describe("slice6/incomplete-generation-degrades-to-lazy", () => {
  it("asks the same question under both policies: is there a plan?", () => {
    // `ADR-0008`: a background generation lost to a restart is not an error
    // path, because `background` is an optimisation on top of `lazy` and never
    // a replacement for it. The cooking view therefore derives whenever no
    // stored plan is found, whichever policy is configured.
    for (const policy of PLAN_GENERATION_POLICIES) {
      expect(cookingViewMustDerive(policy, false), `${policy}: a missing plan`).toBe(true)
      expect(cookingViewMustDerive(policy, true), `${policy}: a stored plan`).toBe(false)
    }
  })
})
