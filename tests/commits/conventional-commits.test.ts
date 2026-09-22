/**
 * CFV1-CCOM — the proofs that a pull request's commits are Conventional Commits.
 *
 * Three claims, each proved by planting the violation and requiring red at its
 * own assertion rather than by reading the check and believing it:
 *
 * 1. The subject rule refuses what this repository actually shipped — the
 *    refused rows below are real subjects from `main`, not invented ones — and
 *    the table is held against the wrong implementations it has to be told apart
 *    from, so it cannot shrink to rows every candidate agrees on.
 * 2. The range check reads the WHOLE range. The fixture plants a bad commit that
 *    is reachable only through a merge's second parent, and the collectors a
 *    narrowing would produce (`--first-parent`, `--no-merges`, the last commit
 *    only) are each measured to fail the same assertions the real one passes.
 * 3. The declared exception — merge commits git or GitHub wrote — is measured as
 *    survivors by sha, and each half of it is planted away on its own: a
 *    single-parent commit that only reads like a merge, and a two-parent merge
 *    whose subject somebody wrote, are both refused.
 *
 * The live case reads the pull request's own range and title from the `commits`
 * CI job's environment. It is skipped where that environment is absent — every
 * other job, and `npm run quality` locally — which is honest only because the
 * `commits` job always sets it on a pull request, and
 * `ci/commits-job-checks-the-pull-request` in `tests/unit/repo-config.test.ts`
 * requires that it does.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import {
  COMMIT_TYPES,
  type Commit,
  checkRange,
  checkSubject,
  checkTitle,
  describeViolations,
  isStandardMerge,
  type LiveCheckEnv,
  listCommits,
  listRangeShas,
  liveCheckRequested,
  MAX_SUBJECT_LENGTH,
} from "./conventional-commits.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

describe("commits/subject-rule", () => {
  const MUST_PASS = [
    ...COMMIT_TYPES.map((type) => `${type}: do the thing`),
    // This repository's own recent subjects, as the rule has to keep them valid.
    "build(deps): pin TypeScript to 5.x and ignore its semver-major (ADR-0028)",
    // What Dependabot writes. A capitalised description is not refused: there
    // is no case rule, because this project also writes German.
    "build(deps-dev): Bump the development-dependencies group across 1 directory with 3 updates",
    "fix(import): Rezept ohne Bild nicht mehr abweisen",
    "feat(api)!: drop the first version of the route",
    // Exactly at the limit, so an off-by-one limit is caught.
    `fix: ${"x".repeat(MAX_SUBJECT_LENGTH - "fix: ".length)}`,
  ]

  // Each refused row names why, so a row that fails for a different reason than
  // its own does not count as proving that reason.
  const MUST_FAIL: ReadonlyArray<readonly [string, RegExp]> = [
    // Real subjects from `main`, 2026-09-22 and earlier.
    [
      "Move to zod 4, and port the walks that read a schema's internals",
      /not `type\(scope\): description`/,
    ],
    ["spike(s1): re-score against corrected ground truth", /`spike` is not a commit type/],
    ["probe: remove the measurement workflow, keeping its result", /`probe` is not a commit type/],
    ["review(#22): record the S1 verdict in the repo, price S6 per success", /`review` is not/],
    [
      "CFV1-DBQ: close the three advisories from the second review round",
      /not `type\(scope\): description`/,
    ],
    // Shapes the rule has to refuse on their own.
    ["Feat: add the route", /not `type\(scope\): description`/],
    ["fix:add the route", /not `type\(scope\): description`/],
    ["fix(): add the route", /not `type\(scope\): description`/],
    ["fix: add the route.", /ends with a period/],
    ["fix: add the route ", /whitespace/],
    [`fix: ${"x".repeat(MAX_SUBJECT_LENGTH - "fix: ".length + 1)}`, /over the limit/],
    ["fixup! fix: add the route", /not `type\(scope\): description`/],
    // git's own revert text. The conventional form is `revert: …`.
    ['Revert "feat: add the route"', /not `type\(scope\): description`/],
    // A merge's standard subject is NOT a valid subject. It is exempted only in a
    // range, and only on a commit with two parents — see commits/range-check.
    ["Merge branch 'main' into claude/some-branch", /not `type\(scope\): description`/],
  ]

  it("accepts every conforming subject, and refuses each nonconforming one for its own reason", () => {
    for (const subject of MUST_PASS) {
      const verdict = checkSubject(subject)
      expect(verdict, `"${subject}" should be accepted`).toEqual({ ok: true })
    }
    for (const [subject, why] of MUST_FAIL) {
      const verdict = checkSubject(subject)
      expect(verdict.ok, `"${subject}" should be refused`).toBe(false)
      expect(
        verdict.ok ? "" : verdict.reason,
        `"${subject}" was refused for the wrong reason`,
      ).toMatch(why)
    }
  })

  it("commits/title-has-no-merge-exemption — a title is held to exactly the subject rule", () => {
    // The title becomes a commit subject on `main`, so it must be no looser than
    // any commit. The two standard merge texts are the ones a commit may carry
    // under the exception; as a title each is refused.
    for (const title of [
      "Merge branch 'main' into claude/some-branch",
      "Merge pull request #95 from kschlt/claude/some-branch",
    ]) {
      expect(checkTitle(title).ok, `the title "${title}" was accepted`).toBe(false)
    }
    for (const subject of MUST_PASS) {
      expect(checkTitle(subject), `"${subject}" should be accepted as a title`).toEqual({
        ok: true,
      })
    }
    for (const [subject] of MUST_FAIL) {
      expect(checkTitle(subject).ok, `"${subject}" should be refused as a title`).toBe(false)
    }
  })

  it("commits/subject-table-discriminates — the table tells the rule apart from each wrong rule", () => {
    // A table only pins the rule if some row separates it from each rule it
    // could be narrowed or widened into. Each candidate below is one edit to the
    // real rule; if the table cannot tell a candidate apart, a row that did has
    // been dropped and the table pins nothing about that edit.
    const accepts = (rule: (s: string) => boolean) =>
      MUST_PASS.every((s) => rule(s)) && MUST_FAIL.every(([s]) => !rule(s))
    const real = (s: string) => checkSubject(s).ok
    expect(accepts(real), "the table does not agree with the real rule").toBe(true)

    const header = /^([a-z]+)(?:\(([^()\s][^()]*)\))?(!)?: (.+)$/
    const candidates: ReadonlyArray<readonly [string, (s: string) => boolean]> = [
      [
        "a rule with no type vocabulary",
        (s) => header.test(s) && !s.endsWith(".") && s === s.trim(),
      ],
      ["a rule that also accepts `spike`", (s) => real(s) || /^spike(\(|:)/.test(s)],
      ["a rule with no period check", (s) => real(s) || (real(s.slice(0, -1)) && s.endsWith("."))],
      ["a rule with no length limit", (s) => real(s) || real(s.slice(0, MAX_SUBJECT_LENGTH))],
      ["a rule whose limit is one too short", (s) => real(s) && s.length < MAX_SUBJECT_LENGTH],
      ["a rule that demands a lowercase description", (s) => real(s) && !/: [A-ZÄÖÜ]/.test(s)],
      [
        "a rule that accepts any case of type",
        (s) => real(s) || real(s.replace(/^[A-Z]/, (c) => c.toLowerCase())),
      ],
      ["a rule with no whitespace check", (s) => real(s) || real(s.trim())],
    ]
    for (const [name, candidate] of candidates) {
      expect(accepts(candidate), `the subject table cannot tell the rule apart from ${name}`).toBe(
        false,
      )
    }
  })
})

/** A throwaway repository, built with real git so the collector reads real history. */
function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
}

