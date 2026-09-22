/**
 * CFV1-RRD — run the interface contract against every store, and prove that is
 * how it is done (ADR-0018).
 *
 * The registry below is the single list of stores that answer to
 * {@link RecipeRepository}. Each is run through the one shared
 * {@link runRepositoryContract}; a new store is added by extending the registry,
 * never by writing a second suite. Today only the provisional store exists; a
 * later persistent store (the DBQ decision) joins the registry and inherits these
 * exact proofs.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createProvisionalStore, type RecipeRepository } from "../../src/persistence/index.js"
import { runRepositoryContract } from "./repository-contract.js"

/** Every store that implements the interface. A new store is a new row here. */
const STORES: ReadonlyArray<readonly [string, () => RecipeRepository]> = [
  ["ProvisionalStore", createProvisionalStore],
]

for (const [label, makeStore] of STORES) {
  runRepositoryContract(label, makeStore)
}

const here = dirname(fileURLToPath(import.meta.url))

describe("repo-reads/one-suite-every-store", () => {
  it("every registered store answers to the whole interface and is run through the one contract", () => {
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
      const store = makeStore() as unknown as Record<string, unknown>
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
  })
})
