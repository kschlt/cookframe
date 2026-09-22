/**
 * CFV1-CCOM at commit time — the judge behind `.githooks/commit-msg`, which runs
 * it through `commit-msg.run.ts`.
 *
 * The `commits` CI job refuses a nonconforming subject only after it has been
 * pushed, and a pushed commit can be repaired only by rewriting the branch's
 * history, which this project does not do. Measured on 2026-09-22: the private
 * `/commit` tooling committed a 102-character subject and exited 0, because
 * nothing in it knows the length limit, and a plain `git commit` knows nothing
 * at all. This hook refuses the same subjects the CI job refuses, before the
 * commit exists, on every path that ends in `git commit` or `git merge`.
 *
 * It applies {@link checkSubject} itself, not a copy of it, so the two cannot
 * drift apart. The one exception the CI job makes, a merge commit carrying git's
 * own text, is decided by {@link isStandardMerge} with the parents git is about
 * to record: HEAD and MERGE_HEAD, which exists only while a merge is being
 * committed. A single-parent commit that merely reads like a merge is refused
 * here exactly as it is there.
 *
 * `npm install` and `npm ci` wire the hook (`prepare` in `package.json` points
 * `core.hooksPath` at `.githooks/`). That replaces `.git/hooks/`, and
 * `git commit --no-verify` still skips it; the CI job stays the rule that holds.
 */
import { checkSubject, isStandardMerge, type SubjectVerdict } from "./conventional-commits.js"

/**
 * The subject git will store for this message, as `%s` reads it back and so as
 * the CI job judges it.
 *
 * git hands the hook the message already cleaned when no editor ran, and
 * uncleaned when one did: then trailing whitespace, leading blank lines and the
 * comment lines are still there, the comments directly under a merge's subject.
 * So all three are dropped here, and the first paragraph is joined with single
 * spaces, as `%s` joins it. A subject line of its own that starts with `#` under
 * `--cleanup=whitespace` is the one case where git keeps a line this drops; it
 * is not a Conventional Commit either way, and the CI job still reads it.
 */
export function subjectOf(message: string): string {
  const lines: string[] = []
  for (const line of message.split("\n")) {
    if (!line.startsWith("#")) lines.push(line.replace(/\s+$/, ""))
  }
  const start = lines.findIndex((line) => line !== "")
  if (start === -1) return ""
  const end = lines.indexOf("", start)
  return lines.slice(start, end === -1 ? undefined : end).join(" ")
}

/** Judge a message about to be committed; `merging` is whether MERGE_HEAD exists. */
export function judgeMessage(message: string, merging: boolean): SubjectVerdict {
  const subject = subjectOf(message)
  const parents = merging ? ["HEAD", "MERGE_HEAD"] : ["HEAD"]
  if (isStandardMerge({ sha: "", parents, subject })) return { ok: true }
  return checkSubject(subject)
}
