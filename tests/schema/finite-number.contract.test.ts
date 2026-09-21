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
import { readFileSync } from "node:fs"
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

/** The three values `Number.isFinite` rejects — the whole non-finite set. */
const NON_FINITE: ReadonlyArray<readonly [string, number]> = [
  ["+Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["NaN", Number.NaN],
]

/** The free scalar quantity fields FIN constrains, on both expression types. */
const QUANTITY_FIELDS = ["value", "minValue", "maxValue"] as const

describe("contract/non-finite-values-decided", () => {
  // The behaviour of the boundary on every non-finite value, for every numeric
  // field of both expression types, is pinned. This nails Zod's observed
  // behaviour rather than trusting a default: were a future Zod to let one of the
  // three through `.finite()`, one of these turns red instead of the contract
  // silently widening.
  const cases: ReadonlyArray<
    readonly [string, typeof ValueExpression | typeof DurationExpression]
  > = [
    ["ValueExpression", ValueExpression],
    ["DurationExpression", DurationExpression],
  ]

  for (const [name, schema] of cases) {
    for (const field of QUANTITY_FIELDS) {
      for (const [label, n] of NON_FINITE) {
        it(`${name} rejects ${label} in ${field}`, () => {
          const result = schema.safeParse({ sourceText: "computed", kind: "exact", [field]: n })
          expect(result.success).toBe(false)
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
  const canonical = ["two-yields-nutrition.json", "ranges-and-qualitative.json"] as const
  const snapshots = [
    "basic.json",
    "freetext-heavy.json",
    "gappy.json",
    "structured-multi-component.json",
  ] as const

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
  // only inferable from this test. Enforced structurally against the contract
  // source: the finite constraint is applied at the declaration, no free scalar
  // field sits on the bare validator, and the rationale naming Zod's observed
  // behaviour sits beside it.
  const commonSrc = readFileSync(join(repoRoot, "schema", "common.ts"), "utf8")

  it("the finite constraint is applied in the contract, not left to a default", () => {
    expect(commonSrc).toMatch(/z\.number\(\)\.finite\(\)/)
  })

  it("no free scalar quantity field is left on the bare validator", () => {
    // Every non-finite hole in this module was `z.number().optional()`; all six
    // now read `FiniteNumber.optional()`. A regression to the bare validator
    // reintroduces the hole and fails here.
    expect(commonSrc).not.toMatch(/z\.number\(\)\.optional\(\)/)
  })

  it("the rationale names the observed library behaviour at the declaration", () => {
    expect(commonSrc).toMatch(/NaN/)
    expect(commonSrc).toMatch(/Infinity/)
    expect(commonSrc).toMatch(/not a default/i)
  })
})
