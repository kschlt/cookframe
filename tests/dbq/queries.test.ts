/**
 * CFV1-DBQ — the three deciding queries, proved executable and consistent
 * across all three physical shapes.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. They prove the mechanics: each
 * shape can be created, written to, read back without loss, and asked all three
 * of ADR-0003's questions, and all three shapes return the SAME answer to each.
 * They do not produce the verdict. The verdict needs real Slice 1 data — real
 * photographs, third-party recipe text, two real normalization runs — which
 * lives under `evals/fixtures/private/` and is git-ignored by design, so it
 * cannot be in CI. `spikes/dbq/evaluate.ts` runs the same queries over that
 * corpus, and its numbers are what the decision record cites.
 *
 * So the split is deliberate: correctness is proved here, on data anyone can
 * run; the measurement is made once, on data that may not leave the machine.
 *
 * These need a PostgreSQL server. CI provides one as a service container, and
 * `tests/unit/repo-config.test.ts` asserts that it does — otherwise a skip here
 * would quietly mean "never proved anywhere".
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { connect, resetShape, SHAPES, type Shape, useShape } from "../../spikes/dbq/db.js"
import { loadDocument, readDocument } from "../../spikes/dbq/document-shape.js"
import { loadHybrid, rebuildExtraction } from "../../spikes/dbq/hybrid-shape.js"
import { compareRuns, shoppingRequirements } from "../../spikes/dbq/queries.js"
import { loadRelational, readRelational } from "../../spikes/dbq/relational-shape.js"
import {
  createDocumentStore,
  createHybridStore,
  createRelationalStore,
  listLibrary,
} from "../../spikes/dbq/stores.js"
import type { CanonicalVersion, RecipeRepository } from "../../src/persistence/repository.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

const base = JSON.parse(
  readFileSync(join(repoRoot, "evals/fixtures/public/canonical/two-yields-nutrition.json"), "utf8"),
) as CanonicalRecipe

/**
 * A small library from the one committed public canonical fixture: three
 * recipes, one of them with two runs that differ. The differences are declared
 * here rather than discovered, because what these tests check is that every
 * shape surfaces the SAME differences — not how many there are.
 */
function corpus(): CanonicalVersion[] {
  const at = (id: string, mutate: (r: CanonicalRecipe) => void): CanonicalRecipe => {
    const r = structuredClone(base)
    ;(r as { id: string }).id = id
    mutate(r)
    return r
  }
  const rename = (r: CanonicalRecipe, title: string): void => {
    ;(r as { title: CanonicalRecipe["title"] }).title = {
      state: "from_source",
      sourceText: title,
      sourceRefs: [{ blockId: "b-title" }],
    }
  }
  return [
    { recipeId: "r-1", version: 1, recipe: at("r-1", (r) => rename(r, "Gratin, first run")) },
    {
      recipeId: "r-1",
      version: 2,
      recipe: at("r-1", (r) => {
        rename(r, "Gratin, second run")
        // A quantity the second run read as a range where the first read it exactly:
        // the case the shopping query must refuse to add up.
        const ing = r.ingredientGroups[0]?.ingredients[0]
        if (ing !== undefined) {
          ;(ing as { quantityExpression?: unknown }).quantityExpression = {
            sourceText: "800-900 g",
            kind: "range",
            minValue: 800,
            maxValue: 900,
          }
        }
      }),
    },
    { recipeId: "r-2", version: 1, recipe: at("r-2", (r) => rename(r, "Second recipe")) },
    { recipeId: "r-3", version: 1, recipe: at("r-3", (r) => rename(r, "Third recipe")) },
  ]
}

const LOADERS = {
  document: loadDocument,
  hybrid: loadHybrid,
  relational: loadRelational,
} as const

const READERS = {
  document: readDocument,
  hybrid: readDocument,
  relational: readRelational,
} as const

const STORES: Record<Shape, (c: Client) => RecipeRepository> = {
  document: (c) => createDocumentStore(c),
  hybrid: (c) => createHybridStore(c),
  relational: (c) => createRelationalStore(c),
}

// Probed at module level, not in `beforeAll`: vitest decides `describe.skipIf`
// while it collects the file, which is before any hook has run.
const client: Client | undefined = await connect()

beforeAll(async () => {
  if (client === undefined) return
  for (const shape of SHAPES) {
    await resetShape(client, shape)
    await LOADERS[shape](client, corpus(), [])
  }
}, 60_000)

afterAll(async () => {
  await client?.end()
})

const db = (): Client => {
  if (client === undefined) throw new Error("no PostgreSQL server; see the file header")
  return client
}
const needsDb = client === undefined

