/**
 * CFV1-BASE — a merge is decided against its RESULT, not against the base the
 * change was branched from.
 *
 * These build real git repositories in a temp directory and run the real
 * `runMergeGate` against them. Nothing here inspects a workflow file: a test
 * that reads `ci.yml` and finds the right words checks a SPELLING, and both
 * measured incidents were pairs of changes whose spelling was impeccable. What
 * has to be proved is that a red merge result is refused, so the proof has to
 * produce a red merge result.
 *
 * The two fixtures are the two measured incidents, kept deliberately different:
 *
 *  - `typecheck` — `#30` implemented five repository operations while `#31`
 *    widened the interface to six. The merge result does not compile.
 *  - `test-premise` — `#28` added proofs resting on the contract admitting a
 *    value while `#34` made the contract reject it. The merge result COMPILES
 *    and its tests die.
 *
 * A mechanism that catches only the first looks exactly like one that works,
 * which is why the second is here. Neither fixture has a file in common between
 * its two sides, because neither incident did: git merges both silently.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { declaredGateCommand, runMergeGate } from "../../scripts/merge-gate.js"

/**
 * How long these proofs are allowed to take, and why that number.
 *
 * Every proof below builds a real git repository and runs a real subprocess
 * gate against it. That cost is the subject, not setup: the file's opening
 * comment says why a proof that reads `ci.yml` would check a spelling instead.
 * So the bound has to fit the work rather than the work fit the bound.
 *
 * On 2026-09-22 one of these went red in the gate at 6173 ms against vitest's
 * built-in 5000 ms, passed five times out of five in isolation, and was green
 * on the next full run. Nothing in this repository had ever declared a timeout
 * for it: 5000 ms was a default nobody measured. This is what it costs,
 * measured on a four-core container under Node 26.10.0, worst of each set, for
 * the slowest proof in the file:
 *
 *   5 runs of this file alone ................................  907 ms
 *   3 runs inside the full suite (69 files in parallel) .......  859 ms
 *   1 run against  4 competing busy processes ................. 1504 ms
 *   1 run against  8 .......................................... 1715 ms
 *   1 run against 16 .......................................... 2473 ms
 *   1 run against 32 .......................................... 4821 ms  <- 179 ms under the old bound
 *   1 run against 48 .......................................... 6231 ms  <- two proofs past it
 *
 * The suite's own parallelism costs this file almost nothing; what stretches it
 * is the machine being oversubscribed, which is the one thing a shared runner
 * does and the one thing that is unknowable after the fact. At roughly twelve
 * times oversubscription the cost reproduces the reported 6173 ms on demand, so
 * that red was never a flake — it was this measurement, taken by accident.
 *
 * The bound is therefore the worst cost measured at the contention that
 * reproduces the incident, times five. Stated as a multiple rather than as a
 * bare number so that a later red can be read: if it is under this, the work
 * grew or the machine was worse than any of the rows above; if it is far under,
 * the proof broke.
 *
 * It is file-scoped and deliberately not a suite-wide default. A number raised
 * everywhere hides the proofs that are slow because they are doing something
 * wrong. It is also one bound for all of them rather than a number per proof:
 * at 48 competing processes the five slowest here measured 6231, 5319, 4228,
 * 3640 and 3508 ms, one band with no outlier, so a per-proof figure would be
 * precision this measurement does not have.
 *
 * WHAT THIS DOES NOT DO. Nothing holds this number in place. Delete the call
 * below and the bound silently reverts to the same guessed default that caused
 * the incident, with every proof still green.
 */
const MEASURED_WORST_UNDER_CONTENTION_MS = 6231
const HEADROOM = 5
vi.setConfig({ testTimeout: MEASURED_WORST_UNDER_CONTENTION_MS * HEADROOM })

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const run = (cwd: string, cmd: string, ...args: string[]): void => {
  execFileSync(cmd, args, { cwd, stdio: "ignore" })
}

/**
 * A repository with `main`, plus two branches that touch no file in common.
 *
 * `gate` is whatever the fixture declares as its `quality` script — the module
 * under test must read it from there rather than knowing a command of its own.
 */
