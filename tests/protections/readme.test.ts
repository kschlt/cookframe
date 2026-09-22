/**
 * The proof that `README.md` says what the tree does — and, where it cannot be
 * measured, that it keeps saying what it said.
 *
 * The reading is in `./readme.ts`; this file is its proof, in three parts:
 *
 * 1. **The reading tables.** Written-out strings, never the tree, so that what
 *    `bulletsAfter`, `moduleClosure`, `callsTo` and `declaredNames` tell apart
 *    stays pinned after the README is right.
 * 2. **The placement proof.** Every capability the README talks about is a row
 *    below, naming the function whose call decides it. Measured against the
 *    closure of `src/server/main.ts`, each row must sit in the list the tree
 *    puts it in: "Working today" when it is reached, "Built and tested, but not
 *    reachable" and "Not there yet" when it is not. Every bullet in the three
 *    lists must be claimed by exactly one row.
 * 3. **Two sentences held against a file.** The release warning against
 *    `package.json`'s version, and the setup commands against `migrations/`.
 *    The Node version is held with every other Node pin, in
 *    `tests/unit/repo-config.test.ts`, so that the agreement has one home.
 *
 * ## Why the rows are written out
 *
 * Nothing here derives a row from the README or from `src/`. A row names a
 * capability, the phrase each list uses for it, and the function whose call
 * decides it — so moving a capability costs an edit here, on purpose. That is
 * the moment the page needs a person's eyes, and it is the only moment.
 *
 * ## Breadth, per ADR-0029
 *
 * The rule that can pass by reading less is "not reachable": a closure that
 * shrank would find fewer calls and agree with every "not yet" on the page.
 * So the closure's breadth is pinned by NAME — `reads the process's whole
 * import closure` lists the exact modules the process does not load — and a
 * closure that loses a module turns red there, whatever it does to the rows.
 * The other half, "reached", asserts a presence, and a narrower reading can
 * only fail it.
 *
 * ## MEASURED on 2026-09-22 against `903b4e2`
 *
 * Run against `main` as it stood, this proof was red at exactly the two rows
 * #94 left behind: `bring` (the page still called the handoff unreachable) and
 * the OQ-48 row (the page did not say a link dies with the process). This
 * change fixes the page; the proof found it.
 *
 * Thirty-six plants, each judged from the test it had to fail, not from an
 * exit code. All red at their own assertion.
 *
 * | planted in | the violation | red at |
 * | --- | --- | --- |
 * | `README.md` | an invented feature under "Working today" (#79's first plant) | the "Working today" census |
 * | `README.md` | the capture-quality limit deleted (#79's second) | `capture quality` |
 * | `README.md` | the old Node major put back (#79's third) | the Node pins, in `repo-config.test.ts` |
 * | `README.md` | the stale Bring line back under "built" | `bring` |
 * | `README.md` | Bring dropped from "Working today" | `bring` |
 * | `README.md` | the OQ-48 limit deleted | `a Bring link outlives a restart` |
 * | `README.md` | the photograph dropped from "built" | `keeping the photograph` |
 * | `README.md` | the re-conversion limit deleted | `re-converting a stored recipe` |
 * | `README.md` | the release warning deleted | the release proof |
 * | `README.md` | a migration command dropped | the migration proof |
 * | `README.md` | a limit no row names added to "not yet" | the "not yet" census |
 * | `README.md` | two working items merged into one | the "Working today" census |
 * | `CONTRIBUTING.md` | the old Node major put back | the Node pins |
 * | `package.json` | the version leaves `0.0.0` | the release proof |
 * | `pages-app.ts` | the share route deleted | `bring` |
 * | `main.ts` | the byte store wired | `keeping the photograph` |
 * | `main.ts` | a second caller of `reprocess` | `re-converting a stored recipe` |
 * | `main.ts` | the grant store no longer the in-memory one | `a Bring link outlives a restart` |
 * | `ingest-app.ts` | the URL route stops calling `importFromUrl` | `import from a link` |
 * | `readme.ts` | `import type` followed | `does not follow a type-only import` |
 * | `readme.ts` | `import()` not followed | `follows a dynamic import` |
 * | `readme.ts` | `export … from` not followed | `follows a re-export` |
 * | `readme.ts` | the closure skips `src/http/` | `reads the process's whole import closure` |
 * | `readme.ts` | an unresolved import dropped silently | `reports an import it cannot resolve` |
 * | `readme.ts` | a reference counted as a call | `does not count a reference passed along` |
 * | `readme.ts` | `new` not counted | `counts a construction` |
 * | `readme.ts` | names matched by prefix | `does not count a longer name` |
 * | `readme.ts` | continuation lines not joined | `joining an item's continuation lines` |
 * | `readme.ts` | a list read past its end | `ends a list at the first line that is not an item` |
 * | `readme.ts` | a lead matched mid-line | `takes a lead only at the start of a line` |
 * | `readme.ts` | a second lead ignored | `refuses a lead that starts two lines` |
 * | `readme.ts` | variables not read as declarations | `sees a variable as declaring the name` |
 * | this file | `schema/` left out of the code roots | `reads the process's whole import closure` |
 * | this file | a row's `except` ignored | `re-converting a stored recipe` |
 * | this file | a row measuring a misspelt name | `names only functions that exist` |
 * | `shopping-handoff.test.ts` | its second half reads a literal (#94's advisory) | `finds a call to every one of them` |
 *
 * ### And what MUST stay green, measured the same way
 *
 * - **A call on a dead path.** The share route wrapped in `if (Date.now() < 0)`
 *   keeps the `issue` call in the tree, so the `bring` row stays green. That is
 *   the limit `readme.ts` declares, and it is not left open: the socket proof
 *   `run/a-recipe-can-be-handed-to-bring-from-a-running-instance` goes red on
 *   the same plant, six cases. The first attempt at the share-route plant
 *   above made this exact mistake by moving the handler into an unused
 *   function, and survived. That is why the plant now deletes the route.
 * - **A limit that ends.** The in-memory grant store replaced AND the OQ-48
 *   bullet deleted, together: green. That is not inertness, and it is
 *   measured: with the one condition that spares it removed — a reached row
 *   with no `working` phrase must still be listed as working — the same plant
 *   goes red at `a Bring link outlives a restart`. So the survivor is spared
 *   by that condition, and the condition kills something when it goes.
 *
 * ## After #97, on the first merge of `main`
 *
 * #97 closed OQ-48 and landed while this change was open. Merging it turned
 * this proof red at three places, each a real finding:
 *
 * - `a Bring link outlives a restart`: the page still stated the limit.
 * - `names only functions that exist`: the row measured the ABSENCE of a
 *   call to `createInMemoryCapabilityStore`, and #97 deleted the function. A
 *   row measuring the absence of a name nobody declares would have been true
 *   forever. It now measures the call that builds the store over the
 *   repository, and the `notCalled` kind of measure it needed went with it.
 * - `lists one psql command per file in migrations/`: #97 added
 *   `migrations/0003-the-capability-grant.sql`, and the README's setup still
 *   applied two. An operator following the page would have got an instance
 *   that refuses to start — `main.ts` probes `capability_grant` before it
 *   binds — with the page itself the reason.
 *
 * ## After #98, on the second merge of `main`
 *
 * #98 wired the byte store and rewrote both photograph bullets itself, so the
 * merge had nothing to correct on the page — the check is that it had nothing
 * to correct, measured rather than assumed. It was red at three places, all in
 * this file and all expected: the census lost the two storage modules the
 * process now loads, and #98's new bullet, "a picture of the dish", was
 * claimed by no row in either list. It has a row now, and that row is
 * `stated`, for the reason the row gives.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { filesUnder, SOURCE_EXTENSIONS } from "../support/tree.js"
import { bulletsAfter, callsTo, declaredNames, moduleClosure } from "./readme.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8")

/* ------------------------------------------------------------------ *
 * 1. THE READING TABLES
 * ------------------------------------------------------------------ */

