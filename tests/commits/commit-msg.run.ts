/**
 * The entry `.githooks/commit-msg` runs. git passes the path of the message it
 * is about to commit; exit 0 lets the commit happen, anything else stops it.
 *
 * This file judges on every run and has no "am I the main module?" guard: such
 * a guard compares paths, a symlinked checkout makes them differ, and the hook
 * would then exit 0 without having judged anything. Measured while writing it.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { judgeMessage, subjectOf } from "./commit-msg.js"

const messageFile = process.argv[2]
if (messageFile === undefined) {
  process.stderr.write("commit-msg: git passes the message file as the only argument\n")
  process.exit(2)
}

const message = readFileSync(messageFile, "utf8")
// Present only while a merge is being committed; git runs hooks from the work tree's root.
const mergeHead = execFileSync("git", ["rev-parse", "--git-path", "MERGE_HEAD"], {
  encoding: "utf8",
}).trim()
const verdict = judgeMessage(message, existsSync(mergeHead))
if (!verdict.ok) {
  process.stderr.write(
    [
      `commit-msg: refused, ${verdict.reason}.`,
      `  subject: ${subjectOf(message)}`,
      "  The `commits` CI job refuses it too (tests/commits/conventional-commits.ts), and once",
      "  pushed it could only be fixed by rewriting history. Nothing was committed; the message",
      `  is still in ${messageFile}.`,
      "",
    ].join("\n"),
  )
  process.exit(1)
}
