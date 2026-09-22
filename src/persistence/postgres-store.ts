/**
 * The durable persistence store (CFV1-PG, ADR-0015).
 *
 * ADR-0015 closed OQ-03/OQ-04 on measured evidence over the real corpus:
 * PostgreSQL, validated JSONB documents as the record of truth, plus an
 * extracted projection where a query was measured to need one. This is that
 * store, implementing the same {@link RecipeRepository} the provisional one
 * does — which is why no caller changes: no caller ever named a store.
 *
 * The physical schema is NOT here. It lives in `migrations/0001-the-recipe-
 * store.sql`, which the operator applies; this module only reads and writes the
 * tables that file declares. A program that migrates its own database at
 * startup is a different decision and would need its own record.
 *
 * ADR-0003 confinement, which ADR-0018 left intact: `pg` is imported here and
 * nowhere else in `src/`, the class is not exported, and nothing this module
 * hands back carries a PostgreSQL type. The barrel re-exports the factory and
 * the interface, so a caller can name no storage type.
 */
import { Pool } from "pg"
import type { CanonicalRecipe, CookingPlan, SourceSnapshot } from "../../schema/index.js"
import {
  type CanonicalVersion,
  type CapabilityGrantRecord,
  type LibraryEntry,
  type RecipeRepository,
  RecipeVersionNotFoundError,
  UnversionedCookingPlanError,
} from "./repository.js"
import { validateCanonical, validateCookingPlan, validateSnapshot } from "./validate.js"

/**
 * The ONE extraction, as one statement derived from the document just written
 * (ADR-0015 commitment 2, and the spike's shape unchanged).
 *
 * It is written in SQL rather than in TypeScript on purpose: the projection is
 * defined by exactly one expression, and {@link PostgresStoreHandle.rebuildProjection}
 * runs that same expression over every document. The write path and the rebuild
 * path cannot drift, because there is only one of them.
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

/**
 * Raised when the store is pointed at a database the migration has not been
 * applied to.
 *
 * Postgres answers a query against a missing table with `42P01`, which reaches a
 * caller as a driver error naming a relation. That is a true message and an
 * unhelpful one: the fault is not in the query, it is that nobody ran the
 * migrations. Saying so is the difference between an operator fixing it in a
 * minute and reading the driver's source.
 *
 * It names the DIRECTORY and not one file, because `migrations/` holds more
 * than one and a missing `cooking_plan` is not fixed by applying the recipe
 * store's migration. The first file stays in the sentence as the place to
 * start, since the order matters and nothing else states it.
 */
const APPLY_THE_MIGRATIONS =
  "apply the migrations in migrations/ in order, beginning with " +
  "migrations/0001-the-recipe-store.sql, before starting the instance"

export class StoreNotMigratedError extends Error {
  constructor(readonly relation: string | undefined) {
    super(
      relation === undefined
        ? `a table this store needs does not exist: ${APPLY_THE_MIGRATIONS}`
        : `the database has no \`${relation}\` table: ${APPLY_THE_MIGRATIONS}`,
    )
    this.name = "StoreNotMigratedError"
  }
}

/**
 * Which relation was missing, taken from the driver's own report.
 *
 * `pg` fills `error.table` from the server's `TABLE` error field, and PostgreSQL
 * sends that field for integrity violations — never for `42P01`. So the field is
 * absent EVERY time here, and naming a fixed table as a fallback named one
 * particular table for every missing one. That was harmless while `migrations/`
 * held a single file: any missing table meant that file had not been applied.
 * With a second migration it is worse than no name at all — it sends an operator
 * whose `cooking_plan` is missing to re-run the recipe store's migration, which
 * they already ran and which will refuse to run twice.
 *
 * The message carries the name (`relation "cooking_plan" does not exist`), so it
 * is read from there, and when it cannot be read the refusal says a table is
 * missing rather than guessing which.
 */
function missingRelation(error: object): string | undefined {
  const table = (error as { table?: unknown }).table
  if (typeof table === "string" && table !== "") return table
  const message = (error as { message?: unknown }).message
  const found =
    typeof message === "string" ? /relation "([^"]+)" does not exist/.exec(message) : null
  return found?.[1]
}

/** Postgres's `undefined_table`. */
const UNDEFINED_TABLE = "42P01"

/** Postgres's `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = "23503"

/** Turn a missing-relation error into {@link StoreNotMigratedError}; re-throw anything else. */
function translate(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown }
    if (code === UNDEFINED_TABLE) {
      throw new StoreNotMigratedError(missingRelation(error))
    }
  }
  throw error
}

/**
 * Turn the Cooking Plan table's foreign-key refusal into the interface's own
 * error (ADR-0025).
 *
 * The check is the foreign key rather than a read before the write: a `select`
 * first would be a second statement with a gap between the two, and the version
 * it found could be gone by the time the insert ran. The database refuses it in
 * the statement that would have written it, and this turns that refusal into
 * the error the contract names.
 */