const PAGE = [
  "# A page",
  "",
  "Working today:",
  "",
  "- **One.** A first line",
  "  and its continuation.",
  "- **Two.**",
  "",
  "Built and tested, but not reachable",
  "from a running instance yet:",
  "",
  "- three;",
  "- four.",
  "## Next heading",
  "",
  "An aside that says Working today: in the middle of a line.",
  "",
  "Empty list:",
  "",
  "Not a list.",
].join("\n")

describe("protections/the-readme-reading-is-precise", () => {
  it("reads a tight list, joining an item's continuation lines", () => {
    expect(bulletsAfter(PAGE, "Working today:")).toEqual([
      "**One.** A first line and its continuation.",
      "**Two.**",
    ])
  })

  it("reads past an introducing paragraph of more than one line", () => {
    expect(bulletsAfter(PAGE, "Built and tested, but not reachable")).toEqual(["three;", "four."])
  })

  it("ends a list at the first line that is not an item", () => {
    // The heading right after "four." is not an item and must not be joined
    // onto it; a reading that ran on would claim a heading as a feature.
    expect(bulletsAfter(PAGE, "Built and tested")?.at(-1)).toBe("four.")
  })

  it("answers an empty list with no items, and a missing lead with null", () => {
    expect(bulletsAfter(PAGE, "Empty list:")).toEqual([])
    expect(bulletsAfter(PAGE, "Not on this page:")).toBeNull()
  })

  it("takes a lead only at the start of a line", () => {
    // The aside names the lead mid-line. Were it read, the lead would be
    // ambiguous and the call would throw.
    expect(() => bulletsAfter(PAGE, "Working today:")).not.toThrow()
  })

  it("refuses a lead that starts two lines", () => {
    expect(() => bulletsAfter(`${PAGE}\nWorking today:\n\n- again`, "Working today:")).toThrow(
      /2 lines start with/,
    )
  })

  /** Loads the closure must follow, each in a module of its own. */
  const LOADS: readonly (readonly [string, string])[] = [
    ["a named import", 'import { a } from "./dep.js"'],
    ["a default import", 'import a from "./dep.js"'],
    ["a side-effect import", 'import "./dep.js"'],
    ["an import naming one type among values", 'import { type A, b } from "./dep.js"'],
    ["a re-export", 'export { a } from "./dep.js"'],
    ["a star re-export", 'export * from "./dep.js"'],
    ["a dynamic import", 'const m = await import("./dep.js")'],
  ]

  it.each(LOADS)("follows %s", (_, line) => {
    const sources = new Map([
      ["src/main.ts", line],
      ["src/dep.ts", ""],
    ])
    expect([...moduleClosure("src/main.ts", sources).reached].sort()).toEqual([
      "src/dep.ts",
      "src/main.ts",
    ])
  })

  /** Lines that load nothing at run time, or nothing of this repository's. */
  const LOADS_NOTHING: readonly (readonly [string, string])[] = [
    ["a type-only import", 'import type { A } from "./dep.js"'],
    ["a type-only re-export", 'export type { A } from "./dep.js"'],
    ["a package", 'import { Hono } from "hono"'],
    ["a comment naming the module", '// import { a } from "./dep.js"'],
  ]

  it.each(LOADS_NOTHING)("does not follow %s", (_, line) => {
    const sources = new Map([
      ["src/main.ts", line],
      ["src/dep.ts", ""],
    ])
    const closure = moduleClosure("src/main.ts", sources)
    expect([...closure.reached]).toEqual(["src/main.ts"])
    expect(closure.unresolved).toEqual([])
  })

  it("resolves a specifier across directories and each script extension", () => {
    const sources = new Map([
      [
        "src/server/main.ts",
        'import "../http/a.js"\nimport "./b.mjs"\nimport "./c.cjs"\nimport "./d.jsx"',
      ],
      ["src/http/a.ts", 'import "../shared/e.js"'],
      ["src/server/b.mts", ""],
      ["src/server/c.cts", ""],
      ["src/server/d.tsx", ""],
      ["src/shared/e.ts", ""],
    ])
    expect([...moduleClosure("src/server/main.ts", sources).reached].sort()).toEqual([
      "src/http/a.ts",
      "src/server/b.mts",
      "src/server/c.cts",
      "src/server/d.tsx",
      "src/server/main.ts",
      "src/shared/e.ts",
    ])
  })

  it("reports an import it cannot resolve instead of stopping there", () => {
    const sources = new Map([["src/main.ts", 'import "./gone.js"']])
    expect(moduleClosure("src/main.ts", sources).unresolved).toEqual(["src/main.ts -> ./gone.js"])
  })

  it("reports an entry that is not in the tree", () => {
    expect(moduleClosure("src/main.ts", new Map()).unresolved).toEqual(["(entry) -> src/main.ts"])
  })

  it("survives a cycle", () => {
    const sources = new Map([
      ["src/a.ts", 'import "./b.js"'],
      ["src/b.ts", 'import "./a.js"'],
    ])
    expect(moduleClosure("src/a.ts", sources).reached.size).toBe(2)
  })

  /** Every way of running `issue` the reading must count. */
  const CALLS: readonly (readonly [string, string])[] = [
    ["a plain call", "issue(id)"],
    ["a method call", "await store.issue(id)"],
    ["an optional call", "store?.issue(id)"],
    ["a call through a non-null assertion", "store.issue!(id)"],
    ["a parenthesised callee", "(store.issue)(id)"],
    ["an element access", 'store["issue"](id)'],
    ["a construction", "throw new issue(id)"],
  ]

  it.each(CALLS)("counts %s", (_, source) => {
    expect(callsTo(source, "issue")).toBe(1)
  })

  /** Every way of naming `issue` without running it. */
  const MENTIONS: readonly (readonly [string, string])[] = [
    ["an import", 'import { issue } from "./x.js"'],
    ["a reference passed along", "const f = store.issue"],
    ["a comment", "// store.issue(id) mints the grant"],
    ["a string", 'const s = "store.issue(id)"'],
    ["a longer name", "store.issued(id)"],
    ["a method declaration", "class S { issue(id: string) { return id } }"],
    ["an interface member", "interface S { issue(id: string): string }"],
  ]

  it.each(MENTIONS)("does not count %s", (_, source) => {
    expect(callsTo(source, "issue")).toBe(0)
  })

  /** Declarations that make a name exist, and forms that must not. */
  const DECLARES: readonly (readonly [string, string])[] = [
    ["a function", "export function reprocess() {}"],
    ["a class", "export class reprocess extends Error {}"],
    ["a method", "class S { reprocess() {} }"],
    ["an interface method", "interface S { reprocess(): void }"],
    ["an interface property", "interface S { reprocess: () => void }"],
    ["a variable", "export const reprocess = () => 1"],
  ]

  it.each(DECLARES)("sees %s as declaring the name", (_, source) => {
    expect(declaredNames(source).has("reprocess")).toBe(true)
  })

  it("does not see a name that is only called or mentioned as declared", () => {
    const source = 'reprocess(x)\n// function reprocess\nconst s = "reprocess"'
    expect([...declaredNames(source)]).toEqual(["s"])
  })
})

