/**
 * Persistence barrel (CFV1-SL1). Exposes only the repository interface, its data
 * shapes and error types, and the provisional-store factory — never a concrete
 * store type (ADR-0003 confinement: no storage type appears outside its
 * implementation).
 */

export { createProvisionalStore } from "./provisional-store.js"
export type { CanonicalVersion, LibraryEntry, RecipeRepository } from "./repository.js"
export {
  RecipeVersionNotFoundError,
  SnapshotNotFoundError,
  UnversionedCookingPlanError,
} from "./repository.js"
export {
  resolveSourceRefs,
  UnresolvedSourceRefError,
  validateCanonical,
  validateCookingPlan,
  validateSnapshot,
} from "./validate.js"
