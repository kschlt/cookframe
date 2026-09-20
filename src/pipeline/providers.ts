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
 * Slice 1's first unit needs only the normalization capability; the capture and
 * cooking-plan capabilities join in their own units.
 */
import type { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"

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