/* ------------------------------------------------------------------ *
 * 2. THE PLACEMENT PROOF
 * ------------------------------------------------------------------ */

/** The sentences that introduce the three lists this proof reads. */
const WORKING = "Working today:"
const BUILT = "Built and tested, but not reachable from a running instance yet"
const NOT_YET = "Not there yet, stated as plainly as the rest:"

/** How a row is decided. */
type Measure =
  /** Reached when every name is called from a module the process loads, outside `except`. */
  | { readonly called: readonly string[]; readonly except?: readonly string[] }
  /** Not measurable here: the page must keep saying it, and that is all. */
  | { readonly stated: true }

interface Row {
  readonly id: string
  readonly measure: Measure
  /** The phrase its bullet in each list contains, for the lists it may be in. */
  readonly working?: string
  readonly built?: string
  readonly notYet?: string
}

/**
 * Every capability the three lists talk about.
 *
 * A reached row must be missing from "built" and "not yet", and present under
 * "Working today" when it names a phrase there. A row with no `working` phrase
 * is a limit rather than a feature — OQ-48's row is one — and when the limit
 * goes, its bullet goes, with nothing to add in its place. A row that is not
 * reached must name at least one of the other two, so the page admits it.
 *
 * A row that moved stays here with the phrases it used to have: `bring` is the
 * row this proof was cut for, and its `built` and `notYet` phrases are the two
 * sentences #94 left standing.
 */
