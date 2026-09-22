/**
 * CFV1-PG — reaching a real database from the proofs, and refusing to pretend.
 *
 * Two properties this file exists to hold, both of them things this project has
 * already been burned by:
 *
 * 1. **The tables the proofs run against are built by the migrations**, read off
 *    disk, never by DDL written a second time here. The files in `migrations/`
 *    are the only declaration of the store's shape, so a proof that
 *    passes against a schema this file invented would be a proof about nothing
 *    an operator will ever apply. {@link applyMigration} is how every schema in
 *    these suites comes into existence, which makes
 *    `persistence/the-migration-builds-the-store` a property of the whole file
 *    rather than one assertion inside it.
 *
 * 2. **A configured database that cannot be reached FAILS; it never skips.** A
 *    skipped proof reports success, and a gate that certified eleven checks
 *    fewer than it appeared to has already cost this project once. The rule is
 *    in {@link decideDatabaseAvailability}, which is a pure function so it can
 *    be proved without a server, and `tests/unit/repo-config.test.ts` closes the
 *    remaining hole by requiring a CI job that sets `DATABASE_URL` — so "skipped
 *    everywhere" cannot be a green build.
 *
 * Isolation between proofs comes from the CONNECTION URL rather than from a
 * test seam in the store: each store is handed a URL carrying
 * `options=-c search_path=<its own schema>`, which Postgres applies to every
 * connection the pool opens. The store under test is therefore constructed
 * exactly as an instance constructs it — from a URL and nothing else.
 */
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * The migrations an operator applies, in the order they are applied — together
 * the single declaration of the store's shape.
 *
 * Read off disk by listing the directory rather than named one by one here: a
 * migration added to the tree and forgotten in this list would leave every
 * proof below running against a schema no operator has, which is precisely the
 * failure this file exists to prevent.
 */
export const MIGRATIONS: readonly { readonly path: string; readonly sql: string }[] = readdirSync(
  join(repoRoot, "migrations"),
)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => {
    const path = join(repoRoot, "migrations", name)
    return { path, sql: readFileSync(path, "utf8") }
  })

/** Every migration's SQL, in order — what an operator's database ends up having run. */
export const MIGRATION_SQL = MIGRATIONS.map((migration) => migration.sql).join("\n")

/** What the suites should do about the database, and why. */
export type DatabaseAvailability =
  | { readonly mode: "run"; readonly url: string }
  | { readonly mode: "skip"; readonly reason: string }
  | { readonly mode: "fail"; readonly reason: string }

/**
 * The fail-rather-than-skip rule, as a value.
 *
 * `configured` absent is a developer's machine with no server, which is the one
 * case where skipping is honest — and it is made safe by CI always setting the
 * variable. `configured` present and unreachable is the case that must never be
 * quiet: something asked for these proofs to run and they did not.
 */
export function decideDatabaseAvailability(
  configured: string | undefined,
  reachable: boolean,
): DatabaseAvailability {
  if (configured === undefined || configured.trim() === "") {
    return {
      mode: "skip",
      reason:
        "DATABASE_URL is not set, so no database was asked for; CI always sets it (see the `persistence` job)",
    }
  }
  if (!reachable) {
    return {
      mode: "fail",
      reason:
        "DATABASE_URL is set but no PostgreSQL server answered; these proofs fail rather than skip, because a skipped proof reports success",
    }
  }
  return { mode: "run", url: configured.trim() }
}

/** Does a server answer on `url`? */
export async function isReachable(url: string): Promise<boolean> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 })
  try {
    await client.connect()
    await client.query("select 1")
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

/** Apply the migration files, in order — the ONLY way a schema in these suites gets its tables. */
export async function applyMigration(client: Client): Promise<void> {
  for (const migration of MIGRATIONS) await client.query(migration.sql)
}

/** Pin a connection URL to one schema, without touching the store's code. */
export function urlForSchema(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set("options", `-c search_path=${schema}`)
  return url.toString()
}

/** One isolated, migrated schema, and the means to take it away again. */
export interface ProvisionedSchema {
  /** A connection URL that reaches only this schema. */
  readonly url: string
  readonly schema: string
  drop(): Promise<void>
}

/**
 * Create an empty schema, apply the migration to it, and return a URL pinned to
 * it. Every proof that needs an empty store calls this, so no proof can be
 * reading a leftover from the one before it.
 */
export async function provisionSchema(baseUrl: string): Promise<ProvisionedSchema> {
  const schema = `cf_test_${randomBytes(6).toString("hex")}`
  const admin = new Client({ connectionString: baseUrl })
  await admin.connect()
  try {
    await admin.query(`create schema "${schema}"`)
    await admin.query(`set search_path to "${schema}"`)
    await applyMigration(admin)
  } finally {
    await admin.end().catch(() => {})
  }
  return {
    url: urlForSchema(baseUrl, schema),
    schema,
    drop: async () => {
      const client = new Client({ connectionString: baseUrl })
      await client.connect()
      try {
        await client.query(`drop schema if exists "${schema}" cascade`)
      } finally {
        await client.end().catch(() => {})
      }
    },
  }
}
