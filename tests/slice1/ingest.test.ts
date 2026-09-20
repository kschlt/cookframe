/**
 * CFV1-SL1 — the end-to-end ingest command (source bytes → persisted snapshot +
 * first Canonical version).
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * The suite composes the real spine — capture, the provisional repository, the
 * block-id policy and normalization — with deterministic fakes behind the ADR-0004
 * seams, so no model or network is involved. Its point is the property no single
 * unit can show: the block ids the capture policy assigned are the ids the
 * normalizer references and that resolve, across the whole chain.
 */
import { describe, expect, it } from "vitest"
import { createProvisionalStore, UnresolvedSourceRefError } from "../../src/persistence/index.js"
import type { RawBlock } from "../../src/pipeline/block-id-policy.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import {
  createFakeCaptureProvider,
  createFakeNormalizationProvider,
} from "../../src/pipeline/fake-providers.js"
import { ingest } from "../../src/pipeline/ingest.js"
import type {
  CaptureContext,
  CaptureProvider,
  CaptureResult,
  NormalizationContext,
  NormalizationProvider,
} from "../../src/pipeline/providers.js"

const policy = createContentDerivedBlockIdPolicy()

const captureCtx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-ingest-1",
  snapshotVersion: 0,
  sourceAdapter: "fake-capture",
  adapterVersion: "0.0.0",
  runId: "capture-run-1",
  ...over,
})

const normCtx = (runId: string): NormalizationContext => ({
  runId,
  targetOntologyVersion: "1.0.0",
})

/** A capture provider yielding a fixed title+ingredient+instruction segmentation. */
function captureOf(blocks: readonly RawBlock[]): CaptureProvider {
  return {
    async capture(): Promise<CaptureResult> {
      return { sourceType: "image", capturedText: "captured", blocks }
    },
  }
}

const fullSegmentation: RawBlock[] = [
  { order: 0, type: "title", text: "Buttermilk Pancakes" },
  { order: 1, type: "ingredient", text: "2 eggs" },
  { order: 2, type: "instruction", text: "Whisk the eggs, then fold in the flour." },
]

const bytes = (s: string) => new TextEncoder().encode(s)

describe("slice1/ingest-composes-the-spine", () => {
  it("captures, persists and normalizes into a readable first version", async () => {
    const repo = createProvisionalStore()
    const { snapshot, canonical } = await ingest(
      repo,
      captureOf(fullSegmentation),
      createFakeNormalizationProvider(),
      policy,
      bytes("ignored by the stub provider"),
      captureCtx(),
      normCtx("norm-run-1"),
    )
    expect(canonical.version).toBe(1)
    // The snapshot is persisted and loadable by the id ingest assigned.
    expect(await repo.loadSnapshot(snapshot.id)).toBeDefined()
    // The library lists exactly the recipe ingest produced.
    expect(await repo.listLibrary()).toEqual([
      { recipeId: canonical.recipeId, latestVersion: 1, title: canonical.recipe.title },
    ])
  })

  it("works with the UTF-8 fake capture provider end to end", async () => {
    const repo = createProvisionalStore()
    const { canonical } = await ingest(
      repo,
      createFakeCaptureProvider(),
      createFakeNormalizationProvider(),
      policy,
      bytes("Pancakes\n\nWhisk the eggs."),
      captureCtx({ snapshotId: "snap-ingest-2" }),
      normCtx("norm-run-2"),
    )
    expect(canonical.version).toBe(1)
    expect(canonical.recipe.provenance.sourceSnapshotId).toBe("snap-ingest-2")
  })
})

describe("slice1/ingest-sourcerefs-resolve-against-captured-ids", () => {
  it("the canonical's refs point at block ids the capture policy assigned", async () => {
    const repo = createProvisionalStore()
    const { snapshot, canonical } = await ingest(
      repo,
      captureOf(fullSegmentation),
      createFakeNormalizationProvider(),
      policy,
      bytes("x"),
      captureCtx({ snapshotId: "snap-ingest-3" }),
      normCtx("norm-run-3"),
    )
    const capturedIds = new Set(snapshot.blocks.map((b) => b.id))
    const group = canonical.recipe.ingredientGroups[0]
    if (group === undefined)
      throw new Error("expected the fake normalizer to emit an ingredient group")
    const ref = group.sourceRefs[0]
    if (ref?.blockId === undefined) throw new Error("expected a blockId sourceRef")
    // The referenced id is one the capture policy actually assigned — not invented.
    expect(capturedIds.has(ref.blockId)).toBe(true)
  })

  it("fails closed end to end: a ref to a non-captured block aborts the ingest", async () => {
    const repo = createProvisionalStore()
    // A normalizer that references a block id the capture never produced.
    const badNormalizer: NormalizationProvider = {
      async normalize(snapshot, ctx) {
        const base = await createFakeNormalizationProvider().normalize(snapshot, ctx)
        const tampered = structuredClone(base)
        const group = tampered.ingredientGroups[0]
        if (group === undefined)
          throw new Error("fixture precondition: expected an ingredient group")
        group.sourceRefs = [{ blockId: "b-does-not-exist" }]
        return tampered
      },
    }
    await expect(
      ingest(
        repo,
        captureOf(fullSegmentation),
        badNormalizer,
        policy,
        bytes("x"),
        captureCtx({ snapshotId: "snap-ingest-4" }),
        normCtx("norm-run-4"),
      ),
    ).rejects.toThrow(UnresolvedSourceRefError)
    // Nothing was appended: the unresolved ref stopped the write.
    expect(await repo.listLibrary()).toHaveLength(0)
  })
})
