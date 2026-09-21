/**
 * The deterministic, versioned Schema.org mapping from the Canonical Recipe
 * (CFV1-SL3). This is the shopping path's interchange format: a third party
 * (Bring) fetches a Schema.org/Recipe representation of a saved recipe, so this
 * module turns a {@link CanonicalRecipe} into a plain Schema.org/Recipe object.
 *
 * The one rule that governs every field is **omit, never coerce** (PDR-0001;
 * CFV1-SL3 "What NOT"). A range, a qualitative quantity or an open-ended duration
 * forced into a single number to satisfy the mapping is a fabrication the user
 * cannot see, so a value reaches a Schema.org numeric field ONLY when the source
 * expressed it exactly; otherwise the number is omitted and, where the field
 * still admits free text, the source wording is preserved verbatim. A missing
 * author is an explicit compatibility STATE, never a value: no placeholder, no
 * empty string, no fabricated name (S3 Q1 — Bring itself never fabricates one).
 *
 * The mapping is **versioned** ({@link SCHEMA_ORG_MAPPING_VERSION}) because its
 * output is consumed by a third party whose behaviour is observed, not
 * guaranteed; the result records the version that produced it so a later change
 * is attributable. The function is pure and deterministic: the same Canonical
 * Recipe always yields the same result, with no clock, no randomness and stable
 * field order.
 *
 * Scope: this module is the mapping only. Serving it at a capability URL and the
 * Bring handoff proper are separate CFV1-SL3 units; this one takes no network
 * primitive (it lives outside `src/security/`) and declares no contract shape
 * (the contract lives only in `schema/`).
 */

import type {
  CanonicalRecipe,
  DurationExpression,
  RecipeTime,
  RecipeYield,
  ValueExpressionKind,
} from "../../schema/index.js"

/** The mapping's own version, independent of the contract's `SCHEMA_VERSION`. */
export const SCHEMA_ORG_MAPPING_VERSION = "1.0.0" as const

// --- The Schema.org/Recipe shape this mapping emits (a plain JSON-LD object) ---
// These are output DTOs, not the Cookframe contract, so they are plain TS
// interfaces declared here rather than Zod object schemas in `schema/`. The
// contract's single source of truth is unaffected, and the guard that keeps
// contract-shape declarations inside `schema/` still holds for this module.

export interface SchemaOrgPerson {
  readonly "@type": "Person"
  readonly name: string
}

/** A Schema.org QuantitativeValue — emitted only for an exact, numeric value. */
export interface SchemaOrgQuantitativeValue {
  readonly "@type": "QuantitativeValue"
  readonly value: number
  readonly unitText?: string
  /** The source wording, retained alongside the exact number. */
  readonly name: string
}

export interface SchemaOrgHowToStep {
  readonly "@type": "HowToStep"
  readonly text: string
}

/** A yield entry: an exact one carries a number; any other is source text only. */
export type SchemaOrgYield = string | SchemaOrgQuantitativeValue

export interface SchemaOrgRecipe {
  readonly "@context": "https://schema.org"
  readonly "@type": "Recipe"
  readonly name: string
  readonly description?: string
  /** Present only when the source named an author; omitted otherwise. */
  readonly author?: readonly SchemaOrgPerson[]
  readonly recipeIngredient?: readonly string[]
  readonly recipeInstructions?: readonly SchemaOrgHowToStep[]
  readonly recipeYield?: readonly SchemaOrgYield[]
  /** ISO 8601 durations — present only for an exactly-expressed duration. */
  readonly prepTime?: string
  readonly cookTime?: string
  readonly totalTime?: string
}

/** Why a field (or a numeric value) was omitted rather than coerced. */
export type OmissionReason =
  | "non_exact_value"
  | "unrecognized_unit"
  | "unmapped_time_type"
  | "duplicate_time_type"

export interface SchemaOrgMappingOmission {
  readonly field: string
  readonly reason: OmissionReason
  readonly sourceText: string
  readonly kind?: ValueExpressionKind
}