const ROWS: readonly Row[] = [
  {
    id: "capture from a phone",
    measure: { called: ["ingest"] },
    working: "**Capture a page with your phone.**",
  },
  {
    id: "import from a link",
    measure: { called: ["importFromUrl"] },
    working: "**Import a recipe from a link.**",
  },
  {
    id: "one consistent recipe",
    measure: { called: ["reprocess", "resolveSourceRefs"] },
    working: "**One consistent recipe, whatever the source.**",
  },
  {
    id: "library and recipe pages",
    measure: { called: ["renderLibraryPage", "renderRecipePage"] },
    working: "**Your library on one page**",
  },
  {
    id: "cooking view",
    measure: { called: ["deriveCookingPlan", "renderCookingPage"] },
    working: "**A cooking view derived from the recipe**",
  },
  {
    id: "refusal of a page holding several recipes",
    measure: { called: ["MultipleRecipesError"] },
    working: "**A refusal instead of a guess.**",
  },
  {
    id: "bring",
    measure: { called: ["issue", "revoke", "bringImportUrl"] },
    working: "**Hand a recipe to Bring.**",
    built: "handing a shopping list to Bring",
    notYet: "**The shopping handoff is not wired into the pages.**",
  },
  {
    id: "keeping the photograph",
    // Wired by #98, and this row moved with it on the next merge of `main`.
    // It has no `working` phrase because the page says it inside the capture
    // bullet ("keeps the photograph"), which the capture row claims; what this
    // row still pins is that neither old sentence comes back.
    measure: { called: ["createFilesystemByteStore"] },
    built: "keeping the photograph itself",
    notYet: "**The photograph you submit is converted and then not kept.**",
  },
  {
    id: "a picture of the dish",
    // Stated, not measured, and deliberately. The renderer takes a
    // `mediaSrc` resolver and calls it itself, so "is it wired" is whether a
    // caller HANDS one over — a property in an options object, which no call
    // can decide. The only call to `mediaSrc` sits in the renderer and runs the
    // same whether or not the pages pass one, so a `called` measure here would
    // read "reached" today and be wrong. `ADR-0004`'s seam is what a measure
    // would have to read; until one does, the page keeps saying it.
    measure: { stated: true },
    built: "a picture of the dish on a recipe's page",
    notYet: "**A recipe's page has no picture.**",
  },
  {
    id: "re-converting a stored recipe",
    // `ingest` calls it once per import, which is exactly what the page says
    // is all that happens today. Any other caller is the capability.
    measure: { called: ["reprocess"], except: ["src/pipeline/ingest.ts"] },
    built: "re-converting a recipe you already have",
    notYet: "**Nothing re-converts a recipe you already have.**",
  },
  {
    id: "a Bring link outlives a restart",
    // OQ-48, closed by #97. Until then the process built its grant store with
    // `createInMemoryCapabilityStore`, and this row measured that call's
    // ABSENCE; #97 deleted the function, and `names only functions that exist`
    // said so on the first run after the merge. The store is now built over the
    // repository, so the row measures that call instead. It has no `working`
    // phrase: it is a limit that ended, and the page only has to stop stating
    // it.
    measure: { called: ["createCapabilityStore"] },
    notYet: "**A link handed to Bring stops working when the instance restarts.**",
  },
  {
    id: "capture quality",
    measure: { stated: true },
    notYet: "**Capture quality has not passed its own gate.**",
  },
  {
    id: "search and accounts",
    measure: { stated: true },
    notYet: "**No library search, and no accounts**",
  },
]

