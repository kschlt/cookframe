/**
 * Repository-configuration tests (CFV1-SL0). Each `it` names the acceptance
 * criterion it proves. These assert repository *content* — the files a
 * reviewer can see in the PR. The three GitHub platform settings (push
 * protection, Dependabot, branch protection) and this instance's `commands.*`
 * seams are CFV1-PROT and are deliberately not asserted here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
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
