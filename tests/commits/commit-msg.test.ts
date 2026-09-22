/**
 * CFV1-CCOM at commit time — the proofs for `.githooks/commit-msg`.
 *
 * Three claims, each proved by planting the violation and requiring red at its
 * own assertion:
 *
 * 1. The hook agrees with the `commits` CI job. Every row below is a real git
 *    command run through the real hook: the hook's verdict is compared with the
 *    CI job's verdict on what git actually stores, read back from the commit
 *    (made with `--no-verify` where the hook refused). The rows cover the paths
 *    a message reaches the hook by, cleaned and uncleaned: git cleans a message
 *    it is given before the hook runs, but not what a person typed in an editor.
 * 2. `npm install` and `npm ci` wire it: they run `prepare` from this
 *    repository's `package.json`, and afterwards `core.hooksPath` names
 *    `.githooks`.
 * 3. Wiring it never breaks an install outside a git repository, which is where
 *    both Dockerfiles run `npm ci`.
 *
 * And the hook fails closed: when it cannot judge, it refuses the commit.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { checkRange } from "./conventional-commits.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

/** Only this test's repository: never a parent's config, hooks or identity. */
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CEILING_DIRECTORIES: tmpdir(),
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: gitEnv, encoding: "utf8" }).trim()
}

/**
 * A repository whose `core.hooksPath` is THIS repository's `.githooks`, with
 * this repository's `tests/commits` and `node_modules` linked in where the hook
 * looks for them. The hook, its judge and the rule are the real files.
 */
function hookedRepository(): string {
  const dir = temp("commit-msg-hook-")
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "commit.gpgsign", "false")
  git(dir, "config", "core.hooksPath", join(repoRoot, ".githooks"))
  mkdirSync(join(dir, "tests"))
  symlinkSync(join(repoRoot, "tests", "commits"), join(dir, "tests", "commits"))
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"))
  writeFileSync(join(dir, ".gitignore"), "tests/\nnode_modules\n")
  git(dir, "add", ".gitignore")
  git(dir, "commit", "-q", "--no-verify", "-m", "chore: the base")
  return dir
}

let files = 0
function stage(dir: string): void {
  files += 1
  writeFileSync(join(dir, `f${files}`), `${files}\n`)
  git(dir, "add", `f${files}`)
}

/** A git command whose outcome is the hook's verdict: it exits 0 only if the hook accepted. */
interface Attempt {
  readonly args: readonly string[]
  readonly stdin?: string
  /**
   * What a person types at the top of the editor git opens. git cleans a message
   * it was given before the hook sees it, but not what came back from an editor,
   * so only this reaches the hook with its whitespace and git's comments intact.
   */
  readonly typed?: string
}

/** An editor that puts `TYPED` above whatever git wrote into the file. */
const editor = join(temp("commit-msg-editor-"), "editor.sh")
writeFileSync(editor, `printf '%s' "$TYPED" | cat - "$1" > "$1.typed" && mv "$1.typed" "$1"\n`)

function attempt(dir: string, run: Attempt, verify: boolean) {
  return spawnSync("git", [...run.args, ...(verify ? [] : ["--no-verify"])], {
    cwd: dir,
    env: {
      ...gitEnv,
      GIT_EDITOR: run.typed === undefined ? ":" : `sh ${editor}`,
      TYPED: run.typed ?? "",
    },
    input: run.stdin ?? "",
    encoding: "utf8",
  })
}

/** Whether the `commits` CI job accepts the commit at HEAD, from what git stored. */
function ciAccepts(dir: string): boolean {
  const [parents = "", subject = ""] = git(dir, "log", "-1", "--format=%P%x1f%s").split("\x1f")
  const report = checkRange([{ sha: "HEAD", parents: parents.split(" "), subject }])
  return report.violations.length === 0
}

const x = (n: number) => "x".repeat(n)
const at100 = `docs(readme): ${x(100 - "docs(readme): ".length)}`

interface Row {
  readonly name: string
  /** Makes the repository ready: stages a change, or opens a side branch to merge. */
  readonly setup: (dir: string) => void
  readonly run: Attempt
  readonly accepted: boolean
}

function sideBranch(dir: string): void {
  git(dir, "checkout", "-q", "-b", "side")
  stage(dir)
  git(dir, "commit", "-q", "--no-verify", "-m", "feat: the side branch")
  git(dir, "checkout", "-q", "main")
  stage(dir)
  git(dir, "commit", "-q", "--no-verify", "-m", "feat: main moves on")
}

