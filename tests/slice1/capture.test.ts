/**
 * CFV1-SL1 — the capture command (source bytes → validated Source Snapshot).
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * The suite exercises the assembly seam with a deterministic fake capture
 * provider (ADR-0004) and the merged content-derived block-id policy, so no model
 * or network is involved.
 *
 * These prove the assembly's honest guarantees — it validates before returning,
 * the block ids are the policy's (not the provider's), and provenance is stamped
 * from the context. They do NOT claim the spec's full `snapshot-block-id-stability`
 * proof: with a fake provider the segmentation is deterministic by construction,
 * so id stability across runs here reflects the assembly, not the real capture
 * provider's segmentation determinism (CFV1-S6's residual, unstructured-input
 * risk), which a later unit with a real provider must establish.
 */
import { describe, expect, it } from "vitest"
import { SourceSnapshot } from "../../schema/index.js"
import {
  createContentDerivedBlockIdPolicy,
  type RawBlock,
} from "../../src/pipeline/block-id-policy.js"
import { captureSnapshot } from "../../src/pipeline/capture.js"
import { createFakeCaptureProvider } from "../../src/pipeline/fake-providers.js"
import type {
  CaptureContext,
  CaptureProvider,
  CaptureResult,
} from "../../src/pipeline/providers.js"

const policy = createContentDerivedBlockIdPolicy()

const ctx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-1",
  snapshotVersion: 0,
  sourceAdapter: "fake-capture",
  adapterVersion: "0.0.0",
  runId: "run-1",
  ...over,
})

/** A capture provider that returns a fixed segmentation, ignoring its input. */
function stubProvider(
  blocks: readonly RawBlock[],
  extra?: Partial<CaptureResult>,
): CaptureProvider {
  return {
    async capture(): Promise<CaptureResult> {
      return { sourceType: "image", capturedText: "captured", blocks, ...extra }
    },
  }
}

const bytes = (s: string) => new TextEncoder().encode(s)

describe("slice1/capture-produces-valid-snapshot", () => {
  it("assembles a snapshot that conforms to the contract", async () => {
    const snapshot = await captureSnapshot(
      createFakeCaptureProvider(),
      policy,
      bytes("Buttermilk Pancakes\n\nWhisk the eggs, then fold in the flour."),
      ctx(),
    )
    expect(() => SourceSnapshot.parse(snapshot)).not.toThrow()
    expect(snapshot.id).toBe("snap-1")
    expect(snapshot.blocks.length).toBe(2)
    expect(snapshot.blocks[0]?.type).toBe("title")
  })

  it("validates before returning: a non-conforming assembly throws, nothing is returned", async () => {
    // A provider that yields a sourceType outside the enum: the assembly must be
    // rejected by validation rather than handed back.
    const broken = stubProvider([{ order: 0, type: "title", text: "X" }], {
      sourceType: "not-a-source-type" as unknown as CaptureResult["sourceType"],
    })
    await expect(captureSnapshot(broken, policy, bytes("x"), ctx())).rejects.toThrow()
  })
})

describe("slice1/capture-block-ids-from-policy", () => {
  it("the snapshot's block ids are exactly the policy's ids for the segmentation", async () => {
    const segmentation: RawBlock[] = [
      { order: 0, type: "title", text: "Pancakes" },
      { order: 1, type: "ingredient", text: "2 eggs" },
      { order: 2, type: "instruction", text: "Whisk." },
    ]
    const snapshot = await captureSnapshot(stubProvider(segmentation), policy, bytes("x"), ctx())
    const expected = policy.assignIds(segmentation).map((b) => b.id)
    expect(snapshot.blocks.map((b) => b.id)).toEqual(expected)
  })

  it("ids are content-derived: a block keeps its id regardless of its position", async () => {
    const forward: RawBlock[] = [
      { order: 0, type: "title", text: "Pancakes" },
      { order: 1, type: "instruction", text: "Whisk." },
    ]
    const reversed: RawBlock[] = [
      { order: 0, type: "instruction", text: "Whisk." },
      { order: 1, type: "title", text: "Pancakes" },
    ]
    const a = await captureSnapshot(stubProvider(forward), policy, bytes("x"), ctx())
    const b = await captureSnapshot(stubProvider(reversed), policy, bytes("x"), ctx())
    const idFor = (blocks: typeof a.blocks, text: string): string | undefined =>
      blocks.find((x) => x.text === text)?.id
    // The same content yields the same id in either ordering. Asserted per block
    // by value, not as a set: a positional scheme (`raw-0`/`raw-1`) would give
    // the title `raw-0` forward and `raw-1` reversed, so this discriminates it —
    // where a set-cardinality check would have passed vacuously.
    expect(idFor(a.blocks, "Pancakes")).toBe(idFor(b.blocks, "Pancakes"))
    expect(idFor(a.blocks, "Whisk.")).toBe(idFor(b.blocks, "Whisk."))
    // And distinct content still gets distinct ids.
    expect(idFor(a.blocks, "Pancakes")).not.toBe(idFor(a.blocks, "Whisk."))
  })
})

describe("slice1/capture-records-provenance", () => {
  it("stamps capture provenance from the context", async () => {
    const snapshot = await captureSnapshot(
      createFakeCaptureProvider(),
      policy,
      bytes("Title\n\nStep."),
      {
        snapshotId: "snap-42",
        snapshotVersion: 2,
        sourceAdapter: "vision-adapter",
        adapterVersion: "1.2.3",
        runId: "run-99",
        captureModel: "fake-capture-1",
        capturePromptVersions: ["capture-prompt@3"],
      },
    )
    expect(snapshot.version).toBe(2)
    const p = snapshot.captureProvenance
    expect(p.sourceAdapter).toBe("vision-adapter")
    expect(p.adapterVersion).toBe("1.2.3")
    expect(p.runId).toBe("run-99")
    expect(p.model).toBe("fake-capture-1")
    expect(p.capturePromptVersions).toEqual(["capture-prompt@3"])
  })

  it("is deterministic: the same input and context yield an identical snapshot", async () => {
    const input = bytes("Pancakes\n\nWhisk the eggs.\n\nFold in the flour.")
    const a = await captureSnapshot(createFakeCaptureProvider(), policy, input, ctx())
    const b = await captureSnapshot(createFakeCaptureProvider(), policy, input, ctx())
    expect(a).toEqual(b)
  })
})
