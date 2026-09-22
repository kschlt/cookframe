/**
 * CFV1-PG — what the durable store must do that the interface contract cannot
 * ask for (ADR-0015).
 *
 * `repository-contract.test.ts` runs both stores through one definition, which
 * proves they are interchangeable. These are the proofs that are ABOUT being a
 * database: surviving a process, being built by the migration an operator
 * applies, refusing an absent configuration, and keeping the one extracted
 * projection derived rather than authoritative. The in-memory store passes none
 * of them, and that is the point — if it did, they would not be measuring
 * durability.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SourceSnapshot } from "../../schema/index.js"
import {
  type CanonicalVersion,
  createPostgresStore,
  DatabaseConfigurationError,
  type PostgresStoreHandle,
  resolveDatabaseUrl,
  StoreNotMigratedError,
} from "../../src/persistence/index.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import {
  applyMigration,
  decideDatabaseAvailability,
  isReachable,
  MIGRATION_SQL,
  MIGRATIONS,
  type ProvisionedSchema,
  provisionSchema,
  urlForSchema,
} from "./postgres-harness.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

const configured = process.env["DATABASE_URL"]
const availability = decideDatabaseAvailability(
  configured,
  configured === undefined || configured.trim() === "" ? false : await isReachable(configured),
)
if (availability.mode === "fail") throw new Error(availability.reason)
const baseUrl = availability.mode === "run" ? availability.url : undefined

/**
 * These proofs need a database; `describe.skipIf` is honest about that and
 * `decideDatabaseAvailability` has already turned the dangerous case — a
 * database asked for and not reachable — into a thrown error above, so what is
 * skipped here is only the case where none was asked for.
 */
const withDatabase = describe.skipIf(baseUrl === undefined)

const snapshot = SourceSnapshot.parse(
  JSON.parse(
    readFileSync(join(repoRoot, "evals/fixtures/public/source-snapshot/basic.json"), "utf8"),
  ),
)
const provider = createFakeNormalizationProvider()
const canonical = (runId: string) =>
  provider.normalize(snapshot, { runId, targetOntologyVersion: "1.0.0" })

/** Schemas and pools opened by these proofs, all released at the end. */
const opened: PostgresStoreHandle[] = []
const provisioned: ProvisionedSchema[] = []

async function freshStore(): Promise<{ handle: PostgresStoreHandle; schema: ProvisionedSchema }> {
  if (baseUrl === undefined) throw new Error("no database")
  const schema = await provisionSchema(baseUrl)
  provisioned.push(schema)
  const handle = createPostgresStore(schema.url)
  opened.push(handle)
  return { handle, schema }
}

