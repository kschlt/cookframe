/**
 * CFV1-SL1 — the real, model-backed capture and normalization capabilities.
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * The suite drives the *real* provider implementations through a scripted
 * {@link ModelTransport}, so these are proofs about the production code paths
 * with no model and no network: the transport seam is what makes that possible,
 * and exercising it here is the same discipline as S5's loopback seam.
 *
 * What is proven: identity and provenance are the pipeline's and survive a model
 * that reports otherwise; a reply that breaks the contract fails closed instead
 * of producing a half-valid object; and the vision path presents an image as an
 * image part rather than decoding bytes as text.
 */
import { describe, expect, it } from "vitest"
import { SCHEMA_VERSION, type SourceSnapshot } from "../../schema/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { captureSnapshot } from "../../src/pipeline/capture.js"
import {
  createModelCaptureProvider,
  createModelNormalizationProvider,
  ModelReplyError,
} from "../../src/pipeline/model-providers.js"
import type {
  CaptureContext,
  ModelExchange,
  ModelTransport,
  NormalizationContext,
} from "../../src/pipeline/providers.js"

const policy = createContentDerivedBlockIdPolicy()

/** A transport that replies with fixed text and records what it was asked. */
function scripted(reply: string): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: reply }
    },
  }
}

/**
 * A transport that replies with each text in turn and repeats the last one once
 * the script runs out, recording every exchange it was handed.
 */
function sequence(...replies: string[]): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: replies[Math.min(seen.length - 1, replies.length - 1)] as string }
    },
  }
}

/**
 * The rejected-reply excerpt, unwrapped from the CFV1-INJ fence it travels in.
 *
 * The repair prompt quotes the model's previous reply, and that reply is
 * untrusted text like any other — a page that steered the model steers what it
 * emits — so it is sealed into its own part rather than interpolated into the
 * instruction. These proofs are about WHAT is quoted, so they unwrap the fence
 * and keep asserting the exact reply.
 *
 * The sealed region carries the rejection REASON first and then the reply,
 * because the reason is model-derived too: `readBlocks` builds it from the
 * reply's own `type` value. So the unwrapping takes what follows the reply's
 * heading, and returns "" if that heading is absent rather than silently
 * handing back the reason as though it were the reply.
 */
const REPLY_HEADING = "The reply that was rejected:"

function repairExcerpt(exchange: ModelExchange | undefined): string {
  const part = exchange?.parts.at(-1)
  const text = part?.kind === "text" ? part.text : ""
  const lines = text.split("\n")
  if (!lines[0]?.startsWith("<<<UNTRUSTED-SOURCE") || !lines.at(-1)?.startsWith("<<<END ")) {
    return ""
  }
  const region = lines.slice(1, -1)
  const at = region.indexOf(REPLY_HEADING)
  return at === -1 ? "" : region.slice(at + 1).join("\n")
}

/** The rejection reason, unwrapped from the same fence. */
function repairReason(exchange: ModelExchange | undefined): string {
  const part = exchange?.parts.at(-1)
  const text = part?.kind === "text" ? part.text : ""
  const lines = text.split("\n")
  if (!lines[0]?.startsWith("<<<UNTRUSTED-SOURCE")) return ""
  const region = lines.slice(1, -1)
  const at = region.indexOf(REPLY_HEADING)
  return (at === -1 ? region : region.slice(0, at)).join("\n")
}

const stage = (transport: ModelTransport) => ({
  transport,
  promptText: "PROMPT",
  contractText: "CONTRACT",
})

const captureCtx: CaptureContext = {
  snapshotId: "snap-1",
  snapshotVersion: 0,
  sourceAdapter: "photo",
  adapterVersion: "1.0.0",
  runId: "run-capture",
  captureModel: "test-model",
  sourceMediaType: "image/jpeg",
}

const normCtx: NormalizationContext = {
  runId: "run-normalize",
  targetOntologyVersion: "1.0.0",
  normalizationModel: "test-model",
}

/** A capture reply whose block ids are deliberately not the policy's. */
const captureReply = JSON.stringify({
  id: "model-chosen-id",
  version: 99,
  sourceType: "image",
  capturedText: "Pfannkuchen\n\n200 g Mehl\n\nAlles verrühren.",
  blocks: [
    { id: "b-title", order: 0, type: "title", text: "Pfannkuchen" },
    { id: "b-ing-1", order: 7, type: "ingredient", text: "200 g Mehl" },
    { id: "b-instr-1", order: 1, type: "instruction", text: "Alles verrühren." },
  ],
  captureProvenance: { sourceAdapter: "lies", adapterVersion: "9.9.9", runId: "lies" },
})

