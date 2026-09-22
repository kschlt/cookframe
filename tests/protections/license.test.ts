/**
 * CFV1-LIC — the proof that the licence is stated in one voice, and that the
 * rule finding those statements is looking at all of them.
 *
 * The rule itself is in `./license.ts`; this file is its proof, and it is in
 * three parts that do different jobs:
 *
 * 1. **The discrimination table.** Written-out strings, never the tree, so that
 *    what the rule tells apart stays pinned after every real file is correct.
 *    Each spared row is followed by the question ADR-0029 makes mandatory —
 *    *which entry dies if this condition is dropped?* — answered by running the
 *    same table through a rule with that condition removed and naming the row
 *    that then fails.
 * 2. **The agreement proof.** Every declaration site in the tree, named, with
 *    the licence it states. This is where a drift like the one that started the
 *    item goes red.
 * 3. **The census.** Every file in the tree that so much as names a licence,
 *    named, and split into the ones that declare and the ones that mention.
 *    Part 2 cannot see a declaration written in a shape the rule does not
 *    recognise; this part makes such a file arrive as a classification to make
 *    rather than as silence.
 *
 * ## Why the licence is a constant here and not read from one of the places
 *
 * `DECLARED_FAMILY` and `DECLARED_SPDX` are literals. Deriving them from, say,
 * `package.json` and asserting the others match would make the whole proof a
 * claim that the places agree with each other, and ADR-0029 is about exactly
 * that shape: an assertion that a set of divergences is empty is satisfied by a
 * reading that finds nothing. Written out, a licence change costs two lines
 * here, on purpose — it is the one moment the full list of places is worth a
 * person's eyes.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { filesUnder } from "../support/tree.js"
import { type Declaration, declarationsIn, mentionsALicense, STRUCTURED_SITES } from "./license.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The licence this repository is under, at the granularity every place can state. */
const DECLARED_FAMILY = "MIT"

/** The exact identifier, which only the two JSON fields can state. */
const DECLARED_SPDX = "MIT"

/** Directories that are not this repository's own text. */
const SKIP = new Set(["node_modules", ".git", ".aos", "dist", "coverage", "private"])

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8")

/* ------------------------------------------------------------------ *
 * 1. THE DISCRIMINATION TABLE
 * ------------------------------------------------------------------ */

interface Case {
  readonly name: string
  readonly path: string
  readonly text: string
  readonly expected: readonly Declaration[]
}

/** The AGPL text's own opening, which is the only thing `LICENSE` ever says. */
const AGPL_HEADING = [
  "                    GNU AFFERO GENERAL PUBLIC LICENSE",
  "                       Version 3, 19 November 2007",
  "",
  " Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>",
].join("\n")

const LOCK_WITH_DEPENDENCIES = JSON.stringify({
  name: "cookframe",
  packages: {
    "": { name: "cookframe", license: "AGPL-3.0-or-later" },
    "node_modules/undici": { version: "8.0.0", license: "MIT" },
    "node_modules/zod": { version: "4.0.0", license: "MIT OR Apache-2.0" },
  },
})

