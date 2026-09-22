/**
 * CFV1-DBQ — connecting to the one engine both shapes are measured in.
 *
 * Both shapes run in the SAME PostgreSQL server, in two schemas. That is the
 * whole point of the setup: if the document shape ran in one engine and the
 * relational shape in another, the comparison would measure the engines. Here
 * the only variable left is the shape.
 *
 * ADR-0003's hypothesis names Postgres explicitly ("Postgres with validated
 * JSONB documents plus extracted query columns"), so the evaluation is run
 * against Postgres rather than a stand-in — and that hypothesis is itself one of
 * the three shapes, not just the frame around the other two.
 *
 * Connection comes from `DATABASE_URL`, or from the local default a CI service
 * container and a locally started server both answer on.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

const here = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_URL = "postgres://postgres:postgres@127.0.0.1:5432/postgres"

/** The physical shapes under comparison. Each gets its own schema. */
export type Shape = "document" | "relational" | "hybrid"

export const SHAPES: readonly Shape[] = ["document", "relational", "hybrid"]

/**
 * The only way a shape name reaches SQL.
 *
 * Every `search_path` statement interpolates its identifier — parameters cannot
 * carry one — so what stands between a caller and an injected identifier is
 * this check. It was previously done by asking whether a SQL constant had a key
 * of that name, which is not the same question: `LIBRARY_SQL["constructor"]` is
 * `Object`'s constructor, not `undefined`, so `constructor`, `toString`,
 * `valueOf`, `hasOwnProperty` and `__proto__` all passed that guard and were
 * interpolated. Not reachable today — every caller passes a `SHAPES` constant —
 * but the guard did not hold the property its callers relied on.
 *
 * Membership in the declared list, which is the contract, rather than a
 * property lookup on an object that inherits five.
 */
export function assertShape(name: string): Shape {
  const shape = SHAPES.find((s) => s === name)
  if (shape === undefined) {
    throw new Error(`not a known shape: ${JSON.stringify(name)} (expected one of ${SHAPES.join(", ")})`)
  }
  return shape
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_URL
}

/** Connect, or return `undefined` when no server answers. */
export async function connect(): Promise<Client | undefined> {
  const client = new Client({ connectionString: databaseUrl() })
  try {
    await client.connect()
    return client
  } catch {
    await client.end().catch(() => {})
    return undefined
  }
}

/**
 * Drop and recreate `shape`'s schema, then apply its DDL. Every run starts from
 * an empty shape, so a measurement can never be a leftover from the last one.
 */
export async function resetShape(client: Client, shapeName: Shape): Promise<void> {
  const shape = assertShape(shapeName)
  const ddl = readFileSync(join(here, `schema-${shape}.sql`), "utf8")
  await client.query(`drop schema if exists ${shape} cascade`)
  await client.query(`create schema ${shape}`)
  await client.query(`set search_path to ${shape}`)
  await client.query(ddl)
}

/** Point the session at one shape's schema. */
export async function useShape(client: Client, shapeName: Shape): Promise<void> {
  await client.query(`set search_path to ${assertShape(shapeName)}`)
}
