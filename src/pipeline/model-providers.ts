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
 *
 * Failing closed is right; *dropping the page* is not, so a rejected reply is
 * retried once by default — see {@link runStage} for what is retried and what is
 * deliberately not. The retry is measured rather than assumed: on the cheap
 * tier it repaired two of three real contract violations over 12 conversions,
 * moving delivery from 9/12 to 11/12, and one failed again
 * (`spikes/s6-fidelity/FINDINGS.md`, *Does the retry work?*). So it moves the
 * rate and does not remove the case, which is why the stage still fails closed
 * once its attempts are spent.
 */
import { BlockType, type CanonicalRecipe, type SourceSnapshot } from "../../schema/index.js"
import { validateCanonical } from "../persistence/validate.js"
import type { RawBlock } from "./block-id-policy.js"
import { verifyCaptureSupport, verifyClaimSupport } from "./claim-support.js"
import type {
  CaptureProvider,
  CaptureResult,
  ModelExchange,
  ModelPart,
  ModelTransport,
  NormalizationContext,
  NormalizationProvider,
} from "./providers.js"
import { type MarkerSource, sealSourceText, untrustedRegionRule } from "./untrusted-source-text.js"

/** Raised when a model reply is unusable: not JSON, or not the contract shape. */
export class ModelReplyError extends Error {
  /**
   * How many physical calls were spent before giving up. 1 unless a retry was
   * configured; a caller accounting for cost needs this, because every attempt
   * was billed whether or not it conformed.
   */
  attempts = 1

  constructor(
    readonly stage: "capture" | "normalization",
    message: string,
    /**
     * The reply that was rejected, **required**.
     *
     * Optional here once, and the invariant was held by two helpers that
     * happened to pass it. Three throw sites added later omitted it and
     * typechecked, which is how the repair path silently lost the text it
     * exists to quote. A required parameter is the only version of this rule
     * that a new throw site cannot forget.
     */
    readonly reply: string,
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
  /**
   * How many physical calls a stage may spend on one input, counting the first.
   * Default {@link DEFAULT_MAX_ATTEMPTS}. Set 1 to disable the retry described
   * in {@link runStage}; values below 1 are treated as 1.
   */
  readonly maxAttempts?: number
  /**
   * Test seam for the untrusted-text fence's random marker (CFV1-INJ). Left
   * unset in production, where the marker is drawn from `crypto.randomUUID()`;
   * a test supplies a predictable one so a fixture can attempt to forge the
   * fence and be shown not to.
   */
  readonly markerSource?: MarkerSource
  /**
   * Called once per physical call, before the reply is read. The only way a
   * caller can count what a conversion actually cost, since a retried call is
   * billed like any other and nothing in the persisted record mentions it.
   */
  readonly onAttempt?: (info: {
    readonly stage: "capture" | "normalization"
    /** 1-based. */
    readonly attempt: number
    readonly maxAttempts: number
    /** The failure this attempt is trying to repair; absent on the first. */
    readonly repairing?: string
  }) => void
}

/**
 * One retry by default.
 *
 * The real-photograph run (CFV1-S1) put a full-tier model through eleven pages
 * and lost one to a `.strict()` violation — an undefined key inside
 * `ingredientUses`. Failing closed on it was right; *dropping* it was not, and a
 * capability whose default silently costs the user one page in eleven has the
 * wrong default. CFV1-S6 measured the same class at 3/27 on a cheap tier.
 *
 * Two, not more: a contract violation that survives a second attempt with the
 * validator's own message in front of the model is a prompt or schema problem,
 * and grinding through further attempts spends real money to arrive at the same
 * failure. ADR-0014 counts this retry as part of the per-conversion cost.
 */
const DEFAULT_MAX_ATTEMPTS = 2

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

/**
 * Every rejection carries the reply it rejected. `ModelReplyError.reply` is what
 * `withRepairRequest` quotes back to the model, so a throw that omits it sends a
 * repair prompt with an empty "your rejected reply" section — the model is told
 * it was wrong and not shown what it wrote. That is why `reply` is a required
 * parameter here rather than an optional courtesy.
 */
function asRecord(
  stage: "capture" | "normalization",
  value: unknown,
  reply: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelReplyError(stage, "reply is not a JSON object", reply)
  }
  return value as Record<string, unknown>
}

/**
 * Assemble one exchange.
 *
 * Instructions go in `system`; untrusted source text goes in `parts`, and only
 * ever through {@link sealSourceText} (CFV1-INJ). The two are never concatenated
 * — there is no string here into which a page's bytes and a pipeline
 * instruction both flow — and when a sealed region is present the system message
 * states the rule naming that region's own unforgeable marker.
 *
 * `trustedParts` are the pipeline's own words (a label, a repair request); the
 * image bytes of a photograph are trusted in the same sense, since the image
 * path is outside CFV1-INJ's scope by the item's own terms.
 */