/** A direct connection into one provisioned schema, for looking at the tables themselves. */
async function inspect<T>(
  schema: ProvisionedSchema,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: schema.url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

/** Every projection row, in a stable order, read through the table rather than the store. */
async function readProjection(schema: ProvisionedSchema): Promise<readonly unknown[]> {
  return inspect(schema, async (client) => {
    const result = await client.query(
      "select * from ingredient order by recipe_id, version, group_ordinal, ordinal",
    )
    return result.rows
  })
}

afterAll(async () => {
  for (const handle of opened) await handle.close()
  for (const schema of provisioned) await schema.drop()
})

describe("persistence/absent-configuration-refuses", () => {
  it("refuses an unset DATABASE_URL instead of defaulting to a database nobody chose", () => {
    // The DBQ spike falls back to a local default when the variable is missing.
    // An instance must not: a fallback means a misconfigured deployment comes
    // up, appears to work, and writes a library somewhere nobody meant.
    expect(() => resolveDatabaseUrl({})).toThrow(DatabaseConfigurationError)
    try {
      resolveDatabaseUrl({})
      throw new Error("precondition: it should have thrown")
    } catch (error) {
      expect((error as DatabaseConfigurationError).problem).toBe("not_configured")
    }
  })

  it("refuses an empty or whitespace value, which is how an unset variable usually arrives", () => {
    for (const value of ["", "   ", "\t\n"]) {
      try {
        resolveDatabaseUrl({ DATABASE_URL: value })
        throw new Error(`precondition: ${JSON.stringify(value)} should have been refused`)
      } catch (error) {
        expect((error as DatabaseConfigurationError).problem).toBe("not_configured")
      }
    }
  })

  it("names which of the three things was wrong, rather than failing the same way for all of them", () => {
    const problemOf = (env: Record<string, string>): string => {
      try {
        resolveDatabaseUrl(env)
        return "accepted"
      } catch (error) {
        return (error as DatabaseConfigurationError).problem
      }
    }
    expect(problemOf({ DATABASE_URL: "not a url at all" })).toBe("unparseable")
    expect(problemOf({ DATABASE_URL: "mysql://localhost/cookframe" })).toBe("not_a_postgres_url")
    expect(problemOf({ DATABASE_URL: "https://example.invalid/db" })).toBe("not_a_postgres_url")
    expect(problemOf({ DATABASE_URL: "postgres://u:p@h:5432/db" })).toBe("accepted")
    expect(problemOf({ DATABASE_URL: "postgresql://u:p@h:5432/db" })).toBe("accepted")
  })

  it("never puts the value in the refusal, because a connection string carries a password", () => {
    // A refusal is exactly the moment a process writes to a log.
    const secret = "postgres://admin:hunter2@db.internal:5432/cookframe"
    try {
      resolveDatabaseUrl({ DATABASE_URL: secret.replace("postgres:", "mysql:") })
      throw new Error("precondition: it should have thrown")
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2")
      expect((error as Error).message).not.toContain("db.internal")
    }
  })
})

describe("persistence/no-storage-type-escapes-the-seam", () => {
  const barrel = readFileSync(join(repoRoot, "src", "persistence", "index.ts"), "utf8")

  it("the barrel exports no PostgreSQL type and no concrete store class", () => {
    expect(barrel).not.toMatch(/from "pg"/)
    expect(barrel).not.toMatch(/\bPool\b/)
    expect(barrel).not.toMatch(/\bClient\b/)
    // Factories and the interface only — never the classes behind them.
    expect(barrel).not.toMatch(/export \{ PostgresStore\b/)
    expect(barrel).not.toMatch(/export \{ ProvisionalStore\b/)
    expect(barrel).toMatch(/createPostgresStore/)
  })

  it("`pg` is imported in exactly one module under src/", () => {
    // ADR-0003 confinement is a property of the tree, not of one file: a second
    // module reaching for `pg` is how a storage type starts appearing in
    // signatures elsewhere.
    const importers: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith(".ts")) {
          if (/from "pg"/.test(readFileSync(full, "utf8"))) importers.push(full)
        }
      }
    }
    walk(join(repoRoot, "src"))
    expect(importers.map((p) => p.replace(`${repoRoot}/`, ""))).toEqual([
      "src/persistence/postgres-store.ts",
    ])
  })

  it("the store handle hands back the interface, not a store with a database on it", () => {
    const handle = createPostgresStore("postgres://u:p@127.0.0.1:1/never-connected")
    // Constructing does not connect (pg pools are lazy), so this reaches no
    // server — it is a shape check, and the pool is ended below.
    const repository = handle.repository as unknown as Record<string, unknown>
    for (const leaked of ["pool", "client", "query", "connect", "end"]) {
      expect(repository[leaked], leaked).toBeUndefined()
    }
    void handle.close()
  })
})

