/**
 * The model-capability seam for the pipeline (CFV1-SL1, ADR-0004).
 *
 * ADR-0004 exposes the model behind capabilities, not a provider SDK: "no
 * provider type, SDK type or model identifier appears outside their
 * implementations", and each capability "records its own prompt-component
 * version and run identity regardless of how many physical model calls back it".
 *
 * The seam is an injected argument, never an env var or import at the call site,
 * so production wires a real provider and tests/`reprocess` wire a deterministic
 * fake through exactly the same path (cf. the S5 loopback seam discipline).
 *
 * Slice 1 needs the capture and normalization capabilities; the cooking-plan
 * capability joins in its own unit.
 */
import type { CanonicalRecipe, SourceSnapshot, SourceType } from "../../schema/index.js"
import type { RawBlock } from "./block-id-policy.js"

/**
 * Run identity and prompt-component versions for one normalization run. Stamped
 * into the resulting `CanonicalRecipe.provenance` so two runs of the same
 * snapshot are distinguishable and comparable (SL1 `run-provenance-recorded`).
 */
export interface NormalizationContext {
  readonly runId: string
  readonly targetOntologyVersion: string
  readonly normalizationModel?: string
  readonly normalizationPromptVersions?: readonly string[]
}

/** The ADR-0004 normalization capability: a Snapshot becomes a Canonical Recipe. */
export interface NormalizationProvider {
  normalize(snapshot: SourceSnapshot, ctx: NormalizationContext): Promise<CanonicalRecipe>
}

/**
 * Snapshot identity and capture run provenance for one capture run. Identity is
 * caller-supplied (the store keys snapshots by id; ADR-0003 storeSnapshot is
 * last-write-per-id, so a re-capture reuses the id and advances `snapshotVersion`),
 * and the provenance fields are stamped into `SourceSnapshot.captureProvenance`.
 */
export interface CaptureContext {
  readonly snapshotId: string
  readonly snapshotVersion: number
  readonly sourceAdapter: string
  readonly adapterVersion: string
  readonly runId: string
  readonly captureModel?: string
  readonly capturePromptVersions?: readonly string[]
  /**
   * The media type of the bytes being captured, e.g. `image/jpeg` for a phone
   * photo or `text/plain` for a pasted source. It is what the caller knows about
   * the input and the provider cannot reliably infer; on the vision path it is
   * how the image bytes are encoded. It does NOT decide the verification
   * exemption — {@link sourceProvenance} does (ADR-0019). A provider that does not
   * care about it ignores it.
   */
  readonly sourceMediaType?: string
  /**
   * Where the bytes came from, which is what earns a model-backed provider's
   * verification exemption — not the media type (ADR-0019). `"photo"` is a page
   * the user physically held: the vision path, exempt from source-text
   * verification because pixels carry no text to anchor against. `"url"` (a
   * fetched page) and `"paste"` (pasted text) carry someone else's words and are
   * verified against them. When a provider needs this and it is absent it fails
   * CLOSED to the verified text path — an absent provenance never earns the
   * exemption, and a URL that merely serves `image/*` is not a photograph the
   * user held, so it does not inherit one's exemption.
   */
  readonly sourceProvenance?: "url" | "paste" | "photo"
}

/**
 * What a capture yields: the source text and its *segmentation* — blocks WITHOUT
 * ids ({@link RawBlock}). The provider never assigns block ids; the block-id
 * policy does, so a model-chosen id cannot reach the snapshot (CFV1-S6). The
 * assembler stamps identity and provenance from the {@link CaptureContext}.
 */
export interface CaptureResult {
  readonly sourceType: SourceType
  readonly capturedText: string
  readonly blocks: readonly RawBlock[]
  readonly structuredSourcePayload?: unknown
}

/** The ADR-0004 capture capability: source bytes become a snapshot segmentation. */
export interface CaptureProvider {
  capture(input: Uint8Array, ctx: CaptureContext): Promise<CaptureResult>
}

/**
 * A single exchange with a model: one system instruction plus the user payload,
 * which may mix text and image parts (a photographed recipe page is an image
 * part; a pasted source or a snapshot handed back for normalization is a text
 * part).
 *
 * This is deliberately *provider-agnostic*, which is what ADR-0004 asks for: no
 * provider type, SDK type or model identifier appears here or in the capabilities
 * built on it. Which vendor serves the exchange, how its request body is shaped
 * and where its bytes leave the process are all properties of the transport
 * implementation, not of the pipeline.
 */
export interface ModelTextPart {
  readonly kind: "text"
  readonly text: string
}

/** An image handed to the model, with the media type needed to encode it. */
export interface ModelImagePart {
  readonly kind: "image"
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export type ModelPart = ModelTextPart | ModelImagePart

/** What one exchange asks of the model. */
export interface ModelExchange {
  readonly system: string
  readonly parts: readonly ModelPart[]
  /**
   * Require a response that is a single JSON object and nothing else. Every
   * pipeline capability sets this: the stages emit contract objects, never prose.
   */
  readonly jsonOnly: boolean
}

/** Token accounting for one exchange, when the transport can report it. */
export interface ModelUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
}

/** What one exchange returns: the model's text, plus what it cost to get it. */
export interface ModelReply {
  readonly text: string
  readonly usage?: ModelUsage
  readonly latencyMs?: number
}

/**
 * The transport seam: something that can run one {@link ModelExchange}.
 *
 * It is an injected argument exactly like {@link CaptureProvider} and
 * {@link NormalizationProvider} are — so a test drives the real capability
 * implementations through a scripted transport with no network, and production
 * wires a transport that reaches a vendor. The capabilities below contain no
 * network primitive of their own; egress is the transport's concern alone.
 */
export interface ModelTransport {
  send(exchange: ModelExchange): Promise<ModelReply>
}
