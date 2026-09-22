/**
 * The provisional persistence store for Slice 1 (CFV1-SL1, ADR-0003).
 *
 * ADR-0003 defers the database technology and physical shape (OQ-03/OQ-04) and
 * lets Slice 1 persist "JSON documents in the simplest store that works", behind
 * the repository interface, explicitly replaceable. This is that store: an
 * in-memory, append-only implementation — dependency-free and deterministic.
 *
 * NO LONGER THE STORE AN INSTANCE RUNS ON, and kept deliberately. CFV1-DBQ
 * measured the three deciding queries over real Slice 1 data, ADR-0015 closed
 * OQ-03/OQ-04 on that evidence — PostgreSQL, JSONB documents, with an extracted
 * projection where a query is measured to need one — and CFV1-PG built that
 * store in `./postgres-store.ts`. An instance keeps its library there.
 *
 * What this store is now for is the contract itself. `runRepositoryContract` is
 * a proof about {@link RecipeRepository} rather than about any one store, and an
 * interface with a single implementation is not an interface anyone has tested:
 * the suite cannot tell a promise the interface makes from a habit its only
 * store happens to have. Two implementations, run from one definition, is what
 * makes that difference visible. So this one stays, dependency-free and needing
 * no server, and every proof runs against both.
 *
 * It is still in memory and still survives nothing, which is now a property
 * rather than a shortfall: a test wants a store that starts empty and costs
 * nothing, and `persistence/a-restart-keeps-the-library` is the proof that
 * separates the two stores on exactly this point.
 *
 * The concrete class is intentionally NOT exported — callers see only
 * {@link RecipeRepository} and {@link createProvisionalStore}, so no storage
 * type leaks past this file (ADR-0003 confinement).
 */
import type { CanonicalRecipe, CookingPlan, SourceSnapshot } from "../../schema/index.js"
import {
  type CanonicalVersion,
  type LibraryEntry,
  type RecipeRepository,
  RecipeVersionNotFoundError,
  UnversionedCookingPlanError,
} from "./repository.js"
import { validateCanonical, validateCookingPlan, validateSnapshot } from "./validate.js"

class ProvisionalStore implements RecipeRepository {
  readonly #snapshots = new Map<string, SourceSnapshot>()
  /** recipeId -> versions in append order; index 0 is version 1. Never mutated in place. */
  readonly #versions = new Map<string, CanonicalRecipe[]>()
  /** `recipeId\u0000version` -> the plan derived from exactly that version (ADR-0025). */
  readonly #plans = new Map<string, CookingPlan>()

  async storeSnapshot(snapshot: SourceSnapshot): Promise<void> {
    // Validate before the store is touched: invalid input never persists. The
    // Zod-parsed value is a fresh object graph, so the store never aliases the
    // caller's input.
    const valid = validateSnapshot(snapshot)
    this.#snapshots.set(valid.id, valid)
  }

  async loadSnapshot(snapshotId: string): Promise<SourceSnapshot | undefined> {
    // Hand back a copy: a caller mutating the result must not reach into stored
    // state (the store's immutability cannot depend on caller discipline).
    const stored = this.#snapshots.get(snapshotId)
    return stored === undefined ? undefined : structuredClone(stored)
  }

  async appendCanonicalVersion(recipe: CanonicalRecipe): Promise<CanonicalVersion> {
    // Validate before the store is touched, then append — the only write path.
    const valid = validateCanonical(recipe)
    const existing = this.#versions.get(valid.id) ?? []
    existing.push(valid)
    this.#versions.set(valid.id, existing)
    return { recipeId: valid.id, version: existing.length, recipe: structuredClone(valid) }
  }

  async loadLatestCanonical(recipeId: string): Promise<CanonicalVersion | undefined> {
    // Not-found is a return value, not a throw (ADR-0018): a public capability
    // route tells a revoked token from a missing recipe without catching. A copy
    // is handed back, like every other read here, so a caller cannot reach into
    // stored state.
    const versions = this.#versions.get(recipeId)
    if (versions === undefined || versions.length === 0) return undefined
    const latest = versions[versions.length - 1]
    if (latest === undefined) return undefined
    return { recipeId, version: versions.length, recipe: structuredClone(latest) }
  }

  async listLibrary(): Promise<readonly LibraryEntry[]> {
    const entries: LibraryEntry[] = []
    for (const [recipeId, versions] of this.#versions) {
      const latest = versions[versions.length - 1]
      if (latest === undefined) continue
      entries.push({
        recipeId,
        latestVersion: versions.length,
        // A declared gap stays a gap in the listing: no key at all rather than
        // a borrowed string, which is what `LibraryEntry.title` being optional
        // is for.
        ...(latest.title.state === "from_source" ? { title: latest.title.sourceText } : {}),
      })
    }
    return entries
  }

  async readTwoRuns(
    recipeId: string,
    versionA: number,
    versionB: number,
  ): Promise<readonly [CanonicalVersion, CanonicalVersion]> {
    const versions = this.#versions.get(recipeId)
    if (versions === undefined) throw new RecipeVersionNotFoundError(recipeId)
    const a = versions[versionA - 1]
    const b = versions[versionB - 1]
    if (a === undefined) throw new RecipeVersionNotFoundError(recipeId, versionA)
    if (b === undefined) throw new RecipeVersionNotFoundError(recipeId, versionB)
    // Copies, so comparing (or mutating) two runs cannot reach stored state.
    return [
      { recipeId, version: versionA, recipe: structuredClone(a) },
      { recipeId, version: versionB, recipe: structuredClone(b) },
    ]
  }

  async storeCookingPlan(plan: CookingPlan): Promise<void> {
    // Validate before the store is touched, like every other write here.
    const valid = validateCookingPlan(plan)
    const version = valid.derivation.canonicalVersion
    if (version === undefined) throw new UnversionedCookingPlanError(valid.recipeId)
    // A plan filed against a version this store does not hold could never be
    // served, and could not be told from a stale one if the version arrived
    // later. Refusing is the same rule the plan's own contents follow.
    const versions = this.#versions.get(valid.recipeId)
    if (versions === undefined || versions[version - 1] === undefined) {
      throw new RecipeVersionNotFoundError(valid.recipeId, version)
    }
    this.#plans.set(planKey(valid.recipeId, version), valid)
  }

  async loadCookingPlan(recipeId: string, version: number): Promise<CookingPlan | undefined> {
    // Absence is the ordinary state of a recipe nobody has cooked yet, not an
    // error (`PDR-0004` ships `lazy`). A copy, like every other read here.
    const stored = this.#plans.get(planKey(recipeId, version))
    return stored === undefined ? undefined : structuredClone(stored)
  }
}

/**
 * One key per (recipe, version). `\u0000` cannot occur in either part of a key
 * this store is given — a recipe id comes from the contract's `z.string().min(1)`
 * over normalized text and a version is a number — so no two distinct pairs can
 * collide into one key by concatenation.
 */
const planKey = (recipeId: string, version: number): string => `${recipeId}\u0000${version}`

/** Construct a fresh provisional (in-memory, append-only) repository. */
export function createProvisionalStore(): RecipeRepository {
  return new ProvisionalStore()
}
