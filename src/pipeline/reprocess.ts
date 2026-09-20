/**
 * The `reprocess` command (CFV1-SL1, ADR-0008).
 *
 * Re-runs normalization over an already-stored Source Snapshot into a NEW
 * Canonical Recipe version, leaving every earlier version intact. It is a plain
 * function invoked in-process — ADR-0008 settled that V1 has no background-job
 * mechanism, so `reprocess` is a command and is not routed through one. There is
 * no HTTP request or job in scope here.
 *
 * Order matters: load → normalize → resolve refs (fail closed) → append
 * (which validates). Nothing reaches the store until it is both structurally
 * valid and referentially resolvable against its snapshot.
 */
import type { CanonicalVersion, RecipeRepository } from "../persistence/repository.js"
import { SnapshotNotFoundError } from "../persistence/repository.js"
import { resolveSourceRefs } from "../persistence/validate.js"
import type { NormalizationContext, NormalizationProvider } from "./providers.js"

/**
 * Reprocess the stored snapshot `snapshotId` into a new Canonical Recipe version.
 * Throws {@link SnapshotNotFoundError} if the snapshot is not stored, and
 * surfaces validation / unresolved-ref errors before anything is persisted.
 */
export async function reprocess(
  repo: RecipeRepository,
  provider: NormalizationProvider,
  snapshotId: string,
  ctx: NormalizationContext,
): Promise<CanonicalVersion> {
  const snapshot = await repo.loadSnapshot(snapshotId)
  if (snapshot === undefined) throw new SnapshotNotFoundError(snapshotId)
  const canonical = await provider.normalize(snapshot, ctx)
  resolveSourceRefs(snapshot, canonical)
  return repo.appendCanonicalVersion(canonical)
}