function fixture(options: {
  readonly gate: string
  readonly mainFiles: Readonly<Record<string, string>>
  readonly sideA: Readonly<Record<string, string>>
  readonly sideB: Readonly<Record<string, string>>
}): string {
  const dir = mkdtempSync(join(tmpdir(), "base-fixture-"))
  made.push(dir)
  const write = (files: Readonly<Record<string, string>>): void => {
    for (const [name, body] of Object.entries(files)) {
      const path = join(dir, name)
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, body)
    }
  }
  run(dir, "git", "init", "-q", "-b", "main")
  // An identity, because the fixture has to build its own history. It is not
  // modelling anything about a CI checkout: the committer-identity failure this
  // once claimed to cover was never reproducible, and the test that claimed it
  // was deleted for passing with and without its own fix.
  run(dir, "git", "config", "user.email", "fixture@example.invalid")
  run(dir, "git", "config", "user.name", "Fixture")
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts: { quality: options.gate } }, null, 2),
  )
  write(options.mainFiles)
  run(dir, "git", "add", "-A")
  run(dir, "git", "commit", "-qm", "main")

  run(dir, "git", "checkout", "-qb", "side-a")
  write(options.sideA)
  run(dir, "git", "add", "-A")
  run(dir, "git", "commit", "-qm", "side A")

  run(dir, "git", "checkout", "-q", "main")
  run(dir, "git", "checkout", "-qb", "side-b")
  write(options.sideB)
  run(dir, "git", "add", "-A")
  run(dir, "git", "commit", "-qm", "side B")
  run(dir, "git", "checkout", "-q", "main")
  // Side A lands first, exactly as in both incidents: each side was green
  // against a base that did not yet contain the other.
  run(dir, "git", "merge", "-q", "--no-ff", "--no-edit", "side-a")
  return dir
}

/**
 * A shell command that touches `path`, and nothing else.
 *
 * Its own helper because the obvious inline version nests double quotes inside
 * double quotes, and the shell then ends the argument early — a silent no-op
 * that leaves the marker unwritten and the proof passing for the wrong reason.
 */
const touching = (path: string): string =>
  `node -e 'require("fs").writeFileSync(process.argv[1], "yes")' ${JSON.stringify(path)}`

/** The typecheck incident: a new store implements five against an interface widened to six. */
const typecheckIncident = () =>
  fixture({
    // `node --check` stands in for `tsc`: a real compiler in a fixture would
    // make the proof about toolchain installation rather than about the
    // mechanism. What matters is that the gate is a command the repo declares
    // and that it goes red on the merge result only.
    gate: "node contract-check.mjs",
    mainFiles: {
      // The contract, and the one store that satisfies it. The check reads
      // EVERY store on disk, which is what makes a store added on one branch
      // meet a contract widened on another.
      "contract-check.mjs":
        "import { readdirSync } from 'node:fs';\n" +
        "const required = ['read', 'write', 'list'];\n" +
        "for (const f of readdirSync('.').filter((f) => f.startsWith('store-'))) {\n" +
        "  const { ops } = await import('./' + f);\n" +
        "  const missing = required.filter((o) => !ops.includes(o));\n" +
        "  if (missing.length > 0) {\n" +
        "    console.error('TS2741: ' + f + ' is missing ' + missing.join(', '));\n" +
        "    process.exit(1);\n" +
        "  }\n" +
        "}\n",
      "store-main.mjs": "export const ops = ['read', 'write', 'list'];\n",
    },
    // Side A adds a second store implementing the contract AS IT STANDS. Green.
    sideA: { "store-dbq.mjs": "export const ops = ['read', 'write', 'list'];\n" },
    // Side B widens the contract and updates the store that exists when it is
    // written. Green too — `store-dbq.mjs` is not on its base. No file in common.
    sideB: {
      "contract-check.mjs":
        "import { readdirSync } from 'node:fs';\n" +
        "const required = ['read', 'write', 'list', 'reprocess'];\n" +
        "for (const f of readdirSync('.').filter((f) => f.startsWith('store-'))) {\n" +
        "  const { ops } = await import('./' + f);\n" +
        "  const missing = required.filter((o) => !ops.includes(o));\n" +
        "  if (missing.length > 0) {\n" +
        "    console.error('TS2741: ' + f + ' is missing ' + missing.join(', '));\n" +
        "    process.exit(1);\n" +
        "  }\n" +
        "}\n",
      "store-main.mjs": "export const ops = ['read', 'write', 'list', 'reprocess'];\n",
    },
  })