/**
 * Every module in the code roots the process does NOT load, and why that is right.
 *
 * This is the breadth of the whole proof. A closure that lost a module would
 * add it here and go red, before it could quietly agree with a "not yet" on
 * the page.
 */
const NOT_LOADED: ReadonlyMap<string, string> = new Map([
  [
    "src/http/plan-generation.ts",
    "the `background` plan policy; the default, `lazy`, is what runs",
  ],
  ["src/pipeline/fake-providers.ts", "test doubles, which a running instance must never load"],
  [
    "src/pipeline/providers.ts",
    "interfaces only; every import of it is `import type`, which loads nothing",
  ],
  [
    "src/storage/byte-store.ts",
    "types only; every import of it is `import type`, which loads nothing",
  ],
])

const ENTRY = "src/server/main.ts"

/**
 * The code a process can load: `src/`, and `schema/`, which `src/` imports.
 * A tree that left `schema/` out would report both imports of it as
 * unresolved, which is how it was found that the closure reaches it.
 */
const CODE_ROOTS = ["src", "schema"]

const sources: ReadonlyMap<string, string> = new Map(
  CODE_ROOTS.flatMap((root) => filesUnder(join(repoRoot, root), { match: SOURCE_EXTENSIONS })).map(
    (file) => [relative(repoRoot, file).split("\\").join("/"), readFileSync(file, "utf8")],
  ),
)
const closure = moduleClosure(ENTRY, sources)
const readme = read("README.md")

