/**
 * CFV1-RRD, extended by CFV1-PG — run the interface contract against every
 * store, and prove that is how it is done (ADR-0018, ADR-0015).
 *
 * The registry below is the single list of stores that answer to
 * {@link RecipeRepository}. Each is run through the one shared
 * {@link runRepositoryContract}; a store is added by extending the registry,
 * never by writing a second suite — a second copy is how two stores drift apart
 * while both report green.
 *
 * There are two stores now, which is the point. An interface with one
 * implementation is not an interface anyone has tested: the suite cannot tell a
 * promise the interface makes from a habit its only store happens to have. The
 * durable PostgreSQL store (ADR-0015) and the in-memory provisional one now run
 * the same proofs from the same definition, so "the two are interchangeable" is
 * a thing that is checked rather than a thing that is said.
 *
 * The PostgreSQL rows join the registry only when a database was asked for, and
 * `decideDatabaseAvailability` is what decides: absent `DATABASE_URL` skips,
 * present-but-unreachable FAILS. `tests/unit/repo-config.test.ts` requires the
 * CI job that always sets it, so the skip cannot become the normal case.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import {
  createPostgresStore,
  createProvisionalStore,
  type PostgresStoreHandle,
  type RecipeRepository,
} from "../../src/persistence/index.js"
import { decideDatabaseAvailability, isReachable, provisionSchema } from "./postgres-harness.js"
import { runRepositoryContract } from "./repository-contract.js"

const configured = process.env["DATABASE_URL"]
const availability = decideDatabaseAvailability(
  configured,
  configured === undefined || configured.trim() === "" ? false : await isReachable(configured),
)

if (availability.mode === "fail") throw new Error(availability.reason)

/** Every store built for a proof, so none leaks a connection pool past the run. */
const opened: PostgresStoreHandle[] = []
const provisioned: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const handle of opened) await handle.close()
  for (const drop of provisioned) await drop()
})

/**
 * A fresh, migrated, empty PostgreSQL store.
 *
 * Isolation is a schema of its own, carried in the connection URL, so the store
 * is built the way an instance builds it — `createPostgresStore(url)` — with no
 * argument that exists only for tests.
 */
async function makePostgresStore(baseUrl: string): Promise<RecipeRepository> {
  const schema = await provisionSchema(baseUrl)
  provisioned.push(schema.drop)
  const handle = createPostgresStore(schema.url)
  opened.push(handle)
  return handle.repository
}

/** Every store that implements the interface. A new store is a new row here. */
const STORES: ReadonlyArray<readonly [string, () => RecipeRepository | Promise<RecipeRepository>]> =
  [
    ["ProvisionalStore", createProvisionalStore],
    ...(availability.mode === "run"
      ? ([["PostgresStore", () => makePostgresStore(availability.url)]] as const)
      : []),
  ]

for (const [label, makeStore] of STORES) {
  runRepositoryContract(label, makeStore)
}

const here = dirname(fileURLToPath(import.meta.url))

describe("repo-reads/one-suite-every-store", () => {
  it("every registered store answers to the whole interface and is run through the one contract", async () => {
    // The property, not just an assertion: one exported contract function is
    // applied to every store in the registry (the loop above), so adding a store
    // cannot mean adding a divergent suite. Discriminating on the registry: each
    // registered factory must produce a store exposing the whole interface — a row
    // that did not (an empty registry, or a store missing an operation) fails here,
    // which is the same conformance the loop then proves behaviourally.
    expect(STORES.length).toBeGreaterThanOrEqual(1)
    expect(typeof runRepositoryContract).toBe("function")
    const interfaceOps = [
      "storeSnapshot",
      "loadSnapshot",
      "appendCanonicalVersion",
      "loadLatestCanonical",
      "listLibrary",
      "readTwoRuns",
      "storeCookingPlan",
      "loadCookingPlan",
    ] as const
    for (const [label, makeStore] of STORES) {
      const store = (await makeStore()) as unknown as Record<string, unknown>
      for (const op of interfaceOps) {
        expect(typeof store[op], `${label}.${op}`).toBe("function")
      }
    }
  })

  it("the shared contract depends only on the interface, never a concrete store", () => {
    // If the contract named a concrete store it could smuggle in a store-specific
    // assumption and stop being an interface proof. It reaches a store only through
    // the injected factory, so it must not mention one by name or by module.
    const src = readFileSync(join(here, "repository-contract.ts"), "utf8")
    expect(src).not.toMatch(/ProvisionalStore/)
    expect(src).not.toMatch(/provisional-store/)
    expect(src).not.toMatch(/PostgresStore/)
    expect(src).not.toMatch(/postgres-store/)
    // …and knows nothing about a database either: a suite that imported `pg`
    // would be describing one store's world, not the interface.
    expect(src).not.toMatch(/\bpg\b/)
    expect(src).not.toMatch(/DATABASE_URL/)
  })
})

describe("persistence/both-stores-satisfy-one-contract", () => {
  it("runs the durable store through the same definition as the provisional one", () => {
    // The acceptance criterion in one place: when a database was asked for,
    // BOTH stores are in the registry, and the loop above puts both through the
    // one shared function. Two rows, one suite.
    if (availability.mode !== "run") {
      expect(availability.mode, availability.reason).toBe("skip")
      return
    }
    expect(STORES.map(([label]) => label)).toEqual(["ProvisionalStore", "PostgresStore"])
  })
})
