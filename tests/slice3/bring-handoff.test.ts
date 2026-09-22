/**
 * CFV1-SL3 — the Bring handoff: the mechanism is recorded, and the mapping's output
 * is pinned against the compatibility spike's recorded fixtures.
 *
 * ADR-0017 fixed that Bring imports a recipe by fetching a Schema.org/Recipe page at
 * the capability URL server-side and parsing it (OQ-18). The mapping this handoff
 * serves is `mapCanonicalToSchemaOrg`; the spike (`spikes/bring-compat/`) recorded
 * how Bring actually parses such a page. This suite proves the two criteria the
 * mapping and route units deferred:
 *
 *  - `slice3/bring-integration-mechanism-recorded` — the mechanism is decided and
 *    recorded (ADR-0017), and OQ-18 is closed there and in the open-questions
 *    register.
 *  - `slice3/bring-fixtures-green` — for each spike observation, the mapping still
 *    emits exactly the wording Bring was fed (its verbatim source lines and its
 *    yield order), and Bring's recorded parse still inverts to that wording. Reading
 *    both the source page (the independent input) and the fixture (Bring's parse of
 *    it) is what makes a later drift on either side — a mapping that reformats, or a
 *    Bring re-record that parses differently — fail loudly instead of silently.
 *
 * The spike pages and fixtures are synthetic and self-authored (the public-repo
 * content rule); nothing here reaches the network — the whole point is offline
 * pinning.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe, SCHEMA_VERSION } from "../../schema/index.js"
import { mapCanonicalToSchemaOrg } from "../../src/shopping/schema-org-mapping.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const spikeDir = join(repoRoot, "spikes", "bring-compat")
const fixturesDir = join(spikeDir, "fixtures")
const pagesDir = join(spikeDir, "pages")
const adrDir = join(repoRoot, "docs", "adr")

// --- spike readers ---------------------------------------------------------

interface BringItem {
  readonly itemId: string
  readonly spec?: string
}
interface BringResponse {
  readonly author?: string
  readonly yield?: string
  readonly baseQuantity?: number
  readonly items?: readonly BringItem[]
}
interface Observation {
  readonly case: string
  readonly source_url: string
  readonly response: BringResponse | string
}
interface Fixture {
  readonly fixture: string
  readonly observations: readonly Observation[]
}

interface PageJsonLd {
  readonly recipeIngredient?: readonly string[]
  readonly recipeYield?: string | readonly string[]
  readonly author?: { readonly name?: string }
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as Fixture

const caseOf = (fx: Fixture, name: string): Observation => {
  const obs = fx.observations.find((o) => o.case === name)
  if (obs === undefined) throw new Error(`no case "${name}" in fixture ${fx.fixture}`)
  return obs
}

/** The success parse for an observation (the object form of `response`). */
const parseOf = (obs: Observation): BringResponse => {
  if (typeof obs.response === "string") {
    throw new Error(`observation "${obs.case}" is an error response, not a parse`)
  }
  return obs.response
}

/** The Schema.org/Recipe JSON-LD of the page an observation fetched — the input. */
const pageOf = (obs: Observation): PageJsonLd => {
  const file = (obs.source_url.split("/").pop() ?? "").split("?")[0]
  const html = readFileSync(join(pagesDir, file as string), "utf8")
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (match === null) throw new Error(`no JSON-LD in page ${file}`)
  return JSON.parse(match[1] as string) as PageJsonLd
}

/** Bring's recorded split of an item, inverted back to a source line. */
const lineOfItem = (item: BringItem): string =>
  item.spec !== undefined && item.spec.length > 0 ? `${item.spec} ${item.itemId}` : item.itemId

// --- canonical builder (synthetic, schema-valid) --------------------------

interface YieldSpec {
  readonly text: string
  readonly value?: number
}

const buildCanonical = (over: {
  ingredients?: readonly string[]
  yields?: readonly YieldSpec[]
  authors?: readonly string[]
}): CanonicalRecipe =>
  CanonicalRecipe.parse({
    id: "recipe-bring",
    schemaVersion: SCHEMA_VERSION,
    title: "Kartoffelgratin",
    authors: over.authors,
    yields: (over.yields ?? [{ text: "4 Portionen", value: 4 }]).map((y, i) => ({
      id: `y-${i + 1}`,
      sourceText: y.text,
      scalingEligibility: "unknown",
      valueExpression:
        y.value !== undefined
          ? { sourceText: y.text, kind: "exact", value: y.value }
          : { sourceText: y.text, kind: "qualitative" },
      sourceRefs: [{ blockId: "b-yield" }],
    })),
    ingredientGroups: [
      {
        id: "ig-1",
        sourceRefs: [{ blockId: "b-ing" }],
        ingredients: (over.ingredients ?? ["800 g Kartoffeln"]).map((line, i) => ({
          id: `ing-${i + 1}`,
          sourceText: line,
          name: line,
          qualifiers: [],
          scalingEligibility: "proportional",
          sourceRefs: [{ blockId: "b-ing" }],
        })),
      },
    ],
    instructionSections: [
      {
        id: "is-1",
        sourceRefs: [{ blockId: "b-step" }],
        steps: [
          {
            id: "step-1",
            sourceText: "Schichten und backen.",
            normalizedActionText: "Schichten und backen.",
            sourceRefs: [{ blockId: "b-step" }],
            ingredientUses: [],
            componentUses: [],
            equipmentUses: [],
            producesComponents: [],
            durations: [],
            temperatures: [],
            donenessCues: [],
            prerequisiteCues: [],
            waitCues: [],
          },
        ],
      },
    ],
    provenance: {
      sourceSnapshotId: "snap-1",
      sourceSnapshotVersion: 0,
      targetOntologyVersion: "1.0.0",
      runId: "run-1",
    },
  })

