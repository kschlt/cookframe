/**
 * CFV1-RRD — the repository INTERFACE contract, written against
 * {@link RecipeRepository} rather than against any one store (ADR-0018).
 *
 * This is the "one suite, every store" proof: a single exported function that
 * takes a store *factory* and exercises every operation the interface promises —
 * ADR-0003's original five, the read ADR-0018 added, and the two Cooking Plan
 * operations ADR-0025 added. Any store that claims to
 * implement the interface runs exactly these proofs by joining the registry in
 * `repository-contract.test.ts`, so a second store inherits the suite instead of
 * getting its own. With one store in the tree today, this is also the only way to
 * catch an operation that is in truth implementable in only one store: the suite
 * names no concrete store and reaches one solely through `makeStore`.
 *
 * Canonical Recipes are produced through the deterministic fake normalization
 * provider (the ADR-0004 seam the SL1 spine already uses as a fixture maker), so
 * the recipes are real, contract-valid documents with a stable id across runs —
 * exactly the shape append-and-compare needs — and no store internals leak in.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { CookingPlan } from "../../schema/index.js"
import { SourceSnapshot } from "../../schema/index.js"
import { deriveCookingPlan } from "../../src/cooking/index.js"
import type { RecipeRepository } from "../../src/persistence/index.js"
import {
  RecipeVersionNotFoundError,
  UnversionedCookingPlanError,
} from "../../src/persistence/index.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import type { NormalizationContext } from "../../src/pipeline/providers.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** A real, contract-valid Source Snapshot — the same public fixture the SL1 spine uses. */
const snapshot = SourceSnapshot.parse(
  JSON.parse(
    readFileSync(join(repoRoot, "evals/fixtures/public/source-snapshot/basic.json"), "utf8"),
  ),
)

const ctx = (runId: string): NormalizationContext => ({ runId, targetOntologyVersion: "1.0.0" })

/**
 * Run every interface proof against the store built by `makeStore`. Each `it`
 * name is the RRD acceptance-criterion id it proves.
 */