/** The test-premise incident: the merge result COMPILES and its tests die. */
const testPremiseIncident = () =>
  fixture({
    gate: "node --check contract.mjs && node --check suite.mjs && node suite.mjs",
    mainFiles: {
      "contract.mjs": "export const accepts = (n) => typeof n === 'number';\n",
      "suite.mjs": "process.exit(0);\n",
    },
    // Side A: a suite whose proofs rest on the contract admitting Infinity.
    sideA: {
      "suite.mjs":
        "import { accepts } from './contract.mjs';\n" +
        "if (!accepts(Infinity)) { console.error('construction failed: Infinity rejected'); process.exit(1); }\n",
    },
    // Side B: the contract now rejects it. Different file; both sides parse.
    sideB: {
      "contract.mjs":
        "export const accepts = (n) => typeof n === 'number' && Number.isFinite(n);\n",
    },
  })

const gateOn = (dir: string) =>
  runMergeGate({
    repoDir: dir,
    base: "main",
    head: "side-b",
    baseLabel: "main (with #A already landed)",
    headLabel: "PR #B",
  })

describe("base/semantic-conflict-is-refused", () => {
  it.each([
    ["a merge result that does not compile", typecheckIncident],
    ["a merge result that compiles and fails its tests", testPremiseIncident],
  ])("refuses %s, though neither side is red alone", (_what, build) => {
    const dir = build()

    // First: each side really is green on its own, or the fixture proves
    // nothing — a mechanism that refuses everything would also pass this test.
    for (const side of ["side-a", "side-b"]) {
      run(dir, "git", "checkout", "-q", side)
      expect(
        () => execFileSync(declaredGateCommand(dir), { cwd: dir, shell: true, stdio: "ignore" }),
        `${side} is not green on its own, so this fixture does not reproduce the incident`,
      ).not.toThrow()
    }
    run(dir, "git", "checkout", "-q", "main")

    // And the merge of the two is refused.
    const result = gateOn(dir)
    expect(result.outcome, "a red merge result was allowed to land").toBe("red")
    expect(result.exitCode).not.toBe(0)
    expect(result.gateRan).toBe(true)
  })

  it("notices although the two changes share no file, so nothing conflicts", () => {
    // Both incidents merged cleanly. A mechanism that leans on git reporting a
    // conflict would have caught neither.
    //
    // The two assertions below once ran the gate twice over the same fixture,
    // which cost a second real merge and subprocess run — 777 ms down to 609 ms
    // median once they shared one result. Setup, not subject: both are claims
    // about the same outcome.
    const dir = typecheckIncident()
    const changed = (ref: string): string[] =>
      execFileSync("git", ["diff", "--name-only", "main..." + ref], { cwd: dir, encoding: "utf8" })
        .split("\n")
        .filter((l) => l !== "")
    const overlap = changed("side-a").filter((f) => changed("side-b").includes(f))
    expect(overlap, "the fixture's two sides touch a file in common").toEqual([])
    const result = gateOn(dir)
    expect(result.outcome).not.toBe("conflict")
    expect(result.outcome).toBe("red")
  })
})

describe("base/refusal-names-both-sides", () => {
  it("names both changes, not only the failing check", () => {
    // "typecheck failed" sends the reader to the head's own diff, where there is
    // nothing wrong: the failure belongs to the PAIR. The first incident cost
    // a repair PR partly because the report named one side.
    const result = gateOn(typecheckIncident())
    expect(result.summary).toContain("PR #B")
    expect(result.summary).toContain("main (with #A already landed)")
    // And it says the thing a reader would otherwise disbelieve.
    expect(result.summary).toMatch(/each is green on its own/)
  })
})