// --- the mechanism is recorded --------------------------------------------

describe("slice3/bring-integration-mechanism-recorded", () => {
  const adr = readFileSync(
    join(adrDir, "ADR-0017-bring-integration-is-a-server-side-pull-of-a-schema-org-page.md"),
    "utf8",
  )

  it("ADR-0017 records the mechanism decided against the spike and closes OQ-18", () => {
    expect(adr).toMatch(/id:\s*"ADR-0017"/)
    expect(adr).toMatch(/status:\s*accepted/)
    expect(adr).toMatch(/decides:\s*\[\s*"OQ-18"\s*\]/)
    // The mechanism itself: a server-side pull of a page, no push/credential API.
    expect(adr).toMatch(/server-side/)
    expect(adr).toMatch(/pull/)
    expect(adr).toMatch(/no Bring API, credential, or push/)
    // What is served: the omit-never-invent mapping, verbatim, first yield as base.
    expect(adr).toMatch(/verbatim/)
    expect(adr).toMatch(/first `recipeYield`/)
  })

  it("the open-questions register marks OQ-18 closed by ADR-0017", () => {
    const oq = readFileSync(join(repoRoot, "docs", "open-questions.md"), "utf8")
    const row = oq.split("\n").find((l) => l.includes("OQ-18"))
    expect(row, "no OQ-18 row").toBeDefined()
    expect(row).toMatch(/closed by ADR-0017/)
  })
})

// --- the mapping is pinned against Bring's recorded parse ------------------

describe("slice3/bring-fixtures-green", () => {
  it("emits ingredient lines verbatim, and Bring's recorded parse inverts to them", () => {
    // A baseline control page fetched cleanly (all lines have an exact leading
    // quantity, so Bring's split is invertible).
    const control = caseOf(fixture("missing-author"), "author-present-control")
    const inputLines = pageOf(control).recipeIngredient
    if (inputLines === undefined) throw new Error("control page has no ingredients")

    // The mapping serves the source wording verbatim — no reformatting for Bring's
    // parser (ADR-0017 §Decision-2). If it ever pre-split a line, this goes red.
    const mapped = mapCanonicalToSchemaOrg(buildCanonical({ ingredients: inputLines }))
    expect(mapped.recipe.recipeIngredient).toEqual(inputLines)

    // Bring's recorded parse of those same lines still inverts to them. If Bring is
    // re-recorded with a different split, the fixture changes and this goes red.
    const items = parseOf(control).items ?? []
    expect(items.map(lineOfItem)).toEqual([...inputLines])
  })

  it("preserves yield order so Bring's kept base yield stays the intended one", () => {
    // Bring adopts the FIRST recipeYield and discards the rest (S3 Q4), so the
    // mapping's yield order is significant (ADR-0017 §Decision-3).
    const obs = caseOf(fixture("multi-yield-scaling"), "multiple-yields")
    const pageYields = pageOf(obs).recipeYield
    const yieldList = Array.isArray(pageYields) ? pageYields : [pageYields as string]
    expect(yieldList.length).toBeGreaterThan(1)

    const mapped = mapCanonicalToSchemaOrg(
      buildCanonical({
        yields: yieldList.map((text) => ({ text, value: Number.parseInt(text, 10) })),
      }),
    )
    const served = mapped.recipe.recipeYield ?? []
    // Every yield is preserved, in order.
    expect(served.map((y) => (typeof y === "string" ? y : y.name))).toEqual(yieldList)

    // The first served yield is the one Bring keeps as its base.
    const first = served[0]
    if (first === undefined || typeof first === "string") {
      throw new Error("expected the first served yield to be an exact QuantitativeValue")
    }
    expect(first.name).toBe(parseOf(obs).yield)
    expect(first.value).toBe(parseOf(obs).baseQuantity)
  })

  it("represents a missing author as an absent state, matching Bring's own", () => {
    const fx = fixture("missing-author")

    // Absent and empty-string authors both produce NO author key in Bring's parse;
    // the mapping must reach the same absent state, never a fabricated name.
    for (const caseName of ["author-absent", "author-empty-string"]) {
      expect("author" in parseOf(caseOf(fx, caseName))).toBe(false)
    }
    const absent = mapCanonicalToSchemaOrg(buildCanonical({}))
    expect(absent.authorState).toBe("absent")
    expect("author" in absent.recipe).toBe(false)
    const empty = mapCanonicalToSchemaOrg(buildCanonical({ authors: ["", "   "] }))
    expect(empty.authorState).toBe("absent")
    expect("author" in empty.recipe).toBe(false)

    // A present author round-trips to Bring's recorded name.
    const control = parseOf(caseOf(fx, "author-present-control"))
    expect(control.author).toBeDefined()
    const present = mapCanonicalToSchemaOrg(buildCanonical({ authors: [control.author as string] }))
    expect(present.authorState).toBe("present")
    expect(present.recipe.author).toEqual([{ "@type": "Person", name: control.author }])
  })
})
