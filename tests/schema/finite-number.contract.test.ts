/**
 * CFV1-FIN — the contract decides, once and explicitly, that a non-finite
 * numeric value is not valid, and enforces it where the field is declared.
 *
 * Zod's bare `number` rejects `NaN` but ACCEPTS `Infinity` and `-Infinity`, so
 * before this the free scalar quantity fields of `ValueExpression` /
 * `DurationExpression` admitted a non-finite number, which then reached a valid
 * Canonical (the #28 omission chain published `PTInfinityH` from an `Infinity`
 * value). JSON cannot encode ±Infinity or NaN, so the inputs here are constructed
 * programmatically — exactly the in-memory computation path #28 hit.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CanonicalRecipe,
  DurationExpression,
  SourceSnapshot,
  ValueExpression,
} from "../../schema/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function readFixture(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(repoRoot, "evals", "fixtures", "public", ...parts), "utf8"))
}

/** Every committed .json fixture in a public fixture subdirectory, sorted. */
function listFixtures(subdir: string): readonly string[] {
  return readdirSync(join(repoRoot, "evals", "fixtures", "public", subdir))
    .filter((name) => name.endsWith(".json"))
    .sort()
}

/** The three values `Number.isFinite` rejects — the whole non-finite set. */
const NON_FINITE: ReadonlyArray<readonly [string, number]> = [
  ["+Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["NaN", Number.NaN],
]

/** Minimal shape needed to introspect and probe a strict object schema. */
type CheckableObjectSchema = {
  readonly shape: Record<string, unknown>
  safeParse: (value: unknown) => { success: boolean }
}

/**
 * Discover a strict object schema's numeric fields behaviourally: a field is
 * numeric iff a minimal valid object still parses with a bare finite number
 * there. Deliberately not a hardcoded list — a numeric field added later, in any
 * spelling (`.optional()`, `.nullish()`, a default), is discovered here, so the
 * non-finite proof covers it automatically instead of silently skipping it. A
 * source-text grep for one spelling cannot do this: the property lives in the
 * field, not in how it is written.
 */
function numericFieldsOf(
  schema: CheckableObjectSchema,
  base: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.keys(schema.shape).filter(
    (field) => schema.safeParse({ ...base, [field]: 0 }).success,
  )
}

describe("contract/non-finite-values-decided", () => {
  // The boundary's behaviour on every non-finite value, for every numeric field
  // of both expression types, is pinned — and the field set is discovered from
  // the schema, not frozen, so a numeric field added later cannot reopen the hole
  // unseen. This nails Zod's observed behaviour rather than trusting a default:
  // were a future Zod to let one of the three through `.finite()`, or a new field
  // to be declared on the bare validator, one of these turns red.
  const cases: ReadonlyArray<readonly [string, CheckableObjectSchema, Record<string, unknown>]> = [
    ["ValueExpression", ValueExpression, { sourceText: "x", kind: "exact" }],
    ["DurationExpression", DurationExpression, { sourceText: "x", kind: "exact" }],
  ]

  for (const [name, schema, base] of cases) {
    const numericFields = numericFieldsOf(schema, base)

    it(`${name} exposes numeric fields to check (the sweep is not vacuous)`, () => {
      expect(numericFields.length).toBeGreaterThan(0)
    })

    for (const field of numericFields) {
      for (const [label, n] of NON_FINITE) {
        it(`${name} rejects ${label} in ${field}`, () => {
          expect(schema.safeParse({ ...base, [field]: n }).success).toBe(false)
        })
      }
    }
  }
})

describe("contract/non-finite-has-an-owner", () => {
  // Because rejection is the chosen decision, the owner is the contract itself: a
  // whole Canonical Recipe carrying a non-finite value stops at the boundary and
  // never reaches a consumer. Tested end to end through a real fixture's required
  // yield value expression, so this is the recipe-level boundary, not just the
  // isolated value object.
  const valid = readFixture("canonical", "two-yields-nutrition.json")

  it("the unmodified fixture parses (so the failures below are the injected value)", () => {
    const result = CanonicalRecipe.safeParse(valid)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })

  for (const [label, n] of NON_FINITE) {
    it(`a recipe with ${label} in a yield's quantity fails to parse`, () => {
      const recipe = structuredClone(valid) as {
        yields: Array<{ valueExpression: { value: number } }>
      }
      const first = recipe.yields[0]
      expect(first).toBeDefined()
      if (first === undefined) return
      first.valueExpression.value = n
      const result = CanonicalRecipe.safeParse(recipe)
      expect(result.success).toBe(false)
    })
  }
})

describe("contract/finite-values-unaffected", () => {
  // Every committed public fixture parses unchanged: the decision closes the
  // non-finite hole without tightening any legitimate, source-grounded value.
  // The fixture set is read from the directory, not a frozen list, so a public
  // fixture added later is covered automatically instead of silently skipped.
  const canonical = listFixtures("canonical")
  const snapshots = listFixtures("source-snapshot")

  it("the fixture directories are non-empty (the sweep below is not vacuous)", () => {
    expect(canonical.length).toBeGreaterThan(0)
    expect(snapshots.length).toBeGreaterThan(0)
  })

  for (const name of canonical) {
    it(`canonical fixture ${name} still parses`, () => {
      const result = CanonicalRecipe.safeParse(readFixture("canonical", name))
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    })
  }

  it("a finite range (min/max) is still accepted on both expression types", () => {
    expect(
      ValueExpression.safeParse({ sourceText: "0–200", kind: "range", minValue: 0, maxValue: 200 })
        .success,
    ).toBe(true)
    expect(
      DurationExpression.safeParse({
        sourceText: "10–12 min",
        kind: "range",
        minValue: 10,
        maxValue: 12,
        unit: "min",
      }).success,
    ).toBe(true)
  })

  // The source-snapshot fixtures carry no numeric quantity fields, but they share
  // the contract module; parsing them proves FIN touched nothing they rely on.
  for (const name of snapshots) {
    it(`source-snapshot fixture ${name} is unaffected by the schema module change`, () => {
      expect(SourceSnapshot.safeParse(readFixture("source-snapshot", name)).success).toBe(true)
    })
  }
})

describe("contract/decision-is-visible-at-the-boundary", () => {
  // Criterion 4: the decision must be readable where the field is declared, not
  // only inferable from a test. This checks the documentation half — the finite
  // constraint is applied and its rationale sits beside it. The enforcement half
  // — that no numeric field, in any spelling, escapes the constraint — is proved
  // behaviourally in contract/non-finite-values-decided, which discovers the
  // fields from the schema rather than grepping the source; a source grep for one
  // spelling would miss a field written another way (e.g. `.nullish()`).
  const commonSrc = readFileSync(join(repoRoot, "schema", "common.ts"), "utf8")

  it("the finite constraint is applied in the contract, not left to a default", () => {
    expect(commonSrc).toMatch(/\.finite\(\)/)
  })

  it("the rationale names the observed library behaviour at the declaration", () => {
    expect(commonSrc).toMatch(/NaN/)
    expect(commonSrc).toMatch(/Infinity/)
    expect(commonSrc).toMatch(/not a default/i)
  })
})
