/**
 * CFV1-LIC — the rule that finds every place this repository states its own
 * licence, as a module rather than as exports from a test file.
 *
 * ## Why this exists
 *
 * `PDR-0006` moves the project from MIT to `AGPL-3.0-or-later`, and the record
 * writes down its own gap in its last Negative bullet:
 *
 * > Nothing in the test suite enforces any of this. There is no check that
 * > `LICENSE`, `package.json` and the prose agree. A later drift between them
 * > will be found by a person reading, or not at all.
 *
 * That gap collected its first casualty four minutes after it was written: the
 * first commit of the licence change left the root entry of
 * `package-lock.json` reading `"license": "MIT"` while every other place said
 * AGPL. Nobody was careless — the lock file's root entry is a copy of
 * `package.json`'s field that only `npm install` rewrites, and the tree has no
 * other reason to look at it. That is the shape of drift this module is for: a
 * place nobody thinks of, saying something nobody re-reads.
 *
 * ## The rule, and why it is mechanical
 *
 * A place states the project's licence if it is one of:
 *
 * 1. `LICENSE` — the heading of the licence text itself.
 * 2. `package.json` — the root `license` field.
 * 3. `package-lock.json` — the `license` of the root entry, `packages[""]`, and
 *    that entry ONLY. The lock file names a licence for several hundred
 *    dependencies and none of them is this project's.
 * 4. Any markdown file — every link whose target resolves to the repository's
 *    `LICENSE`, taking the link's own text as the licence it names. Today that
 *    is `README.md`; after `PDR-0006` it is `README.md` and `CONTRIBUTING.md`.
 *
 * Rule 4 is a link and not a phrase on purpose. This repository's prose names
 * MIT in four places that are not declarations and must never be forced to
 * change: `docs/adr/ADR-0010` and `src/security/address-policy.ts` name the
 * licence of `ipaddr.js`, `docs/archive/discovery-decision-log.md` is an
 * archived record, and `PDR-0006` itself quotes the licence it supersedes at
 * length. A record is never rewritten, so a rule that read licence names out of
 * prose would either go red on all four or would need a list of exceptions that
 * grows with every record — and a guard whose exception list grows is a guard
 * that will one day be quieted by adding a line to it. A link to `LICENSE` is
 * something only a declaration has a reason to be.
 *
 * ## What it reports, and the one distinction it draws
 *
 * Each declaration carries two values because the places cannot all express the
 * same thing:
 *
 * - `declared` is the licence **family** — `MIT`, `AGPL-3.0` — which every
 *   place can state. The AGPL's own text says "Version 3, 19 November 2007" and
 *   has no way to say "or later", so this is the granularity at which `LICENSE`
 *   and `package.json` can be held against each other at all.
 * - `spdx` is the exact identifier where the place states a machine-readable
 *   one, and `null` where it does not. Only the two JSON fields do. That is
 *   what holds `AGPL-3.0-or-later` against a drift to `AGPL-3.0-only` between
 *   `package.json` and the lock file, which the family alone would not see.
 *
 * ## What is deliberately out of reach
 *
 * A declaration written in prose with no link to `LICENSE` is invisible here.
 * Two such declarations existed when this rule was written —
 * `docs/open-source-self-hosting-principles.md` ("Cookframe is released under
 * the **GNU Affero General Public License, version 3 or later**.") and the
 * release checklist in `docs/validation-and-evaluation.md` — and rather than
 * grow a per-document pattern for each, both sentences were given the link they
 * were describing anyway. They are ordinary declarations now.
 *
 * The gap itself has not gone away: a document added tomorrow that names the
 * licence in a sentence and links nothing is not seen by this rule. What
 * catches that is the census in `license.test.ts`, which lists every file in
 * the tree that names any licence at all and requires each to be classified by
 * name. A new declaration in an unrecognised shape arrives there as a file to
 * classify, not as silence.
 */
import { posix } from "node:path"

/**
 * Licence names, and the family each one belongs to.
 *
 * Ordered, and the order is load-bearing: "GNU Affero General Public License"
 * must be tried before the GPL patterns, and the SPDX spellings before the
 * prose ones, because a prose pattern is the looser of the two.
 */
const FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAGPL-3\.0(?:-or-later|-only)?\b/i, "AGPL-3.0"],
  [/GNU\s+Affero\s+General\s+Public\s+License/i, "AGPL-3.0"],
  [/\bGPL-3\.0(?:-or-later|-only)?\b/i, "GPL-3.0"],
  [/GNU\s+General\s+Public\s+License/i, "GPL-3.0"],
  [/\bMIT\b/, "MIT"],
  [/\bApache-2\.0\b/i, "Apache-2.0"],
  [/Apache\s+License,?\s+Version\s+2\.0/i, "Apache-2.0"],
  [/\bMPL-2\.0\b/i, "MPL-2.0"],
  [/Mozilla\s+Public\s+License/i, "MPL-2.0"],
  [/\bBSD-3-Clause\b/i, "BSD-3-Clause"],
  [/\bBSD-2-Clause\b/i, "BSD-2-Clause"],
  [/\bISC\b/, "ISC"],
]

/**
 * The family a licence name belongs to, or `null` if no known name is in it.
 *
 * This is the only place a name becomes a family, so the same judgement stands
 * behind a JSON field, a licence heading and a link's text.
 */
export function familyOf(name: string): string | null {
  for (const [pattern, family] of FAMILIES) if (pattern.test(name)) return family
  return null
}

/** One place that states the project's licence, and what it states there. */
export interface Declaration {
  /** Repository-relative path of the file the statement is in. */
  readonly path: string
  /** The licence family, or a `?`-prefixed reason the family could not be read. */
  readonly declared: string
  /** The exact SPDX identifier where the place states one; `null` where it cannot. */
  readonly spdx: string | null
}

/**
 * The three files that state the licence somewhere other than in prose.
 *
 * Named here rather than discovered, because each is read by its own structure
 * and there is nothing to discover: a repository has one `LICENSE`, one
 * manifest and one lock file. Deleting a name from this list removes a
 * declaration from the report, which is why the test's expected list is written
 * out in full rather than derived from it.
 */
export const STRUCTURED_SITES: readonly string[] = ["LICENSE", "package.json", "package-lock.json"]

/** The path a link in `from` points at, repository-relative and normalised. */
function linkTarget(from: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(from), target))
}

/** A short, quotable form of a name that no known licence pattern matched. */
function unrecognised(name: string): string {
  const flat = name.replace(/\s+/g, " ").trim()
  return `?unrecognised: ${flat.length > 60 ? `${flat.slice(0, 60)}…` : flat}`
}

/** The family and SPDX id a JSON `license` field states. */
function fromField(value: unknown): [string, string | null] {
  if (typeof value !== "string" || value.trim() === "") return ["?absent", null]
  const family = familyOf(value)
  return family === null ? [unrecognised(value), value] : [family, value]
}

/** The `license` a parsed JSON document states at `pick`, with every failure named. */
function fromJson(
  text: string,
  pick: (doc: Record<string, unknown>) => unknown,
): [string, string | null] {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return ["?unparsable", null]
  }
  if (doc === null || typeof doc !== "object") return ["?unparsable", null]
  return fromField(pick(doc as Record<string, unknown>))
}

/**
 * Every declaration `text` makes, given that it is the file at `path`.
 *
 * Pure: `path` is used to choose the rule and to resolve links, never to read
 * anything. That is what lets `license.test.ts` hold the rule against
 * written-out strings, so the discrimination stays pinned after every real file
 * in the tree is correct.
 */
export function declarationsIn(path: string, text: string): Declaration[] {
  if (path === "LICENSE") {
    const heading = text.split("\n").find((line) => line.trim() !== "") ?? ""
    const family = familyOf(heading)
    return [{ path, declared: family ?? unrecognised(heading), spdx: null }]
  }
  if (path === "package.json") {
    const [declared, spdx] = fromJson(text, (doc) => doc.license)
    return [{ path, declared, spdx }]
  }
  if (path === "package-lock.json") {
    const [declared, spdx] = fromJson(text, (doc) => {
      const packages = doc.packages
      if (packages === null || typeof packages !== "object") return undefined
      return (packages as Record<string, { license?: unknown }>)[""]?.license
    })
    return [{ path, declared, spdx }]
  }
  if (!path.endsWith(".md")) return []
  const out: Declaration[] = []
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    const name = match[1]
    const target = match[2]
    if (name === undefined || target === undefined) continue
    if (linkTarget(path, target) !== "LICENSE") continue
    const family = familyOf(name)
    out.push({ path, declared: family ?? unrecognised(name), spdx: null })
  }
  return out
}

/**
 * Whether `text` names any licence this module knows, wherever and for whatever
 * reason.
 *
 * This is deliberately looser than {@link declarationsIn} and is not the drift
 * rule. It exists so the test can assert, by name, which files in the tree even
 * mention a licence — so that a declaration written in a shape
 * {@link declarationsIn} cannot see shows up as a file that has to be
 * classified, rather than as silence.
 */
export function mentionsALicense(text: string): boolean {
  return familyOf(text) !== null
}
