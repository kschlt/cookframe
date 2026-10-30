/**
 * Apply the migrations an instance is missing, and only those.
 *
 * `npm run migrate` reads `DATABASE_URL`, looks at which tables the migrations
 * create, and applies each migration whose table is absent, in filename order,
 * each in its own transaction. It exists because applying the files by hand
 * once cost a first deployment a manual step: the database predated `0003`, the
 * instance refused to start naming the missing table (ADR-0027), and the fix
 * was SQL typed into a console.
 *
 * ## What it is not
 *
 * Not a version table. The migrations are deliberately not idempotent (`0001`
 * says why: a second application should stop a human), and this script keeps
 * that: it never re-runs a file whose table already exists, and it refuses a
 * database it cannot classify. The ledger is the schema itself. A migration
 * added to `migrations/` without a row in {@link SENTINELS} stops the script
 * rather than being skipped or guessed at, and
 * `tests/run/migrate.test.ts` fails first.
 *
 * It does not know which platform runs it (ADR-0026's fourth cut): it takes a
 * URL, like the instance does, and the platform file may call it as a release
 * command.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The table each migration creates, by filename. Presence of the table is the
 * only evidence that the migration ran.
 */
export const SENTINELS: Readonly<Record<string, string>> = {
  "0001-the-recipe-store.sql": "snapshot",
  "0002-the-cooking-plan.sql": "cooking_plan",
  "0003-the-capability-grant.sql": "capability_grant",
}

export interface MigrationFile {
  readonly name: string
  readonly sql: string
}

export interface Plan {
  readonly apply: readonly MigrationFile[]
  readonly present: readonly string[]
}

/**
 * Decide which files to apply, given which sentinel tables exist.
 *
 * Refuses a file with no sentinel, and refuses a gap: a later migration's table
 * existing while an earlier one's is missing means the database was not built
 * by these files in order, and applying the earlier file now could fail or, worse,
 * succeed against something unexpected.
 */
export function planMigrations(
  files: readonly MigrationFile[],
  existingTables: ReadonlySet<string>,
): Plan {
  const apply: MigrationFile[] = []
  const present: string[] = []
  let sawMissing: string | undefined
  for (const file of files) {
    const table = SENTINELS[file.name]
    if (table === undefined) {
      throw new Error(
        `migrations/${file.name} has no entry in SENTINELS (scripts/migrate.ts), so this script ` +
          "cannot tell whether it was applied. Add the table the file creates.",
      )
    }
    if (existingTables.has(table)) {
      if (sawMissing !== undefined) {
        throw new Error(
          `table "${table}" (${file.name}) exists but an earlier migration's table "${sawMissing}" ` +
            "does not. The database was not built by these files in order; resolve it by hand.",
        )
      }
      present.push(file.name)
    } else {
      sawMissing ??= table
      apply.push(file)
    }
  }
  return { apply, present }
}

export function readMigrationFiles(dir = join(repoRoot, "migrations")): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }))
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"]
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Point it at the instance's PostgreSQL database.")
  }
  const files = readMigrationFiles()
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const existing = new Set<string>()
    for (const table of Object.values(SENTINELS)) {
      const res = await client.query<{ found: string | null }>(
        "select to_regclass($1)::text as found",
        [table],
      )
      if (res.rows[0]?.found != null) existing.add(table)
    }
    const plan = planMigrations(files, existing)
    for (const name of plan.present) console.log(`already applied: ${name}`)
    for (const file of plan.apply) {
      await client.query("begin")
      try {
        await client.query(file.sql)
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => {})
        throw new Error(
          `${file.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      console.log(`applied: ${file.name}`)
    }
    if (plan.apply.length === 0) console.log("nothing to apply")
  } finally {
    await client.end()
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