/**
 * Whether the source named an author. `absent` is the explicit compatibility
 * state that stands in for a missing author — the mapping never invents one.
 */
export type AuthorCompatibilityState = "present" | "absent"

export interface SchemaOrgMappingResult {
  readonly recipe: SchemaOrgRecipe
  /** The mapping version that produced `recipe`. */
  readonly mappingVersion: typeof SCHEMA_ORG_MAPPING_VERSION
  readonly authorState: AuthorCompatibilityState
  /** Every value the mapping omitted rather than coerce, with its reason. */
  readonly omissions: readonly SchemaOrgMappingOmission[]
}

// --- duration conversion --------------------------------------------------

const SECONDS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ["s", 1],
  ["sec", 1],
  ["secs", 1],
  ["second", 1],
  ["seconds", 1],
  ["sek", 1],
  ["sekunde", 1],
  ["sekunden", 1],
  ["m", 60],
  ["min", 60],
  ["mins", 60],
  ["minute", 60],
  ["minutes", 60],
  ["minuten", 60],
  ["h", 3600],
  ["hr", 3600],
  ["hrs", 3600],
  ["hour", 3600],
  ["hours", 3600],
  ["std", 3600],
  ["stunde", 3600],
  ["stunden", 3600],
  ["d", 86400],
  ["day", 86400],
  ["days", 86400],
  ["tag", 86400],
  ["tage", 86400],
])

/**
 * Convert a duration to an ISO 8601 string ONLY when the source expressed it
 * exactly and its unit is recognized. A range, an approximation, an open-ended
 * bound ("overnight", "at least 2 h") or an unrecognized unit yields `undefined`
 * — the caller omits the field rather than invent a number. The reason is
 * returned so the omission can be recorded.
 */
function toIsoDuration(
  d: DurationExpression,
): { iso: string } | { omit: Extract<OmissionReason, "non_exact_value" | "unrecognized_unit"> } {
  if (d.kind !== "exact" || d.value === undefined) return { omit: "non_exact_value" }
  const unitSeconds =
    d.unit === undefined ? undefined : SECONDS_PER_UNIT.get(d.unit.trim().toLowerCase())
  if (unitSeconds === undefined) return { omit: "unrecognized_unit" }
  const totalSeconds = Math.round(d.value * unitSeconds)
  if (totalSeconds <= 0) return { omit: "non_exact_value" }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  let iso = "PT"
  if (hours > 0) iso += `${hours}H`
  if (minutes > 0) iso += `${minutes}M`
  if (seconds > 0) iso += `${seconds}S`
  return { iso }
}

/** The Canonical time types that map to each Schema.org time field, in priority order. */
const TIME_FIELD_BY_TYPE: ReadonlyMap<RecipeTime["type"], "prepTime" | "cookTime" | "totalTime"> =
  new Map([
    ["prep", "prepTime"],
    ["cook", "cookTime"],
    ["bake", "cookTime"],
    ["total", "totalTime"],
  ])

// --- yield mapping --------------------------------------------------------

/**
 * Map one Canonical yield. An exactly-expressed yield becomes a QuantitativeValue
 * carrying the number and its source wording; any other kind (range, qualitative,
 * approximate, …) becomes the source text alone — the number is omitted, never
 * derived from a range's bounds.
 */
function mapYield(y: RecipeYield): { value: SchemaOrgYield; omission?: SchemaOrgMappingOmission } {
  const ve = y.valueExpression
  if (ve.kind === "exact" && ve.value !== undefined) {
    const qv: SchemaOrgQuantitativeValue = {
      "@type": "QuantitativeValue",
      value: ve.value,
      ...(y.unit !== undefined ? { unitText: y.unit } : {}),
      name: y.sourceText,
    }
    return { value: qv }
  }
  return {
    value: y.sourceText,
    omission: {
      field: "recipeYield",
      reason: "non_exact_value",
      sourceText: y.sourceText,
      kind: ve.kind,
    },
  }
}

