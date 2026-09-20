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