function commitFile(dir: string, name: string, subject: string): string {
  writeFileSync(join(dir, name), `${subject}\n`)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", subject)
  return git(dir, "rev-parse", "HEAD")
}

interface Fixture {
  readonly dir: string
  readonly base: string
  readonly staleBase: string
  readonly head: string
  readonly sha: Readonly<Record<string, string>>
}

/**
 * main:  c0 ──────────── c1 (prose, on main only)
 *          \               \
 * pr:       p1 ── p2 ── m1 ── m2 ── p3 ── m3
 *             \       /                  /
 * topic:       s1 ───┘       other: o1 ─┘
 *
 * s1 is refused and reachable ONLY through m1's second parent. m1 and m2 carry
 * git's own merge subjects and are the exception. p3 reads like a merge but has
 * one parent; m3 is a real merge with a subject somebody wrote. c1 is on main,
 * so it belongs to the pull request only when the base is stale.
 */
function buildFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "commits-fixture-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "fixture@example.invalid")
  git(dir, "config", "user.name", "Fixture")
  git(dir, "config", "commit.gpgsign", "false")
  const sha: Record<string, string> = {}
  sha.c0 = commitFile(dir, "c0", "chore: the base")

  git(dir, "checkout", "-q", "-b", "pr")
  sha.p1 = commitFile(dir, "p1", "feat: the first conforming commit")
  git(dir, "checkout", "-q", "-b", "topic")
  sha.s1 = commitFile(dir, "s1", "Relicense the side branch in prose")
  git(dir, "checkout", "-q", "pr")
  sha.p2 = commitFile(dir, "p2", "fix: the second conforming commit")
  git(dir, "merge", "-q", "--no-ff", "--no-edit", "topic")
  sha.m1 = git(dir, "rev-parse", "HEAD")

  git(dir, "checkout", "-q", "main")
  sha.c1 = commitFile(dir, "c1", "A prose commit that only main has")
  git(dir, "checkout", "-q", "pr")
  git(dir, "merge", "-q", "--no-ff", "--no-edit", "main")
  sha.m2 = git(dir, "rev-parse", "HEAD")

  sha.p3 = commitFile(dir, "p3", "Merge branch 'topic' into pr")

  git(dir, "checkout", "-q", "-b", "other", sha.c0)
  sha.o1 = commitFile(dir, "o1", "docs: a conforming commit on another branch")
  git(dir, "checkout", "-q", "pr")
  git(dir, "merge", "-q", "--no-ff", "-m", "Merge the other branch, which I wrote by hand", "other")
  sha.m3 = git(dir, "rev-parse", "HEAD")

  return { dir, base: sha.c1, staleBase: sha.c0, head: sha.m3, sha }
}

