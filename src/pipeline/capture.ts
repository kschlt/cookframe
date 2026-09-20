/**
 * The capture command for Slice 1 (CFV1-SL1): source bytes become a validated
 * Source Snapshot.
 *
 * This is the assembly seam. A {@link CaptureProvider} (ADR-0004 capability,
 * injected — never imported at the call site) turns the input bytes into a
 * *segmentation* and the source text; the {@link BlockIdPolicy} assigns the block
 * ids (CFV1-S6: ids are the policy's, never the model's); and this command stamps
 * the snapshot identity and capture provenance from the context, then validates
 * the whole against the contract before handing it back. Validation precedes
 * persistence: the caller stores the returned snapshot through the repository,
 * and an invalid assembly throws here rather than reaching the store.
 *
 * Scope: this command does not persist, and it does not store the captured image
 * bytes or record their `storageIdentity` on the snapshot — the snapshot has no
 * field for a source-asset identity, and adding one is a schema decision left
 * open. The byte store (ADR-0009) retains the image independently.
 *
 * Honesty on stability: given a provider that yields a *stable segmentation* for
 * an input, this command yields stable block ids — the policy makes id
 * assignment deterministic. Whether the real capture provider segments the same
 * source identically run to run (the harder half of `snapshot-block-id-stability`
 * for unstructured input) is a capture-prompt property beyond this command
 * (CFV1-S6's residual risk).
 */
import type { SourceSnapshot } from "../../schema/index.js"
import { validateSnapshot } from "../persistence/validate.js"
import type { BlockIdPolicy } from "./block-id-policy.js"
import type { CaptureContext, CaptureProvider } from "./providers.js"

/**
 * Capture `input` into a validated Source Snapshot: run the provider, assign
 * block ids through the policy, stamp identity and provenance from `ctx`, and
 * validate before returning. Throws on an assembly that does not conform.
 */
export async function captureSnapshot(
  provider: CaptureProvider,
  policy: BlockIdPolicy,
  input: Uint8Array,
  ctx: CaptureContext,
): Promise<SourceSnapshot> {
  const result = await provider.capture(input, ctx)
  const blocks = policy.assignIds(result.blocks)
  const snapshot = {
    id: ctx.snapshotId,
    version: ctx.snapshotVersion,
    sourceType: result.sourceType,
    capturedText: result.capturedText,
    ...(result.structuredSourcePayload !== undefined
      ? { structuredSourcePayload: result.structuredSourcePayload }
      : {}),
    blocks,
    captureProvenance: {
      sourceAdapter: ctx.sourceAdapter,
      adapterVersion: ctx.adapterVersion,
      runId: ctx.runId,
      ...(ctx.captureModel !== undefined ? { model: ctx.captureModel } : {}),
      ...(ctx.capturePromptVersions !== undefined
        ? { capturePromptVersions: [...ctx.capturePromptVersions] }
        : {}),
    },
  }
  // Validate before the snapshot leaves this command (validation precedes
  // persistence): an assembly that does not conform throws rather than returning.
  return validateSnapshot(snapshot)
}
