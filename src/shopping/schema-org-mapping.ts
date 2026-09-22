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
  /**
   * Present only when the source named the recipe; omitted otherwise, with
   * {@link SchemaOrgMappingResult.titleState} saying so.
   *
   * Schema.org wants a `name` on a Recipe and this mapping still will not
   * supply one it does not have. A consumer reading a nameless Recipe knows it
   * has no name; a consumer reading a name taken from the method is told
   * something false about the source, and cannot tell. That is the same
   * omit-never-coerce trade every other field here makes.
   */
  readonly name?: string
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
  | "missing_unit"
  | "unrecognized_unit"
  | "not_representable"
  | "unmapped_time_type"
  | "duplicate_time_type"
  | "blank_source_text"
  | "not_in_source"

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

/**
 * Whether the source named the recipe. The same explicit shape as
 * {@link AuthorCompatibilityState}, for the field the contract used to demand.
 */
export type TitleCompatibilityState = "present" | "absent"

export interface SchemaOrgMappingResult {
  readonly recipe: SchemaOrgRecipe
  /** The mapping version that produced `recipe`. */
  readonly mappingVersion: typeof SCHEMA_ORG_MAPPING_VERSION
  readonly authorState: AuthorCompatibilityState
  readonly titleState: TitleCompatibilityState
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
 * How close a converted duration must be to a whole number of seconds to count
 * as exactly representable. Floating-point multiplication is not exact, so a
 * literal `Number.isInteger` test would omit durations the source did state
 * exactly. The tolerance is absolute and nine orders of magnitude below one
 * second, which no source wording can reach: it forgives representation error
 * and nothing else.
 *
 * Which products actually miss is not obvious, and guessing at one is how this
 * comment was wrong before: it claimed `0.1 * 3600` is `360.00000000000006`,
 * and it is exactly `360`. The measured counter-cases, the ones that make this
 * constant load-bearing rather than decorative, are `1.1 h` (`3960.0000000000005`),
 * `2.2 h` (`7920.000000000001`) and `4.1 min` (`245.99999999999997`). Each is a
 * duration a source can plainly write, and each would be omitted as
 * unrepresentable without the tolerance. `slice3/omission-is-recorded-and-exact`
 * holds one of them as a proof, so deleting this constant turns a test red
 * instead of passing unnoticed.
 */
const SECOND_TOLERANCE = 1e-9

/**
 * Convert a duration to an ISO 8601 string ONLY when the source expressed it
 * exactly, its unit is recognized, and the result is a whole number of seconds.
 * A range, an approximation, an open-ended bound ("overnight", "at least 2 h"),
 * a missing or unrecognized unit, or a value that is not representable as a
 * positive ISO duration yields `undefined` — the caller omits the field rather
 * than invent a number. The reason is returned so the omission can be recorded.
 *
 * The last of those conditions is the one that is easy to get wrong. Rounding to
 * the nearest second looks harmless and is not: "2.5 seconds" would publish as
 * `PT3S` with no omission recorded, which is a number nobody wrote appearing
 * silently in the one module whose whole rule is omit-never-coerce. ISO 8601
 * durations have no sub-second form here, so a sub-second residue is omitted.
 */
function toIsoDuration(d: DurationExpression):
  | { iso: string }
  | {
      omit: Extract<
        OmissionReason,
        "non_exact_value" | "missing_unit" | "unrecognized_unit" | "not_representable"
      >
    } {
  if (d.kind !== "exact" || d.value === undefined) return { omit: "non_exact_value" }
  if (d.unit === undefined || d.unit.trim().length === 0) return { omit: "missing_unit" }
  const unitSeconds = SECONDS_PER_UNIT.get(d.unit.trim().toLowerCase())
  if (unitSeconds === undefined) return { omit: "unrecognized_unit" }

  const exactSeconds = d.value * unitSeconds
  // Finiteness first, and as its own check rather than as a side effect of the
  // two below. `NaN` defeats every comparison — `Math.abs(NaN - NaN) > x` is
  // false and `NaN <= 0` is false — so a non-finite value would fall through to
  // the ISO builder and publish `PTInfinityH` or a bare `PT` with nothing
  // recorded. `-Infinity` happens to be caught by the positivity check, and
  // that asymmetry is the tell that it was luck rather than a decision.
  if (!Number.isFinite(exactSeconds)) return { omit: "not_representable" }
  const totalSeconds = Math.round(exactSeconds)
  // Not a whole number of seconds, so no ISO duration says what the source said.
  if (Math.abs(exactSeconds - totalSeconds) > SECOND_TOLERANCE) {
    return { omit: "not_representable" }
  }
  // Zero and negative durations have no positive ISO form; `PT` alone is not one.
  if (totalSeconds <= 0) return { omit: "not_representable" }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  let iso = "PT"
  if (hours > 0) iso += `${hours}H`
  if (minutes > 0) iso += `${minutes}M`
  if (seconds > 0) iso += `${seconds}S`
  return { iso }
}

/**
 * Which Schema.org time field each Canonical time type fills. `cook` and `bake`
 * share `cookTime`; when both are present the first in the recipe's `times` array
 * order CLAIMS it and the later one is omitted (recorded as a duplicate), never
 * merged. Claiming happens on the attempt, not on the conversion: a ranged `cook`
 * followed by an exact `bake` must not publish the bake duration as `cookTime`,
 * because that would tell the consumer a cook time the source never stated — it
 * stated a range. A type absent from this map has no Schema.org field and is
 * omitted.
 */
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