describe("commits/merge-exemption-is-exact", () => {
  // The exception is where a guard like this goes quietly green, so its breadth
  // is held by a table of its own. A two-parent commit is exempt only with one
  // of git's or GitHub's own texts, spelled exactly; anything a person wrote is
  // judged like any other commit. The first refused row is a real subject from
  // #91, which a merge step written by hand put on a branch twice.
  const two = ["a".repeat(40), "b".repeat(40)]
  const EXEMPT = [
    "Merge branch 'main' into claude/foo",
    "Merge branch 'main'",
    "Merge remote-tracking branch 'origin/main' into claude/foo",
    "Merge branch 'main' of https://github.com/kschlt/cookframe into claude/foo",
    "Merge pull request #95 from kschlt/claude/foo",
  ]
  const NOT_EXEMPT = [
    "Merge main into claude/foo",
    "Merge the other branch, which I wrote by hand",
    "merge branch 'main' into claude/foo",
    "Merge branch 'main' into claude/foo and fix the tests",
    "Merge pull request #95: the title somebody typed",
  ]
  const merge = (subject: string, parents = two): Commit => ({
    sha: "c".repeat(40),
    parents,
    subject,
  })

  it("exempts only the standard texts, and only on a commit with two parents", () => {
    for (const subject of EXEMPT) {
      expect(isStandardMerge(merge(subject)), `"${subject}" on a merge is git's own text`).toBe(
        true,
      )
      expect(
        isStandardMerge(merge(subject, ["a".repeat(40)])),
        `"${subject}" on a single-parent commit was exempted`,
      ).toBe(false)
    }
    for (const subject of NOT_EXEMPT) {
      expect(
        isStandardMerge(merge(subject)),
        `"${subject}" was written by a person and exempted`,
      ).toBe(false)
    }
  })

  it("commits/merge-table-discriminates — the table tells the exemption apart from each looser one", () => {
    const agrees = (rule: (c: Commit) => boolean) =>
      EXEMPT.every((s) => rule(merge(s)) && !rule(merge(s, ["a".repeat(40)]))) &&
      NOT_EXEMPT.every((s) => !rule(merge(s)))
    expect(agrees(isStandardMerge), "the table does not agree with the real exemption").toBe(true)
    const candidates: ReadonlyArray<readonly [string, (c: Commit) => boolean]> = [
      ["an exemption by parent count alone", (c) => c.parents.length >= 2],
      ["an exemption by subject text alone", (c) => isStandardMerge({ ...c, parents: two })],
      [
        "any subject starting with `Merge `",
        (c) => c.parents.length >= 2 && /^Merge /.test(c.subject),
      ],
      [
        "any subject starting with `Merge` in any case",
        (c) => c.parents.length >= 2 && /^merge /i.test(c.subject),
      ],
      [
        "a text match that ignores what follows",
        (c) => c.parents.length >= 2 && /^Merge (branch|pull request) /.test(c.subject),
      ],
    ]
    for (const [name, candidate] of candidates) {
      expect(
        agrees(candidate),
        `the merge table cannot tell the exemption apart from ${name}`,
      ).toBe(false)
    }
  })
})

