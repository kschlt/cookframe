/**
 * The real, model-backed capture and normalization capabilities (CFV1-SL1,
 * ADR-0004) — the production counterparts to `fake-providers.ts`.
 *
 * These are **provider-agnostic**. Neither function names a vendor, an SDK or a
 * model id: both run their stage through an injected {@link ModelTransport}, so
 * "which model" is the transport's business and "which model was used" is data
 * the caller stamps through the context. That is ADR-0004's boundary taken
 * literally — the capability is the seam, the provider is an implementation
 * detail behind it — and it is why neither module below contains a network
 * primitive (cf. the ADR-0010 chokepoint: egress belongs to the transport).
 *
 * Two things the model emits are deliberately **discarded and re-stamped here**,
 * on the same principle that already governs block ids (CFV1-S6, PR #14):
 * identity and provenance are the pipeline's, never the model's.
 *
 *   - **Block ids.** The capture prompt asks for stable ids, and CFV1-S6
 *     measured that the request is not honoured: across sonnet, gpt-5.4 and
 *     gpt-5.4-mini, segmentation ids wander between runs in no predictable
 *     pattern. This provider therefore returns {@link RawBlock}s — the model's
 *     ids are dropped on the floor and the {@link BlockIdPolicy} assigns the
 *     real ones downstream.
 *   - **Recipe identity and provenance.** The recipe id is derived from the
 *     snapshot it was normalized from, so two runs of the same snapshot produce
 *     two versions of the *same* recipe (what ADR-0003 op 5 `readTwoRuns` and
 *     `reprocess` rely on); `provenance` is built from the context, so a model
 *     cannot misreport which snapshot, run or ontology version produced a fact.
 *
 * The contract is enforced, not hoped for: a reply that does not parse, or that
 * does not conform to the schema in `schema/`, throws {@link ModelReplyError}
 * rather than returning a half-valid object. CFV1-S6 measured why this matters —
 * a full-tier model produced 27/27 conformant outputs and a mini tier 24/27, and
 * all three failures were contract violations (`.strict()` caught every one).
 */
import { BlockType, type CanonicalRecipe, type SourceSnapshot } from "../../schema/index.js"
import { validateCanonical } from "../persistence/validate.js"
import type { RawBlock } from "./block-id-policy.js"
import type {
  CaptureProvider,
  CaptureResult,
  ModelExchange,
  ModelPart,
  ModelTransport,
  NormalizationContext,
  NormalizationProvider,
} from "./providers.js"

/** Raised when a model reply is unusable: not JSON, or not the contract shape. */
export class ModelReplyError extends Error {
  constructor(
    readonly stage: "capture" | "normalization",
    message: string,
    readonly reply?: string,
  ) {
    super(`${stage}: ${message}`)
    this.name = "ModelReplyError"
  }
}

/**
 * What a model-backed stage needs besides its transport: the versioned prompt
 * that drives it and the contract text it must write against.
 *
 * Both are injected rather than read from disk here, because both are *versioned
 * artifacts* the caller chooses (`prompts/README.md`: one version per file, a
 * measured rate always names the prompt it was measured against). The contract
 * text is the `schema/` source itself — the single source of truth handed to the
 * model verbatim, so a prompt never restates the field list and cannot drift
 * from it (recipe-ontology §5).
 */
export interface ModelStageConfig {
  readonly transport: ModelTransport
  readonly promptText: string
  readonly contractText: string
}

/** Strip a markdown fence a model may have wrapped its JSON in, then parse. */
function parseJsonReply(stage: "capture" | "normalization", text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "")
  try {
    return JSON.parse(cleaned)
  } catch {
    throw new ModelReplyError(stage, "reply is not valid JSON", text)
  }
}

function asRecord(stage: "capture" | "normalization", value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelReplyError(stage, "reply is not a JSON object")
  }
  return value as Record<string, unknown>
}

function buildExchange(
  config: ModelStageConfig,
  contract: string,
  parts: readonly ModelPart[],
): ModelExchange {
  return {
    system: [
      "You are one stage of a recipe-processing pipeline. Follow the STAGE INSTRUCTIONS exactly and emit only the JSON output they require. No prose, no markdown fence.",
      "",
      "=== STAGE INSTRUCTIONS ===",
      config.promptText,
      "",
      "=== OUTPUT CONTRACT (authoritative Zod schema; every object is .strict() — unknown keys are a failure) ===",
      config.contractText,
      "",
      "=== THIS CALL ===",
      contract,
    ].join("\n"),
    parts,
    jsonOnly: true,
  }
}

/**
 * Read the model's segmentation into {@link RawBlock}s, dropping any id it
 * assigned. `order` is taken from array position rather than the model's own
 * `order` field, so a model that numbers inconsistently cannot produce a
 * snapshot whose blocks disagree with their own ordering.
 */