function buildExchange(
  config: ModelStageConfig,
  contract: string,
  trustedParts: readonly ModelPart[],
  sealed?: { readonly marker: string; readonly part: ModelPart },
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
      ...(sealed !== undefined
        ? ["", "=== SOURCE DATA ===", untrustedRegionRule(sealed.marker)]
        : []),
    ].join("\n"),
    parts: sealed !== undefined ? [...trustedParts, sealed.part] : trustedParts,
    jsonOnly: true,
  }
}

/** How much of a rejected reply to show the model when asking it to repair. */
const REPAIR_EXCERPT_CHARS = 4000

/**
 * Run one stage, retrying a reply the contract rejects.
 *
 * **Only a contract failure is retried.** `read` throws {@link ModelReplyError}
 * when the model wrote something unusable — not JSON, an out-of-contract block
 * type, a canonical that does not parse — and that is a fault the model can
 * plausibly repair when it is shown the validator's own message. Anything else
 * propagates untouched: a transport or egress failure is the transport's
 * concern and has its own typed reasons, a deadline has already elapsed, and
 * retrying a call that may have been delivered is a different decision with
 * different costs. Re-sending a request the provider already answered is not
 * this function's business.
 *
 * The retry is a **fresh exchange with the failure appended**, not a
 * conversation: the stage is stateless, so the second call carries the same
 * system prompt, the same contract, the same input parts, plus what was wrong
 * with the last reply. Nothing from the failed attempt is persisted or read —
 * only its error text is quoted back — so a retry cannot smuggle a half-valid
 * object past the contract.
 *
 * Failing after the last attempt is still failing closed. The error carries the
 * attempt count so a caller can tell "the model got it right on the second try"
 * from "the model never got it right", and account for what both cost.
 */
async function runStage<T>(
  config: ModelStageConfig,
  stage: "capture" | "normalization",
  exchange: ModelExchange,
  read: (replyText: string) => T,
): Promise<T> {
  const maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  let lastFailure: ModelReplyError | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    config.onAttempt?.({
      stage,
      attempt,
      maxAttempts,
      ...(lastFailure !== undefined ? { repairing: lastFailure.message } : {}),
    })
    const thisExchange =
      lastFailure === undefined
        ? exchange
        : withRepairRequest(exchange, lastFailure, config.markerSource)
    const reply = await config.transport.send(thisExchange)
    try {
      return read(reply.text)
    } catch (err) {
      if (!(err instanceof ModelReplyError)) throw err
      err.attempts = attempt
      lastFailure = err
    }
  }
  // Unreachable unless maxAttempts < 1, which the clamp above forbids. There is
  // no reply to carry because no call was made, and `""` says that rather than
  // leaving the field absent — see the constructor.
  throw lastFailure ?? new ModelReplyError(stage, "no attempt was made", "")
}

/**
 * The same exchange plus what was wrong with the previous reply.
 *
 * The rejected reply is **sealed like any other untrusted text** (CFV1-INJ). It
 * is the model's own output rather than the page's, but a page that steers the
 * model steers what it emits, so quoting a rejected reply back unfenced would
 * reopen on the repair path exactly the boundary the first call closed — and it
 * would do so on the one path where the model has already demonstrably departed
 * from its contract. The reason line is the validator's own words and is the
 * pipeline's to state; only the excerpt is sealed.
 */
function withRepairRequest(
  exchange: ModelExchange,
  failure: ModelReplyError,
  markerSource: MarkerSource | undefined,
): ModelExchange {
  const excerpt = sealSourceText(
    "your rejected reply",
    (failure.reply ?? "").slice(0, REPAIR_EXCERPT_CHARS),
    markerSource,
  )
  return {
    ...exchange,
    parts: [
      ...exchange.parts,
      {
        kind: "text",
        text: [
          "=== YOUR PREVIOUS REPLY WAS REJECTED ===",
          "It was checked against the output contract above and did not conform.",
          `Reason: ${failure.message}`,
          "",
          "Emit a corrected reply for the SAME input. Do not explain the error and",
          "do not include any key the contract does not define — every object is",
          ".strict(), so an extra key is itself a failure.",
          "",
          untrustedRegionRule(excerpt.marker),
          "",
          "Your rejected reply, for reference:",
        ].join("\n"),
      },
      excerpt.part,
    ],
  }
}

/**
 * Read the model's segmentation into {@link RawBlock}s, dropping any id it
 * assigned. `order` is taken from array position rather than the model's own
 * `order` field, so a model that numbers inconsistently cannot produce a
 * snapshot whose blocks disagree with their own ordering.
 */
