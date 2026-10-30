/**
 * `npm run migrate` applies what a database is missing and nothing else.
 *
 * Each `describe` string is the proof id it satisfies. The planner is pure, so
 * these need no server; the database case runs only where `DATABASE_URL` asks
 * for one and then FAILS rather than skips if it cannot be reached
 * (`tests/persistence/postgres-harness.ts` says why).
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { planMigrations, readMigrationFiles, SENTINELS } from "../../scripts/migrate.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const files = readMigrationFiles()

describe("run/migrate-knows-every-migration", () => {
  it("has a sentinel for every file, and each sentinel table is created by its own file", () => {
    expect(files.map((f) => f.name)).toEqual(Object.keys(SENTINELS).sort())
    for (const f of files) {
      const table = SENTINELS[f.name]
      expect(f.sql, f.name).toMatch(new RegExp(`create table ${table} \\(`))
    }
    expect(readdirSync(join(repoRoot, "migrations")).every((n) => n.endsWith(".sql"))).toBe(true)
  })
})

describe("run/migrate-applies-only-the-missing", () => {
  it("applies everything to an empty database", () => {
    expect(planMigrations(files, new Set()).apply.map((f) => f.name)).toEqual(
      files.map((f) => f.name),
    )
  })
  it("applies only 0003 to a database that predates it", () => {
    const plan = planMigrations(files, new Set(["snapshot", "cooking_plan"]))
    expect(plan.apply.map((f) => f.name)).toEqual(["0003-the-capability-grant.sql"])
  })
  it("applies nothing to a complete database", () => {
    const all = new Set(Object.values(SENTINELS))
    expect(planMigrations(files, all).apply).toEqual([])
  })
  it("refuses a gap rather than guessing", () => {
    expect(() => planMigrations(files, new Set(["capability_grant"]))).toThrow(
      /not built by these files in order/,
    )
  })
  it("refuses a migration it does not know", () => {
    expect(() => planMigrations([{ name: "9999-x.sql", sql: "" }], new Set())).toThrow(
      /no entry in SENTINELS/,
    )
  })
})