describe("slice1/capture-ids-are-the-policys-not-the-models", () => {
  it("drops the model's block ids and its claimed order", async () => {
    const transport = scripted(captureReply)
    const snapshot = await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    const ids = snapshot.blocks.map((b) => b.id)
    expect(ids).not.toContain("b-title")
    expect(ids).not.toContain("b-ing-1")
    // `order` is array position, so the model's bogus 7 cannot survive.
    expect(snapshot.blocks.map((b) => b.order)).toEqual([0, 1, 2])
    // Identity and provenance come from the context, not the reply.
    expect(snapshot.id).toBe("snap-1")
    expect(snapshot.version).toBe(0)
    expect(snapshot.captureProvenance.sourceAdapter).toBe("photo")
    expect(snapshot.captureProvenance.runId).toBe("run-capture")
  })

  it("assigns the same ids to the same segmentation on an independent run", async () => {
    const run = async () =>
      captureSnapshot(
        createModelCaptureProvider(stage(scripted(captureReply))),
        policy,
        new Uint8Array([0xff, 0xd8, 0xff]),
        captureCtx,
      )
    const [a, b] = await Promise.all([run(), run()])
    expect(a.blocks.map((x) => x.id)).toEqual(b.blocks.map((x) => x.id))
  })

  it("does not take a structured source payload from the model", async () => {
    // `structuredSourcePayload` asserts that the SOURCE published machine-readable
    // structure, which only a deterministic adapter that parsed one can attest.
    // `resolveSourceRefs` resolves a `payloadPointer` ref by checking the snapshot
    // carries a payload at all, so a model-supplied one would make every such ref
    // resolve by construction.
    const withPayload = JSON.stringify({
      ...JSON.parse(captureReply),
      structuredSourcePayload: { "@type": "Recipe", name: "invented by the model" },
    })
    const snapshot = await captureSnapshot(
      createModelCaptureProvider(stage(scripted(withPayload))),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    expect(snapshot.structuredSourcePayload).toBeUndefined()
  })
})

describe("slice1/capture-uses-the-vision-path-for-an-image", () => {
  it("sends image bytes as an image part, not as decoded text", async () => {
    const transport = scripted(captureReply)
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    await captureSnapshot(createModelCaptureProvider(stage(transport)), policy, bytes, captureCtx)
    const parts = transport.seen[0]?.parts ?? []
    const image = parts.find((p) => p.kind === "image")
    expect(image).toBeDefined()
    expect(image?.kind === "image" && image.mediaType).toBe("image/jpeg")
    expect(image?.kind === "image" && image.bytes).toEqual(bytes)
    expect(transport.seen[0]?.jsonOnly).toBe(true)
  })

  it("decodes a non-image media type as text instead", async () => {
    const transport = scripted(captureReply)
    await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      // The source text the scripted reply claims to have read. On the text
      // path CFV1-INJ verifies every block against the decoded input, so an
      // input that did not say what the reply reports is refused — which is
      // the point of that check, and not what this test is about.
      new TextEncoder().encode("Pfannkuchen\n\n200 g Mehl\n\nAlles verrühren."),
      { ...captureCtx, sourceMediaType: "text/plain" },
    )
    const parts = transport.seen[0]?.parts ?? []
    expect(parts.some((p) => p.kind === "image")).toBe(false)
    expect(parts.some((p) => p.kind === "text" && p.text.includes("Pfannkuchen"))).toBe(true)
  })
})

describe("slice1/model-reply-fails-closed", () => {
  it("rejects a reply that is not JSON", async () => {
    await expect(
      createModelCaptureProvider(stage(scripted("I'm afraid I can't do that."))).capture(
        new Uint8Array([1]),
        captureCtx,
      ),
    ).rejects.toThrow(ModelReplyError)
  })

  it("rejects a captured block whose type is not in the contract's enum", async () => {
    const reply = JSON.stringify({
      capturedText: "x",
      blocks: [{ order: 0, type: "ingredient_list", text: "200 g Mehl" }],
    })
    await expect(
      createModelCaptureProvider(stage(scripted(reply))).capture(new Uint8Array([1]), captureCtx),
    ).rejects.toThrow(/unknown type/)
  })

  it("rejects a canonical recipe that does not conform, rather than returning it", async () => {
    // `yields` is required by the contract and absent here.
    const reply = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      title: "Pfannkuchen",
      ingredientGroups: [],
      instructionSections: [],
    })
    const snapshot: SourceSnapshot = {
      id: "snap-1",
      version: 0,
      sourceType: "image",
      capturedText: "x",
      blocks: [{ id: "b1", order: 0, type: "title", text: "Pfannkuchen" }],
      captureProvenance: { sourceAdapter: "photo", adapterVersion: "1.0.0", runId: "r" },
    }
    await expect(
      createModelNormalizationProvider(stage(scripted(reply))).normalize(snapshot, normCtx),
    ).rejects.toThrow(ModelReplyError)
  })
})