const MUST_FLAG: readonly Case[] = [
  {
    name: "the MIT licence text's own heading",
    path: "LICENSE",
    text: "MIT License\n\nCopyright (c) 2026 Cookframe contributors\n",
    expected: [{ path: "LICENSE", declared: "MIT", spdx: null }],
  },
  {
    name: "the AGPL licence text's own heading, indented and shouted",
    path: "LICENSE",
    text: AGPL_HEADING,
    expected: [{ path: "LICENSE", declared: "AGPL-3.0", spdx: null }],
  },
  {
    name: "a licence heading behind leading blank lines",
    path: "LICENSE",
    text: "\n\n   \nMIT License\n",
    expected: [{ path: "LICENSE", declared: "MIT", spdx: null }],
  },
  {
    name: "the manifest's licence field",
    path: "package.json",
    text: JSON.stringify({ name: "cookframe", license: "MIT" }),
    expected: [{ path: "package.json", declared: "MIT", spdx: "MIT" }],
  },
  {
    name: "the manifest's licence field carrying the grant suffix",
    path: "package.json",
    text: JSON.stringify({ name: "cookframe", license: "AGPL-3.0-or-later" }),
    expected: [{ path: "package.json", declared: "AGPL-3.0", spdx: "AGPL-3.0-or-later" }],
  },
  {
    name: "the lock file's root entry, and not its dependencies",
    path: "package-lock.json",
    text: LOCK_WITH_DEPENDENCIES,
    expected: [{ path: "package-lock.json", declared: "AGPL-3.0", spdx: "AGPL-3.0-or-later" }],
  },
  {
    name: "a manifest with no licence field at all",
    path: "package.json",
    text: JSON.stringify({ name: "cookframe" }),
    expected: [{ path: "package.json", declared: "?absent", spdx: null }],
  },
  {
    name: "a lock file whose root entry has no licence field",
    path: "package-lock.json",
    text: JSON.stringify({ packages: { "": { name: "cookframe" } } }),
    expected: [{ path: "package-lock.json", declared: "?absent", spdx: null }],
  },
  {
    name: "a manifest that does not parse",
    path: "package.json",
    text: '{ "license": ',
    expected: [{ path: "package.json", declared: "?unparsable", spdx: null }],
  },
  {
    name: "a link to the licence from the repository root",
    path: "README.md",
    text: "Cookframe is licensed under the [MIT License](LICENSE).\n",
    expected: [{ path: "README.md", declared: "MIT", spdx: null }],
  },
  {
    name: "a link to the licence from one directory down, wrapped across lines",
    path: "docs/open-source-self-hosting-principles.md",
    text: "Cookframe is released under the\n[GNU Affero General Public License, version 3 or later](../LICENSE).\n",
    expected: [
      { path: "docs/open-source-self-hosting-principles.md", declared: "AGPL-3.0", spdx: null },
    ],
  },
  {
    name: "a link to the licence from two directories down",
    path: "docs/product-decisions/PDR-0006.md",
    text: "under the [MIT License](../../LICENSE)\n",
    expected: [{ path: "docs/product-decisions/PDR-0006.md", declared: "MIT", spdx: null }],
  },
  {
    name: "two declarations in one file are two declarations",
    path: "CONTRIBUTING.md",
    text: "under the [MIT License](LICENSE), and\nstays under the [MIT License](LICENSE) for everyone else.\n",
    expected: [
      { path: "CONTRIBUTING.md", declared: "MIT", spdx: null },
      { path: "CONTRIBUTING.md", declared: "MIT", spdx: null },
    ],
  },
  {
    name: "a licence this rule has never heard of is reported, not dropped",
    path: "README.md",
    text: "licensed under the [Blue Oak Model License 1.0.0](LICENSE).\n",
    expected: [
      { path: "README.md", declared: "?unrecognised: Blue Oak Model License 1.0.0", spdx: null },
    ],
  },
]

const MUST_SPARE: readonly Case[] = [
  {
    name: "a record naming a dependency's licence",
    path: "docs/adr/ADR-0010-safe-url-fetch-is-guarded-at-the-connector.md",
    text: "single-file, MIT, zero-production-dependency library covering IPv6, IPv4-mapped IPv6 and\n",
    expected: [],
  },
  {
    name: "a source comment naming a dependency's licence",
    path: "src/security/address-policy.ts",
    text: " * from `ipaddr.js` (single-file, MIT, zero production dependencies). The allow\n",
    expected: [],
  },
  {
    name: "an archived record of the licence this project started under",
    path: "docs/archive/discovery-decision-log.md",
    text: "- License: **MIT**\n",
    expected: [],
  },
  {
    name: "a superseding record quoting the licence it replaces",
    path: "docs/product-decisions/PDR-0006-the-project-is-licensed-under-the-agpl.md",
    text: "> - License: **MIT**\n\nEverything published under MIT up to this record stays available under MIT forever.\n",
    expected: [],
  },
  {
    name: "a link to a vendored dependency's licence file",
    path: "docs/dependencies.md",
    text: "ipaddr.js ships its [MIT License](../vendor/ipaddr.js/LICENSE).\n",
    expected: [],
  },
  {
    name: "a link that names a licence but points somewhere else entirely",
    path: "README.md",
    text: "see the [MIT License](https://opensource.org/license/mit) for the text\n",
    expected: [],
  },
  {
    name: "prose about licensing that names no licence",
    path: "docs/validation-and-evaluation.md",
    text: "- or permissively licensed / otherwise safe to redistribute.\n",
    expected: [],
  },
]

const TABLE: readonly Case[] = [...MUST_FLAG, ...MUST_SPARE]

/** A rule with the same shape as the real one, so a wrong one can be run through the table. */
type Rule = (path: string, text: string) => Declaration[]