  // Title: a declared gap is carried across as a gap. The omission is recorded
  // for the same reason a dropped ingredient is — a page that quietly has no
  // name is as misleading as one with a borrowed name, and the record is what
  // lets a caller tell "no name" from "the mapping lost it".
  const titleState: TitleCompatibilityState =
    recipe.title.state === "from_source" ? "present" : "absent"
  if (recipe.title.state !== "from_source") {
    omissions.push({ field: "name", reason: "not_in_source", sourceText: "" })
  }

  // Author: source-provided only. Empty/blank names are dropped, and if nothing
  // remains the field is omitted and the state is `absent` — never invented.
  const authorNames = (recipe.authors ?? []).map((a) => a.trim()).filter((a) => a.length > 0)
  const authorState: AuthorCompatibilityState = authorNames.length > 0 ? "present" : "absent"
  const author = authorNames.map((name): SchemaOrgPerson => ({ "@type": "Person", name }))

  // Ingredients: the source wording verbatim, in canonical order. Reconstructing
  // a line from the parsed quantity risks coercing a range/qualitative amount, so
  // the source text is used as-is (it already carries whatever the source wrote).
  const recipeIngredient: string[] = []
  for (const ingredient of recipe.ingredientGroups.flatMap((g) => g.ingredients)) {
    if (ingredient.sourceText.trim().length > 0) {
      recipeIngredient.push(ingredient.sourceText)
      continue
    }
    // A dropped ingredient is a missing shopping-list line, so it is recorded
    // rather than filtered away: omit-never-invent cuts both ways, and a list
    // that is quietly short is as misleading as one with an invented number.
    omissions.push({
      field: "recipeIngredient",
      reason: "blank_source_text",
      sourceText: ingredient.name,
    })
  }

  // Instructions: the source wording of each step, in section/step order.
  const recipeInstructions: SchemaOrgHowToStep[] = []
  for (const step of recipe.instructionSections.flatMap((s) => s.steps)) {
    if (step.sourceText.trim().length > 0) {
      recipeInstructions.push({ "@type": "HowToStep", text: step.sourceText })
      continue
    }
    omissions.push({
      field: "recipeInstructions",
      reason: "blank_source_text",
      sourceText: step.normalizedActionText,
    })
  }

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
  // Which fields a time entry has already claimed, whether or not its duration
  // converted. Tracked separately from `times`, because a field left empty by an
  // omitted duration is still spoken for by the entry that omitted it.
  const claimed = new Set<"prepTime" | "cookTime" | "totalTime">()
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
    if (claimed.has(field)) {
      omissions.push({
        field,
        reason: "duplicate_time_type",
        sourceText: t.durationExpression.sourceText,
        kind: t.durationExpression.kind,
      })
      continue
    }
    claimed.add(field)
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
    ...(recipe.title.state === "from_source" ? { name: recipe.title.sourceText } : {}),
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
    titleState,
    omissions,
  }
}
