/**
 * The single source of truth for the Cookframe data contract (CFV1-SL0).
 *
 * Validation, persistence and the Schema.org / Bring mapping MUST import the
 * contract from here — there is deliberately no second copy of the shape
 * anywhere in the tree (recipe-ontology §5; ADR-0006). Types are inferred from
 * the Zod schemas (`z.infer`), so the runtime validator and the compile-time
 * types can never drift apart.
 */

export * from "./canonical-recipe.js"
export * from "./common.js"
export * from "./cooking-plan.js"
export * from "./source-snapshot.js"
export { SCHEMA_VERSION, type SchemaVersion } from "./version.js"
