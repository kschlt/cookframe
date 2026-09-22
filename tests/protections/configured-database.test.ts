/**
 * protections/a-test-runs-on-what-was-configured — the test tree decides what to
 * run from what was ASKED FOR, never from what happens to be listening.
 *
 * Why this is a protection and not a style rule: a suite gated on reachability
 * reports a different total on two correctly set-up machines, and the larger
 * total is the dishonest one. Measured on 2026-09-22, with `DATABASE_URL` unset:
 * `vitest run tests/dbq` answered `34 passed | 1 skipped` with a local server up at
 * `DEFAULT_URL` specifically and `27 passed | 8 skipped` with it stopped. On a machine
 * whose PostgreSQL listens on another port it read 27/8 either way — so the total
 * depended on which port a correctly set-up machine happened to use, which is the
 * same defect seen from further away. Seven proofs ran because
 * something was listening, not because anyone had asked for them — and the same
 * substitution put a wrong figure into a pull request description.
 *
 * The table below is the guard's BREADTH, not just its aim. Every entry names
 * what it is there to stop, and the load-bearing test holds a deliberately
 * NARROWER detector against the same table and requires it to miss: a detector
 * quietly narrowed back to one spelling has to go red here rather than sail
 * through on the positives it still catches.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  defaultedDatabaseUrls,
  type Finding,
  typeScriptFilesUnder,
  where,
} from "./configured-database.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Each entry says what it stops, so a deletion has to argue with a sentence. */
interface Case {
  readonly name: string
  readonly source: string
  readonly why: string
}

const MUST_FLAG: readonly Case[] = [
  {
    name: "nullish default on a property read",
    source: `const url = process.env.DATABASE_URL ?? "postgres://localhost/x"`,
    why: "the exact line this guard was written for",
  },
  {
    name: "nullish default on a bracket read",
    source: `const url = process.env["DATABASE_URL"] ?? FALLBACK`,
    why: "bracket access is the same read; the repo uses this spelling under noPropertyAccessFromIndexSignature",
  },
  {
    name: "logical-or default",
    source: `const url = process.env.DATABASE_URL || DEFAULT_URL`,
    why: "`||` substitutes for an empty string too, so it is strictly wider than `??`",
  },
  {
    name: "conditional default, undefined check",
    source: `const url = process.env["DATABASE_URL"] === undefined ? LOCAL : process.env["DATABASE_URL"]`,
    why: "the spelling that survives being told not to write `??`",
  },
  {
    name: "conditional default, truthiness",
    source: `const url = process.env.DATABASE_URL ? process.env.DATABASE_URL : LOCAL`,
    why: "same substitution, no equality operator to key on",
  },
  {
    name: "default behind parentheses",
    source: `const url = (process.env.DATABASE_URL) ?? LOCAL`,
    why: "a parenthesis must not be a way past the guard",
  },
  {
    name: "default behind an as-cast",
    source: `const url = (process.env["DATABASE_URL"] as string | undefined) ?? LOCAL`,
    why: "a cast is the natural thing to write here and must not hide the default",
  },
  {
    name: "importing the defaulting accessor",
    source: `import { connectTo, databaseUrl } from "../../spikes/dbq/db.js"`,
    why: "the substitution one module away is the same substitution",
  },
  {
    name: "importing the default constant",
    source: `import { DEFAULT_URL } from "../../spikes/dbq/db.js"`,
    why: "a test that names the constant is choosing a URL nobody configured",
  },
  {
    name: "importing the accessor under an alias",
    source: `import { databaseUrl as anyDatabase } from "../../spikes/dbq/db.js"`,
    why: "keying on the local name instead of the imported one is a rename away from silent",
  },
  {
    name: "importing the defaulting connector",
    source: `import { connect } from "../../spikes/dbq/db.js"`,
    why: "`connect()` IS `connectTo(databaseUrl())` — the same substitution one call deeper, and the line this file replaced",
  },
]

const MUST_SPARE: readonly Case[] = [
  {
    name: "a bare read with no stand-in",
    source: `const configured = process.env["DATABASE_URL"]`,
    why: "reading the variable is the CORRECT thing; flagging it would leave no way to ask the question",
  },
  {
    name: "a bare read, then an explicit undefined branch that does not substitute a URL",
    source: `const configured = process.env["DATABASE_URL"]
const client = configured === undefined ? undefined : await connectTo(configured)`,
    why: "this is the shipped fix; a guard that flags it forbids its own remedy",
  },
  {
    name: "importing the URL-taking connector",
    source: `import { connectTo, SHAPES } from "../../spikes/dbq/db.js"`,
    why: "`connectTo` takes what it is given — the whole point of the split",
  },
  {
    name: "the availability rule itself",
    source: `import { decideDatabaseAvailability } from "../persistence/postgres-harness.js"`,
    why: "routing through the rule is what this guard wants, not what it forbids",
  },
  {
    name: "a default for some other variable",
    source: `const port = process.env["PORT"] ?? "3000"`,
    why: "the guard is about the database, and a guard that creeps stops being trusted",
  },
  {
    name: "a default for a similarly-named variable",
    source: `const shadow = process.env["DATABASE_URL_FOR_DOCS"] ?? "postgres://docs"`,
    why: "prefix matching would flag this; the read must be the exact name",
  },
  {
    name: "DATABASE_URL on the RIGHT of a default",
    source: `const url = explicitlyChosen ?? process.env["DATABASE_URL"]`,
    why: "this defaults TO the configured value; it substitutes nothing for it",
  },
  {
    name: "the same export name from an unrelated module",
    source: `import { DEFAULT_URL } from "../url-fetch/network-primitives.js"`,
    why: "the guard names a module, not a word; another module's constant is not this defect",
  },
  {
    name: "the same export name from a NEIGHBOURING module whose path contains db",
    source: `import { DEFAULT_URL } from "../dbq/report-fixtures.js"`,
    why: "this is the entry that dies if the module pattern is loosened to /db/; without it the pattern's anchoring is pinned by nothing, and a widened match sails through",
  },
  {
    name: "the spike module's own harmless exports",
    source: `import { SHAPES, resetShape, useShape } from "../../spikes/dbq/db.js"`,
    why: "the module is not forbidden — only the three exports that substitute a URL are",
  },
  {
    name: "a string that merely mentions the variable",
    source: `expect(message).toContain("DATABASE_URL is not set") || "fallback"`,
    why: "prose about the variable is not a read of it",
  },
]

