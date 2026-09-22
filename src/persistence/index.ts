/**
 * Persistence barrel (CFV1-SL1, CFV1-PG). Exposes only the repository interface,
 * its data shapes and error types, the configuration seam, and the two store
 * factories — never a concrete store type, and no PostgreSQL type at all
 * (ADR-0003 confinement: no storage type appears outside its implementation).
 */

export {
  DatabaseConfigurationError,
  type DatabaseConfigurationProblem,
  resolveDatabaseUrl,
} from "./configuration.js"
export {
  createPostgresStore,
  type PostgresStoreHandle,
  StoreNotMigratedError,
} from "./postgres-store.js"
export { createProvisionalStore } from "./provisional-store.js"
export type {
  CanonicalVersion,
  CapabilityGrantRecord,
  LibraryEntry,
  RecipeRepository,
} from "./repository.js"
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