const rows: readonly Row[] = [
  {
    name: "exactly 100 characters",
    setup: stage,
    run: { args: ["commit", "-q", "-m", at100] },
    accepted: true,
  },
  {
    name: "101 characters",
    setup: stage,
    run: { args: ["commit", "-q", "-m", `${at100}x`] },
    accepted: false,
  },
  {
    name: "101 characters typed in an editor, above `-v`'s comments and diff",
    setup: stage,
    run: { args: ["commit", "-q", "-v"], typed: `${at100}x\n` },
    accepted: false,
  },
  {
    name: "two lines, each short, that git joins into one subject over 100",
    setup: stage,
    run: { args: ["commit", "-q", "-F", "-"], stdin: `docs: ${x(60)}\n${x(60)}\n\nbody\n` },
    accepted: false,
  },
  {
    name: "trailing whitespace typed in an editor, which git strips",
    setup: stage,
    run: { args: ["commit", "-q"], typed: "feat: trailing spaces   \n" },
    accepted: true,
  },
  {
    name: "leading blank lines typed in an editor, which git strips",
    setup: stage,
    run: { args: ["commit", "-q"], typed: "\n\nfeat: after two blank lines\n" },
    accepted: true,
  },
  {
    name: "a prose subject",
    setup: stage,
    run: { args: ["commit", "-q", "-m", "Add the thing"] },
    accepted: false,
  },
  {
    name: "git's own merge text, through the merge editor and its comments",
    setup: sideBranch,
    run: { args: ["merge", "-q", "--no-ff", "--edit", "side"], typed: "" },
    accepted: true,
  },
  {
    name: "a merge whose subject somebody wrote as prose",
    setup: sideBranch,
    run: {
      args: [
        "merge",
        "-q",
        "--no-ff",
        "-m",
        "Merge the side branch, which I wrote by hand",
        "side",
      ],
    },
    accepted: false,
  },
  {
    name: "a merge with a conventional subject",
    setup: sideBranch,
    run: { args: ["merge", "-q", "--no-ff", "-m", "chore: merge side into main", "side"] },
    accepted: true,
  },
  {
    name: "one parent that only reads like a merge",
    setup: stage,
    run: { args: ["commit", "-q", "-m", "Merge branch 'side' into main"] },
    accepted: false,
  },
]

type Verdict = "accepted" | "refused"

/** One row run for real: what the hook did, and what the CI job says about what git stored. */
function observe(row: Row) {
  const dir = hookedRepository()
  row.setup(dir)
  const before = git(dir, "rev-parse", "HEAD")
  const hooked = attempt(dir, row.run, true)
  const hook: Verdict = hooked.status === 0 ? "accepted" : "refused"
  // Refused means the commit does not exist, not that it exists and was complained about.
  const committed = git(dir, "rev-parse", "HEAD") !== before
  const said = hooked.stderr.split("\n").find((line) => line.startsWith("commit-msg:")) ?? null
  if (hook === "refused") {
    if (row.run.args[0] === "merge") git(dir, "merge", "--abort")
    const stored = attempt(dir, row.run, false)
    if (stored.status !== 0)
      throw new Error(`${row.name}: git refused it without the hook too: ${stored.stderr}`)
  }
  const ci: Verdict = ciAccepts(dir) ? "accepted" : "refused"
  return { row: row.name, hook, committed, said, ci }
}

describe("commits/commit-msg-hook-agrees-with-ci", () => {
  // One case over the whole table, so every row is judged and a disagreement names its row.
  it("the hook and the CI job reach the same verdict on every row, from what git stored", () => {
    const expected = rows.map((row) => {
      const verdict: Verdict = row.accepted ? "accepted" : "refused"
      return {
        row: row.name,
        hook: verdict,
        committed: row.accepted,
        said: row.accepted ? null : expect.stringMatching(/^commit-msg: refused, /),
        ci: verdict,
      }
    })
    expect(rows.map(observe)).toEqual(expected)
  }, 60_000)
})

describe("commits/commit-msg-hook-fails-closed", () => {
  it("without node_modules it refuses the commit and says to install, rather than letting it through", () => {
    const dir = hookedRepository()
    rmSync(join(dir, "node_modules"))
    stage(dir)
    const before = git(dir, "rev-parse", "HEAD")

    const hooked = attempt(
      dir,
      { args: ["commit", "-q", "-m", "feat: a conforming subject"] },
      true,
    )
    expect(hooked.status, "the hook let a commit through without judging it").not.toBe(0)
    expect(hooked.stderr).toContain("run `npm ci`")
    expect(git(dir, "rev-parse", "HEAD")).toBe(before)
  })
})

/** A package with no dependencies and this repository's own `prepare`, so npm runs it offline. */
function packageWithRealPrepare(dir: string): void {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  const prepare = pkg.scripts?.prepare
  expect(prepare, "package.json has no `prepare`, so nothing wires the hook").toBeTruthy()
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "wiring-fixture",
      version: "0.0.0",
      private: true,
      scripts: { prepare },
    }),
  )
}

function npm(dir: string, ...args: string[]) {
  return spawnSync("npm", [...args, "--offline", "--no-audit", "--no-fund"], {
    cwd: dir,
    env: gitEnv,
    encoding: "utf8",
  })
}

describe("commits/npm-install-wires-the-hook", () => {
  it("`npm install` and `npm ci` both point core.hooksPath at .githooks", () => {
    const dir = temp("commit-msg-wiring-")
    git(dir, "init", "-q", "-b", "main")
    packageWithRealPrepare(dir)

    const install = npm(dir, "install")
    expect(install.status, install.stderr).toBe(0)
    expect(git(dir, "config", "--get", "core.hooksPath")).toBe(".githooks")

    git(dir, "config", "--unset", "core.hooksPath")
    const ci = npm(dir, "ci")
    expect(ci.status, ci.stderr).toBe(0)
    expect(git(dir, "config", "--get", "core.hooksPath")).toBe(".githooks")
  }, 60_000)

  it("an install outside any git repository still succeeds, as both Dockerfiles need", () => {
    const dir = temp("commit-msg-no-git-")
    packageWithRealPrepare(dir)
    expect(spawnSync("git", ["rev-parse", "--git-dir"], { cwd: dir, env: gitEnv }).status).not.toBe(
      0,
    )

    const install = npm(dir, "install")
    expect(install.status, install.stderr).toBe(0)
  }, 60_000)
})
