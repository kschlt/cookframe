/**
 * CFV1-CCOM — every commit a pull request brings is a Conventional Commit.
 *
 * The rule was declared once, in the maintainer's private workflow configuration
 * (`conventions.commit_format: conventional`), and nowhere in this repository.
 * Nothing checked it: no hook, no CI job. The tooling that writes conforming
 * messages is only present where that private layer is mounted, and a plain
 * `git commit` walks past it even there. On 2026-09-22 that produced dozens of
 * prose subjects on `main` from at least six threads, and the build was green
 * for every one of them.
 *
 * This module is the rule as code, so the repository says what it requires and
 * refuses what does not meet it. It judges a SUBJECT LINE and a RANGE of commits;
 * it never reads the maintainer's configuration, which a contributor does not
 * have.
 *
 * **The one declared exception is measured, not claimed.** A merge commit that
 * git or GitHub wrote — two or more parents AND their standard text — is exempt,
 * because its subject is not written by the author and the up-to-date merge every
 * pull request here has to take would otherwise be refused. The exemption needs
 * BOTH halves: a single-parent commit that merely reads like a merge is judged
 * like any other commit, and so is a merge commit whose subject somebody wrote by
 * hand. {@link checkRange} returns what it exempted by name, so a report says which
 * commits survived and why rather than leaving the reader to trust that only
 * merges did.
 *
 * The collector reads the WHOLE range — merges, and commits reachable only
 * through a merge's second parent — because a check that walks the first-parent
 * line or skips merges reports green on exactly the commit it never looked at.
 * The breadth is held by {@link listRangeShas}: the same range counted by
 * `git rev-list`, which the proofs compare against what was checked.
 */
import { execFileSync } from "node:child_process"

/**
 * The types a subject may start with: the Conventional Commits 1.0 set as the
 * widely used `config-conventional` convention names it. It is a superset of the
 * six the private `/commit` tooling writes (`feat`, `fix`, `docs`, `refactor`,
 * `test`, `chore`), so anything that tooling produces passes here, and `build`,
 * `ci`, `perf`, `style` and `revert` are accepted because this repository
 * already writes them for what they name.
 */
export const COMMIT_TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
] as const

/** A header longer than this is refused; the widely used convention's own limit. */
export const MAX_SUBJECT_LENGTH = 100

/**
 * `type(scope)!: description`. The scope and the `!` are optional. There is no
 * rule on the case of the description: this project writes in German as well as
 * English, and a German noun starts with a capital letter.
 */
const HEADER =
  /^(?<type>[a-z]+)(?:\((?<scope>[^()\s][^()]*)\))?(?<breaking>!)?: (?<description>.+)$/

/** The standard texts git and GitHub write for a merge commit, and only those. */
const STANDARD_MERGE_SUBJECTS: readonly RegExp[] = [
  // `git merge main` on a branch, `git pull`, and GitHub's "Update branch" button.
  /^Merge (?:remote-tracking )?branch '[^']+'(?: of \S+)?(?: into \S+)?$/,
  // GitHub's merge button with its default message.
  /^Merge pull request #\d+ from \S+$/,
]

export type SubjectVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Judge one subject line against the rule. Pure; says why when it refuses. */
export function checkSubject(subject: string): SubjectVerdict {
  if (subject !== subject.trim()) {
    return { ok: false, reason: "the subject has leading or trailing whitespace" }
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      reason: `the subject is ${subject.length} characters, over the limit of ${MAX_SUBJECT_LENGTH}`,
    }
  }
  const match = HEADER.exec(subject)
  if (match === null) {
    return { ok: false, reason: "the subject is not `type(scope): description`" }
  }
  const type = match.groups?.type ?? ""
  if (!(COMMIT_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason: `\`${type}\` is not a commit type; use one of ${COMMIT_TYPES.join(", ")}`,
    }
  }
  if (subject.endsWith(".")) {
    return { ok: false, reason: "the subject ends with a period" }
  }
  return { ok: true }
}

/**
 * Judge a pull request's title. The merge step uses it as the subject of the
 * merge commit on `main`, so it is held to exactly the subject rule and gets NO
 * merge exemption: a title has no parents to qualify, and a title that reads
 * like a merge would put that text on `main` unchecked.
 */
export function checkTitle(title: string): SubjectVerdict {
  return checkSubject(title)
}

/** One commit as the range check needs it. */
export interface Commit {
  readonly sha: string
  readonly parents: readonly string[]
  readonly subject: string
}

/**
 * Whether git or GitHub wrote this commit as a merge: two or more parents AND
 * one of their standard subjects. Either half alone is not enough.
 */
export function isStandardMerge(commit: Commit): boolean {
  return commit.parents.length >= 2 && STANDARD_MERGE_SUBJECTS.some((re) => re.test(commit.subject))
}

export interface Violation {
  readonly commit: Commit
  readonly reason: string
}

/** What a range check found: what it judged, what it exempted, and what it refused. */
export interface RangeReport {
  readonly checked: readonly Commit[]
  readonly exempted: readonly Commit[]
  readonly violations: readonly Violation[]
}

/** Judge every commit of a range. Pure over already-loaded commits. */
export function checkRange(commits: readonly Commit[]): RangeReport {
  const checked: Commit[] = []
  const exempted: Commit[] = []
  const violations: Violation[] = []
  for (const commit of commits) {
    if (isStandardMerge(commit)) {
      exempted.push(commit)
      continue
    }
    checked.push(commit)
    const verdict = checkSubject(commit.subject)
    if (!verdict.ok) violations.push({ commit, reason: verdict.reason })
  }
  return { checked, exempted, violations }
}

/** The pull request environment the `commits` CI job hands the live check. */
export interface LiveCheckEnv {
  readonly base: string | undefined
  readonly head: string | undefined
  readonly title: string | undefined
}

/**
 * Whether the live check was asked for: true when ANY of the three is set, even
 * to an empty string. A job that set one of them meant the check to run, so a
 * missing or empty other half has to fail it, not turn it into a skip. Only a
 * fully absent environment — every other job, and a local run — skips.
 */
export function liveCheckRequested(env: LiveCheckEnv): boolean {
  return env.base !== undefined || env.head !== undefined || env.title !== undefined
}

/** A field separator no subject line can contain. */
const FIELD = "\x1f"

/**
 * Every commit reachable from `head` and not from `base`, with its parents and
 * subject — merges included, second parents included. Deliberately no
 * `--no-merges` and no `--first-parent`: either would drop commits the pull
 * request brings, and the check would be green about commits it never read.
 */
export function listCommits(repoDir: string, base: string, head: string): Commit[] {
  const out = execFileSync("git", ["log", `--format=%H${FIELD}%P${FIELD}%s`, `${base}..${head}`], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = "", parents = "", subject = ""] = line.split(FIELD)
      return { sha, parents: parents.split(" ").filter((p) => p.length > 0), subject }
    })
}

/**
 * The same range counted independently, by `git rev-list`. The proofs compare
 * it with what {@link listCommits} returned, so a collector narrowed to fewer
 * commits disagrees with it and goes red.
 */
export function listRangeShas(repoDir: string, base: string, head: string): string[] {
  const out = execFileSync("git", ["rev-list", `${base}..${head}`], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split("\n").filter((line) => line.length > 0)
}

/** One line per refused commit, in the form a CI log reader can act on. */
export function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.commit.sha.slice(0, 7)} "${v.commit.subject}": ${v.reason}`)
    .join("\n")
}
