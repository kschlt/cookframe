/**
 * serve/every-ingest-entry-point-is-reachable — a way to get a recipe in is a way
 * somebody can use.
 *
 * The measured failure: `importFromUrl` was built, guarded and proved by
 * CFV1-SL4, and had no caller in `src/` at all, so a running instance offered no
 * address that could import a link. `tests/slice4/` drove it thirteen times and
 * every one of those proofs was about the function rather than about the
 * instance — this repository's fourth recurring defect shape, a proof that builds
 * its own subject.
 *
 * The rule and its limits are stated in `ingest-entry-points.ts`. This file is
 * the rule's BREADTH: every entry below names what it is there to stop, and the
 * load-bearing case holds a deliberately NARROWER detector against the same
 * table and requires it to miss, so a detector quietly narrowed back to the one
 * spelling that started this has to go red here rather than sail through on the
 * positives it still catches.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { filesUnder, SOURCE_EXTENSIONS } from "../support/tree.js"
import { where } from "./configured-database.js"
import { ingestEntryPointsIn, namesCalledIn } from "./ingest-entry-points.js"

// The file walk is imported rather than written again, and it is the walk
// ADR-0029 names: `filesUnder` with `SOURCE_EXTENSIONS`, whose own breadth is
// held by `tests/support/tree.test.ts`. This guard asserts that a set of
// violations is EMPTY, so a walk that reads fewer files can only make it easier
// — exactly the shape that ADR is about. An earlier draft of this file walked
// `.ts` only; a `.mts` entry point would have been invisible to it and the
// guard would have reported all-clear.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Each entry says what it stops, so a deletion has to argue with a sentence. */
interface Case {
  readonly name: string
  readonly source: string
  readonly why: string
}

const MUST_FIND: readonly Case[] = [
  {
    name: "the declaration this guard was written for",
    source: `export async function importFromUrl(deps: D, url: string): Promise<IngestResult> {}`,
    why: "the exact shape that had no caller for a whole slice",
  },
  {
    name: "the image path's entry point",
    source: `export async function ingest(repo: R, bytes: Uint8Array): Promise<IngestResult> {}`,
    why: "the other member of the category; a rule that saw only one of them would be a rule about one function",
  },
  {
    name: "an arrow-declared entry point",
    source: `export const importFromPaste = (text: string): Promise<IngestResult> => run(text)`,
    why: "CFV1-SERVE measured a guard keyed on `export function` staying green while the arrow form was live in the layer it scanned",
  },
  {
    name: "a function-expression entry point",
    source: `export const importFromPaste = function (t: string): Promise<IngestResult> { return run(t) }`,
    why: "the third spelling of the same declaration; two out of three is a rule about syntax, not about doors",
  },
  {
    name: "a batch entry point",
    source: `export async function importAll(urls: string[]): Promise<IngestResult[]> {}`,
    why: "this is why the test is `mentions` and not the exact type; a batch import is the same kind of door",
  },
  {
    name: "an entry point that may decline",
    source: `export async function importIfFresh(u: string): Promise<IngestResult | undefined> {}`,
    why: "a union return is still an entry point, and keying on the exact spelling would miss it",
  },
]

const MUST_SPARE: readonly Case[] = [
  {
    name: "a function that is not exported",
    source: `async function importFromUrl(u: string): Promise<IngestResult> {}`,
    why: "a module-private function cannot be called from another directory at all, so demanding a caller there would be a demand nobody can meet",
  },
  {
    name: "a CONSUMER of an ingest result",
    source: `export function describeImport(result: IngestResult): string { return result.snapshot.id }`,
    why: "this is the entry that dies if the type test stops looking at the RETURN type; without it, `mentions` could drift to mentioning the type anywhere and the table would still be green",
  },
  {
    name: "an exported function returning something else",
    source: `export function createContentDerivedBlockIdPolicy(): BlockIdPolicy { return p }`,
    why: "most of `src/pipeline/` is this; a guard that crept to cover it would stop being trusted",
  },
  {
    name: "an exported type alias",
    source: `export type ImportOutcome = Promise<IngestResult>`,
    why: "a type is not a door — there is nothing here for the http layer to call",
  },
  {
    name: "an exported interface with an ingest method",
    source: `export interface Importer { run(u: string): Promise<IngestResult> }`,
    why: "an interface declares a capability; the name `run` is not something `src/http/` could call by itself",
  },
  {
    name: "an exported const that is not a function",
    source: `export const NO_RESULTS: IngestResult[] = []`,
    why: "a value mentioning the type is not a way to produce one",
  },
  {
    name: "a non-exported arrow with the same return type",
    source: `const importInternal = (u: string): Promise<IngestResult> => run(u)`,
    why: "the arrow form of the first spare; without it, adding the arrow reader could have dropped the export test on that branch alone",
  },
]

const CALLS: readonly Case[] = [
  {
    name: "a plain call",
    source: `const r = await importFromUrl(deps, url, a, b)`,
    why: "the shape this unit added to the route",
  },
  {
    name: "a call through a collaborator",
    source: `const r = await deps.pipeline.importFromUrl(url)`,
    why: "an entry point reached through an injected object is still reached",
  },
]