/** Whether `name` is called from a module the process loads, outside `except`. */
function calledFromTheProcess(name: string, except: readonly string[] = []): boolean {
  for (const path of closure.reached) {
    if (except.includes(path)) continue
    if (callsTo(sources.get(path) ?? "", name) > 0) return true
  }
  return false
}

/** Whether the row's capability is reached today, or `null` when it cannot be measured. */
function reached(measure: Measure): boolean | null {
  if ("stated" in measure) return null
  return measure.called.every((name) => calledFromTheProcess(name, measure.except))
}

/** The list each phrase field belongs to. */
const LISTS = [
  { key: "working", lead: WORKING },
  { key: "built", lead: BUILT },
  { key: "notYet", lead: NOT_YET },
] as const

function itemsOf(lead: string): string[] {
  const items = bulletsAfter(readme, lead)
  if (items === null) throw new Error(`README.md no longer introduces a list with "${lead}"`)
  return items
}

describe("protections/the-readme-says-what-a-running-instance-reaches", () => {
  it("reads the process's whole import closure", () => {
    for (const root of CODE_ROOTS) {
      const read = [...sources.keys()].filter((path) => path.startsWith(`${root}/`))
      expect(read.length, `the walk read nothing under ${root}/`).toBeGreaterThan(0)
    }
    expect(closure.unresolved, "imports the closure could not follow").toEqual([])
    const notLoaded = [...sources.keys()].filter((path) => !closure.reached.has(path)).sort()
    expect(notLoaded, "modules in the code roots the process does not load").toEqual([
      ...NOT_LOADED.keys(),
    ])
  })

  it("names only functions that exist", () => {
    const declared = new Set<string>()
    for (const source of sources.values())
      for (const name of declaredNames(source)) declared.add(name)
    const named = ROWS.flatMap(({ measure }) => ("called" in measure ? measure.called : []))
    expect(named.filter((name) => !declared.has(name))).toEqual([])
  })

  it.each(LISTS)(
    "claims every item under the list introduced by '$lead' exactly once",
    ({ key, lead }) => {
      const unclaimed: string[] = []
      const claimedTwice: string[] = []
      for (const item of itemsOf(lead)) {
        const claims = ROWS.filter((row) => {
          const phrase = row[key]
          return phrase !== undefined && item.includes(phrase)
        })
        if (claims.length === 0) unclaimed.push(item)
        if (claims.length > 1)
          claimedTwice.push(`${claims.map((row) => row.id).join(" + ")}: ${item}`)
      }
      expect(unclaimed, "items no row in readme.test.ts measures or names").toEqual([])
      expect(claimedTwice, "items more than one row claims").toEqual([])
    },
  )

  it.each(ROWS)("puts '$id' in the list the tree puts it in", (row) => {
    const isReached = reached(row.measure)
    const listed = (key: (typeof LISTS)[number]["key"]): boolean => {
      const phrase = row[key]
      const lead = LISTS.find((list) => list.key === key)?.lead as string
      return phrase !== undefined && itemsOf(lead).some((item) => item.includes(phrase))
    }

    if (isReached === null) {
      expect(
        (["working", "built", "notYet"] as const).filter(
          (key) => row[key] !== undefined && !listed(key),
        ),
        `README.md stopped saying what the row '${row.id}' names; nothing here can tell whether it became untrue`,
      ).toEqual([])
      return
    }

    if (isReached) {
      expect(
        {
          working: row.working === undefined ? "n/a" : listed("working"),
          built: listed("built"),
          notYet: listed("notYet"),
        },
        `'${row.id}' is reached from ${ENTRY}: the README must stop calling it missing, and list it as working where the row names`,
      ).toEqual({ working: row.working === undefined ? "n/a" : true, built: false, notYet: false })
    } else {
      expect(
        row.built !== undefined || row.notYet !== undefined,
        `'${row.id}' is not reached, so the row must say where the README admits it`,
      ).toBe(true)
      expect(
        {
          working: listed("working"),
          built: row.built === undefined ? "n/a" : listed("built"),
          notYet: row.notYet === undefined ? "n/a" : listed("notYet"),
        },
        `'${row.id}' is not reached from ${ENTRY}: the README must not list it as working, and must say so where the row names`,
      ).toEqual({
        working: false,
        built: row.built === undefined ? "n/a" : true,
        notYet: row.notYet === undefined ? "n/a" : true,
      })
    }
  })
})