describe("commits/range-check", () => {
  const fixture = buildFixture()
  afterAll(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const { sha } = fixture

  /**
   * The assertions a correct collector passes over this fixture. They are a
   * function so the same assertions can be run over each narrowed collector
   * below and required to fail there.
   */
  const holds = (commits: readonly Commit[]): boolean => {
    const report = checkRange(commits)
    const all = new Set([...report.checked, ...report.exempted].map((c) => c.sha))
    const range = new Set(listRangeShas(fixture.dir, fixture.base, fixture.head))
    const refused = new Set(report.violations.map((v) => v.commit.sha))
    const exempt = new Set(report.exempted.map((c) => c.sha))
    return (
      all.size === range.size &&
      [...range].every((s) => all.has(s)) &&
      refused.size === 3 &&
      [sha.s1, sha.p3, sha.m3].every((s) => refused.has(s as string)) &&
      exempt.size === 2 &&
      [sha.m1, sha.m2].every((s) => exempt.has(s as string))
    )
  }

  it("refuses exactly the planted commits, by sha, and exempts exactly the two standard merges", () => {
    const commits = listCommits(fixture.dir, fixture.base, fixture.head)
    const report = checkRange(commits)

    // The breadth claim, named rather than counted: the side-branch commit is
    // the one a first-parent walk would never read.
    expect(
      report.violations.map((v) => v.commit.sha),
      "s1 is reachable only through a merge's second parent, and the check missed it",
    ).toContain(sha.s1)
    // Each half of the exception, planted away on its own.
    expect(
      report.violations.map((v) => v.commit.sha),
      "a single-parent commit that reads like a merge was not refused — exempted, or never read",
    ).toContain(sha.p3)
    expect(
      report.violations.map((v) => v.commit.sha),
      "a two-parent merge with a hand-written subject was not refused — exempted, or never read",
    ).toContain(sha.m3)
    expect(report.violations, describeViolations(report.violations)).toHaveLength(3)

    // The survivors, measured rather than claimed.
    expect(report.exempted.map((c) => c.sha).sort()).toEqual([sha.m1, sha.m2].sort())

    // Everything the range holds was either judged or exempted by name.
    const seen = [...report.checked, ...report.exempted].map((c) => c.sha).sort()
    expect(seen, "the check read a different set of commits than the range holds").toEqual(
      listRangeShas(fixture.dir, fixture.base, fixture.head).sort(),
    )
    expect(holds(commits), "the shared assertions disagree with the ones above").toBe(true)
  })

  it("commits/range-breadth-is-pinned — each narrowed collector fails the same assertions", () => {
    const narrowed: ReadonlyArray<readonly [string, string[]]> = [
      ["a first-parent walk", ["--first-parent"]],
      ["a walk that skips merges", ["--no-merges"]],
      ["the last commit only", ["-n", "1"]],
    ]
    for (const [name, flags] of narrowed) {
      const out = git(
        fixture.dir,
        "log",
        ...flags,
        "--format=%H%x1f%P%x1f%s",
        `${fixture.base}..${fixture.head}`,
      )
      const commits = out
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          const [s = "", p = "", subject = ""] = l.split("\x1f")
          return { sha: s, parents: p.split(" ").filter((x) => x.length > 0), subject }
        })
      expect(
        holds(commits),
        `${name} passed the range assertions, so they do not pin breadth`,
      ).toBe(false)
    }
  })

  it("the base decides what the pull request brings — a stale base blames it for main's commits", () => {
    // Why the CI job fetches the base tip at run time instead of using the base
    // recorded in the event: measured against a stale base, c1 — which only
    // main has — is reported as the pull request's.
    const current = checkRange(listCommits(fixture.dir, fixture.base, fixture.head))
    const stale = checkRange(listCommits(fixture.dir, fixture.staleBase, fixture.head))
    expect(current.violations.map((v) => v.commit.sha)).not.toContain(sha.c1)
    expect(stale.violations.map((v) => v.commit.sha)).toContain(sha.c1)
  })
})

