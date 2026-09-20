/**
 * CFV1-SL1 — the append-and-compare repository spine (first unit).
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * The suite exercises the repository interface (ADR-0003's five operations), the
 * validate-before-persist guard, sourceRef resolution, and the `reprocess`
 * command, using a deterministic fake normalization provider (ADR-0004 seam) so
 * no real model or network is involved. The three SL1 criteria that need a real
 * capture provider or the byte store (block-id stability, captured-image
 * retrievable, storage-identity confinement) are deferred to later units.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { type CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"
import * as persistenceBarrel from "../../src/persistence/index.js"
import {
  createProvisionalStore,
  resolveSourceRefs,
  UnresolvedSourceRefError,
} from "../../src/persistence/index.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import type { NormalizationContext } from "../../src/pipeline/providers.js"
import { reprocess } from "../../src/pipeline/reprocess.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const snapshot = SourceSnapshot.parse(
  JSON.parse(
    readFileSync(join(repoRoot, "evals/fixtures/public/source-snapshot/basic.json"), "utf8"),
  ),
)

const ctx = (runId: string, model?: string): NormalizationContext => ({
  runId,
  targetOntologyVersion: "1.0.0",
  ...(model !== undefined ? { normalizationModel: model } : {}),
})

describe("slice1/validate-before-persist", () => {
  it("rejects an invalid snapshot and persists nothing", async () => {
    const repo = createProvisionalStore()
    await expect(repo.storeSnapshot({ id: "bad" } as unknown as SourceSnapshot)).rejects.toThrow()
    expect(await repo.loadSnapshot("bad")).toBeUndefined()
  })

  it("rejects an invalid canonical and appends nothing", async () => {
    const repo = createProvisionalStore()
    await expect(
      repo.appendCanonicalVersion({ id: "r1" } as unknown as CanonicalRecipe),
    ).rejects.toThrow()
    expect(await repo.listLibrary()).toHaveLength(0)
  })
})

describe("slice1/no-in-place-overwrite", () => {
  it("a second version never mutates the first", async () => {
    const repo = createProvisionalStore()
    const provider = createFakeNormalizationProvider()
    await repo.storeSnapshot(snapshot)
    const v1 = await reprocess(repo, provider, snapshot.id, ctx("run-A"))
    const v2 = await reprocess(repo, provider, snapshot.id, ctx("run-B"))
    expect(v1.version).toBe(1)
    expect(v2.version).toBe(2)
    expect(v1.recipeId).toBe(v2.recipeId)
    const [a, b] = await repo.readTwoRuns(v1.recipeId, 1, 2)
    expect(a.recipe.provenance.runId).toBe("run-A")
    expect(b.recipe.provenance.runId).toBe("run-B")
  })

  it("the repository exposes no in-place write path", () => {
    const repo = createProvisionalStore() as unknown as Record<string, unknown>
    for (const forbidden of ["update", "save", "put", "overwrite", "replace", "set", "delete"]) {
      expect(repo[forbidden]).toBeUndefined()
    }
  })
})

describe("slice1/reprocess-creates-new-version", () => {
  it("produces a new version and keeps the prior readable", async () => {
    const repo = createProvisionalStore()
    const provider = createFakeNormalizationProvider()
    await repo.storeSnapshot(snapshot)
    const v1 = await reprocess(repo, provider, snapshot.id, ctx("run-1"))
    const v2 = await reprocess(repo, provider, snapshot.id, ctx("run-2"))
    expect(v2.version).toBe(v1.version + 1)
    const [a] = await repo.readTwoRuns(v1.recipeId, 1, 2)
    expect(a.recipe.provenance.runId).toBe("run-1")
    expect(await repo.listLibrary()).toEqual([
      { recipeId: v1.recipeId, latestVersion: 2, title: a.recipe.title },
    ])
  })
})

describe("slice1/reprocess-is-a-command", () => {
  it("has no HTTP request or job primitive in its source", () => {
    const src = readFileSync(join(repoRoot, "src/pipeline/reprocess.ts"), "utf8")
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).not.toMatch(/from\s+["']node:http/)
    expect(src).not.toMatch(/require\(\s*["']http/)
    expect(src).not.toMatch(/new\s+Request\b/)
    expect(src).not.toMatch(/\.request\s*\(/)
  })

  it("runs in-process, taking no request/response argument", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(snapshot)
    const v = await reprocess(repo, createFakeNormalizationProvider(), snapshot.id, ctx("run-x"))
    expect(v.version).toBe(1)
    // (repo, provider, snapshotId, ctx) — four args, none an HTTP request/response
    expect(reprocess.length).toBe(4)
  })
})

describe("slice1/read-two-runs-comparable", () => {
  it("returns both runs of the same recipe in full", async () => {
    const repo = createProvisionalStore()
    const provider = createFakeNormalizationProvider()
    await repo.storeSnapshot(snapshot)
    const v1 = await reprocess(repo, provider, snapshot.id, ctx("run-1", "model-a"))
    await reprocess(repo, provider, snapshot.id, ctx("run-2", "model-b"))
    const [a, b] = await repo.readTwoRuns(v1.recipeId, 1, 2)
    expect(a.recipe.id).toBe(b.recipe.id)
    expect(a.recipe.provenance.runId).not.toBe(b.recipe.provenance.runId)
    expect(a.recipe.provenance.normalizationModel).toBe("model-a")
    expect(b.recipe.provenance.normalizationModel).toBe("model-b")
  })

  it("throws for a missing version rather than inventing one", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(snapshot)
    await reprocess(repo, createFakeNormalizationProvider(), snapshot.id, ctx("only"))
    await expect(repo.readTwoRuns(`recipe-of-${snapshot.id}`, 1, 2)).rejects.toThrow()
  })
})

describe("slice1/repository-interface-confinement", () => {
  it("the store is reachable only through the factory + interface", () => {
    const names = Object.keys(persistenceBarrel)
    expect(names).toContain("createProvisionalStore")
    expect(names).not.toContain("ProvisionalStore")
    const repo = createProvisionalStore() as unknown as Record<string, unknown>
    for (const op of [
      "storeSnapshot",
      "loadSnapshot",
      "appendCanonicalVersion",
      "listLibrary",
      "readTwoRuns",
    ]) {
      expect(typeof repo[op]).toBe("function")
    }
  })

  it("no module outside the store's own file names the concrete store type", () => {
    for (const f of [
      "src/pipeline/reprocess.ts",
      "src/pipeline/fake-providers.ts",
      "src/persistence/index.ts",
      "src/persistence/repository.ts",
      "src/persistence/validate.ts",
    ]) {
      expect(readFileSync(join(repoRoot, f), "utf8")).not.toMatch(/\bProvisionalStore\b/)
    }
  })
})

describe("slice1/run-provenance-recorded", () => {
  it("records run identity, model and prompt-component versions", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(snapshot)
    const v = await reprocess(repo, createFakeNormalizationProvider(), snapshot.id, {
      runId: "run-42",
      targetOntologyVersion: "1.0.0",
      normalizationModel: "fake-normalizer-1",
      normalizationPromptVersions: ["norm-prompt@2"],
    })
    const p = v.recipe.provenance
    expect(p.runId).toBe("run-42")
    expect(p.sourceSnapshotId).toBe(snapshot.id)
    expect(p.sourceSnapshotVersion).toBe(snapshot.version)
    expect(p.targetOntologyVersion).toBe("1.0.0")
    expect(p.normalizationModel).toBe("fake-normalizer-1")
    expect(p.normalizationPromptVersions).toEqual(["norm-prompt@2"])
  })
})

describe("slice1/sourceref-resolution", () => {
  it("passes when every ref resolves, and the fake actually emits refs", async () => {
    const canonical = await createFakeNormalizationProvider().normalize(snapshot, ctx("run-1"))
    expect(canonical.ingredientGroups.length).toBeGreaterThan(0)
    expect(() => resolveSourceRefs(snapshot, canonical)).not.toThrow()
  })

  it("fails an unresolvable ref rather than dropping it", async () => {
    const canonical = await createFakeNormalizationProvider().normalize(snapshot, ctx("run-1"))
    const tampered = structuredClone(canonical)
    const group = tampered.ingredientGroups[0]
    if (group === undefined) throw new Error("fixture precondition: expected an ingredient group")
    group.sourceRefs.push({ blockId: "b-does-not-exist" })
    expect(() => resolveSourceRefs(snapshot, tampered)).toThrow(UnresolvedSourceRefError)
  })
})
