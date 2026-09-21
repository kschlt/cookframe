/**
 * CFV1-SL3 — the deterministic, versioned Schema.org mapping from the Canonical
 * Recipe, proving the offline half of Slice 3: the mapping semantics and their
 * one governing rule, omit-never-invent.
 *
 * Scope / honesty (mirrors tests/slice4/url-jsonld-mapping.test.ts). This suite
 * proves the mapping itself — determinism, versioning, omission over coercion,
 * and the missing-author compatibility state. It deliberately does NOT claim the
 * criteria that need the capability URL or the live Bring handoff
 * (`slice3/capability-url-*`, `slice3/bring-fixtures-green`,
 * `slice3/bring-integration-mechanism-recorded`) — those are the serving-layer
 * and Bring-handoff units, which need the HTTP layer (ADR-0007).
 *
 * Every Canonical Recipe below is synthetic and self-authored — no third-party
 * recipe text (the public-repo content rule). Each fixture is validated against
 * the contract with `CanonicalRecipe.parse` so the mapping is only ever exercised
 * on inputs the schema actually admits.
 */
import { describe, expect, it } from "vitest"
import {
  CanonicalRecipe,
  type DurationExpression,
  type RecipeTime,
  type RecipeYield,
  SCHEMA_VERSION,
  type ValueExpression,
} from "../../schema/index.js"
import {
  mapCanonicalToSchemaOrg,
  SCHEMA_ORG_MAPPING_VERSION,
} from "../../src/shopping/schema-org-mapping.js"

// --- fixture builders (synthetic, schema-valid) ---------------------------

const exactValue = (value: number, sourceText: string): ValueExpression => ({
  sourceText,
  kind: "exact",
  value,
})

const yieldOf = (
  over: Partial<RecipeYield> & { valueExpression: ValueExpression },
): RecipeYield => ({
  id: "y-1",
  sourceText: over.valueExpression.sourceText,
  scalingEligibility: "unknown",
  sourceRefs: [{ blockId: "b-yield" }],
  ...over,
})

const timeOf = (type: RecipeTime["type"], durationExpression: DurationExpression): RecipeTime => ({
  type,
  durationExpression,
  sourceRefs: [{ blockId: "b-time" }],
})

/**
 * A complete, schema-valid synthetic Canonical Recipe. Overrides let each test
 * vary exactly the facet it exercises while keeping the rest valid.
 */
const canonical = (over?: Partial<CanonicalRecipe>): CanonicalRecipe => {
  const base: CanonicalRecipe = {
    id: "recipe-1",
    schemaVersion: SCHEMA_VERSION,
    title: "Synthetic Test Loaf",
    authors: ["Fixture Author"],
    yields: [yieldOf({ valueExpression: exactValue(1, "1 loaf"), unit: "loaf" })],
    ingredientGroups: [
      {
        id: "ig-1",
        sourceRefs: [{ blockId: "b-ing" }],
        ingredients: [
          {
            id: "ing-1",
            sourceText: "200 g flour",
            name: "flour",
            qualifiers: [],
            scalingEligibility: "proportional",
            sourceRefs: [{ blockId: "b-ing" }],
          },
          {
            id: "ing-2",
            sourceText: "2-3 tbsp olive oil",
            name: "olive oil",
            qualifiers: [],
            scalingEligibility: "proportional",
            sourceRefs: [{ blockId: "b-ing" }],
          },
        ],
      },
    ],
    instructionSections: [
      {
        id: "is-1",
        sourceRefs: [{ blockId: "b-step" }],
        steps: [
          {
            id: "step-1",
            sourceText: "Mix and bake.",
            normalizedActionText: "Mix and bake.",
            sourceRefs: [{ blockId: "b-step" }],
            ingredientUses: [],
            componentUses: [],
            equipmentUses: [],
            producesComponents: [],
            durations: [],
            temperatures: [],
            donenessCues: [],
            prerequisiteCues: [],
            waitCues: [],
          },
        ],
      },
    ],
    provenance: {
      sourceSnapshotId: "snap-1",
      sourceSnapshotVersion: 0,
      targetOntologyVersion: "1.0.0",
      runId: "run-1",
    },
    ...over,
  }
  // Only ever map inputs the contract admits.
  return CanonicalRecipe.parse(base)
}

