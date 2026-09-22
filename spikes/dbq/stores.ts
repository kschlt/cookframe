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
 *
 * Two more arrived after this spike ran: `storeCookingPlan` and
 * `loadCookingPlan` (ADR-0025). They are declared here as refusals rather than
 * implemented, because implementing them would mean adding a table and a query
 * to a FINISHED measurement — the numbers this spike reports would then describe
 * a shape nobody measured. Nothing in this spike calls them; when the persistent
 * store is built, it implements them for real and the contract suite is what
 * holds it to that.
 */
import type { Client } from "pg"
import { assertShape } from "./db.js"
import type { CanonicalRecipe, CookingPlan, SourceSnapshot } from "../../schema/index.js"
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
  const known = assertShape(schema)
  const use = (): Promise<unknown> => client.query(`set search_path to ${known}`)
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
    async loadLatestCanonical(recipeId: string): Promise<CanonicalVersion | undefined> {
      // (6, ADR-0018). Not-found is a return value, not a throw — the interface
      // is explicit that this follows `loadSnapshot` rather than `readTwoRuns`,
      // because the shopping slice's capability-URL route has to tell a revoked
      // token from a missing recipe without catching an exception.
      await use()
      const latest = await client.query<{ v: number | null }>(
        "select max(version) as v from recipe_version where recipe_id = $1",
        [recipeId],
      )
      const version = latest.rows[0]?.v
      if (version === null || version === undefined) return undefined
      const recipe = await read(client, recipeId, Number(version))
      if (recipe === undefined) return undefined
      return { recipeId, version: Number(version), recipe }
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
    async storeCookingPlan(_plan: CookingPlan): Promise<void> {
      throw new Error(NOT_MEASURED_HERE)
    },
    async loadCookingPlan(_recipeId: string, _version: number): Promise<CookingPlan | undefined> {
      throw new Error(NOT_MEASURED_HERE)
    },
  }
}

/** Why the two Cooking Plan operations refuse here; see this file's header. */
const NOT_MEASURED_HERE =
  "the Cooking Plan operations (ADR-0025) arrived after CFV1-DBQ measured these shapes, and are not implemented in the spike"

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
      v.doc -> 'title' ->> 'sourceText' as title
    from latest l
    join recipe_version v on v.recipe_id = l.recipe_id and v.version = l.version
    order by l.recipe_id`,
  relational: `
    select distinct on (recipe_id)
      recipe_id as "recipeId",
      version   as "latestVersion",
      title_source_text as title
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
      v.doc -> 'title' ->> 'sourceText' as title
    from latest l
    join recipe_version v on v.recipe_id = l.recipe_id and v.version = l.version
    order by l.recipe_id`,
}

export async function listLibrary(client: Client, schema: string): Promise<readonly LibraryEntry[]> {
  const known = assertShape(schema)
  const sql = LIBRARY_SQL[known]
  if (sql === undefined) throw new Error(`no library query for shape ${known}`)
  // Apply the schema rather than only selecting SQL by it. Without this the
  // query read whatever the session's `search_path` happened to point at, so
  // the parameter promised a scoping it did not perform — every caller set the
  // path first, which is why nothing failed, and a caller that trusted the
  // name would have got another shape's rows. `shoppingRequirements` already
  // did this; the two now behave the same way.
  await client.query(`set search_path to ${known}`)
  const r = await client.query<LibraryEntry & { title: string | null }>(sql)
  // A recipe whose source had no title has no title, and `LibraryEntry` says
  // so by leaving the key out — the in-memory store already does. SQL can only
  // hand back a null, so the key is dropped here rather than letting one
  // implementation of the interface return `{ title: null }` and another `{}`.
  return r.rows.map(({ title, ...rest }) => (title === null ? rest : { ...rest, title }))
}