function translatePlanWrite(error: unknown, recipeId: string, version: number): never {
  if (typeof error === "object" && error !== null && "code" in error) {
    if ((error as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) {
      throw new RecipeVersionNotFoundError(recipeId, version)
    }
  }
  return translate(error)
}

class PostgresStore implements RecipeRepository {
  readonly #pool: Pool

  constructor(pool: Pool) {
    this.#pool = pool
  }

  async storeSnapshot(snapshot: SourceSnapshot): Promise<void> {
    // Validate before the database is touched: invalid input never persists.
    const valid = validateSnapshot(snapshot)
    await this.#pool
      .query(
        "insert into snapshot (id, doc) values ($1, $2) on conflict (id) do update set doc = excluded.doc",
        [valid.id, JSON.stringify(valid)],
      )
      .catch(translate)
  }

  async loadSnapshot(snapshotId: string): Promise<SourceSnapshot | undefined> {
    const result = await this.#pool
      .query<{ doc: unknown }>("select doc from snapshot where id = $1", [snapshotId])
      .catch(translate)
    const row = result.rows[0]
    // Parsed on the way out as well as on the way in. A document that no longer
    // satisfies the contract is a thing a reader must be told about, not
    // something to hand on as if it were valid — and a row written by an older
    // contract version is exactly how that happens.
    return row === undefined ? undefined : validateSnapshot(row.doc)
  }

  async appendCanonicalVersion(recipe: CanonicalRecipe): Promise<CanonicalVersion> {
    const valid = validateCanonical(recipe)
    const client = await this.#pool.connect()
    try {
      // The document and its extraction are one transaction (ADR-0015
      // commitment 2), so a version and its projection can never disagree: both
      // land or neither does.
      await client.query("begin")
      const inserted = await client.query<{ version: number }>(
        `insert into recipe_version (recipe_id, version, doc)
         values ($1, coalesce((select max(version) from recipe_version where recipe_id = $1), 0) + 1, $2)
         returning version`,
        [valid.id, JSON.stringify(valid)],
      )
      const version = inserted.rows[0]?.version
      if (version === undefined) throw new Error("append returned no version")
      await client.query(EXTRACT_SQL, [valid.id, version])
      await client.query("commit")
      return { recipeId: valid.id, version, recipe: valid }
    } catch (error) {
      await client.query("rollback").catch(() => {})
      return translate(error)
    } finally {
      client.release()
    }
  }

  async loadLatestCanonical(recipeId: string): Promise<CanonicalVersion | undefined> {
    // Answered by the store, not by reading every version and picking the last
    // (CFV1-PG constraint, ADR-0018): one indexed row comes back.
    const result = await this.#pool
      .query<{ version: number; doc: unknown }>(
        "select version, doc from recipe_version where recipe_id = $1 order by version desc limit 1",
        [recipeId],
      )
      .catch(translate)
    const row = result.rows[0]
    // Not-found is a return value, not a throw (ADR-0018): the capability-URL
    // route must tell a revoked token from a missing recipe without catching.
    if (row === undefined) return undefined
    return { recipeId, version: row.version, recipe: validateCanonical(row.doc) }
  }

  async listLibrary(): Promise<readonly LibraryEntry[]> {
    const result = await this.#pool
      .query<{ recipe_id: string; latest_version: number; title: string | null }>(
        `select v.recipe_id,
                v.version                        as latest_version,
                v.doc -> 'title' ->> 'sourceText' as title
         from recipe_version v
         join (select recipe_id, max(version) as version from recipe_version group by recipe_id) latest
           on latest.recipe_id = v.recipe_id and latest.version = v.version
         order by v.recipe_id`,
      )
      .catch(translate)
    return result.rows.map((row) => ({
      recipeId: row.recipe_id,
      latestVersion: row.latest_version,
      // A declared gap stays a gap in the listing: no key at all rather than a
      // borrowed string or a SQL null crossing as one (PDR-0005). `->>` yields
      // NULL both for `{"state":"not_in_source"}` and for a title that somehow
      // carries no wording, and both mean the same thing to a reader.
      ...(row.title === null ? {} : { title: row.title }),
    }))
  }

  async storeCookingPlan(plan: CookingPlan): Promise<void> {
    // Validate before the database is touched, like every other write here.
    const valid = validateCookingPlan(plan)
    // The version is read from the plan, never passed beside it (ADR-0025):
    // two places to state it are two places to disagree.
    const version = valid.derivation.canonicalVersion
    if (version === undefined) throw new UnversionedCookingPlanError(valid.recipeId)
    // Last write per (recipe, version) wins, which is an upsert on the key. The
    // derivation is deterministic (ADR-0023), so a second write of one version
    // carries the same document and an append would only accumulate copies.
    await this.#pool
      .query(
        `insert into cooking_plan (recipe_id, version, doc) values ($1, $2, $3)
         on conflict (recipe_id, version) do update set doc = excluded.doc`,
        [valid.recipeId, version, JSON.stringify(valid)],
      )
      .catch((error) => translatePlanWrite(error, valid.recipeId, version))
  }

  async loadCookingPlan(recipeId: string, version: number): Promise<CookingPlan | undefined> {
    const result = await this.#pool
      .query<{ doc: unknown }>(
        "select doc from cooking_plan where recipe_id = $1 and version = $2",
        [recipeId, version],
      )
      .catch(translate)
    const row = result.rows[0]
    // Absence is a return value and the ordinary state of every recipe nobody
    // has cooked yet (`PDR-0004` ships `lazy`), so the caller derives rather
    // than catches. Parsed on the way out, like every other read here.
    return row === undefined ? undefined : validateCookingPlan(row.doc)
  }

  async storeCapabilityGrant(grant: CapabilityGrantRecord): Promise<boolean> {
    // `on conflict do nothing`, and the row count says which happened: one
    // statement, so no gap between a check and a write in which a second grant
    // for the same digest could land (ADR-0032). A held digest — active or
    // revoked — is never overwritten; the caller mints another token.
    const result = await this.#pool
      .query(
        `insert into capability_grant (token_digest, recipe_id) values ($1, $2)
         on conflict (token_digest) do nothing`,
        [grant.tokenDigest, grant.recipeId],
      )
      .catch(translate)
    return result.rowCount === 1
  }

  async resolveCapabilityGrant(tokenDigest: string): Promise<string | undefined> {
    // Unknown and revoked are one answer, filtered in the query rather than
    // after it, so a revoked grant's recipe id never reaches this process.
    const result = await this.#pool
      .query<{ recipe_id: string }>(
        "select recipe_id from capability_grant where token_digest = $1 and not revoked",
        [tokenDigest],
      )
      .catch(translate)
    return result.rows[0]?.recipe_id
  }

  async revokeCapabilityGrant(tokenDigest: string): Promise<boolean> {
    // An update, never a delete: the kept row is what makes this digest
    // un-mintable for good (ADR-0016 point 5). `and not revoked` makes a second
    // revocation touch nothing, which is how it reports `false`.
    const result = await this.#pool
      .query("update capability_grant set revoked = true where token_digest = $1 and not revoked", [
        tokenDigest,
      ])
      .catch(translate)
    return result.rowCount === 1
  }

  async readTwoRuns(
    recipeId: string,
    versionA: number,
    versionB: number,
  ): Promise<readonly [CanonicalVersion, CanonicalVersion]> {
    const result = await this.#pool
      .query<{ version: number; doc: unknown }>(
        "select version, doc from recipe_version where recipe_id = $1 and version = any($2::int[])",
        [recipeId, [versionA, versionB]],
      )
      .catch(translate)
    if (result.rows.length === 0) {
      // Nothing at all under this id: the caller named a recipe, not a version.
      const any = await this.#pool
        .query("select 1 from recipe_version where recipe_id = $1 limit 1", [recipeId])
        .catch(translate)
      if (any.rows.length === 0) throw new RecipeVersionNotFoundError(recipeId)
    }
    const byVersion = new Map(result.rows.map((row) => [row.version, row.doc] as const))
    const read = (version: number): CanonicalVersion => {
      const doc = byVersion.get(version)
      if (doc === undefined) throw new RecipeVersionNotFoundError(recipeId, version)
      return { recipeId, version, recipe: validateCanonical(doc) }
    }
    // One statement for both versions — the operation ADR-0015 measured as the
    // document shape's widest win (7.90 ms against the relational shape's 62.55).
    return [read(versionA), read(versionB)]
  }
}

/**
 * A constructed store together with the two things a durable store owns that an
 * in-memory one does not.
 *
 * {@link RecipeRepository} stays at the eleven operations ADR-0003, ADR-0018,
 * ADR-0025 and ADR-0032 fixed: a connection pool's lifetime and a derived
 * table's rebuild are not persistence operations, and putting them on the
 * interface would have made every caller carry them. Neither member names a PostgreSQL type, so the
 * confinement holds.
 */
export interface PostgresStoreHandle {
  /** The store, as the interface — the only thing a caller should pass on. */
  readonly repository: RecipeRepository
  /** Release the connection pool. After this the repository answers nothing. */
  close(): Promise<void>
  /**
   * Throw the extraction away and rebuild it from the documents alone.
   *
   * This is ADR-0015 commitment 2 made runnable rather than promised: if a
   * rebuild changes a single row, the projection was carrying something the
   * documents do not, and it was a second source of truth rather than a cache.
   */
  rebuildProjection(): Promise<void>
}

/**
 * Build the durable store against `databaseUrl`.
 *
 * The URL is the whole of the store's knowledge of the world — resolve it with
 * {@link resolveDatabaseUrl}, which refuses an absent one rather than defaulting
 * to a database nobody chose. Connecting is lazy, as `pg` pools are: the first
 * operation is what reaches the server, so constructing a store cannot fail for
 * a reason the caller has no operation to attribute it to.
 */
export function createPostgresStore(databaseUrl: string): PostgresStoreHandle {
  const pool = new Pool({ connectionString: databaseUrl })
  return {
    repository: new PostgresStore(pool),
    close: async () => {
      await pool.end()
    },
    rebuildProjection: async () => {
      const client = await pool.connect()
      try {
        await client.query("begin")
        await client.query("delete from ingredient")
        await client.query(EXTRACT_SQL, [null, null])
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        return translate(error)
      } finally {
        client.release()
      }
    },
  }
}