describe("base/green-merge-is-not-slowed", () => {
  it("lets a green merge result through", () => {
    const dir = fixture({
      gate: "node --check a.js && node --check b.js",
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = gateOn(dir)
    expect(result.outcome, result.summary).toBe("green")
    expect(result.exitCode).toBe(0)
  })

  it("lets a green merge result through even when the gate is loud", () => {
    // `execFileSync` with piped stdio inherits Node's 1 MB default and THROWS
    // past it, and that throw lands in the same catch as a failing gate. So a
    // green gate that talks a lot came back as a refusal naming both sides —
    // a rejection manufactured out of an output size, indistinguishable in the
    // log from a real semantic conflict. Measured at 2 MB before the budget was
    // made explicit; kept here because the default is invisible until it bites.
    const dir = fixture({
      gate: `node --check a.js && node -e "process.stdout.write('x'.repeat(2*1024*1024))"`,
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = gateOn(dir)
    expect(result.outcome, result.summary.slice(0, 200)).toBe("green")
    expect(result.exitCode).toBe(0)
  })

  it("does not run the gate again when the head already contains the base", () => {
    // Every merge now pays for a full gate run, so a redundant one is a real
    // cost. When the head already contains the base the merge result IS the
    // head's tree, which the head's own run already measured.
    const dir = fixture({
      gate: "node --check a.js && node --check b.js",
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    run(dir, "git", "checkout", "-q", "side-b")
    run(dir, "git", "merge", "-q", "--no-ff", "--no-edit", "main")
    run(dir, "git", "checkout", "-q", "main")

    const result = gateOn(dir)
    expect(result.outcome).toBe("already-current")
    expect(result.gateRan, "the gate was run a second time on an unchanged tree").toBe(false)
    expect(result.exitCode).toBe(0)
  })
})

describe("base/one-definition-of-the-gate", () => {
  it("runs the command the repository declares, not one of its own", () => {
    // A second definition of green is a second thing to keep in step, and the
    // copy is what drifts. Proved by declaring a gate that could not be guessed:
    // if the module carried its own command, this fixture would pass.
    const marker = join(mkdtempSync(join(tmpdir(), "base-marker-")), "ran")
    made.push(join(marker, ".."))
    const dir = fixture({
      gate: `${touching(marker)} && exit 3`,
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = gateOn(dir)
    expect(result.gateCommand, "the declared command was not the one reported").toContain("exit 3")
    // It really EXECUTED that command — asserted, not assumed. Without this the
    // case would pass on `exit 3` alone, whether or not the declared command
    // ever ran, which is the shape of proof this project keeps finding.
    expect(existsSync(marker), "the declared gate command never ran").toBe(true)
    expect(result.outcome).toBe("red")
  })

  it("runs the gate the MERGE RESULT declares, not the caller's", () => {
    // Found at review, reproduced before being fixed. The tree was recomputed
    // at check time and the DEFINITION OF GREEN was not: `quality` was read
    // from the caller's checkout and then run against the merge worktree. So a
    // change that strengthens the gate — the shape of any pull request adding a
    // check, and `#37` did exactly that to this repository — was measured by
    // the weaker rule it was replacing.
    //
    // The case above cannot see this: it declares the same `quality` in the
    // caller's tree and on both sides, which makes "read from the repository"
    // and "read from the tree being measured" indistinguishable. It guards the
    // neighbouring claim, not the rule.
    const dir = mkdtempSync(join(tmpdir(), "base-which-tree-"))
    made.push(dir)
    const callerGate = join(dir, "caller-gate-ran")
    const resultGate = join(dir, "result-gate-ran")
    const built = fixture({
      // `main`'s gate: green on anything, and leaves a trace if it ever runs.
      gate: touching(callerGate),
      mainFiles: { "a.js": "export const a = 1;\n" },
      // Side A adds a store. Green under `main`'s gate, and lands first.
      sideA: { "new-store.js": "export const s = 1;\n" },
      // Side B strengthens the gate and adds the check it declares. Green on
      // its own base, which does not carry `new-store.js` yet.
      sideB: {
        "package.json": `${JSON.stringify(
          {
            name: "fixture",
            private: true,
            scripts: { quality: `${touching(resultGate)} && node check.mjs` },
          },
          null,
          2,
        )}\n`,
        "check.mjs":
          "import { existsSync } from 'node:fs';\n" +
          "if (existsSync('new-store.js')) {\n" +
          "  console.error('new-store.js does not satisfy the new check');\n" +
          "  process.exit(1);\n" +
          "}\n",
      },
    })

    // Both sides green alone, or this fixture reproduces nothing.
    for (const side of ["side-a", "side-b"]) {
      run(built, "git", "checkout", "-q", side)
      expect(
        () =>
          execFileSync(declaredGateCommand(built), { cwd: built, shell: true, stdio: "ignore" }),
        `${side} is not green on its own`,
      ).not.toThrow()
    }
    run(built, "git", "checkout", "-q", "main")
    rmSync(callerGate, { force: true })
    rmSync(resultGate, { force: true })

    const result = gateOn(built)
    expect(existsSync(resultGate), "the merge result's own gate never ran").toBe(true)
    expect(existsSync(callerGate), "the caller's weaker gate ran instead").toBe(false)
    expect(result.gateCommand, "the command reported was not the merge result's").toContain(
      "check.mjs",
    )
    expect(result.outcome, "a merge result red under its OWN gate was reported green").toBe("red")
  })

  it("refuses to invent a gate when the repository declares none", () => {
    // Failing closed. A module that quietly substituted a plausible command
    // would report green for a repository that defines no green at all.
    const dir = mkdtempSync(join(tmpdir(), "base-nogate-"))
    made.push(dir)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }))
    expect(() => declaredGateCommand(dir)).toThrow(/no .?quality.? script/)
  })
})

describe("base/dependencies-come-from-the-merge-result", () => {
  it("installs from the merge result's own lockfile, not the caller's tree", () => {
    // A fresh worktree has no `node_modules` and the gate cannot run without
    // one. Borrowing the caller's would hide the case where the two sides
    // disagree about a dependency — which is one of the things this check
    // exists to find, not a detail to work around.
    const marker = join(mkdtempSync(join(tmpdir(), "base-install-")), "installed")
    made.push(join(marker, ".."))
    const dir = fixture({
      gate: "node --check a.js && node --check b.js",
      mainFiles: {
        "a.js": "export const a = 1;\n",
        "b.js": "export const b = 1;\n",
        "package-lock.json": '{"name":"fixture","lockfileVersion":3}\n',
      },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = runMergeGate({
      repoDir: dir,
      base: "main",
      head: "side-b",
      installCommand: touching(marker),
    })
    expect(result.installed, "a lockfile was present and nothing was installed").toBe(true)
    expect(existsSync(marker), "the install command never ran in the worktree").toBe(true)
    expect(result.outcome).toBe("green")
  })

  it("skips the install when the merge result has no lockfile", () => {
    const dir = fixture({
      gate: "node --check a.js && node --check b.js",
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = runMergeGate({ repoDir: dir, base: "main", head: "side-b" })
    expect(result.installed).toBe(false)
    expect(result.outcome).toBe("green")
  })

  it("reports a failed install as a disagreement, not as a green run", () => {
    // Failing closed: an install that dies must never leave the gate unrun and
    // the merge looking measured.
    const dir = fixture({
      gate: "node --check a.js && node --check b.js",
      mainFiles: {
        "a.js": "export const a = 1;\n",
        "b.js": "export const b = 1;\n",
        "package-lock.json": '{"name":"fixture","lockfileVersion":3}\n',
      },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = runMergeGate({
      repoDir: dir,
      base: "main",
      head: "side-b",
      installCommand: "exit 7",
    })
    expect(result.exitCode, "a failed install passed as a measured merge").not.toBe(0)
    expect(result.gateRan).toBe(false)
  })
})

describe("base/the-refusal-is-readable", () => {
  it("strips the colour the gate's own tools emit", () => {
    // The refusal is the one artefact a person reads to understand why a merge
    // was stopped. Escape sequences survive into a CI log and a PR comment as
    // noise, so the most important text becomes the least readable.
    const dir = fixture({
      gate: `node -e 'process.stdout.write("\\u001B[31mred text\\u001B[0m"); process.exit(1)'`,
      mainFiles: { "a.js": "export const a = 1;\n", "b.js": "export const b = 1;\n" },
      sideA: { "a.js": "export const a = 2;\n" },
      sideB: { "b.js": "export const b = 2;\n" },
    })
    const result = gateOn(dir)
    expect(result.outcome).toBe("red")
    expect(result.summary, "the gate's output was dropped entirely").toContain("red text")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting none survive is the point
    expect(result.summary, "ANSI escapes survived into the refusal").not.toMatch(/\u001B\[/)
  })
})
