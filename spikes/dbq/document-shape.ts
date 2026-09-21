/**
 * CFV1-DBQ — writing and reading the document shape.
 *
 * There is almost nothing here, which is the finding: one INSERT per version,
 * and a read that hands the document straight back. Whatever the document shape
 * costs, it does not cost this.
 */
import type { Client } from "pg"
import type { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"
import type { CanonicalVersion } from "../../src/persistence/repository.js"

/** What a load cost, in the units DBQ compares shapes in. */
export interface LoadCost {
  /** INSERT statements issued. Write amplification, measured rather than argued. */
  readonly inserts: number
  readonly ms: number
}

export async function loadDocument(
  client: Client,
  versions: readonly CanonicalVersion[],
  snapshots: readonly SourceSnapshot[],
): Promise<LoadCost> {
  const started = Date.now()
  let inserts = 0
  for (const s of snapshots) {
    await client.query("insert into snapshot (id, doc) values ($1, $2)", [s.id, JSON.stringify(s)])
    inserts += 1
  }
  for (const v of versions) {
    await client.query(
      "insert into recipe_version (recipe_id, version, doc) values ($1, $2, $3)",
      [v.recipeId, v.version, JSON.stringify(v.recipe)],
    )
    inserts += 1
  }
  return { inserts, ms: Date.now() - started }
}

/** Read one version back out. The document shape's whole read path. */
export async function readDocument(
  client: Client,
  recipeId: string,
  version: number,
): Promise<CanonicalRecipe | undefined> {
  const r = await client.query<{ doc: CanonicalRecipe }>(
    "select doc from recipe_version where recipe_id = $1 and version = $2",
    [recipeId, version],
  )
  return r.rows[0]?.doc
}
