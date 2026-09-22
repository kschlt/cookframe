/**
 * The narrow persistence interface for Cookframe (CFV1-SL1, ADR-0003; widened by
 * ADR-0018).
 *
 * ADR-0003 fixed the interface at five operations and required that "no storage
 * type appears outside its implementation", and warned that such an interface
 * "may need widening; it should be extended when a real query demands it". ADR-0018
 * is that widening: the shopping slice's capability-URL route needs the latest
 * Canonical version for a recipe id, so a sixth read — {@link
 * RecipeRepository.loadLatestCanonical} — is added, and ADR-0018 supersedes ADR-0003
 * on the operation set. This module declares only the interface and its plain data
 * shapes; concrete stores live behind {@link RecipeRepository} and are constructed
 * through a factory, never named by a caller.
 *
 * The append-and-compare shape is deliberate (SL1 Hints): the only write path
 * for a Canonical Recipe is an *append*, so an implementation that overwrites a
 * version in place is unwritable against this interface — which is what makes
 * "read two runs of the same recipe" (op 5) satisfiable at all.
 *
 * No contract shape is declared here: the schema lives only in `schema/`
 * (repo-config `slice0/schema-single-source-of-truth`). Types are imported from
 * the contract.
 */
import type { CanonicalRecipe, CookingPlan, SourceSnapshot } from "../../schema/index.js"

/** One persisted, immutable Canonical Recipe version. */
export interface CanonicalVersion {
  /** The recipe identity shared across every normalization run: `CanonicalRecipe.id`. */
  readonly recipeId: string
  /** Store-assigned, 1-based, monotonic per `recipeId`. Never supplied by a caller. */
  readonly version: number
  readonly recipe: CanonicalRecipe
}

/** One row of the library listing (op 4). */
export interface LibraryEntry {
  readonly recipeId: string
  readonly latestVersion: number
  /**
   * The source's own title, absent when the source carried none.
   *
   * Absent rather than a placeholder: a listing row is a thing a person reads
   * and a thing a query groups by, and either would be wrong about a recipe
   * whose card had no heading. The caller decides what to show for a gap —
   * `src/render/library.ts` says so in words — and the store never invents one.
   */
  readonly title?: string
}

/** Raised when a snapshot id is not present in the store. */
export class SnapshotNotFoundError extends Error {
  constructor(readonly snapshotId: string) {
    super(`no Source Snapshot stored for id ${snapshotId}`)
    this.name = "SnapshotNotFoundError"
  }
}

/** Raised when a requested recipe id or version ordinal does not exist. */
export class RecipeVersionNotFoundError extends Error {
  constructor(
    readonly recipeId: string,
    readonly version?: number,
  ) {
    super(
      version === undefined
        ? `no Canonical Recipe stored for id ${recipeId}`
        : `no version ${version} for Canonical Recipe id ${recipeId}`,
    )
    this.name = "RecipeVersionNotFoundError"
  }
}

/**
 * Raised when a Cooking Plan is offered for storage without naming the Canonical
 * version it was derived from. A plan is derived data whose only meaning is
 * relative to one version of one recipe (ADR-0025); filed without that, it is an
 * artefact nobody can tell apart from a stale one.
 */
export class UnversionedCookingPlanError extends Error {
  constructor(readonly recipeId: string) {
    super(`the Cooking Plan for ${recipeId} names no Canonical version to belong to`)
    this.name = "UnversionedCookingPlanError"
  }
}

/**
 * The persistence operations — ADR-0003's original five, the read ADR-0018
 * added, and the two ADR-0025 added for the derived Cooking Plan. Everything the pipeline persists goes through this interface, and every
 * document is validated against the versioned contract before it is written (see
 * `./validate.ts`).
 */
export interface RecipeRepository {
  /** (1) Store a Source Snapshot. Validated before write; last write per id wins. */
  storeSnapshot(snapshot: SourceSnapshot): Promise<void>

  /** (2) Load a Source Snapshot, or `undefined` when none is stored for the id. */
  loadSnapshot(snapshotId: string): Promise<SourceSnapshot | undefined>

  /**
   * (3) Store a Canonical Recipe version — APPEND ONLY. A recipe with an id that
   * already has versions becomes the next version; existing versions are never
   * mutated. Validated before write. Returns the newly created version.
   */
  appendCanonicalVersion(recipe: CanonicalRecipe): Promise<CanonicalVersion>

  /**
   * (6, ADR-0018) Load the latest Canonical version for `recipeId`, or `undefined`
   * when no recipe has that id. Not-found is a RETURN VALUE, not a throw: the
   * caller that demanded this — the shopping slice's capability-URL route
   * (ADR-0016) — must distinguish a revoked token from a missing recipe, and it
   * should not have to catch an exception to do so. This follows {@link
   * loadSnapshot} (which returns `undefined`), not {@link readTwoRuns} (which
   * throws for a caller that asked for a version by ordinal and got it wrong).
   */
  loadLatestCanonical(recipeId: string): Promise<CanonicalVersion | undefined>

  /** (4) List the library: one entry per recipe id, newest version's title if it has one. */
  listLibrary(): Promise<readonly LibraryEntry[]>

  /**
   * (5) Read two runs of the same recipe for comparison. Both versions are
   * returned in full and unchanged; this is the operation a document store is
   * least likely to serve well, and the one CFV1-DBQ measures.
   */
  readTwoRuns(
    recipeId: string,
    versionA: number,
    versionB: number,
  ): Promise<readonly [CanonicalVersion, CanonicalVersion]>

  /**
   * (7, ADR-0025) Store the derived Cooking Plan for ONE Canonical version.
   *
   * The plan names the version it belongs to, in `derivation.canonicalVersion`,
   * rather than the caller naming it alongside: two places to say it is two
   * places to disagree, and the disagreement would be a plan served for a recipe
   * it was not derived from. A plan that names no version is refused with {@link
   * UnversionedCookingPlanError}, and one naming a version this store does not
   * hold with {@link RecipeVersionNotFoundError} — a stored plan whose recipe
   * version does not exist is an untraceable artefact, which the slice forbids
   * for a plan's contents and forbids no less for the plan itself.
   *
   * Last write per (recipe, version) wins. The plan is derived data: re-deriving
   * the same version yields the same bytes (ADR-0023), so there is nothing an
   * append would preserve, and no comparison of two runs to serve.
   */
  storeCookingPlan(plan: CookingPlan): Promise<void>

  /**
   * (8, ADR-0025) Load the stored Cooking Plan for one version of one recipe, or
   * `undefined` when none is stored.
   *
   * Keyed by version, not by recipe: a plan derived from version 2 must not be
   * served for version 3, and keying it this way makes that impossible rather
   * than checked. Absence is a RETURN VALUE and the ordinary state of every
   * recipe not yet cooked — `PDR-0004` ships `lazy`, so the caller derives on a
   * miss rather than failing.
   */
  loadCookingPlan(recipeId: string, version: number): Promise<CookingPlan | undefined>
}