describe.skipIf(needsDb)("CFV1-DBQ query evaluation", () => {
  for (const shape of SHAPES) {
    // The acceptance criteria name a proof per shape; the hybrid is ADR-0003's
    // own hypothesis and gets the same treatment as the two extremes.
    const proof =
      shape === "document"
        ? "dbq/queries-run-against-document-shape"
        : shape === "relational"
          ? "dbq/queries-run-against-relational-shape"
          : "dbq/queries-run-against-hybrid-shape"

    it(`${proof} — all three deciding queries answer over the ${shape} shape`, async () => {
      await useShape(db(), shape)

      const library = await listLibrary(db(), shape)
      expect(library.map((e) => e.recipeId).sort()).toEqual(["r-1", "r-2", "r-3"])
      // The library lists the LATEST version of each recipe, never an earlier one.
      expect(library.find((e) => e.recipeId === "r-1")).toEqual({
        recipeId: "r-1",
        latestVersion: 2,
        title: "Gratin, second run",
      })

      const shopping = await shoppingRequirements(db(), shape)
      expect(shopping.length).toBeGreaterThan(0)
      // The range quantity in r-1 version 2 is carried out in the source's own
      // words and never added to a total (ontology §5.2).
      const ranged = shopping.find((l) => l.unsummable.includes("800-900 g"))
      expect(ranged, "the range quantity reaches the shopping list unsummed").toBeDefined()
      expect(ranged?.unsummableCount).toBe(1)

      const comparison = await compareRuns(STORES[shape](db()), "r-1", 1, 2)
      expect(comparison.differences.length).toBeGreaterThan(0)
    })
  }

  it("dbq/stores-implement-the-sixth-operation — the latest version, or undefined", async () => {
    // ADR-0018 widened `RecipeRepository` to six operations while this module
    // was on an unmerged branch, so main stopped typechecking the moment both
    // landed: each PR was green against its own base. Implemented rather than
    // stubbed, and proved here, because an operation the interface documents as
    // returning `undefined` for not-found is exactly the kind that gets a throw
    // bolted on to satisfy the compiler.
    for (const shape of SHAPES) {
      await useShape(db(), shape)
      const repo = STORES[shape](db())
      const latest = await repo.loadLatestCanonical("r-1")
      expect(latest?.version, `${shape}: r-1 has two runs, the latest is 2`).toBe(2)
      expect(latest?.recipe.title, shape).toBe("Gratin, second run")
      expect(
        await repo.loadLatestCanonical("r-2"),
        `${shape}: a single-version recipe`,
      ).toMatchObject({ recipeId: "r-2", version: 1 })
      // Not-found is a RETURN VALUE, not a throw (ADR-0018).
      await expect(
        repo.loadLatestCanonical("no-such-recipe"),
        `${shape}: a missing recipe resolves to undefined`,
      ).resolves.toBeUndefined()
    }
  })

  it("dbq/shapes-agree-on-every-query — every shape answers each query identically", async () => {
    const byShape = async <T>(fn: (s: Shape) => Promise<T>): Promise<Record<string, T>> => {
      const out: Record<string, T> = {}
      for (const shape of SHAPES) {
        await useShape(db(), shape)
        out[shape] = await fn(shape)
      }
      return out
    }

    const libraries = await byShape((s) => listLibrary(db(), s))
    const shopping = await byShape((s) => shoppingRequirements(db(), s))
    const comparisons = await byShape((s) => compareRuns(STORES[s](db()), "r-1", 1, 2))

    // Agreement, which is what makes a cost difference mean anything: three
    // results per query, one per shape, and all three identical.
    //
    // This is NOT the "reported per query and per shape" criterion, though it
    // carried that name until a review pointed out that it never touches the
    // reporting code. `tests/dbq/report.test.ts` proves that one.
    for (const [label, results] of [
      ["library list", libraries],
      ["shopping", shopping],
      ["run comparison", comparisons],
    ] as const) {
      expect(Object.keys(results).sort(), label).toEqual([...SHAPES].sort())
      const distinct = new Set(Object.values(results).map((r) => JSON.stringify(r)))
      expect(
        distinct.size,
        `${label}: the shapes disagree, so their costs are not comparable`,
      ).toBe(1)
    }
  })

  it("dbq/run-comparison-reads-two-runs — both runs come back whole, through the repository interface", async () => {
    for (const shape of SHAPES) {
      await useShape(db(), shape)
      const repo = STORES[shape](db())
      // Operation 5 of ADR-0003's interface, not a query beside it.
      const [a, b] = await repo.readTwoRuns("r-1", 1, 2)
      expect(a.version, shape).toBe(1)
      expect(b.version, shape).toBe(2)
      // "Both versions are returned in full and unchanged" — whole recipes, not
      // a projection, which is what makes this the operation a shape can fail.
      const expected = corpus()
      expect(a.recipe, shape).toEqual(expected[0]?.recipe)
      expect(b.recipe, shape).toEqual(expected[1]?.recipe)

      const diff = await compareRuns(repo, "r-1", 1, 2)
      expect(
        diff.differences.map((d) => d.path),
        shape,
      ).toContain("/title")
      expect(diff.same, shape).toBeGreaterThan(0)
    }
  })

  it("dbq/shapes-are-lossless — a version read back out of any shape is the version that went in", async () => {
    for (const shape of SHAPES) {
      await useShape(db(), shape)
      for (const v of corpus()) {
        const back = await READERS[shape](db(), v.recipeId, v.version)
        expect(back, `${shape} ${v.recipeId}@${v.version}`).toEqual(v.recipe)
      }
    }
  })

  it("dbq/hybrid-extraction-is-derived — rebuilding it from the documents changes nothing", async () => {
    // The hybrid's extracted table is a cache with a contract. If a rebuild from
    // the documents alone produced different rows, it would be a second source
    // of truth, and the hybrid would not be the shape it claims to be.
    await useShape(db(), "hybrid")
    const rows = async (): Promise<unknown[]> =>
      (
        await db().query(
          "select * from ingredient order by recipe_id, version, group_ordinal, ordinal",
        )
      ).rows
    const before = await rows()
    expect(before.length).toBeGreaterThan(0)
    await rebuildExtraction(db())
    expect(await rows()).toEqual(before)
  })
})

describe.skipIf(!needsDb)("CFV1-DBQ query evaluation (no database)", () => {
  it("says plainly that the proofs did not run", () => {
    // Not a pass. CI always has the server, and repo-config asserts the job that
    // provides it, so a skip here is a local-machine statement and nothing else.
    expect(client).toBeUndefined()
  })
})