const kinds = (source: string): string[] => defaultedDatabaseUrls(source).map((f) => f.kind)

describe("protections/a-test-runs-on-what-was-configured", () => {
  it("flags every spelling that substitutes a URL nobody configured", () => {
    for (const entry of MUST_FLAG) {
      expect(defaultedDatabaseUrls(entry.source), `${entry.name} — ${entry.why}`).not.toHaveLength(
        0,
      )
    }
  })

  it("spares reading the variable, and everything that is not this defect", () => {
    for (const entry of MUST_SPARE) {
      expect(defaultedDatabaseUrls(entry.source), `${entry.name} — ${entry.why}`).toHaveLength(0)
    }
  })

  it("names WHICH spelling it found, so a fixture asserts the reason and not the count", () => {
    expect(kinds(`const u = process.env.DATABASE_URL ?? LOCAL`)).toEqual(["defaulted-env-read"])
    expect(kinds(`import { databaseUrl } from "../../spikes/dbq/db.js"`)).toEqual([
      "defaulting-import",
    ])
  })

  /**
   * The breadth proof. A detector narrowed back to the one spelling that started
   * this — `process.env.DATABASE_URL ?? X`, property access and `??` only —
   * still passes every positive it can see, which is exactly how a narrowing
   * gets merged. Held against the SAME table, it must be caught MISSING things.
   *
   * The count is asserted, not merely "some": "misses at least one" stays true
   * while someone quietly widens the narrow reference, which would make this
   * test stop measuring anything. The names are asserted too, so the number
   * cannot be kept right by a different set of misses.
   */
  it("a detector narrowed to the first spelling is caught missing the rest", () => {
    const narrow = (source: string): boolean =>
      /process\s*\.\s*env\s*\.\s*DATABASE_URL\s*\?\?/.test(source)

    const missed = MUST_FLAG.filter((entry) => !narrow(entry.source))
    expect(missed.map((m) => m.name)).toEqual([
      "nullish default on a bracket read",
      "logical-or default",
      "conditional default, undefined check",
      "conditional default, truthiness",
      "default behind parentheses",
      "default behind an as-cast",
      "importing the defaulting accessor",
      "importing the default constant",
      "importing the accessor under an alias",
      "importing the defaulting connector",
    ])

    // ...and the narrow reference is not merely blind: it does catch the entry
    // it was drawn around. Without this, deleting the reference's body would
    // also pass the line above, and the proof would be measuring nothing.
    expect(MUST_FLAG.filter((entry) => narrow(entry.source)).map((m) => m.name)).toEqual([
      "nullish default on a property read",
    ])
  })

  /**
   * The negative table is the half that can be gutted without anything noticing:
   * deleting a spare entry can only turn a red guard green. This does not test
   * the detector — it stops the table from shrinking to the point where the
   * sparing half proves nothing.
   */
  it("the sparing table is not quietly gutted to make a later change pass", () => {
    expect(MUST_SPARE.length).toBeGreaterThan(6)
  })

  /**
   * The file walk, proved separately from the detector.
   *
   * This was a SURVIVOR: dropping the recursion left every other test green,
   * because `tests/` holds no `.ts` files at its top level — every one of them
   * is in a subdirectory. So a walk that stopped at depth one returned an empty
   * list, the tree scan below found nothing, and the guard reported all-clear
   * while reading no file at all. The fourth recurring defect shape of this
   * project, in the subject-gathering half: a proof that never asks the system
   * anything.
   *
   * A real two-level tree, because the property is about descending, and a
   * mocked directory would prove only that the mock was written correctly.
   */
  it("reads files at every depth, not just the top level", () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-walk-"))
    try {
      mkdirSync(join(dir, "one", "two"), { recursive: true })
      writeFileSync(join(dir, "top.ts"), "export const a = 1")
      writeFileSync(join(dir, "one", "middle.ts"), "export const b = 2")
      writeFileSync(join(dir, "one", "two", "deep.ts"), "export const c = 3")
      writeFileSync(join(dir, "one", "ignored.txt"), "not typescript")

      const found = typeScriptFilesUnder(dir)
        .map((p) => where(dir, p))
        .sort()
      expect(found).toEqual(["one/middle.ts", "one/two/deep.ts", "top.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** The real subject: the tree as it is now. */
  it("no file under tests/ decides which database to use from a value nobody configured", () => {
    const offenders: Finding[] = []
    for (const path of typeScriptFilesUnder(join(repoRoot, "tests"))) {
      // This file and its detector carry the violations as FIXTURE TEXT inside
      // string literals, which the parser reads as strings and not as reads —
      // so no exemption is needed for them, and none is granted. A guard with a
      // path exemption is one rename from exempting the thing it guards.
      offenders.push(...defaultedDatabaseUrls(readFileSync(path, "utf8"), where(repoRoot, path)))
    }
    expect(
      offenders.map((o) => `${o.at} (${o.kind})`),
      "a suite gated on what is listening reports a different total on two correctly set-up machines",
    ).toEqual([])
  })
})