withDatabase("persistence/the-migration-builds-the-store", () => {
  let schema: ProvisionedSchema

  beforeAll(async () => {
    const built = await freshStore()
    schema = built.schema
  })

  it("is the only declaration of the store's shape, and every proof here runs on what it built", async () => {
    // `provisionSchema` applies this file and nothing else, so the tables these
    // suites exercise are the tables an operator gets. DDL written a second time
    // inside the tests would make every proof below a proof about nothing
    // deployed.
    expect(MIGRATION_SQL).toMatch(/create table recipe_version/)
    expect(MIGRATION_SQL).toMatch(/create table cooking_plan/)
    const tables = await inspect(schema, async (client) => {
      const result = await client.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = $1 order by table_name",
        [schema.schema],
      )
      return result.rows.map((r) => r.table_name)
    })
    expect(tables).toEqual(["cooking_plan", "ingredient", "recipe_version", "snapshot"])
  })

  it("builds a store the repository can immediately write to and read back", async () => {
    const { handle } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    const loaded = await handle.repository.loadLatestCanonical(appended.recipeId)
    expect(loaded?.recipe.id).toBe(appended.recipeId)
  })

  it("indexes the title's own wording, not the title node", async () => {
    // Since PDR-0005 the title is a declared state, so `doc ->> 'title'` yields
    // the whole object as text — an expression the library query does not ask
    // for, which would leave the listing unindexed while the index looked
    // present. (The DBQ spike's hybrid DDL still carries the old expression; it
    // is frozen evidence for a decision already taken, and is not edited here.)
    const definition = await inspect(schema, async (client) => {
      const result = await client.query<{ indexdef: string }>(
        "select indexdef from pg_indexes where schemaname = $1 and indexname = 'recipe_version_title'",
        [schema.schema],
      )
      return result.rows[0]?.indexdef ?? ""
    })
    expect(definition).toContain("'title'")
    expect(definition).toContain("sourceText")
  })

  it("refuses a second application rather than passing silently over a database that holds recipes", async () => {
    // Deliberately not `create table if not exists`: re-running a migration is
    // the one case where a human should be stopped and made to look.
    await expect(inspect(schema, (client) => applyMigration(client))).rejects.toThrow(
      /already exists/,
    )
  })

  it("is a file an operator can apply with psql, with no runner and no version table", async () => {
    // Every file, not just the first: a migration an operator is never told to
    // run is a table their database will not have.
    expect(MIGRATIONS.map((m) => m.path.replace(/^.*\/migrations\//, ""))).toEqual([
      "0001-the-recipe-store.sql",
      "0002-the-cooking-plan.sql",
    ])
    for (const migration of MIGRATIONS) {
      const name = migration.path.replace(/^.*\/migrations\//, "")
      expect(migration.sql, name).toMatch(
        new RegExp(`psql "\\$DATABASE_URL" -f migrations/${name.replace(/\./g, "\\.")}`),
      )
    }
    // A program that migrates its own database at startup is a different
    // decision and would need its own record, so nothing in `src/` may apply
    // it: the store declares no DDL and never reads the file. It may NAME it —
    // `StoreNotMigratedError` tells an operator which file to run, which is the
    // whole reason that error exists.
    const storeSrc = readFileSync(join(repoRoot, "src", "persistence", "postgres-store.ts"), "utf8")
    expect(storeSrc).not.toMatch(/create table/i)
    expect(storeSrc).not.toMatch(/readFileSync/)
    expect(storeSrc).toMatch(/0001-the-recipe-store\.sql/)
  })
})

withDatabase("persistence/a-restart-keeps-the-library", () => {
  it("a recipe written by another process is readable here, sharing nothing but the database", async () => {
    const { handle, schema } = await freshStore()
    // Nothing is in this schema yet, so whatever is read back came from the
    // child and could not have come from this process's memory.
    expect(await handle.repository.listLibrary()).toHaveLength(0)

    const output = execFileSync(
      join(repoRoot, "node_modules", ".bin", "tsx"),
      [join(here, "append-in-another-process.ts"), schema.url, "run-from-another-process"],
      { cwd: repoRoot, encoding: "utf8" },
    )
    const written = JSON.parse(output.trim()) as { recipeId: string; version: number }
    expect(written.version).toBe(1)

    const loaded = await handle.repository.loadLatestCanonical(written.recipeId)
    expect(loaded?.recipe.provenance.runId).toBe("run-from-another-process")
    expect(await handle.repository.listLibrary()).toHaveLength(1)
    // The snapshot survived the other process too, so the whole import did, not
    // just the row the assertion above happens to look at.
    expect((await handle.repository.loadSnapshot(snapshot.id))?.id).toBe(snapshot.id)
  })

  it("a second store object over the same database sees what the first wrote, and the in-memory store cannot", async () => {
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    await handle.close()
    opened.splice(opened.indexOf(handle), 1)

    // A brand-new pool, built from the URL alone — the store holds nothing else
    // about the world, so this is what an instance restarting does.
    const restarted = createPostgresStore(schema.url)
    opened.push(restarted)
    const loaded = await restarted.repository.loadLatestCanonical(appended.recipeId)
    expect(loaded?.version).toBe(1)
    expect(loaded?.recipe.provenance.runId).toBe("run-1")
  })
})

withDatabase("persistence/versions-are-appended-never-overwritten", () => {
  it("keeps every earlier version readable at its own ordinal, against the real store", async () => {
    const { handle } = await freshStore()
    const repo = handle.repository
    const v1 = await repo.appendCanonicalVersion(await canonical("run-1"))
    const v2 = await repo.appendCanonicalVersion(await canonical("run-2"))
    const v3 = await repo.appendCanonicalVersion(await canonical("run-3"))
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3])
    expect(new Set([v1.recipeId, v2.recipeId, v3.recipeId]).size).toBe(1)

    // Each ordinal still answers with the run that was written under it — the
    // third append did not move, rewrite or renumber the first two.
    const [first, second] = await repo.readTwoRuns(v1.recipeId, 1, 2)
    expect(first.recipe.provenance.runId).toBe("run-1")
    expect(second.recipe.provenance.runId).toBe("run-2")
    const [again, third] = await repo.readTwoRuns(v1.recipeId, 1, 3)
    expect(again.recipe.provenance.runId).toBe("run-1")
    expect(third.recipe.provenance.runId).toBe("run-3")
    // One row per recipe id, carrying the NEWEST version's ordinal — three
    // appends are three versions of one recipe, not three library entries.
    const listed = await repo.listLibrary()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.recipeId).toBe(v1.recipeId)
    expect(listed[0]?.latestVersion).toBe(3)
  })

  it("the primary key makes an overwrite unwritable, not merely unwritten", async () => {
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    // Going around the repository to the table itself: even a writer that
    // computed the same ordinal cannot replace a stored version in place.
    await expect(
      inspect(schema, (client) =>
        client.query("insert into recipe_version (recipe_id, version, doc) values ($1, 1, $2)", [
          appended.recipeId,
          JSON.stringify({ tampered: true }),
        ]),
      ),
    ).rejects.toThrow(/duplicate key/)
    const loaded = await handle.repository.loadLatestCanonical(appended.recipeId)
    expect(loaded?.recipe.provenance.runId).toBe("run-1")
  })

  it("two appends that race cannot quietly become one — the loser errors, it does not overwrite", async () => {
    // The ordinal is computed as `max(version) + 1`, so two writers that read
    // the same maximum compute the same ordinal. What happens then is the whole
    // append-only claim: the primary key turns the second into an error a
    // caller sees. An `on conflict do update` here would make both calls report
    // version 1 while the first recipe silently vanished, and every
    // single-threaded proof above would stay green through it.
    const { handle } = await freshStore()
    const repo = handle.repository
    // Both documents are built BEFORE either append starts. Awaiting inside the
    // array would have suspended between the two calls and let the first append
    // finish, which is a sequential test wearing a concurrent test's shape —
    // and it read as green against a store that overwrites.
    //
    // The recipes carry NO ingredients, and that is the whole point of the
    // case. With ingredients, an overwriting store is caught by accident: the
    // projection's own primary key rejects the second writer's extraction, so
    // the append fails for a reason that has nothing to do with the append-only
    // rule. Measured, on a store mutated to `on conflict do update`: the loser
    // came back with `duplicate key ... "ingredient_pkey"`. Take the
    // ingredients away — a card with no ingredient list is an ordinary source,
    // not a contrivance — and the accident goes with them, leaving only
    // `recipe_version`'s primary key between two writers and a lost version.
    const withoutIngredients = async (runId: string) => ({
      ...(await canonical(runId)),
      ingredientGroups: [],
    })
    const [a, b] = [await withoutIngredients("run-a"), await withoutIngredients("run-b")]
    const results = await Promise.allSettled([
      repo.appendCanonicalVersion(a),
      repo.appendCanonicalVersion(b),
    ])
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<CanonicalVersion> => r.status === "fulfilled",
    )
    // No two successful appends may report the same ordinal…
    expect(new Set(fulfilled.map((r) => r.value.version)).size).toBe(fulfilled.length)
    // …the store holds exactly as many versions as succeeded…
    const listed = await repo.listLibrary()
    expect(listed[0]?.latestVersion).toBe(fulfilled.length)
    // …and every run that was told it had been appended is still readable at
    // the ordinal it was given. A lost update is precisely an append that
    // reported success and is no longer there, so this is what sees it.
    const runIds = await Promise.all(
      fulfilled.map(async ({ value }) => {
        const [stored] = await repo.readTwoRuns(a.id, value.version, value.version)
        return stored.recipe.provenance.runId
      }),
    )
    expect(new Set(runIds).size, "an append reported success but its run is gone").toBe(
      fulfilled.length,
    )
  })

  it("a recipe whose source had no title lists with no title key at all, not a null one", async () => {
    // PDR-0005 through the database. `->>` yields SQL NULL for
    // `{"state":"not_in_source"}`, and a null handed straight into the object
    // would put `title: null` on a row `LibraryEntry` says has no title —
    // which the renderer and the in-memory store would then disagree about.
    // Every other proof here uses a fixture that HAS a title, so without this
    // one the gap is never carried across a store at all.
    const { handle } = await freshStore()
    const titled = await canonical("run-1")
    const untitled = { ...titled, title: { state: "not_in_source" } } as typeof titled
    const appended = await handle.repository.appendCanonicalVersion(untitled)

    const listed = await handle.repository.listLibrary()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual({ recipeId: appended.recipeId, latestVersion: 1 })
    expect(Object.hasOwn(listed[0] as object, "title")).toBe(false)

    // …and the document itself still round-trips as the declared gap it is.
    const loaded = await handle.repository.loadLatestCanonical(appended.recipeId)
    expect(loaded?.recipe.title).toEqual({ state: "not_in_source" })
  })

  it("a version that fails to validate leaves no half-written row and no projection rows", async () => {
    const { handle, schema } = await freshStore()
    await expect(handle.repository.appendCanonicalVersion({ id: "r1" } as never)).rejects.toThrow()
    const counts = await inspect(schema, async (client) => {
      const versions = await client.query("select count(*)::int as n from recipe_version")
      const ingredients = await client.query("select count(*)::int as n from ingredient")
      return [versions.rows[0]?.n, ingredients.rows[0]?.n]
    })
    expect(counts).toEqual([0, 0])
  })
})