describe("slice1/run-provenance-recorded", () => {
  it("stamps recipe identity and provenance from the context, overriding the model", async () => {
    const snapshot: SourceSnapshot = {
      id: "snap-7",
      version: 3,
      sourceType: "image",
      capturedText: "x",
      blocks: [{ id: "b1", order: 0, type: "title", text: "Pfannkuchen" }],
      captureProvenance: { sourceAdapter: "photo", adapterVersion: "1.0.0", runId: "r" },
    }
    const reply = JSON.stringify({
      id: "a-model-chosen-recipe-id",
      schemaVersion: SCHEMA_VERSION,
      title: "Pfannkuchen",
      yields: [],
      ingredientGroups: [],
      instructionSections: [],
      provenance: {
        sourceSnapshotId: "a-different-snapshot",
        sourceSnapshotVersion: 0,
        targetOntologyVersion: "0.0.1",
        runId: "a-model-chosen-run",
      },
    })
    const recipe = await createModelNormalizationProvider(stage(scripted(reply))).normalize(
      snapshot,
      normCtx,
    )
    expect(recipe.id).toBe("recipe-of-snap-7")
    expect(recipe.provenance.sourceSnapshotId).toBe("snap-7")
    expect(recipe.provenance.sourceSnapshotVersion).toBe(3)
    expect(recipe.provenance.runId).toBe("run-normalize")
    expect(recipe.provenance.targetOntologyVersion).toBe("1.0.0")
    expect(recipe.provenance.normalizationModel).toBe("test-model")
  })
})

/**
 * The gap the real-photograph run found: one page in eleven was rejected by
 * `.strict()` and dropped. Failing closed was right, dropping it was not.
 */
