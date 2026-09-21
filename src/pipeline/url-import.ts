/**
 * Import a recipe from a URL end to end (CFV1-SL4): fetch the page through the
 * safe-fetch guard, then run its bytes through exactly the same ingest spine an
 * image import uses.
 *
 * This is the wiring that makes a URL import a first-class source: it composes the
 * URL byte source (the egress seam, `src/security/url-byte-source.ts`) with the
 * shared {@link ingest} command. The convergence principle (owner-confirmed) is
 * structural here, not asserted — a URL import produces a `SourceSnapshot` and a
 * `CanonicalRecipe` through the same `ingest(...)` call as any other source, with
 * no URL-specific "light" shape and no path that skips snapshot persistence. The
 * capture provider it is given decides how the fetched bytes become a snapshot
 * (the deterministic JSON-LD adapter, or a fallback capability); this module only
 * gets the bytes to the pipeline and lets the pipeline's invariants hold.
 *
 * Every collaborator is injected (ADR-0004): the byte source, the repository, the
 * capture and normalization providers, and the block-id policy all arrive as
 * arguments, so production wires the real safe-fetch-backed byte source and tests
 * wire a loopback-allowed one through the same path. Nothing here imports a
 * network primitive — the fetch happens behind {@link UrlByteSource}, whose
 * implementation is the only code in `src/` outside `src/security/` that may.
 *
 * A guard refusal or a fail-closed bound surfaces as the byte source's
 * `SafeFetchError` (with its `reasonCode`) and propagates before anything is
 * captured or persisted; an insufficient-source refusal from the deterministic
 * capture provider surfaces as its own error the same way. Either way nothing is
 * persisted when the import cannot complete — the ingest order (capture → store →
 * reprocess) guarantees it.
 */

import type { RecipeRepository } from "../persistence/repository.js"
import type { UrlByteSource } from "../security/url-byte-source.js"
import type { BlockIdPolicy } from "./block-id-policy.js"
import { type IngestResult, ingest } from "./ingest.js"
import type {
  CaptureContext,
  CaptureProvider,
  NormalizationContext,
  NormalizationProvider,
} from "./providers.js"

/**
 * The injected collaborators for a URL import. The byte source is the egress seam;
 * the rest are the same spine {@link ingest} composes for any source, passed here
 * so the URL path reuses it wholesale rather than reassembling it.
 */
export interface UrlImportDeps {
  readonly byteSource: UrlByteSource
  readonly repo: RecipeRepository
  readonly capture: CaptureProvider
  readonly normalization: NormalizationProvider
  readonly policy: BlockIdPolicy
}

/**
 * Import the recipe at `url`: fetch it through the safe-fetch guard, then ingest
 * the fetched bytes into a persisted `SourceSnapshot` and its first Canonical
 * version. Returns the same {@link IngestResult} an image import returns.
 *
 * Throws before persisting anything if the guard refuses the URL or a bound is
 * exceeded (`SafeFetchError`), or if the capture provider declines the fetched
 * bytes (e.g. the deterministic adapter's insufficient-JSON-LD refusal).
 */
export async function importFromUrl(
  deps: UrlImportDeps,
  url: string,
  captureCtx: CaptureContext,
  normalizationCtx: NormalizationContext,
): Promise<IngestResult> {
  const fetched = await deps.byteSource.load(url)
  return ingest(
    deps.repo,
    deps.capture,
    deps.normalization,
    deps.policy,
    fetched.bytes,
    captureCtx,
    normalizationCtx,
  )
}