/* ------------------------------------------------------------------ *
 * 3. TWO SENTENCES HELD AGAINST A FILE
 * ------------------------------------------------------------------ */

/** What the page says while nothing has been released. */
const UNRELEASED = [
  "**This is work in progress.**",
  "**In development. Nothing here is released or versioned, and nothing about it is supported.**",
]

describe("protections/the-readme-states-the-release-it-is", () => {
  it("says nothing is released exactly while package.json carries no version", () => {
    const version = (JSON.parse(read("package.json")) as { version?: string }).version
    const unreleased = version === "0.0.0"
    const present = UNRELEASED.filter((sentence) => readme.includes(sentence))
    expect(
      present,
      unreleased
        ? "package.json is at 0.0.0, and README.md dropped the warning that nothing is released"
        : `package.json is at ${version}, and README.md still says nothing is released or versioned`,
    ).toEqual(unreleased ? UNRELEASED : [])
  })
})

describe("protections/the-readme-applies-every-migration", () => {
  it("lists one psql command per file in migrations/, in order", () => {
    const files = readdirSync(join(repoRoot, "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()
    expect(files.length, "migrations/ holds no .sql file").toBeGreaterThan(0)
    const commands = [...readme.matchAll(/^psql "\$DATABASE_URL" -f migrations\/(\S+)$/gm)].map(
      (match) => match[1],
    )
    expect(commands, "README.md's setup commands against migrations/").toEqual(files)
  })
})