describe("slice1/contract-failure-is-retried", () => {
  /** A canonical the contract rejects: `yields` is required and absent. */
  const badCanonical = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    title: "Pfannkuchen",
    ingredientGroups: [],
    instructionSections: [],
  })
  const goodCanonical = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    title: "Pfannkuchen",
    yields: [],
    ingredientGroups: [],
    instructionSections: [],
  })
  const snapshot: SourceSnapshot = {
    id: "snap-1",
    version: 0,
    sourceType: "image",
    capturedText: "x",
    blocks: [{ id: "b1", order: 0, type: "title", text: "Pfannkuchen" }],
    captureProvenance: { sourceAdapter: "photo", adapterVersion: "1.0.0", runId: "r" },
  }

  it("recovers a page a single attempt would have dropped", async () => {
    const transport = sequence(badCanonical, goodCanonical)
    const recipe = await createModelNormalizationProvider(stage(transport)).normalize(
      snapshot,
      normCtx,
    )
    expect(transport.seen).toHaveLength(2)
    // Identity and provenance are still the pipeline's on the recovered reply.
    expect(recipe.id).toBe("recipe-of-snap-1")
    expect(recipe.provenance.runId).toBe("run-normalize")
  })

  it("retries a rejected capture too, not only normalization", async () => {
    const badCapture = JSON.stringify({
      capturedText: "x",
      blocks: [{ order: 0, type: "ingredient_list", text: "200 g Mehl" }],
    })
    const transport = sequence(badCapture, captureReply)
    const snapshotOut = await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    expect(transport.seen).toHaveLength(2)
    expect(snapshotOut.blocks).toHaveLength(3)
  })

  it("quotes the rejected reply back on the capture path, not only on normalization", async () => {
    // The repair prompt ends with "Your rejected reply, for reference:". Before
    // this was fixed, every rejection raised inside `readBlocks` / `asRecord`
    // constructed its error without the reply, so that section arrived EMPTY on
    // the capture path: the model was told it was wrong and not shown what it
    // had written. Measured 0 characters there against 84 on the normalization
    // path, which made `REPAIR_EXCERPT_CHARS` dead code for capture.
    const rejected = JSON.stringify({
      capturedText: "x",
      blocks: [{ order: 0, type: "not_a_block_type", text: "200 g Mehl" }],
    })
    const transport = sequence(rejected, captureReply)
    await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    expect(transport.seen).toHaveLength(2)
    const instruction = transport.seen[1]?.parts.at(-2)
    expect(instruction?.kind === "text" ? instruction.text : "").toContain(
      "YOUR PREVIOUS REPLY WAS REJECTED",
    )
    // The whole rejected reply, not just the complaint about it.
    expect(repairExcerpt(transport.seen[1])).toBe(rejected)
  })

  it("quotes it back when the reply has no blocks array at all", async () => {
    // The other capture-path throw that used to drop the reply: `blocks` absent
    // means `readBlocks` rejects before any block is looked at.
    const rejected = JSON.stringify({ capturedText: "x" })
    const transport = sequence(rejected, captureReply)
    await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    expect(repairExcerpt(transport.seen[1])).toBe(rejected)
  })

  it("quotes it back when the reply is a JSON array instead of an object", async () => {
    // `asRecord`'s own throw, the one shared by both stages.
    const rejected = JSON.stringify([{ capturedText: "x" }])
    const transport = sequence(rejected, captureReply)
    await captureSnapshot(
      createModelCaptureProvider(stage(transport)),
      policy,
      new Uint8Array([0xff, 0xd8, 0xff]),
      captureCtx,
    )
    expect(repairExcerpt(transport.seen[1])).toBe(rejected)
  })

  it("spends no second call when the first reply conforms", async () => {
    const transport = sequence(goodCanonical)
    await createModelNormalizationProvider(stage(transport)).normalize(snapshot, normCtx)
    // A speculative retry would be billed for nothing.
    expect(transport.seen).toHaveLength(1)
  })

  it("re-sends the input with the failure, as a fresh exchange and not a conversation", async () => {
    const transport = sequence(badCanonical, goodCanonical)
    await createModelNormalizationProvider(stage(transport)).normalize(snapshot, normCtx)
    const [first, second] = transport.seen
    // Same instructions and same contract: the stage is stateless.
    expect(second?.system).toBe(first?.system)
    // The input is carried again, so the model is not asked to remember it.
    expect(second?.parts[0]).toEqual(first?.parts[0])
    // The repair instruction, then the reason and the rejected reply sealed in
    // their own part.
    const repair = second?.parts.at(-2)
    expect(repair?.kind).toBe("text")
    const text = repair?.kind === "text" ? repair.text : ""
    expect(text).toContain("YOUR PREVIOUS REPLY WAS REJECTED")
    // The validator's own message, not a paraphrase of it — and in the SEALED
    // part, not here. It reads like the pipeline's sentence and is not one: at
    // capture it is built from the model's `type` value verbatim, and here from
    // a Zod error carrying key names out of the reply. Asserting its absence
    // from the instruction is the half of this that would have caught that.
    expect(repairReason(second)).toContain("yields")
    expect(text).not.toContain("yields")
  })

  it("still fails closed once the attempts are spent, and says what they cost", async () => {
    const transport = sequence(badCanonical)
    const error = await createModelNormalizationProvider(stage(transport))
      .normalize(snapshot, normCtx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelReplyError)
    expect((error as ModelReplyError).attempts).toBe(2)
    expect(transport.seen).toHaveLength(2)
  })

  it("makes exactly one call when a caller sets maxAttempts to 1", async () => {
    const transport = sequence(badCanonical)
    await expect(
      createModelNormalizationProvider({ ...stage(transport), maxAttempts: 1 }).normalize(
        snapshot,
        normCtx,
      ),
    ).rejects.toThrow(ModelReplyError)
    expect(transport.seen).toHaveLength(1)
  })

  it("does not retry a failure the model cannot repair", async () => {
    // A transport or egress failure is not a contract violation: the request may
    // already have been delivered and billed, and re-sending it is a different
    // decision with different costs.
    let calls = 0
    const failing: ModelTransport = {
      async send() {
        calls++
        throw new Error("egress refused: TIME_LIMIT")
      },
    }
    await expect(
      createModelNormalizationProvider(stage(failing)).normalize(snapshot, normCtx),
    ).rejects.toThrow(/TIME_LIMIT/)
    expect(calls).toBe(1)
  })

  it("reports every physical call, so a caller can account for what it spent", async () => {
    const seen: { attempt: number; repairing?: string }[] = []
    const transport = sequence(badCanonical, goodCanonical)
    await createModelNormalizationProvider({
      ...stage(transport),
      onAttempt: (info) =>
        seen.push({
          attempt: info.attempt,
          ...(info.repairing !== undefined ? { repairing: info.repairing } : {}),
        }),
    }).normalize(snapshot, normCtx)
    expect(seen).toHaveLength(2)
    expect(seen[0]?.repairing).toBeUndefined()
    expect(seen[1]?.repairing).toContain("does not conform")
  })
})
