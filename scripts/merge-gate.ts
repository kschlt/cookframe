/**
 * CFV1-BASE — decide a merge against the result, not against the base it was
 * branched from.
 *
 * Twice in one night two pull requests, each green against its own base,
 * produced a broken `main` when both landed. No CI run could have caught either,
 * because each ran against a base that did not yet contain the other.
 *
 * The two failed DIFFERENTLY, and that is the part that shapes this module.
 * `#30` implemented five repository operations while `#31` widened the interface
 * to six: the merge result stopped compiling. `#28` added proofs that construct
 * an infinite duration while `#34` made the contract reject it: the merge result
 * **typechecks perfectly** and three tests die at construction. So a typecheck
 * on the base after each merge — the obvious fix, and the one proposed when the
 * first case was found — is known by measurement to be insufficient. The whole
 * declared gate has to run, not a part of it chosen by guesswork.
 *
 * Neither case had a textual conflict. Git would have merged both silently, so
 * the mechanism must not rely on a conflict to notice.
 *
 * ## Staleness, which is the same defect one step along
 *
 * A merge result computed once and trusted an hour later has exactly the fault
 * this module exists to close. So the merge is recomputed HERE, at the moment
 * the check runs, against whatever the base tip is now — never read from a ref
 * GitHub computed when the pull request was last pushed.
 *
 * What keeps that honest at the moment of MERGING rather than merely at the
 * moment of checking is the repository setting "Require branches to be up to
 * date before merging": it withholds the merge button until the head contains
 * the current base, which re-runs this check. That setting is deliberately not
 * this module's business — it is a repository protection, and this module is
 * what the protection requires.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** What the check decided, and everything a reader needs to act on it. */
export interface MergeGateResult {
  /** `0` only when the merge result is green, or when there is nothing to merge. */
  readonly exitCode: number
  /** `merged` ran the gate; `already-current` had nothing to merge; `conflict` could not merge. */
  readonly outcome: "green" | "red" | "already-current" | "conflict"
  /** Whether the declared gate was actually executed. */
  readonly gateRan: boolean
  /** The gate command, as the repository declares it. */
  readonly gateCommand: string
  /** One line a human can act on — the refusal names BOTH sides, not just the check. */
  readonly summary: string
  /** Whether dependencies had to be installed into the merge worktree. */
  readonly installed: boolean
}