// --- the mapping ----------------------------------------------------------

/**
 * Map a {@link CanonicalRecipe} to a Schema.org/Recipe object, omitting rather
 * than coercing every non-exact quantity and duration and representing a missing
 * author as an explicit state. Deterministic and versioned.
 */
export function mapCanonicalToSchemaOrg(recipe: CanonicalRecipe): SchemaOrgMappingResult {
  const omissions: SchemaOrgMappingOmission[] = []

  // Author: source-provided only. Empty/blank names are dropped, and if nothing
  // remains the field is omitted and the state is `absent` — never invented.
  const authorNames = (recipe.authors ?? []).map((a) => a.trim()).filter((a) => a.length > 0)
  const authorState: AuthorCompatibilityState = authorNames.length > 0 ? "present" : "absent"
  const author = authorNames.map((name): SchemaOrgPerson => ({ "@type": "Person", name }))

  // Ingredients: the source wording verbatim, in canonical order. Reconstructing
  // a line from the parsed quantity risks coercing a range/qualitative amount, so
  // the source text is used as-is (it already carries whatever the source wrote).
  const recipeIngredient = recipe.ingredientGroups
    .flatMap((g) => g.ingredients)
    .map((i) => i.sourceText)
    .filter((t) => t.trim().length > 0)

  // Instructions: the source wording of each step, in section/step order.
  const recipeInstructions = recipe.instructionSections
    .flatMap((s) => s.steps)
    .map((step): SchemaOrgHowToStep => ({ "@type": "HowToStep", text: step.sourceText }))
    .filter((s) => s.text.trim().length > 0)

  // Yields: every yield preserved in order; exact ones carry a number.
  const recipeYield: SchemaOrgYield[] = []
  for (const y of recipe.yields) {
    const { value, omission } = mapYield(y)
    recipeYield.push(value)
    if (omission !== undefined) omissions.push(omission)
  }

  // Times: map the recognized types to ISO 8601, exact durations only. A second
  // time of an already-filled field, and a type with no Schema.org field, are
  // omitted (recorded), never merged or summed.
  const times: { prepTime?: string; cookTime?: string; totalTime?: string } = {}
  for (const t of recipe.times ?? []) {
    const field = TIME_FIELD_BY_TYPE.get(t.type)
    if (field === undefined) {
      omissions.push({
        field: `times.${t.type}`,
        reason: "unmapped_time_type",
        sourceText: t.durationExpression.sourceText,
        kind: t.durationExpression.kind,
      })
      continue
    }
    if (times[field] !== undefined) {
      omissions.push({
        field,
        reason: "duplicate_time_type",
        sourceText: t.durationExpression.sourceText,
        kind: t.durationExpression.kind,
      })
      continue
    }
    const converted = toIsoDuration(t.durationExpression)
    if ("iso" in converted) {
      times[field] = converted.iso
    } else {
      omissions.push({
        field,
        reason: converted.omit,
        sourceText: t.durationExpression.sourceText,
        kind: t.durationExpression.kind,
      })
    }
  }

  const schemaRecipe: SchemaOrgRecipe = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    ...(recipe.description !== undefined ? { description: recipe.description } : {}),
    ...(author.length > 0 ? { author } : {}),
    ...(recipeIngredient.length > 0 ? { recipeIngredient } : {}),
    ...(recipeInstructions.length > 0 ? { recipeInstructions } : {}),
    ...(recipeYield.length > 0 ? { recipeYield } : {}),
    ...(times.prepTime !== undefined ? { prepTime: times.prepTime } : {}),
    ...(times.cookTime !== undefined ? { cookTime: times.cookTime } : {}),
    ...(times.totalTime !== undefined ? { totalTime: times.totalTime } : {}),
  }

  return {
    recipe: schemaRecipe,
    mappingVersion: SCHEMA_ORG_MAPPING_VERSION,
    authorState,
    omissions,
  }
}
