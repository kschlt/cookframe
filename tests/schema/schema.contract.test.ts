/**
 * Schema-contract tests (CFV1-SL0, proof: slice0/schema-contracts-versioned,
 * slice0/schema-single-source-of-truth).
 *
 * The contract in `schema/` is the single source of truth. These tests assert
 * the three properties later slices lean on: the committed public fixtures
 * satisfy the contract, `.strict()` rejects an invented key, and the schema
 * version is pinned as a literal so a snapshot written against 1.0.0 can never
 * be silently accepted as some other version.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe, SCHEMA_VERSION, SourceSnapshot } from "../../schema/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function fixture(...parts: string[]): unknown {
  const path = join(repoRoot, "evals", "fixtures", "public", ...parts)
  return JSON.parse(readFileSync(path, "utf8"))
}

describe("Canonical Recipe contract", () => {
  const valid = fixture("canonical", "two-yields-nutrition.json")

  it("accepts the future-readiness fixture (recipe-ontology §12)", () => {
    const result = CanonicalRecipe.safeParse(valid)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it("represents two contextual yields without discarding either", () => {
    const parsed = CanonicalRecipe.parse(valid)
    expect(parsed.yields).toHaveLength(2)
    expect(parsed.yields.map((y) => y.unit)).toEqual(["servings", "persons"])
  })

  it("rejects an unknown top-level key (the 'do not invent' guard)", () => {
    const withExtra = { ...(valid as object), inventedField: "nope" }
    const result = CanonicalRecipe.safeParse(withExtra)
    expect(result.success).toBe(false)
  })

  it("rejects an unknown nested key", () => {
    const base = valid as { yields: Array<Record<string, unknown>> }
    const mutated = structuredClone(base)
    const firstYield = mutated.yields[0]
    expect(firstYield).toBeDefined()
    if (firstYield === undefined) return
    firstYield.inventedField = "nope"
    const result = CanonicalRecipe.safeParse(mutated)
    expect(result.success).toBe(false)
  })

  it("pins schemaVersion to the current literal", () => {
    const wrongVersion = { ...(valid as object), schemaVersion: "2.0.0" }
    const result = CanonicalRecipe.safeParse(wrongVersion)
    expect(result.success).toBe(false)
    expect(SCHEMA_VERSION).toBe("1.0.0")
  })
})

describe("Source Snapshot contract", () => {
  const valid = fixture("source-snapshot", "basic.json")

  it("accepts the basic snapshot fixture", () => {
    const result = SourceSnapshot.safeParse(valid)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  it("rejects an unknown top-level key", () => {
    const withExtra = { ...(valid as object), inventedField: "nope" }
    expect(SourceSnapshot.safeParse(withExtra).success).toBe(false)
  })
})
