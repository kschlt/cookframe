/**
 * The end-to-end ingest command for Slice 1 (CFV1-SL1): source bytes become a
 * persisted Source Snapshot and its first Canonical Recipe version.
 *
 * This composes the spine that the earlier units built in isolation — capture
 * (bytes → validated snapshot, block ids from the policy), persistence (store the
 * snapshot), and normalization (the stored snapshot → a Canonical version whose
 * `sourceRefs` resolve against the captured block ids). It is the one place all
 * three meet, so it is where the end-to-end property lives: the block ids the
 * capture policy assigned are the ids the normalizer references and that resolve.
 *
 * It is a plain command (ADR-0008: V1 has no job mechanism). Every provider is an
 * injected argument (ADR-0004), so production wires real capture and
 * normalization and tests wire fakes through the same path. Order is capture →
 * store → reprocess; nothing is persisted until it is valid, and no Canonical
 * version is appended until its refs resolve against its snapshot (`reprocess`).
 *
 * Scope: like `captureSnapshot`, this does not store the captured image bytes or
 * record a source-asset `storageIdentity` on the snapshot — that association is
 * an owner-gated schema decision. The byte store (ADR-0009) retains the image
 * independently.
 */

import type { SourceSnapshot } from "../../schema/index.js"
import type { CanonicalVersion, RecipeRepository } from "../persistence/repository.js"
import type { BlockIdPolicy } from "./block-id-policy.js"
import { captureSnapshot } from "./capture.js"
import type {
  CaptureContext,
  CaptureProvider,
  NormalizationContext,
  NormalizationProvider,
} from "./providers.js"
import { reprocess } from "./reprocess.js"

/** The persisted result of one ingest: the stored snapshot and its first version. */
export interface IngestResult {
  readonly snapshot: SourceSnapshot
  readonly canonical: CanonicalVersion
}

/**
 * Ingest `input` end to end: capture it into a validated snapshot (block ids from
 * `policy`), persist the snapshot, then normalize it into its first Canonical
 * version. Surfaces validation / unresolved-ref errors before anything downstream
 * is persisted. Returns the stored snapshot and the appended version.
 */
export async function ingest(
  repo: RecipeRepository,
  capture: CaptureProvider,
  normalization: NormalizationProvider,
  policy: BlockIdPolicy,
  input: Uint8Array,
  captureCtx: CaptureContext,
  normalizationCtx: NormalizationContext,
): Promise<IngestResult> {
  const snapshot = await captureSnapshot(capture, policy, input, captureCtx)
  await repo.storeSnapshot(snapshot)
  const canonical = await reprocess(repo, normalization, snapshot.id, normalizationCtx)
  return { snapshot, canonical }
}
