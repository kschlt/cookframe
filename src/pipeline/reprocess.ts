/**
 * The `reprocess` command (CFV1-SL1, ADR-0008).
 *
 * Re-runs normalization over an already-stored Source Snapshot into a NEW
 * Canonical Recipe version, leaving every earlier version intact. It is a plain
 * function invoked in-process — ADR-0008 settled that V1 has no background-job
 * mechanism, so `reprocess` is a command and is not routed through one. There is
 * no HTTP request or job in scope here.
 *
 * Order matters: load → normalize → resolve refs (fail closed) → ground the
 * title (fail closed) → append (which validates). Nothing reaches the store
 * until it is structurally valid, referentially resolvable against its
 * snapshot, and not claiming a title the source never gave.
 *
 * The title check sits HERE rather than in the normalization provider because
 * this is the one place every producer of a Canonical Recipe passes — `ingest`
 * composes it, and a reprocess of a stored snapshot runs it again — and because
 * it must govern the `image` path, where the provider's own claim verification
 * is deliberately off (`src/pipeline/title-grounding.ts`).
 *
 * **The picture is the pipeline's, never the normalizer's.** What a Canonical
 * Recipe carries as `media` is decided HERE, for the same reason: this is the
 * one place every version passes. A normalizer's `media` is dropped, because a
 * model's reply passes through its other fields and a `storageIdentity` it named
 * would be served by the picture route as the dish's — and the same store holds
 * the kept photographs. The version carries the `media` its caller kept for it
 * (a URL import, `src/pipeline/hero-image.ts`), or, when the caller kept none,
 * the media the recipe's previous version carried: re-converting a stored
 * source keeps its picture and fetches nothing.
 */
import type { CanonicalRecipe, RecipeMedia } from "../../schema/index.js"
import type { CanonicalVersion, RecipeRepository } from "../persistence/repository.js"
import { SnapshotNotFoundError } from "../persistence/repository.js"
import { resolveSourceRefs } from "../persistence/validate.js"
import type { NormalizationContext, NormalizationProvider } from "./providers.js"
import { verifyTitleGrounding } from "./title-grounding.js"

/** What a caller decided for the version beyond what the normalizer produces. */
export interface ReprocessOptions {
  /**
   * The picture the caller kept for this version. Absent means the caller kept
   * none, and the recipe's previous version's picture, if any, is carried.
   */
  readonly media?: RecipeMedia
}

/**
 * Reprocess the stored snapshot `snapshotId` into a new Canonical Recipe version.
 * Throws {@link SnapshotNotFoundError} if the snapshot is not stored, and
 * surfaces validation, unresolved-ref and ungrounded-title errors before
 * anything is persisted.
 */
export async function reprocess(
  repo: RecipeRepository,
  provider: NormalizationProvider,
  snapshotId: string,
  ctx: NormalizationContext,
  options: ReprocessOptions = {},
): Promise<CanonicalVersion> {
  const snapshot = await repo.loadSnapshot(snapshotId)
  if (snapshot === undefined) throw new SnapshotNotFoundError(snapshotId)
  const normalized = await provider.normalize(snapshot, ctx)
  const media = options.media ?? (await repo.loadLatestCanonical(normalized.id))?.recipe.media
  const canonical = withMedia(normalized, media)
  resolveSourceRefs(snapshot, canonical)
  verifyTitleGrounding(snapshot, canonical)
  return repo.appendCanonicalVersion(canonical)
}

/** `recipe` carrying exactly `media`: whatever the normalizer put there is gone. */
function withMedia(recipe: CanonicalRecipe, media: RecipeMedia | undefined): CanonicalRecipe {
  const { media: _fromTheNormalizer, ...rest } = recipe
  return media === undefined ? rest : { ...rest, media }
}