/** The names of the rows `rule` gets wrong. Empty means the rule satisfies the table. */
function rowsFailing(rule: Rule): string[] {
  return TABLE.filter((c) => {
    const actual = rule(c.path, c.text)
    return JSON.stringify(actual) !== JSON.stringify(c.expected)
  }).map((c) => c.name)
}

describe("protections/the-licence-rule-discriminates", () => {
  it("flags every declaration and spares every mention", () => {
    // NON-VACUITY FIRST. Without this, a rule that returned nothing at all would
    // leave every spared row below green while guarding nothing — the shape this
    // project has been caught by repeatedly.
    expect(MUST_FLAG.length).toBeGreaterThan(0)
    expect(MUST_SPARE.length).toBeGreaterThan(0)
    expect(rowsFailing(declarationsIn)).toEqual([])
  })

  it("and no rule missing one of its conditions does", () => {
    // ADR-0029 makes this mandatory: a table proves nothing until a deliberately
    // wrong rule is run through it and the row that kills it is NAMED. A row no
    // wrong rule needs is a row measuring nothing.

    // Drop the restriction to the lock file's root entry.
    const everyLockEntry: Rule = (path, text) => {
      if (path !== "package-lock.json") return declarationsIn(path, text)
      const packages = (JSON.parse(text) as { packages?: Record<string, { license?: string }> })
        .packages
      return Object.values(packages ?? {}).flatMap((entry) =>
        entry.license === undefined ? [] : [{ path, declared: entry.license, spdx: entry.license }],
      )
    }
    expect(rowsFailing(everyLockEntry).sort()).toEqual(
      [
        "the lock file's root entry, and not its dependencies",
        "a lock file whose root entry has no licence field",
      ].sort(),
    )

    // Drop the check on where the link points.
    const anyLinkNamingALicence: Rule = (path, text) => {
      if (!path.endsWith(".md")) return declarationsIn(path, text)
      const out: Declaration[] = []
      for (const match of text.matchAll(/\[([^\]\n]+)\]\([^)\s]+\)/g)) {
        const name = match[1] ?? ""
        if (/\bMIT\b|Affero/.test(name)) out.push({ path, declared: "MIT", spdx: null })
      }
      return out
    }
    expect(rowsFailing(anyLinkNamingALicence).sort()).toEqual(
      [
        "a link that names a licence but points somewhere else entirely",
        "a link to a vendored dependency's licence file",
        "a link to the licence from one directory down, wrapped across lines",
        "a licence this rule has never heard of is reported, not dropped",
      ].sort(),
    )

    // Drop the link requirement and read licence names out of prose instead.
    const anyMentionInProse: Rule = (path, text) => {
      if (path === "LICENSE" || path.endsWith(".json")) return declarationsIn(path, text)
      return /\bMIT\b/.test(text) ? [{ path, declared: "MIT", spdx: null }] : []
    }
    expect(rowsFailing(anyMentionInProse).sort()).toEqual(
      [
        "a record naming a dependency's licence",
        "a source comment naming a dependency's licence",
        "an archived record of the licence this project started under",
        "a superseding record quoting the licence it replaces",
        "a link to a vendored dependency's licence file",
        "a link that names a licence but points somewhere else entirely",
        "two declarations in one file are two declarations",
        "a licence this rule has never heard of is reported, not dropped",
        "a link to the licence from one directory down, wrapped across lines",
      ].sort(),
    )

    // Report only the first declaration in a file instead of every one.
    const firstPerFile: Rule = (path, text) => declarationsIn(path, text).slice(0, 1)
    expect(rowsFailing(firstPerFile)).toEqual(["two declarations in one file are two declarations"])

    // Drop the exact identifier and keep only the family, which is what would
    // let `AGPL-3.0-or-later` and `AGPL-3.0-only` drift apart unnoticed.
    const familyOnly: Rule = (path, text) =>
      declarationsIn(path, text).map((d) => ({ ...d, spdx: null }))
    expect(rowsFailing(familyOnly).sort()).toEqual(
      [
        "the manifest's licence field",
        "the manifest's licence field carrying the grant suffix",
        "the lock file's root entry, and not its dependencies",
      ].sort(),
    )
  })
})

/* ------------------------------------------------------------------ *
 * 2. THE AGREEMENT PROOF
 * ------------------------------------------------------------------ */

