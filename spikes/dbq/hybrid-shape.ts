/**
 * CFV1-DBQ — writing the hybrid shape: the document, plus the one extraction.
 *
 * The document write is the document shape's, unchanged. What this adds is the
 * ingredient projection, written in the same transaction, so a version and its
 * extraction can never disagree — and {@link rebuildExtraction} proves the
 * extraction is derivable from the documents alone, which is what makes it a
 * cache rather than a second source of truth.
 */
import type { Client } from "pg"
import type { SourceSnapshot } from "../../schema/index.js"
import type { CanonicalVersion } from "../../src/persistence/repository.js"
import type { LoadCost } from "./document-shape.js"

/**
 * The extraction, as ONE statement per version derived from the document that
 * was just written. Doing it in SQL rather than in TypeScript is the point: the
 * projection is defined once, by the same expression that rebuilds it, so the
 * write path and the rebuild path cannot drift.
 */
const EXTRACT_SQL = `
  insert into ingredient (
    recipe_id, version, group_ordinal, ordinal,
    name, unit, val_kind, val_value, val_source_text, source_text
  )
  select
    v.recipe_id,
    v.version,
    (g.ord - 1)::int,
    (i.ord - 1)::int,
    i.value ->> 'name',
    i.value ->> 'unit',
    i.value -> 'quantityExpression' ->> 'kind',
    (i.value -> 'quantityExpression' ->> 'value')::double precision,
    i.value -> 'quantityExpression' ->> 'sourceText',
    i.value ->> 'sourceText'
  from recipe_version v
  cross join lateral jsonb_array_elements(v.doc -> 'ingredientGroups') with ordinality g(value, ord)
  cross join lateral jsonb_array_elements(g.value -> 'ingredients') with ordinality i(value, ord)
  where ($1::text is null or (v.recipe_id = $1 and v.version = $2::int))`

export async function loadHybrid(
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
    await client.query("insert into recipe_version (recipe_id, version, doc) values ($1, $2, $3)", [
      v.recipeId,
      v.version,
      JSON.stringify(v.recipe),
    ])
    await client.query(EXTRACT_SQL, [v.recipeId, v.version])
    inserts += 2
  }
  return { inserts, ms: Date.now() - started }
}

/**
 * Throw the extraction away and rebuild it from the documents. If this changes
 * any row, the extraction was carrying something the documents do not — which
 * would make it a second source of truth, and the hybrid shape a lie.
 */
export async function rebuildExtraction(client: Client): Promise<void> {
  await client.query("delete from ingredient")
  await client.query(EXTRACT_SQL, [null, null])
}