describe("commits/live-check-runs-on-any-part-of-its-environment", () => {
  // One row per subset of the three variables, plus the empty string: a job
  // that set a variable to nothing still asked for the check. Only the fully
  // absent environment skips.
  const ROWS: ReadonlyArray<readonly [LiveCheckEnv, boolean]> = [
    [{ base: undefined, head: undefined, title: undefined }, false],
    [{ base: "FETCH_HEAD", head: undefined, title: undefined }, true],
    [{ base: undefined, head: "abc123", title: undefined }, true],
    [{ base: undefined, head: undefined, title: "fix: x" }, true],
    [{ base: "FETCH_HEAD", head: "abc123", title: undefined }, true],
    [{ base: "FETCH_HEAD", head: undefined, title: "fix: x" }, true],
    [{ base: undefined, head: "abc123", title: "fix: x" }, true],
    [{ base: "FETCH_HEAD", head: "abc123", title: "fix: x" }, true],
    [{ base: "", head: undefined, title: undefined }, true],
    [{ base: undefined, head: undefined, title: "" }, true],
  ]

  it("runs whenever any of the three is set, and skips only when none is", () => {
    for (const [env, expected] of ROWS) {
      expect(liveCheckRequested(env), `for ${JSON.stringify(env)}`).toBe(expected)
    }
  })

  it("commits/live-check-table-discriminates — the table tells the rule apart from each narrower one", () => {
    const agrees = (rule: (env: LiveCheckEnv) => boolean) =>
      ROWS.every(([env, expected]) => rule(env) === expected)
    expect(agrees(liveCheckRequested), "the table does not agree with the real rule").toBe(true)
    const candidates: ReadonlyArray<readonly [string, (env: LiveCheckEnv) => boolean]> = [
      [
        "running only when all three are set",
        (e) => e.base !== undefined && e.head !== undefined && e.title !== undefined,
      ],
      ["running only when the range is set", (e) => e.base !== undefined && e.head !== undefined],
      ["running only when the base is set", (e) => e.base !== undefined],
      ["running only when the title is set", (e) => e.title !== undefined],
      ["treating an empty value as absent", (e) => Boolean(e.base || e.head || e.title)],
      ["always running", () => true],
      ["never running", () => false],
    ]
    for (const [name, candidate] of candidates) {
      expect(
        agrees(candidate),
        `the live-check table cannot tell the rule apart from ${name}`,
      ).toBe(false)
    }
    // And the other direction: every row refuses at least one candidate, so no
    // row is along for the ride. The absent row is the only one that refuses
    // "always running"; the all-set row, the one CI actually sends, refuses
    // only "never running"; the two empty-string rows are the only ones that
    // refuse truthiness.
    for (const [env, expected] of ROWS) {
      expect(
        candidates.some(([, candidate]) => candidate(env) !== expected),
        `the row ${JSON.stringify(env)} refuses no candidate, so it measures nothing`,
      ).toBe(true)
    }
  })

  it("the live case below decides its skip by this rule, not by a copy of it", () => {
    // The table proves the function; this proves the live case calls it. An
    // inlined condition would pass every row above and decide nothing.
    const source = readFileSync(fileURLToPath(import.meta.url), "utf8")
    const block = source.slice(source.lastIndexOf('describe("commits/this-pull-request"'))
    expect(block).toContain("const asked = liveCheckRequested({ base, head, title })")
    expect(block.match(/skipIf\(([^)]*)\)/g)).toEqual(["skipIf(!asked)", "skipIf(!asked)"])
  })
})

describe("commits/this-pull-request", () => {
  const base = process.env.COMMITS_BASE
  const head = process.env.COMMITS_HEAD
  const title = process.env.PR_TITLE
  const asked = liveCheckRequested({ base, head, title })

  it.skipIf(!asked)("every commit this pull request brings is conventional", () => {
    // Fail closed on half an environment: `liveCheckRequested` runs this when
    // any one of the three is set, so a missing other half is red here.
    expect(base, "COMMITS_BASE is not set").toBeTruthy()
    expect(head, "COMMITS_HEAD is not set").toBeTruthy()
    const commits = listCommits(repoRoot, base as string, head as string)
    // A range with nothing in it would pass every check below by checking
    // nothing. A pull request always brings at least one commit.
    expect(commits.length, `the range ${base}..${head} is empty`).toBeGreaterThan(0)
    expect(commits.map((c) => c.sha).sort()).toEqual(
      listRangeShas(repoRoot, base as string, head as string).sort(),
    )
    const report = checkRange(commits)
    expect(
      report.violations,
      `these commits are not Conventional Commits (see CONTRIBUTING.md):\n${describeViolations(report.violations)}`,
    ).toEqual([])
  })

  it.skipIf(!asked)("the pull request's title is conventional", () => {
    expect(title, "PR_TITLE is not set").toBeTruthy()
    const verdict = checkTitle(title as string)
    expect(
      verdict,
      `the pull request title "${title}" is not a Conventional Commit subject`,
    ).toEqual({ ok: true })
  })
})