function readBlocks(value: unknown, reply: string): RawBlock[] {
  if (!Array.isArray(value)) {
    throw new ModelReplyError("capture", "reply has no `blocks` array", reply)
  }
  return value.map((raw, index) => {
    const block = asRecord("capture", raw, reply)
    const text = block.text
    if (typeof text !== "string") {
      throw new ModelReplyError("capture", `block ${index} has no string \`text\``, reply)
    }
    // The block type is validated against the contract's own enum — this calls
    // the schema, it does not restate it.
    const parsedType = BlockType.safeParse(block.type)
    if (!parsedType.success) {
      throw new ModelReplyError(
        "capture",
        `block ${index} has an unknown type: ${String(block.type)}`,
        reply,
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
      // The image path hands over bytes the user physically photographed, which
      // CFV1-INJ leaves out of scope by its own terms. The TEXT path is the one
      // that carries someone else's words — a fetched page, or a paste of one —
      // so it never reaches the prompt as an interpolated string: it is sealed
      // into its own fenced part and the system message states the rule.
      const trustedParts: ModelPart[] = isImage
        ? [
            { kind: "text", text: "RAW SOURCE (photographed recipe page):" },
            { kind: "image", mediaType, bytes: input },
          ]
        : [{ kind: "text", text: "RAW SOURCE follows in the fenced region below." }]
      const sourceText = isImage ? "" : new TextDecoder().decode(input)
      const sealed = isImage
        ? undefined
        : sealSourceText("raw source text", sourceText, config.markerSource)

      const exchange = buildExchange(
        config,
        `Output a single SourceSnapshot JSON object (schema/source-snapshot.ts). sourceType is "${sourceType}".`,
        trustedParts,
        sealed,
      )
      return runStage(config, "capture", exchange, (replyText) => {
        const parsed = asRecord("capture", parseJsonReply("capture", replyText), replyText)
        const blocks = readBlocks(parsed.blocks, replyText)
        const capturedText = parsed.capturedText
        if (typeof capturedText !== "string") {
          throw new ModelReplyError("capture", "reply has no string `capturedText`", replyText)
        }
        // `sourceType` is the caller's, not the model's: a model handed a
        // photograph of a page may reasonably call it either "image" or "text",
        // and only the caller knows what it actually passed in.
        //
        // CFV1-INJ. Verification at normalization compares the canonical against
        // the SNAPSHOT, and on the fallback path the snapshot is this model's
        // own output — so without this the chain verifies an invention against
        // itself. Measured before it was closed: a fabricated ingredient block
        // survived capture, normalization and resolution together. Anchored on
        // the decoded input, which is the one thing here the model did not
        // write. Not a `ModelReplyError`, so `runStage` does not retry it.
        verifyCaptureSupport(sourceType, sourceText, blocks)
        // `structuredSourcePayload` is deliberately NOT carried over from the
        // reply, even when the model offers one. It means "the source itself
        // published machine-readable structure" (Recipe JSON-LD and the like),
        // and only a deterministic adapter that actually parsed such a payload
        // can attest to that; a model reading a page can at best re-encode what
        // it read, which is a different claim wearing the same field's name. The
        // difference is load-bearing rather than cosmetic: `resolveSourceRefs`
        // resolves a `payloadPointer` ref by checking that the snapshot carries
        // a payload at all, so a model-invented payload would make every
        // payload-pointer ref resolve by construction and turn a fail-closed
        // check into a tautology. Same rule as block ids and provenance —
        // structure the pipeline vouches for is never taken from the model.
        return { sourceType, capturedText, blocks }
      })
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
      // The snapshot's blocks ARE the source's words, so the normalization call
      // is an untrusted-text call too — the fallback path's model sees the
      // fetched page here, not at capture. Sealing the whole snapshot keeps one
      // boundary rather than two, and keeps it verbatim: `verifyClaimSupport`
      // below compares the reply against exactly these block texts.
      const sealed = sealSourceText(
        "source snapshot",
        JSON.stringify(snapshot, null, 2),
        config.markerSource,
      )
      const exchange = buildExchange(
        config,
        "Output a single CanonicalRecipe JSON object (schema/canonical-recipe.ts). schemaVersion must equal SCHEMA_VERSION; every sourceRef.blockId must be an id present in the input snapshot's blocks.",
        [{ kind: "text", text: "SOURCE SNAPSHOT (input) follows in the fenced region below." }],
        sealed,
      )
      return runStage(config, "normalization", exchange, (replyText) => {
        const parsed = asRecord(
          "normalization",
          parseJsonReply("normalization", replyText),
          replyText,
        )
        const candidate = {
          ...parsed,
          // Identity and provenance are the pipeline's, never the model's.
          id: `recipe-of-${snapshot.id}`,
          provenance: stampProvenance(snapshot, ctx),
        }
        let canonical: CanonicalRecipe
        try {
          canonical = validateCanonical(candidate)
        } catch (cause) {
          throw new ModelReplyError(
            "normalization",
            `reply does not conform to the contract: ${(cause as Error).message}`,
            replyText,
          )
        }
        // CFV1-INJ. Deliberately NOT a `ModelReplyError`: `runStage` retries
        // that class and only that class, so an `UnsupportedClaimError` leaves
        // this stage on the first attempt. A page that steered the model into
        // inventing content will steer it again, and spending a second billed
        // call to be lied to twice is not a retry policy. It is also distinct
        // from a transport failure, so a caller can tell the three apart.
        verifyClaimSupport(snapshot, canonical)
        return canonical
      })
    },
  }
}
