/**
 * CFV1-RRD — the repository INTERFACE contract, written against
 * {@link RecipeRepository} rather than against any one store (ADR-0018).
 *
 * This is the "one suite, every store" proof: a single exported function that
 * takes a store *factory* and exercises every operation the interface promises —
 * ADR-0003's original five plus the read ADR-0018 added. Any store that claims to
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
import { SourceSnapshot } from "../../schema/index.js"
import type { RecipeRepository } from "../../src/persistence/index.js"
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
      ;(first.recipe as { title: string }).title = "mutated by caller"
      const second = await repo.loadLatestCanonical(appended.recipeId)
      expect(second?.recipe.title).not.toBe("mutated by caller")
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
        { recipeId: v.recipeId, latestVersion: 2, title: latest?.recipe.title },
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
}