/** Every declaration the tree makes, sorted by the file it is in. */
function declarationsInTree(): Declaration[] {
  const markdown = filesUnder(repoRoot, { match: /\.md$/, skip: SKIP }).map((f) =>
    relative(repoRoot, f),
  )
  return [...STRUCTURED_SITES, ...markdown]
    .flatMap((p) =>
      // A structured site that is not there at all must name itself rather than
      // simply stop appearing, so that a deleted `LICENSE` reads as a deleted
      // `LICENSE` and not as a list one entry shorter.
      existsSync(join(repoRoot, p))
        ? declarationsIn(p, read(p))
        : [{ path: p, declared: "?missing file", spdx: null }],
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

describe("protections/the-licence-is-stated-in-one-voice", () => {
  it("says the same licence in every place that states one, and these are the places", () => {
    // THE PLACES ARE WRITTEN OUT. Narrowing what the rule reads — a name removed
    // from `STRUCTURED_SITES`, a directory added to `SKIP`, the markdown pattern
    // tightened — takes an entry out of the list on the left and nothing out of
    // the list on the right, which is the whole reason the right-hand side is a
    // literal and not built from the same list.
    //
    // `package-lock.json` is here because of what started the item: it was the
    // one place the first commit of the licence change forgot, four minutes
    // after the record was written saying nothing would catch that.
    expect(declarationsInTree()).toEqual([
      { path: "LICENSE", declared: DECLARED_FAMILY, spdx: null },
      { path: "README.md", declared: DECLARED_FAMILY, spdx: null },
      { path: "package-lock.json", declared: DECLARED_FAMILY, spdx: DECLARED_SPDX },
      { path: "package.json", declared: DECLARED_FAMILY, spdx: DECLARED_SPDX },
    ])
  })
})

/* ------------------------------------------------------------------ *
 * 3. THE CENSUS
 * ------------------------------------------------------------------ */

/**
 * The files whose licence names are NOT this project declaring its own, and why
 * each one is allowed to say what it says.
 *
 * Two of these are declarations in prose that the rule cannot see, and they are
 * written down as such rather than left to be inferred from a green run. They
 * come under the rule as soon as their licence name becomes a link to
 * `LICENSE`, and then they move into the list above instead.
 */
const MENTIONS_ONLY: Readonly<Record<string, string>> = {
  "docs/adr/ADR-0010-safe-url-fetch-is-guarded-at-the-connector.md":
    "names the licence of `ipaddr.js`, not this project's",
  "docs/archive/discovery-decision-log.md":
    "the archived founding decision; a record is never rewritten",
  "docs/open-source-self-hosting-principles.md":
    "NOT COVERED — states the project's licence in prose, with no link to `LICENSE`",
  "docs/validation-and-evaluation.md":
    "NOT COVERED — states the project's licence in prose, with no link to `LICENSE`",
  "src/security/address-policy.ts": "names the licence of `ipaddr.js`, not this project's",
  "tests/protections/license.ts": "the rule itself, which has to name every licence it knows",
  "tests/protections/license.test.ts": "this file",
}

/** Every file in the tree that names any licence, whatever its reason. */
function filesNamingALicense(): string[] {
  const out: string[] = []
  for (const absolute of filesUnder(repoRoot, { skip: SKIP })) {
    const bytes = readFileSync(absolute)
    // A binary file is not prose. Without this the census carries
    // `spikes/s1-capture-quality/fixtures/07-ranges.png`, whose compressed bytes
    // happen to spell `MIT`.
    if (bytes.subarray(0, 8192).includes(0)) continue
    if (mentionsALicense(bytes.toString("utf8"))) out.push(relative(repoRoot, absolute))
  }
  return out.sort()
}

describe("protections/every-file-naming-a-licence-is-accounted-for", () => {
  it("is a declaration site or a mention with a reason, and there is no third kind", () => {
    // WHY THIS EXISTS BESIDE THE PROOF ABOVE. That proof can only compare the
    // places its rule recognises. A declaration written some other way — a
    // sentence in a new document, a field in a new manifest — would be invisible
    // to it and would stay invisible while it went green. It cannot be invisible
    // here: naming a licence at all puts a file in this list, and the only way
    // out is to appear in one of the two lists below by name.
    const declaring = [...new Set(declarationsInTree().map((d) => d.path))]
    expect(filesNamingALicense()).toEqual([...declaring, ...Object.keys(MENTIONS_ONLY)].sort())
  })
})