describe("slice3/deterministic-mapping", () => {
  it("produces the same output for the same Canonical Recipe", () => {
    const recipe = canonical()
    const a = mapCanonicalToSchemaOrg(recipe)
    const b = mapCanonicalToSchemaOrg(recipe)
    expect(a).toEqual(b)
    // Deterministic down to serialized field order (a third party reads the bytes).
    expect(JSON.stringify(a.recipe)).toBe(JSON.stringify(b.recipe))
  })

  it("emits a well-formed Schema.org/Recipe with the source facts", () => {
    const { recipe } = mapCanonicalToSchemaOrg(canonical())
    expect(recipe["@context"]).toBe("https://schema.org")
    expect(recipe["@type"]).toBe("Recipe")
    expect(recipe.name).toBe("Synthetic Test Loaf")
    expect(recipe.author).toEqual([{ "@type": "Person", name: "Fixture Author" }])
    // Ingredient lines are the source wording verbatim, in order.
    expect(recipe.recipeIngredient).toEqual(["200 g flour", "2-3 tbsp olive oil"])
    expect(recipe.recipeInstructions).toEqual([{ "@type": "HowToStep", text: "Mix and bake." }])
  })
})

describe("slice3/mapping-is-versioned", () => {
  it("carries an explicit version and records which version produced the output", () => {
    const result = mapCanonicalToSchemaOrg(canonical())
    expect(result.mappingVersion).toBe(SCHEMA_ORG_MAPPING_VERSION)
    expect(SCHEMA_ORG_MAPPING_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("slice3/range-omitted-not-coerced", () => {
  it("omits the number for a ranged yield, keeping the source wording, never a midpoint", () => {
    const rangedYield = canonical({
      yields: [
        yieldOf({
          valueExpression: {
            sourceText: "4-6 servings",
            kind: "range",
            minValue: 4,
            maxValue: 6,
          },
        }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(rangedYield)
    // The wording survives as plain text; no QuantitativeValue, no derived number.
    expect(recipe.recipeYield).toEqual(["4-6 servings"])
    const serialized = JSON.stringify(recipe.recipeYield)
    expect(serialized).not.toContain("QuantitativeValue")
    for (const n of ["4", "5", "6"]) expect(serialized.includes(`"value":${n}`)).toBe(false)
    expect(omissions).toContainEqual({
      field: "recipeYield",
      reason: "non_exact_value",
      sourceText: "4-6 servings",
      kind: "range",
    })
  })

  it("omits a ranged cook time rather than emit a bound or midpoint as a duration", () => {
    const rangedTime = canonical({
      times: [
        timeOf("cook", {
          sourceText: "10-12 min",
          kind: "range",
          minValue: 10,
          maxValue: 12,
          unit: "min",
        }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(rangedTime)
    expect(recipe.cookTime).toBeUndefined()
    expect(omissions).toContainEqual({
      field: "cookTime",
      reason: "non_exact_value",
      sourceText: "10-12 min",
      kind: "range",
    })
  })
})

describe("slice3/qualitative-omitted-not-coerced", () => {
  it("keeps a qualitative yield as wording and emits no number", () => {
    const qualitativeYield = canonical({
      yields: [
        yieldOf({
          valueExpression: {
            sourceText: "a generous batch",
            kind: "qualitative",
            qualifierText: "generous",
          },
        }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(qualitativeYield)
    expect(recipe.recipeYield).toEqual(["a generous batch"])
    expect(JSON.stringify(recipe.recipeYield)).not.toContain("QuantitativeValue")
    expect(omissions).toContainEqual({
      field: "recipeYield",
      reason: "non_exact_value",
      sourceText: "a generous batch",
      kind: "qualitative",
    })
  })
})

describe("slice3/open-ended-duration-omitted", () => {
  it("omits an open-ended duration (a minimum bound) rather than invent an endpoint", () => {
    // A MAPPED time type (total), so the omission goes through the duration
    // conversion's exactness check — not the unmapped-type short-circuit. This is
    // what makes the test discriminating: coercing minValue (8) to PT8H would fail
    // the reason assertion below.
    const openEnded = canonical({
      times: [
        timeOf("total", {
          sourceText: "at least 8 hours",
          kind: "minimum",
          minValue: 8,
          unit: "hours",
        }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(openEnded)
    expect(recipe.totalTime).toBeUndefined()
    expect(omissions).toContainEqual({
      field: "totalTime",
      reason: "non_exact_value",
      sourceText: "at least 8 hours",
      kind: "minimum",
    })
  })

  it("omits a time type that has no Schema.org field, recording it", () => {
    const rest = canonical({
      times: [
        timeOf("rest", { sourceText: "30 minutes", kind: "exact", value: 30, unit: "minutes" }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(rest)
    // Even an exactly-expressed rest time is omitted: there is no Schema.org field
    // for it, and inventing a mapping (e.g. folding it into totalTime) would be a
    // fabrication.
    expect(recipe.prepTime).toBeUndefined()
    expect(recipe.cookTime).toBeUndefined()
    expect(recipe.totalTime).toBeUndefined()
    expect(omissions).toContainEqual({
      field: "times.rest",
      reason: "unmapped_time_type",
      sourceText: "30 minutes",
      kind: "exact",
    })
  })

  it("fills a shared Schema.org field once and omits the later same-field time", () => {
    // cook and bake both target cookTime; the first in source order fills it, the
    // second is omitted and recorded — never merged or summed into one number.
    const both = canonical({
      times: [
        timeOf("cook", { sourceText: "20 minutes", kind: "exact", value: 20, unit: "minutes" }),
        timeOf("bake", { sourceText: "40 minutes", kind: "exact", value: 40, unit: "minutes" }),
      ],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(both)
    expect(recipe.cookTime).toBe("PT20M")
    expect(omissions).toContainEqual({
      field: "cookTime",
      reason: "duplicate_time_type",
      sourceText: "40 minutes",
      kind: "exact",
    })
  })

  it('omits a qualitative duration such as "overnight"', () => {
    const overnight = canonical({
      times: [timeOf("total", { sourceText: "overnight", kind: "qualitative" })],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(overnight)
    expect(recipe.totalTime).toBeUndefined()
    expect(omissions).toContainEqual({
      field: "totalTime",
      reason: "non_exact_value",
      sourceText: "overnight",
      kind: "qualitative",
    })
  })

  it("maps an exact duration to an ISO 8601 string (the discriminating positive case)", () => {
    const exact = canonical({
      times: [
        timeOf("prep", { sourceText: "15 minutes", kind: "exact", value: 15, unit: "minutes" }),
        timeOf("cook", { sourceText: "1.5 h", kind: "exact", value: 1.5, unit: "h" }),
      ],
    })
    const { recipe } = mapCanonicalToSchemaOrg(exact)
    expect(recipe.prepTime).toBe("PT15M")
    expect(recipe.cookTime).toBe("PT1H30M")
  })

  it("omits an exact duration whose unit it cannot safely convert", () => {
    const weird = canonical({
      times: [timeOf("prep", { sourceText: "2 moons", kind: "exact", value: 2, unit: "moons" })],
    })
    const { recipe, omissions } = mapCanonicalToSchemaOrg(weird)
    expect(recipe.prepTime).toBeUndefined()
    expect(omissions).toContainEqual({
      field: "prepTime",
      reason: "unrecognized_unit",
      sourceText: "2 moons",
      kind: "exact",
    })
  })
})

describe("slice3/missing-author-explicit-state", () => {
  it("represents a recipe with no authors as the explicit absent state, inventing nothing", () => {
    const { recipe, authorState } = mapCanonicalToSchemaOrg(canonical({ authors: undefined }))
    expect(authorState).toBe("absent")
    expect("author" in recipe).toBe(false)
  })

  it("treats an empty-string author as absent, never as an empty or placeholder value", () => {
    const { recipe, authorState } = mapCanonicalToSchemaOrg(canonical({ authors: ["", "   "] }))
    expect(authorState).toBe("absent")
    expect("author" in recipe).toBe(false)
  })

  it("marks a present author explicitly and carries only the real names", () => {
    const { recipe, authorState } = mapCanonicalToSchemaOrg(
      canonical({ authors: ["Ada", "", "Grace"] }),
    )
    expect(authorState).toBe("present")
    expect(recipe.author).toEqual([
      { "@type": "Person", name: "Ada" },
      { "@type": "Person", name: "Grace" },
    ])
  })

  it("maps an exact yield to a QuantitativeValue carrying the number and wording", () => {
    const { recipe } = mapCanonicalToSchemaOrg(canonical())
    expect(recipe.recipeYield).toEqual([
      { "@type": "QuantitativeValue", value: 1, unitText: "loaf", name: "1 loaf" },
    ])
  })
})
