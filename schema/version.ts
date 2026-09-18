/**
 * The Canonical/Source contract version. Bumped when the shape changes so that
 * persistence, validation and Schema.org mapping can key behaviour off it, and
 * so a stored record can be reprocessed against a later ontology version
 * (recipe-ontology §4, §8). This is the ONE place the version is declared.
 */
export const SCHEMA_VERSION = "1.0.0" as const
export type SchemaVersion = typeof SCHEMA_VERSION
