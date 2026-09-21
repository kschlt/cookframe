/**
 * The provisional persistence store for Slice 1 (CFV1-SL1, ADR-0003).
 *
 * ADR-0003 defers the database technology and physical shape (OQ-03/OQ-04) and
 * lets Slice 1 persist "JSON documents in the simplest store that works", behind
 * the repository interface, explicitly replaceable. This is that store: an
 * in-memory, append-only implementation — dependency-free and deterministic. It
 * decides nothing about OQ-03/OQ-04; the deciding evaluation is CFV1-DBQ.
 *
 * The concrete class is intentionally NOT exported — callers see only
 * {@link RecipeRepository} and {@link createProvisionalStore}, so no storage
 * type leaks past this file (ADR-0003 confinement).
 */
import type { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"
import {
  type CanonicalVersion,
  type LibraryEntry,
  type RecipeRepository,
  RecipeVersionNotFoundError,
} from "./repository.js"
import { validateCanonical, validateSnapshot } from "./validate.js"

class ProvisionalStore implements RecipeRepository {
  readonly #snapshots = new Map<string, SourceSnapshot>()
  /** recipeId -> versions in append order; index 0 is version 1. Never mutated in place. */
  readonly #versions = new Map<string, CanonicalRecipe[]>()

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
      entries.push({ recipeId, latestVersion: versions.length, title: latest.title })
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
}

/** Construct a fresh provisional (in-memory, append-only) repository. */
export function createProvisionalStore(): RecipeRepository {
  return new ProvisionalStore()
}