/** Where the two sides of the merge come from. */
export interface MergeGateRequest {
  /** The repository to work in. */
  readonly repoDir: string
  /** The base the change will actually land on, e.g. `origin/main`. */
  readonly base: string
  /** The change being merged, e.g. a pull request head. */
  readonly head: string
  /** Human labels for the two sides, used in the refusal. */
  readonly baseLabel?: string
  readonly headLabel?: string
  /**
   * How to install dependencies in the merge worktree, when the merge result
   * has a lockfile. A fresh worktree has no `node_modules`, and the gate cannot
   * run without one. Injectable so a proof can observe it without a registry.
   */
  readonly installCommand?: string
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

/**
 * The gate command, read from the repository's own declaration.
 *
 * Read rather than restated on purpose: a second definition of "green" is a
 * second thing to keep in step, and the one that drifts is always the copy. If
 * `package.json` has no `quality` script there is nothing to run and saying so
 * is better than inventing a command that looks plausible.
 */
export function declaredGateCommand(repoDir: string): string {
  const pkg = JSON.parse(readFileSync(join(repoDir, "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  const declared = pkg.scripts?.["quality"]
  if (declared === undefined || declared.trim() === "") {
    throw new Error(
      "the repository declares no `quality` script, so this check has no definition of green to run",
    )
  }
  return declared
}

/**
 * Run the repository's declared gate against the result of merging `head` into
 * `base`, computed now.
 *
 * The merge happens in a throwaway worktree so the caller's checkout is never
 * touched — this runs in CI beside other jobs, and a check that mutates the
 * tree it is checking is its own kind of stale measurement.
 */
export function runMergeGate(request: MergeGateRequest): MergeGateResult {
  const { repoDir, base, head, installCommand } = request
  const baseLabel = request.baseLabel ?? base
  const headLabel = request.headLabel ?? head
  const gateCommand = declaredGateCommand(repoDir)

  const baseSha = git(repoDir, "rev-parse", base)
  const headSha = git(repoDir, "rev-parse", head)

  // Nothing to measure when the head already contains the base: the merge
  // result IS the head's own tree, which the head's own gate run already
  // measured. Running it again would cost a full gate run to reproduce a number
  // that is already in hand — and this check is paid for on every merge, so a
  // redundant run is not free.
  if (isAncestor(repoDir, baseSha, headSha)) {
    return {
      exitCode: 0,
      outcome: "already-current",
      gateRan: false,
      gateCommand,
      installed: false,
      summary:
        `${headLabel} already contains ${baseLabel}, so the merge result is the head's own tree ` +
        `and its gate run already measured it. Gate not run again.`,
    }
  }

  const worktree = mkdtempSync(join(tmpdir(), "merge-gate-"))
  try {
    git(repoDir, "worktree", "add", "--detach", worktree, baseSha)
    try {
      // An identity is supplied per invocation, as insurance rather than as a
      // fix for anything observed. This merge creates a commit and
      // `actions/checkout` configures no committer, but git then GUESSES one
      // from the user and host and commits anyway — measured, including with
      // `user.useConfigOnly`, so the failure is NOT reproducible here and no
      // test below claims otherwise. Where that guess cannot be made the merge
      // would abort, and this function would have reported it as a CONFLICT,
      // blaming the two changes for a fault of its own. The commit dies with
      // the worktree, so the identity costs nothing; a wrong diagnosis would.
      execFileSync(
        "git",
        [
          "-c",
          "user.name=merge-gate",
          "-c",
          "user.email=merge-gate@invalid",
          "merge",
          "--no-edit",
          "--no-ff",
          headSha,
        ],
        { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] },
      )
    } catch {
      return {
        exitCode: 2,
        outcome: "conflict",
        gateRan: false,
        gateCommand,
        installed: false,
        summary:
          `${headLabel} and ${baseLabel} conflict textually and could not be merged, ` +
          `so the merge result could not be measured.`,
      }
    }

    // A fresh worktree has no `node_modules`, and the gate cannot run without
    // one. Installed from the MERGE RESULT's own lockfile rather than reusing
    // the caller's: when the two sides disagree about a dependency, that
    // disagreement is one of the things this check exists to find, and
    // borrowing the caller's tree would hide it.
    let installed = false
    if (existsSync(join(worktree, "package-lock.json")) && installCommand !== undefined) {
      installed = true
      try {
        execFileSync(installCommand, {
          cwd: worktree,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, CI: "1" },
        })
      } catch (err) {
        const out = err as { stdout?: Buffer; stderr?: Buffer }
        return {
          exitCode: 2,
          outcome: "red",
          gateRan: false,
          gateCommand,
          installed,
          summary:
            `the merge of ${headLabel} into ${baseLabel} could not have its dependencies ` +
            `installed, so the merge result could not be measured. This is itself a disagreement ` +
            `between the two sides rather than an infrastructure fault.\n` +
            lastLines(`${out.stdout?.toString() ?? ""}${out.stderr?.toString() ?? ""}`.trim(), 30),
        }
      }
    }

    // The gate runs against the MERGE RESULT. Neither side's own green says
    // anything about this tree; that is the entire point of the item.
    try {
      execFileSync(gateCommand, {
        cwd: worktree,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "1" },
      })
    } catch (err) {
      const out = err as { stdout?: Buffer; stderr?: Buffer }
      const detail = `${out.stdout?.toString() ?? ""}${out.stderr?.toString() ?? ""}`.trim()
      return {
        exitCode: 1,
        outcome: "red",
        gateRan: true,
        gateCommand,
        installed,
        // Names BOTH sides. "typecheck failed" sends the reader to the head's
        // own diff, where there is nothing wrong — the failure belongs to the
        // pair, and neither half of it is legible alone.
        summary:
          `the merge of ${headLabel} into ${baseLabel} is red, though each is green on its own. ` +
          `Ran \`${gateCommand}\` against the merge result (${baseSha.slice(0, 7)} + ` +
          `${headSha.slice(0, 7)}).${detail === "" ? "" : `\n${lastLines(detail, 40)}`}`,
      }
    }

    return {
      exitCode: 0,
      outcome: "green",
      gateRan: true,
      gateCommand,
      installed,
      summary:
        `the merge of ${headLabel} into ${baseLabel} is green ` +
        `(${baseSha.slice(0, 7)} + ${headSha.slice(0, 7)}).`,
    }
  } finally {
    rmSync(worktree, { recursive: true, force: true })
    try {
      git(repoDir, "worktree", "prune")
    } catch {
      // Pruning is housekeeping; a failure here must not change the verdict.
    }
  }
}

/** Whether `ancestor` is already contained in `descendant`. */
function isAncestor(repoDir: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoDir,
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

/**
 * The tail of a gate's output, without the colour.
 *
 * The gate's tools colour their output, and those escape sequences survive into
 * a CI log and a pull request comment as unreadable noise — which makes the one
 * artefact a person reads to understand the refusal the hardest part of it to
 * read. Stripped here rather than at each call site.
 */
function lastLines(text: string, count: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
  const plain = text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "")
  const lines = plain.split("\n").filter((l) => l.trim() !== "")
  return lines.slice(Math.max(0, lines.length - count)).join("\n")
}

/**
 * The command line CI calls.
 *
 * Arguments rather than environment sniffing, so the same invocation can be run
 * by hand when a refusal has to be reproduced locally — a check that can only
 * be run by CI is a check nobody debugs.
 */
export function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`))
    return hit?.slice(name.length + 3)
  }
  const base = arg("base")
  const head = arg("head")
  if (base === undefined || head === undefined) {
    process.stderr.write(
      "usage: merge-gate --base=<ref> --head=<ref> [--base-label=<text>] [--head-label=<text>]\n",
    )
    return 64
  }
  const result = runMergeGate({
    repoDir: arg("repo") ?? process.cwd(),
    base,
    head,
    ...(arg("base-label") === undefined ? {} : { baseLabel: arg("base-label") as string }),
    ...(arg("head-label") === undefined ? {} : { headLabel: arg("head-label") as string }),
    installCommand: arg("install") ?? "npm ci --no-audit --no-fund",
  })
  process.stdout.write(`${result.summary}\n`)
  return result.exitCode
}

// Only when run as a program, never when imported by a test.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