const NOT_CALLS: readonly Case[] = [
  {
    name: "a bare reference",
    source: `void importFromUrl`,
    why: "the mirror of what CFV1-SERVE found: a rule named for calling must not accept a mention, or the tree can go dark again with the name still in it",
  },
  {
    name: "an import binding",
    source: `import { importFromUrl } from "../pipeline/url-import.js"`,
    why: "importing the module is what the dark tree ALREADY did not do; making it sufficient would set the bar below the defect",
  },
  {
    name: "an alias that is never invoked",
    source: `const run = importFromUrl`,
    why: "assigning it calls nothing",
  },
  {
    name: "the name inside a string",
    source: `const message = "importFromUrl(deps, url)"`,
    why: "prose about a call is not a call; this is why the scan reads the syntax tree and not a regular expression",
  },
]

const names = (source: string): string[] => ingestEntryPointsIn(source).map((e) => e.name)

describe("serve/every-ingest-entry-point-is-reachable", () => {
  it("sees an entry point in every spelling one can be declared in", () => {
    for (const entry of MUST_FIND) {
      expect(names(entry.source), `${entry.name} — ${entry.why}`).toHaveLength(1)
    }
  })

  it("spares what is not a door", () => {
    for (const entry of MUST_SPARE) {
      expect(names(entry.source), `${entry.name} — ${entry.why}`).toHaveLength(0)
    }
  })

  it("names the entry point, so a finding says which one has no caller", () => {
    expect(
      names(`export async function importFromUrl(u: string): Promise<IngestResult> {}`),
    ).toEqual(["importFromUrl"])
  })

  it("counts a call as a call and a mention as nothing", () => {
    for (const entry of CALLS) {
      expect(namesCalledIn(entry.source).has("importFromUrl"), `${entry.name} — ${entry.why}`).toBe(
        true,
      )
    }
    for (const entry of NOT_CALLS) {
      expect(namesCalledIn(entry.source).has("importFromUrl"), `${entry.name} — ${entry.why}`).toBe(
        false,
      )
    }
  })

  /**
   * The breadth proof. A detector narrowed to the one spelling that started this
   * — `export function` with the literal text `Promise<IngestResult>` — still
   * passes every positive it can see, which is exactly how a narrowing gets
   * merged. Held against the SAME table, it must be caught MISSING things.
   *
   * The names are asserted, not merely a count: "misses at least one" stays true
   * while someone quietly widens the narrow reference, and a bare count can be
   * kept right by a different set of misses.
   */
  it("a detector narrowed to the first spelling is caught missing the rest", () => {
    const narrow = (source: string): boolean =>
      /export\s+(async\s+)?function\s+\w+\s*\([^)]*\)\s*:\s*Promise<IngestResult>/.test(source)

    expect(MUST_FIND.filter((entry) => !narrow(entry.source)).map((e) => e.name)).toEqual([
      "an arrow-declared entry point",
      "a function-expression entry point",
      "a batch entry point",
      "an entry point that may decline",
    ])

    // ...and the narrow reference is not merely blind: it does catch the two it
    // was drawn around. Without this, emptying its body would also satisfy the
    // line above and the proof would be measuring nothing.
    expect(MUST_FIND.filter((entry) => narrow(entry.source)).map((e) => e.name)).toEqual([
      "the declaration this guard was written for",
      "the image path's entry point",
    ])
  })

  /**
   * The negative table is the half that can be gutted without anything noticing:
   * deleting a spare entry can only turn a red guard green.
   */
  it("the sparing table is not quietly gutted to make a later change pass", () => {
    expect(MUST_SPARE.length).toBeGreaterThan(5)
    expect(NOT_CALLS.length).toBeGreaterThan(3)
  })

  /**
   * The real subject: the tree as it is now.
   *
   * The floor comes first and is not decoration. A scan that found NO entry
   * points would satisfy "every entry point is called" vacuously — the third
   * recurring shape, a no-op passing because there was nothing to fail on — and
   * that is not hypothetical: the same guard's file walk shipped once returning
   * an empty list, and every assertion resting on it was green.
   */
  it("every way into the pipeline is called from the HTTP layer", () => {
    const entryPoints = filesUnder(join(repoRoot, "src", "pipeline"), {
      match: SOURCE_EXTENSIONS,
    }).flatMap((path) => ingestEntryPointsIn(readFileSync(path, "utf8"), where(repoRoot, path)))
    expect(
      entryPoints.map((e) => e.name).sort(),
      "a scan that finds nothing satisfies the rule below without reading a thing",
    ).toEqual(["importFromUrl", "ingest"])

    const called = new Set<string>()
    for (const path of filesUnder(join(repoRoot, "src", "http"), { match: SOURCE_EXTENSIONS })) {
      for (const name of namesCalledIn(readFileSync(path, "utf8"), where(repoRoot, path))) {
        called.add(name)
      }
    }

    expect(
      entryPoints.filter((e) => !called.has(e.name)).map((e) => `${e.name} (${e.at})`),
      "a way to get a recipe in that the HTTP layer never calls is a capability with no door",
    ).toEqual([])
  })
})