withDatabase("persistence/the-projection-is-derived-not-authoritative", () => {
  it("is written in the same transaction as the document it comes from", async () => {
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    const rows = await inspect(schema, async (client) => {
      const result = await client.query<{ n: number }>(
        "select count(*)::int as n from ingredient where recipe_id = $1 and version = $2",
        [appended.recipeId, appended.version],
      )
      return result.rows[0]?.n ?? 0
    })
    const expected = (await canonical("run-1")).ingredientGroups.reduce(
      (total, group) => total + group.ingredients.length,
      0,
    )
    expect(rows).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  it("a failing extraction takes the document down with it, so neither can land without the other", async () => {
    // "Same transaction" is the claim, and in the happy path a projection
    // written just AFTER the commit looks identical — both rows end up there.
    // What separates them is an extraction that fails: inside the transaction
    // the document rolls back with it, after the commit the document is already
    // durable and the projection is simply missing. So the projection is made
    // to fail, and the assertion is about the DOCUMENT.
    const { handle, schema } = await freshStore()
    await inspect(schema, (client) => client.query("drop table ingredient"))
    await expect(
      handle.repository.appendCanonicalVersion(await canonical("run-1")),
    ).rejects.toThrow()
    const versions = await inspect(schema, async (client) => {
      const result = await client.query<{ n: number }>(
        "select count(*)::int as n from recipe_version",
      )
      return result.rows[0]?.n ?? -1
    })
    expect(versions, "the document survived an extraction that failed").toBe(0)
  })

  it("rebuilding it from the documents alone changes nothing — so it is a cache, not a second truth", async () => {
    // ADR-0015 commitment 2, run rather than asserted. If a rebuild moved a
    // single row, the projection was carrying something the documents do not.
    const { handle, schema } = await freshStore()
    await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    await handle.repository.appendCanonicalVersion(await canonical("run-2"))
    const before = await readProjection(schema)
    expect(before.length).toBeGreaterThan(0)
    await handle.rebuildProjection()
    expect(await readProjection(schema)).toEqual(before)
  })

  it("rebuilds the projection from nothing, so a rebuild that does nothing cannot pass for one", async () => {
    // Review caught this, and it was right: read-rebuild-compare is satisfied
    // by a `rebuildProjection` emptied of BOTH its statements, because a no-op
    // trivially leaves the rows equal. Reproduced before it was changed — all
    // 56 proofs stayed green against a rebuild that did nothing at all.
    //
    // "Derived from the documents" means the rows can be REPRODUCED, so the
    // rows have to be gone before the rebuild runs. They are destroyed out of
    // band, through the table rather than through the store, because the store
    // deliberately offers no way to destroy them.
    const { handle, schema } = await freshStore()
    await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    await handle.repository.appendCanonicalVersion(await canonical("run-2"))
    const before = await readProjection(schema)
    expect(before.length).toBeGreaterThan(0)

    await inspect(schema, (client) => client.query("delete from ingredient"))
    expect(await readProjection(schema)).toHaveLength(0)

    await handle.rebuildProjection()
    expect(await readProjection(schema)).toEqual(before)
  })

  it("replaces what it finds rather than adding to it, so a corrupted row does not survive a rebuild", async () => {
    // The other half of "a cache with a contract": a rebuild that only filled
    // in what was missing would leave a wrong row standing, and the projection
    // would disagree with the document it claims to come from.
    const { handle, schema } = await freshStore()
    await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    const before = await readProjection(schema)
    expect(before.length).toBeGreaterThan(0)

    await inspect(schema, (client) =>
      client.query("update ingredient set name = $1", ["not what the document says"]),
    )
    expect((await readProjection(schema))[0]).not.toEqual(before[0])

    await handle.rebuildProjection()
    expect(await readProjection(schema)).toEqual(before)
  })

  it("a deleted document takes its projection rows with it, so an orphan cannot outlive its truth", async () => {
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    const remaining = await inspect(schema, async (client) => {
      await client.query("delete from recipe_version where recipe_id = $1", [appended.recipeId])
      const result = await client.query<{ n: number }>("select count(*)::int as n from ingredient")
      return result.rows[0]?.n ?? -1
    })
    expect(remaining).toBe(0)
  })
})

withDatabase("persistence/a-stored-document-is-parsed-on-the-way-out", () => {
  // Review caught that this property had no proof at all: replacing the parse
  // with a bare cast at each of the three read paths, one at a time, left all
  // 56 green. Reproduced before anything was changed. Nothing in these suites
  // could write a non-conforming row, so nothing could ever meet the check.
  //
  // It is newly load-bearing, which is why it belongs to this PR rather than a
  // later one: before the durable store, nothing survived a process, so a row
  // written by an older contract version could not exist. Now it can, and the
  // answer has to be a refusal rather than a document handed on as if it were
  // valid — omission over coercion, at the read as well as at the write.
  //
  // The bad rows go in through the table, because the store's own write path
  // parses and would refuse them, which is the point.
  const NOT_A_RECIPE = { id: "r1", schemaVersion: "0.0.1" }

  it("refuses a Source Snapshot the contract no longer accepts", async () => {
    const { handle, schema } = await freshStore()
    await inspect(schema, (client) =>
      client.query("insert into snapshot (id, doc) values ($1, $2)", [
        "snap-from-an-older-contract",
        JSON.stringify(NOT_A_RECIPE),
      ]),
    )
    await expect(handle.repository.loadSnapshot("snap-from-an-older-contract")).rejects.toThrow()
  })

  it("refuses the latest Canonical version when the stored document no longer parses", async () => {
    const { handle, schema } = await freshStore()
    await inspect(schema, (client) =>
      client.query("insert into recipe_version (recipe_id, version, doc) values ($1, 1, $2)", [
        "recipe-from-an-older-contract",
        JSON.stringify(NOT_A_RECIPE),
      ]),
    )
    await expect(
      handle.repository.loadLatestCanonical("recipe-from-an-older-contract"),
    ).rejects.toThrow()
  })

  it("refuses a stored Cooking Plan the contract no longer accepts", async () => {
    // The plan is derived data, so a stale row here costs one derivation to
    // replace — but handing it on unparsed would put a document nobody can
    // read in front of a cook, which is the one thing the fallback exists to
    // avoid. The version has to exist first: the table's foreign key is what
    // refuses a plan belonging to nothing.
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    await inspect(schema, (client) =>
      client.query("insert into cooking_plan (recipe_id, version, doc) values ($1, 1, $2)", [
        appended.recipeId,
        JSON.stringify(NOT_A_RECIPE),
      ]),
    )
    await expect(handle.repository.loadCookingPlan(appended.recipeId, 1)).rejects.toThrow()
  })

  it("refuses a comparison when either of the two versions no longer parses", async () => {
    // The stale row is the SECOND version, so a reader that parsed only the
    // first would still hand this one on.
    const { handle, schema } = await freshStore()
    const appended = await handle.repository.appendCanonicalVersion(await canonical("run-1"))
    await inspect(schema, (client) =>
      client.query("insert into recipe_version (recipe_id, version, doc) values ($1, 2, $2)", [
        appended.recipeId,
        JSON.stringify(NOT_A_RECIPE),
      ]),
    )
    await expect(handle.repository.readTwoRuns(appended.recipeId, 1, 2)).rejects.toThrow()
    // …and the good version on its own is still readable, so the refusal is
    // about the stale document and not about the store having given up.
    const [first] = await handle.repository.readTwoRuns(appended.recipeId, 1, 1)
    expect(first.recipe.provenance.runId).toBe("run-1")
  })
})

withDatabase("persistence/an-unmigrated-database-says-so", () => {
  it("names the migration rather than handing on a driver error about a relation", async () => {
    if (baseUrl === undefined) throw new Error("no database")
    // A schema that exists but has never had the migration applied: the exact
    // state an operator reaches by creating the database and starting the
    // instance.
    const client = new Client({ connectionString: baseUrl })
    await client.connect()
    const schema = `cf_unmigrated_${Date.now()}`
    await client.query(`create schema "${schema}"`)
    await client.end().catch(() => {})

    const handle = createPostgresStore(urlForSchema(baseUrl, schema))
    try {
      await expect(handle.repository.listLibrary()).rejects.toThrow(StoreNotMigratedError)
      // The relation it NAMES is the one that is missing, not a fixed one.
      // PostgreSQL does not send the `TABLE` error field for `42P01`, so the
      // name has to come from the message; a fallback that named one table for
      // every missing one was harmless while `migrations/` held one file and
      // sends an operator to the wrong migration now that it holds two.
      await expect(handle.repository.loadCookingPlan("nobody", 1)).rejects.toThrow(
        /no `cooking_plan` table/,
      )
      await expect(handle.repository.listLibrary()).rejects.toThrow(/0001-the-recipe-store\.sql/)
    } finally {
      await handle.close()
      const cleanup = new Client({ connectionString: baseUrl })
      await cleanup.connect()
      await cleanup.query(`drop schema if exists "${schema}" cascade`)
      await cleanup.end().catch(() => {})
    }
  })
})

describe("persistence/the-gate-runs-against-a-real-database", () => {
  it("fails when a database was asked for and none answered, rather than skipping", () => {
    // The rule as a value, so it can be proved without taking a server away.
    // A skipped proof reports success, which is the failure mode this project
    // has already paid for once.
    expect(decideDatabaseAvailability("postgres://u:p@127.0.0.1:1/db", false)).toMatchObject({
      mode: "fail",
    })
    expect(decideDatabaseAvailability("postgres://u:p@127.0.0.1:1/db", true)).toMatchObject({
      mode: "run",
    })
  })

  it("skips only when no database was asked for at all", () => {
    expect(decideDatabaseAvailability(undefined, false).mode).toBe("skip")
    expect(decideDatabaseAvailability("", false).mode).toBe("skip")
    expect(decideDatabaseAvailability("   ", false).mode).toBe("skip")
    // Unreachability is irrelevant when nothing was configured: there is no
    // server to be unreachable.
    expect(decideDatabaseAvailability(undefined, true).mode).toBe("skip")
  })

  it("carries a reason a reader can act on, in both cases", () => {
    const skipped = decideDatabaseAvailability(undefined, false)
    const failed = decideDatabaseAvailability("postgres://u:p@h/db", false)
    expect(skipped.mode === "skip" && skipped.reason).toMatch(/DATABASE_URL is not set/)
    expect(failed.mode === "fail" && failed.reason).toMatch(/no PostgreSQL server answered/)
  })
})