function readBlocks(value: unknown): RawBlock[] {
  if (!Array.isArray(value)) {
    throw new ModelReplyError("capture", "reply has no `blocks` array")
  }
  return value.map((raw, index) => {
    const block = asRecord("capture", raw)
    const text = block.text
    if (typeof text !== "string") {
      throw new ModelReplyError("capture", `block ${index} has no string \`text\``)
    }
    // The block type is validated against the contract's own enum — this calls
    // the schema, it does not restate it.
    const parsedType = BlockType.safeParse(block.type)
    if (!parsedType.success) {
      throw new ModelReplyError(
        "capture",
        `block ${index} has an unknown type: ${String(block.type)}`,
      )
    }
    const heading = block.heading
    return {
      order: index,
      type: parsedType.data,
      text,
      ...(typeof heading === "string" ? { heading } : {}),
    }
  })
}

/**
 * Create the real capture capability: source bytes (a photographed page, or
 * pasted text) become a segmentation, through one model exchange.
 *
 * `mediaType` decides how the input is presented: an `image/*` media type is
 * sent as an image part (the vision path — what a phone photo needs), anything
 * else is decoded as UTF-8 text. The resulting {@link CaptureResult} carries no
 * ids; `captureSnapshot` runs it through the {@link BlockIdPolicy} and stamps
 * identity and provenance from its context.
 */
export function createModelCaptureProvider(config: ModelStageConfig): CaptureProvider {
  return {
    async capture(input, ctx): Promise<CaptureResult> {
      const mediaType = ctx.sourceMediaType ?? "image/jpeg"
      const isImage = mediaType.startsWith("image/")
      const sourceType = isImage ? "image" : "text"
      const parts: ModelPart[] = isImage
        ? [
            { kind: "text", text: "RAW SOURCE (photographed recipe page):" },
            { kind: "image", mediaType, bytes: input },
          ]
        : [{ kind: "text", text: `RAW SOURCE:\n${new TextDecoder().decode(input)}` }]

      const exchange = buildExchange(
        config,
        `Output a single SourceSnapshot JSON object (schema/source-snapshot.ts). sourceType is "${sourceType}".`,
        parts,
      )
      const reply = await config.transport.send(exchange)
      const parsed = asRecord("capture", parseJsonReply("capture", reply.text))

      const blocks = readBlocks(parsed.blocks)
      const capturedText = parsed.capturedText
      if (typeof capturedText !== "string") {
        throw new ModelReplyError("capture", "reply has no string `capturedText`")
      }
      // `sourceType` is the caller's, not the model's: a model handed a
      // photograph of a page may reasonably call it either "image" or "text",
      // and only the caller knows what it actually passed in.
      return {
        sourceType,
        capturedText,
        blocks,
        ...(parsed.structuredSourcePayload !== undefined
          ? { structuredSourcePayload: parsed.structuredSourcePayload }
          : {}),
      }
    },
  }
}

/** Build the provenance the pipeline guarantees, from the context alone. */
function stampProvenance(snapshot: SourceSnapshot, ctx: NormalizationContext) {
  return {
    sourceSnapshotId: snapshot.id,
    sourceSnapshotVersion: snapshot.version,
    targetOntologyVersion: ctx.targetOntologyVersion,
    runId: ctx.runId,
    ...(ctx.normalizationModel !== undefined ? { normalizationModel: ctx.normalizationModel } : {}),
    ...(ctx.normalizationPromptVersions !== undefined
      ? { normalizationPromptVersions: [...ctx.normalizationPromptVersions] }
      : {}),
  }
}

/**
 * Create the real normalization capability: a Source Snapshot becomes a
 * Canonical Recipe, through one model exchange.
 *
 * The model is given the snapshot verbatim and asked for the canonical form; the
 * reply's `id` and `provenance` are then replaced with the pipeline's own before
 * the whole is parsed against the contract. `resolveSourceRefs` (run by the
 * repository on write) is what then proves the refs point at real blocks — this
 * provider does not pre-empt that check, so a ref failure surfaces at the
 * boundary that owns it.
 */
export function createModelNormalizationProvider(config: ModelStageConfig): NormalizationProvider {
  return {
    async normalize(snapshot, ctx): Promise<CanonicalRecipe> {
      const exchange = buildExchange(
        config,
        "Output a single CanonicalRecipe JSON object (schema/canonical-recipe.ts). schemaVersion must equal SCHEMA_VERSION; every sourceRef.blockId must be an id present in the input snapshot's blocks.",
        [
          {
            kind: "text",
            text: `SOURCE SNAPSHOT (input):\n${JSON.stringify(snapshot, null, 2)}`,
          },
        ],
      )
      const reply = await config.transport.send(exchange)
      const parsed = asRecord("normalization", parseJsonReply("normalization", reply.text))

      const candidate = {
        ...parsed,
        // Identity and provenance are the pipeline's, never the model's.
        id: `recipe-of-${snapshot.id}`,
        provenance: stampProvenance(snapshot, ctx),
      }
      try {
        return validateCanonical(candidate)
      } catch (cause) {
        throw new ModelReplyError(
          "normalization",
          `reply does not conform to the contract: ${(cause as Error).message}`,
          reply.text,
        )
      }
    },
  }
}
