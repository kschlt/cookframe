/**
 * The Canonical/Source contract version. Bumped when the shape changes so that
 * persistence, validation and Schema.org mapping can key behaviour off it, and
 * so a stored record can be reprocessed against a later ontology version
 * (recipe-ontology §4, §8). This is the ONE place the version is declared.
 *
 * **2.0.0, not 1.1.0.** `title` stopped being a `string` and became a declared
 * state (PDR-0005), so a record written against 1.0.0 does not parse against
 * this contract at all. That is a break, not an addition, and this literal is
 * the only discriminator a later reader has — a minor number would make it lie.
 * Nothing is migrated: no persisted 1.0.0 record exists in this repository and
 * the application is not deployed. If one is ever found, the way forward is
 * `reprocess` from its snapshot, never a synthesized grounding for its title.
 */
export const SCHEMA_VERSION = "2.0.0" as const
export type SchemaVersion = typeof SCHEMA_VERSION