export function runRepositoryContract(label: string, makeStore: () => RecipeRepository): void {
  const provider = createFakeNormalizationProvider()

  describe(`repo-reads/load-latest-by-id (${label})`, () => {
    it("returns the latest Canonical version for a known recipe id", async () => {
      const repo = makeStore()
      const canonical = await provider.normalize(snapshot, ctx("run-1"))
      const appended = await repo.appendCanonicalVersion(canonical)

      const loaded = await repo.loadLatestCanonical(appended.recipeId)
      expect(loaded).toBeDefined()
      expect(loaded?.recipeId).toBe(appended.recipeId)
      expect(loaded?.version).toBe(1)
      expect(loaded?.recipe.id).toBe(canonical.id)
      expect(loaded?.recipe.provenance.runId).toBe("run-1")
    })

    it("hands back a copy, so a caller cannot mutate stored state", async () => {
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("r")),
      )
      const first = await repo.loadLatestCanonical(appended.recipeId)
      if (first === undefined) throw new Error("precondition: recipe should load")
      ;(first.recipe as { title: unknown }).title = {
        state: "from_source",
        sourceText: "mutated by caller",
        sourceRefs: [{ blockId: "b-title" }],
      }
      const second = await repo.loadLatestCanonical(appended.recipeId)
      expect(second?.recipe.title).not.toMatchObject({ sourceText: "mutated by caller" })
    })
  })

  describe(`repo-reads/unknown-id-returns-undefined (${label})`, () => {
    it("returns undefined for an unknown id rather than throwing", async () => {
      const repo = makeStore()
      // No catch, no rejection: the value itself says "not here", which is what
      // lets a capability route tell a missing recipe from a revoked token.
      await expect(repo.loadLatestCanonical("no-such-recipe")).resolves.toBeUndefined()
    })

    it("still returns undefined once other recipes exist", async () => {
      const repo = makeStore()
      await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("run-1")))
      expect(await repo.loadLatestCanonical("a-different-id")).toBeUndefined()
    })
  })

  describe(`repo-reads/load-latest-returns-the-newest-version (${label})`, () => {
    it("returns the newest appended version, not the first", async () => {
      const repo = makeStore()
      const c1 = await provider.normalize(snapshot, ctx("run-1"))
      const c2 = await provider.normalize(snapshot, ctx("run-2"))
      // Same recipe (a second normalization run), so the two share an id and
      // append as versions 1 and 2 under it.
      expect(c2.id).toBe(c1.id)
      const v1 = await repo.appendCanonicalVersion(c1)
      const v2 = await repo.appendCanonicalVersion(c2)
      expect(v2.version).toBe(v1.version + 1)

      const loaded = await repo.loadLatestCanonical(v1.recipeId)
      expect(loaded?.version).toBe(2)
      expect(loaded?.recipe.provenance.runId).toBe("run-2")
    })
  })

  describe(`repo-reads/existing-operations-unchanged (${label})`, () => {
    it("stores and loads a Source Snapshot, and returns undefined for an unknown one", async () => {
      const repo = makeStore()
      expect(await repo.loadSnapshot(snapshot.id)).toBeUndefined()
      await repo.storeSnapshot(snapshot)
      const loaded = await repo.loadSnapshot(snapshot.id)
      expect(loaded?.id).toBe(snapshot.id)
    })

    it("validates before persisting: an invalid document is rejected and nothing is stored", async () => {
      const repo = makeStore()
      await expect(repo.storeSnapshot({ id: "bad" } as unknown as SourceSnapshot)).rejects.toThrow()
      await expect(
        repo.appendCanonicalVersion({ id: "r1" } as unknown as Awaited<
          ReturnType<typeof provider.normalize>
        >),
      ).rejects.toThrow()
      expect(await repo.listLibrary()).toHaveLength(0)
    })

    it("hands back a copy of a snapshot, so a caller cannot mutate stored state", async () => {
      // The same property `loadLatestCanonical` is held to. It was unproven for
      // the snapshot read until a mutation sweep removed the copy and nothing
      // went red.
      const repo = makeStore()
      await repo.storeSnapshot(snapshot)
      const loaded = await repo.loadSnapshot(snapshot.id)
      if (loaded === undefined) throw new Error("the snapshot that was just stored is not there")
      loaded.blocks.length = 0

      const again = await repo.loadSnapshot(snapshot.id)
      expect(
        again?.blocks.length,
        "the stored snapshot was reachable through the copy",
      ).toBeGreaterThan(0)
    })

    it("appends versions monotonically and never mutates an earlier one", async () => {
      const repo = makeStore()
      const v1 = await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("run-1")))
      const v2 = await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("run-2")))
      expect(v1.version).toBe(1)
      expect(v2.version).toBe(2)
      expect(v1.recipeId).toBe(v2.recipeId)
      const [a, b] = await repo.readTwoRuns(v1.recipeId, 1, 2)
      expect(a.recipe.provenance.runId).toBe("run-1")
      expect(b.recipe.provenance.runId).toBe("run-2")
    })

    it("lists the library with one entry per recipe id and the newest version's title", async () => {
      const repo = makeStore()
      const v = await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("run-1")))
      await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("run-2")))
      const latest = await repo.loadLatestCanonical(v.recipeId)
      expect(await repo.listLibrary()).toEqual([
        {
          recipeId: v.recipeId,
          latestVersion: 2,
          // The listing carries the source's own wording, or no key at all —
          // never the title object, and never a stand-in for a missing one.
          ...(latest?.recipe.title.state === "from_source"
            ? { title: latest.recipe.title.sourceText }
            : {}),
        },
      ])
    })

    it("readTwoRuns still throws for a missing recipe rather than inventing one", async () => {
      const repo = makeStore()
      await expect(repo.readTwoRuns("never-stored", 1, 2)).rejects.toThrow()
    })

    it("exposes no in-place write path", () => {
      const repo = makeStore() as unknown as Record<string, unknown>
      for (const forbidden of ["update", "save", "put", "overwrite", "replace", "set", "delete"]) {
        expect(repo[forbidden]).toBeUndefined()
      }
    })
  })

  describe(`repo-plan/stored-plan-belongs-to-one-version (${label})`, () => {
    it("stores a plan under the version it names, and loads it back", async () => {
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      const plan = deriveCookingPlan(appended.recipe, { canonicalVersion: appended.version })
      await repo.storeCookingPlan(plan)

      expect(await repo.loadCookingPlan(appended.recipeId, appended.version)).toEqual(plan)
    })

    it("answers undefined for a version with no plan, rather than failing", async () => {
      // Under `PDR-0004`'s `lazy` default this is the ordinary state of every
      // recipe nobody has cooked yet, so the caller derives rather than catches.
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      expect(await repo.loadCookingPlan(appended.recipeId, appended.version)).toBeUndefined()
      expect(await repo.loadCookingPlan("never-stored", 1)).toBeUndefined()
    })

    it("does not serve one version's plan for another", async () => {
      // The failure this keying exists to make impossible: a recipe re-normalized
      // into a new version, with the previous version's plan still on disk.
      const repo = makeStore()
      const first = await repo.appendCanonicalVersion(await provider.normalize(snapshot, ctx("r1")))
      await repo.storeCookingPlan(
        deriveCookingPlan(first.recipe, { canonicalVersion: first.version }),
      )
      const second = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("r2")),
      )

      expect(second.version).toBe(2)
      expect(await repo.loadCookingPlan(second.recipeId, second.version)).toBeUndefined()
      expect(await repo.loadCookingPlan(first.recipeId, first.version)).toBeDefined()
    })

    it("refuses a plan that names no version, and one naming a version it does not hold", async () => {
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      // Each refusal named, not merely "throws": a plan with no version reaches
      // the version check as `undefined` and would be refused there for the
      // wrong reason, which would leave the guard that exists for it unproven.
      await expect(repo.storeCookingPlan(deriveCookingPlan(appended.recipe))).rejects.toThrow(
        UnversionedCookingPlanError,
      )
      await expect(
        repo.storeCookingPlan(deriveCookingPlan(appended.recipe, { canonicalVersion: 99 })),
      ).rejects.toThrow(RecipeVersionNotFoundError)
    })

    it("validates the plan before persisting, rather than filing what it is handed", async () => {
      // The same commitment ADR-0003 made for every other document, and the
      // reason ADR-0025 could add a write at all: a store that files an invalid
      // plan would hand a cook a page derived from something that is not one.
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      const plan = deriveCookingPlan(appended.recipe, { canonicalVersion: appended.version })

      await expect(
        repo.storeCookingPlan({ ...plan, units: "not units" } as unknown as CookingPlan),
      ).rejects.toThrow()
      expect(await repo.loadCookingPlan(appended.recipeId, appended.version)).toBeUndefined()
    })

    it("lets the last write for one version win, rather than accumulating runs", async () => {
      // ADR-0025 point 4: the derivation is deterministic, so re-deriving a
      // version yields the same plan and an append would only pile up copies.
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      const plan = deriveCookingPlan(appended.recipe, { canonicalVersion: appended.version })
      await repo.storeCookingPlan(plan)
      await repo.storeCookingPlan({ ...plan, setUp: [] })

      expect((await repo.loadCookingPlan(appended.recipeId, appended.version))?.setUp).toEqual([])
    })

    it("hands back a copy, so a caller cannot mutate the stored plan", async () => {
      const repo = makeStore()
      const appended = await repo.appendCanonicalVersion(
        await provider.normalize(snapshot, ctx("run-1")),
      )
      await repo.storeCookingPlan(
        deriveCookingPlan(appended.recipe, { canonicalVersion: appended.version }),
      )
      const loaded = await repo.loadCookingPlan(appended.recipeId, appended.version)
      if (loaded === undefined) throw new Error("the plan that was just stored is not there")
      loaded.units.length = 0

      const again = await repo.loadCookingPlan(appended.recipeId, appended.version)
      expect(again?.units.length, "the stored plan was reachable through the copy").toBeGreaterThan(
        0,
      )
    })
  })
}
