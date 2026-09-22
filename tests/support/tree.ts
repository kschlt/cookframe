/**
 * The one recursive file walk the structural guards scan with (CFV1-BRD2).
 *
 * ## Why this is one module and not seven
 *
 * Seven suites walked the tree with their own copy of the same six lines, and
 * the copies had drifted into four different answers to "which files are
 * source". Measured on `main` at `4cbf371`:
 *
 * | walk | extensions it read |
 * | --- | --- |
 * | `tests/run/containment.test.ts` | `.ts`, `.mts` |
 * | `tests/unit/response-header-record.test.ts` | `.ts`, `.mts`, `.cts`, `.tsx` |
 * | `tests/url-fetch/network-primitives.ts` | `.ts`, `.mts`, `.cts`, `.tsx` |
 * | `tests/persistence/postgres-store.test.ts` | `.ts` |
 * | `tests/slice2/render.test.ts` | `.ts` |
 * | `tests/unit/repo-config.test.ts` | every file, filtered at the call site |
 * | `tests/protections/repository-claims.test.ts` | `.md` |
 *
 * `src/` holds nothing but `.ts` today, so every one of those answers is the
 * same answer right now and the drift is invisible. It stops being invisible
 * the first time a `.tsx` module appears — `tests/slice2/render.test.ts` already
 * has a proof that looks for one, so that is not a hypothetical — and then three
 * guards would read it and two would not, silently.
 *
 * ## Why the extension set is a constant and not a default
 *
 * A guard that scans TypeScript sources declares {@link SOURCE_EXTENSIONS}
 * rather than spelling a pattern, so widening the set widens every scan at once.
 * A guard that scans something else (records, every file) passes its own
 * `match`, and says at the call site what it is looking at.
 *
 * ## What holds this module's own breadth
 *
 * `tree.test.ts`, and it is the point of the module. This walk has exactly the
 * shape ADR-0029 names as the one whose breadth nothing holds: every guard using
 * it asserts that a set of violations is EMPTY, so a walk that returns fewer
 * files can only make those assertions easier. Narrowing the extension pattern
 * to `/\.ts$/` left the whole gate green — 1011 passed, measured — in all three
 * suites that had widened it. So the breadth is held here instead, by a proof
 * that plants one file per extension and names each of them.
 */
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The file extensions a TypeScript source scan must read.
 *
 * `.tsx` and `.cts` are in the set because the toolchain compiles them, not
 * because the tree has one today. A guard that reads only what the tree
 * currently holds stops being a guard the moment the tree changes, which is the
 * only moment it was ever needed.
 */
export const SOURCE_EXTENSIONS = /\.(?:ts|mts|cts|tsx)$/

export interface WalkOptions {
  /** Only files whose basename matches are returned. Default: every file. */
  readonly match?: RegExp
  /** Directory and file basenames the walk does not enter or return. */
  readonly skip?: ReadonlySet<string>
}

/**
 * Every file under `dir`, recursively, sorted — absolute paths.
 *
 * An unreadable directory yields nothing rather than throwing, because a guard
 * that points at an optional tree (`evals/` is not always present) must be able
 * to ask without branching first.
 */
export function filesUnder(dir: string, options: WalkOptions = {}): string[] {
  const { match, skip } = options
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    if (skip?.has(name) === true) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, options))
    else if (match === undefined || match.test(name)) out.push(full)
  }
  return out.sort()
}
