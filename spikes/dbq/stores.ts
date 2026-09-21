/**
 * CFV1-DBQ — `ADR-0003`'s repository interface implemented over both shapes.
 *
 * The acceptance criteria say the run-comparison query reads its two runs
 * "through the repository interface", so the shapes are not measured as raw SQL
 * sitting beside the product: each is a real {@link RecipeRepository}, and the
 * queries go through it exactly as the pipeline's would. What a shape cannot do
 * behind this interface, it cannot do.
 *
 * One operation is deliberately NOT here: the shopping aggregation. ADR-0003
 * named it as one of the three deciding queries, and the interface it also
 * defines has no operation for it — that gap is a DBQ finding, reported in the
 * record rather than papered over. It lives in `queries.ts` as the widening the
 * interface needs.
 */
import type { Client } from "pg"
import type { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"
import {
  type CanonicalVersion,
  type LibraryEntry,
  type RecipeRepository,
  RecipeVersionNotFoundError,
} from "../../src/persistence/repository.js"
import { validateCanonical, validateSnapshot } from "../../src/persistence/validate.js"
import { loadDocument, readDocument } from "./document-shape.js"
import { loadHybrid } from "./hybrid-shape.js"
import { loadRelational, readRelational } from "./relational-shape.js"

type Reader = (client: Client, recipeId: string, version: number) => Promise<CanonicalRecipe | undefined>

/**
 * The half both shapes share. Validate-before-write and append-only version
 * assignment are ADR-0003 commitments, not shape choices, so they are written
 * once and the shape supplies only its own read and write.
 */
function store(
  client: Client,
  schema: string,
  write: (recipe: CanonicalRecipe, version: number) => Promise<void>,
  read: Reader,
): RecipeRepository {
  const use = (): Promise<unknown> => client.query(`set search_path to ${schema}`)
  return {
    async storeSnapshot(snapshot: SourceSnapshot): Promise<void> {
      const valid = validateSnapshot(snapshot)
      await use()
      await client.query(
        "insert into snapshot (id, doc) values ($1, $2) on conflict (id) do update set doc = excluded.doc",
        [valid.id, JSON.stringify(valid)],
      )
    },
    async loadSnapshot(snapshotId: string): Promise<SourceSnapshot | undefined> {
      await use()
      const r = await client.query<{ doc: SourceSnapshot }>(
        "select doc from snapshot where id = $1",
        [snapshotId],
      )
      return r.rows[0]?.doc
    },
    async appendCanonicalVersion(recipe: CanonicalRecipe): Promise<CanonicalVersion> {
      const valid = validateCanonical(recipe)
      await use()
      const next = await client.query<{ v: number }>(
        "select coalesce(max(version), 0) + 1 as v from recipe_version where recipe_id = $1",
        [valid.id],
      )
      const version = Number(next.rows[0]?.v ?? 1)
      await write(valid, version)
      return { recipeId: valid.id, version, recipe: valid }
    },
    async listLibrary(): Promise<readonly LibraryEntry[]> {
      await use()
      return listLibrary(client, schema)
    },
    async readTwoRuns(
      recipeId: string,
      versionA: number,
      versionB: number,
    ): Promise<readonly [CanonicalVersion, CanonicalVersion]> {
      await use()
      const a = await read(client, recipeId, versionA)
      const b = await read(client, recipeId, versionB)
      if (a === undefined) throw new RecipeVersionNotFoundError(recipeId, versionA)
      if (b === undefined) throw new RecipeVersionNotFoundError(recipeId, versionB)
      return [
        { recipeId, version: versionA, recipe: a },
        { recipeId, version: versionB, recipe: b },
      ]
    },
  }
}

export function createDocumentStore(client: Client, schema = "document"): RecipeRepository {
  return store(
    client,
    schema,
    async (recipe, version) => {
      await loadDocument(client, [{ recipeId: recipe.id, version, recipe }], [])
    },
    readDocument,
  )
}

/**
 * The hybrid store reads a version exactly as the document store does — the
 * extraction serves the shopping aggregation and nothing else, so it never
 * appears on the read path for a whole recipe.
 */
export function createHybridStore(client: Client, schema = "hybrid"): RecipeRepository {
  return store(
    client,
    schema,
    async (recipe, version) => {
      await loadHybrid(client, [{ recipeId: recipe.id, version, recipe }], [])
    },
    readDocument,
  )
}

export function createRelationalStore(client: Client, schema = "relational"): RecipeRepository {
  return store(
    client,
    schema,
    async (recipe, version) => {
      await loadRelational(client, [{ recipeId: recipe.id, version, recipe }], [])
    },
    readRelational,
  )
}

/** QUERY 1 — the library list. The SQL differs; the result must not. */
export const LIBRARY_SQL: Record<string, string> = {
  // Same discipline as the shopping query: pick the version first, reach into
  // the document afterwards, so no jsonb column is carried through the sort.
  document: `
    with latest as (
      select distinct on (recipe_id) recipe_id, version
      from recipe_version
      order by recipe_id, version desc
    )
    select
      l.recipe_id       as "recipeId",
      l.version         as "latestVersion",
      v.doc ->> 'title' as title
    from latest l
    join recipe_version v on v.recipe_id = l.recipe_id and v.version = l.version
    order by l.recipe_id`,
  relational: `
    select distinct on (recipe_id)
      recipe_id as "recipeId",
      version   as "latestVersion",
      title     as title
    from recipe_version
    order by recipe_id, version desc`,
  // The hybrid extracts ingredients and nothing else, so the library list is
  // the document shape's query, word for word.
  hybrid: `
    with latest as (
      select distinct on (recipe_id) recipe_id, version
      from recipe_version
      order by recipe_id, version desc
    )
    select
      l.recipe_id       as "recipeId",
      l.version         as "latestVersion",
      v.doc ->> 'title' as title
    from latest l
    join recipe_version v on v.recipe_id = l.recipe_id and v.version = l.version
    order by l.recipe_id`,
}

export async function listLibrary(client: Client, schema: string): Promise<readonly LibraryEntry[]> {
  const sql = LIBRARY_SQL[schema]
  if (sql === undefined) throw new Error(`no library query for shape ${schema}`)
  const r = await client.query<LibraryEntry>(sql)
  return r.rows
}
