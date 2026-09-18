import { z } from "zod"
import { Cue, DurationExpression, SourceRef, ValueExpression } from "./common.js"
import { SCHEMA_VERSION } from "./version.js"

/**
 * Layer B — the normalized, provider-independent Canonical Recipe: the recipe
 * FACTS the source describes, not UX interpretation (recipe-ontology §3 Layer B,
 * §5). Every object is `.strict()`: an unknown key is rejected, which is the
 * structural guard behind "do not invent" (§5). Derived judgements (nutrition
 * inference, classifications, scaling beyond source evidence) are deliberately
 * NOT modelled here — they belong to replaceable derived layers (§5, §11).
 */

// --- §5.1 source-provided classifications ---------------------------------
export const ClassificationKind = z.enum([
  "cuisine",
  "category",
  "meal_type",
  "diet",
  "difficulty",
  "keyword",
  "cooking_method",
  "other",
])

export const SourceClassification = z
  .object({
    kind: ClassificationKind,
    sourceText: z.string(),
    normalizedValue: z.string().optional(),
    vocabulary: z.string().optional(),
    identifier: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type SourceClassification = z.infer<typeof SourceClassification>

// --- §5.3 yields ----------------------------------------------------------
export const YieldScalingEligibility = z.enum(["allowed", "disallowed", "unknown"])

export const RecipeYield = z
  .object({
    id: z.string().min(1),
    sourceText: z.string(),
    valueExpression: ValueExpression,
    unit: z.string().optional(),
    contextText: z.string().optional(),
    /** Conservative, versioned derived policy; defaults to unknown (§5.3, §5.9). */
    scalingEligibility: YieldScalingEligibility,
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type RecipeYield = z.infer<typeof RecipeYield>

// --- §5.4 times -----------------------------------------------------------
export const TimeType = z.enum([
  "prep",
  "cook",
  "bake",
  "rest",
  "marinate",
  "chill",
  "total",
  "active",
  "passive",
  "other",
])

export const RecipeTime = z
  .object({
    type: TimeType,
    sourceLabel: z.string().optional(),
    durationExpression: DurationExpression,
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type RecipeTime = z.infer<typeof RecipeTime>

// --- §5.5 equipment -------------------------------------------------------
export const Equipment = z
  .object({
    id: z.string().min(1),
    sourceText: z.string(),
    name: z.string(),
    quantityExpression: ValueExpression.optional(),
    qualifiers: z.array(z.string()),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type Equipment = z.infer<typeof Equipment>

// --- §5.6 ingredients -----------------------------------------------------
export const IngredientScalingEligibility = z.enum(["proportional", "non_scalable", "unknown"])

export const Ingredient = z
  .object({
    id: z.string().min(1),
    sourceText: z.string(),
    quantityExpression: ValueExpression.optional(),
    unit: z.string().optional(),
    name: z.string(),
    qualifiers: z.array(z.string()),
    optional: z.boolean().optional(),
    scalingEligibility: IngredientScalingEligibility,
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type Ingredient = z.infer<typeof Ingredient>

export const IngredientGroup = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    sourceRefs: z.array(SourceRef),
    ingredients: z.array(Ingredient),
  })
  .strict()
export type IngredientGroup = z.infer<typeof IngredientGroup>

// --- §5.7 prepared components + instruction steps -------------------------
export const PreparedComponent = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    createdByStepId: z.string().min(1),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type PreparedComponent = z.infer<typeof PreparedComponent>

export const UsageKind = z.enum([
  "use_now",
  "reserve_for_later",
  "use_remaining",
  "use_partial_unspecified",
  "use_all",
])

export const IngredientUse = z
  .object({
    ingredientId: z.string().min(1),
    usage: UsageKind,
    quantityExpression: ValueExpression.optional(),
    unit: z.string().optional(),
    sourceText: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type IngredientUse = z.infer<typeof IngredientUse>

export const ComponentUse = z
  .object({
    componentId: z.string().min(1),
    usage: UsageKind,
    quantityExpression: ValueExpression.optional(),
    unit: z.string().optional(),
    sourceText: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type ComponentUse = z.infer<typeof ComponentUse>

export const EquipmentUse = z
  .object({
    equipmentId: z.string().min(1),
    sourceText: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type EquipmentUse = z.infer<typeof EquipmentUse>

export const Temperature = z
  .object({
    sourceText: z.string(),
    valueExpression: ValueExpression,
    unit: z.string().optional(),
    contextText: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type Temperature = z.infer<typeof Temperature>

export const StepDuration = z
  .object({
    durationExpression: DurationExpression,
    sourceLabel: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type StepDuration = z.infer<typeof StepDuration>

export const InstructionStep = z
  .object({
    id: z.string().min(1),
    sourceText: z.string(),
    /** Formatting/segmentation cleanup only — never a culinary change (§5.7). */
    normalizedActionText: z.string(),
    sourceRefs: z.array(SourceRef),
    ingredientUses: z.array(IngredientUse),
    componentUses: z.array(ComponentUse),
    equipmentUses: z.array(EquipmentUse),
    producesComponents: z.array(z.string().min(1)),
    durations: z.array(StepDuration),
    temperatures: z.array(Temperature),
    donenessCues: z.array(Cue),
    prerequisiteCues: z.array(Cue),
    waitCues: z.array(Cue),
  })
  .strict()
export type InstructionStep = z.infer<typeof InstructionStep>

export const InstructionSection = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    sourceRefs: z.array(SourceRef),
    steps: z.array(InstructionStep),
  })
  .strict()
export type InstructionSection = z.infer<typeof InstructionSection>

// --- §5.8 source-provided nutrition ---------------------------------------
export const NutritionBasisKind = z.enum([
  "whole_recipe",
  "per_yield",
  "per_serving",
  "per_quantity",
  "other",
  "unknown",
])

export const NutritionBasis = z
  .object({
    kind: NutritionBasisKind,
    yieldRef: z.string().optional(),
    quantityExpression: ValueExpression.optional(),
    unit: z.string().optional(),
    sourceText: z.string().optional(),
  })
  .strict()
export type NutritionBasis = z.infer<typeof NutritionBasis>

export const Nutrient = z.enum([
  "energy",
  "protein",
  "carbohydrate",
  "fat",
  "fiber",
  "sugar",
  "sodium",
  "cholesterol",
  "saturated_fat",
  "trans_fat",
  "other",
])

export const NutritionFact = z
  .object({
    nutrient: Nutrient,
    sourceLabel: z.string().optional(),
    valueExpression: ValueExpression,
    unit: z.string().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type NutritionFact = z.infer<typeof NutritionFact>

export const NutritionStatement = z
  .object({
    id: z.string().min(1),
    sourceText: z.string().optional(),
    basis: NutritionBasis,
    facts: z.array(NutritionFact),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type NutritionStatement = z.infer<typeof NutritionStatement>

// --- §7 media -------------------------------------------------------------
export const HeroImageOrigin = z.enum(["source_url", "user_added", "other"])

export const RecipeMedia = z
  .object({
    heroImage: z
      .object({
        storageIdentity: z.string().min(1),
        origin: HeroImageOrigin,
        originalSourceUrl: z.string().optional(),
        attribution: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type RecipeMedia = z.infer<typeof RecipeMedia>

// --- §4 normalization-run provenance --------------------------------------
export const NormalizationProvenance = z
  .object({
    sourceSnapshotId: z.string().min(1),
    sourceSnapshotVersion: z.number().int().nonnegative(),
    normalizationModel: z.string().optional(),
    normalizationPromptVersions: z.array(z.string()).optional(),
    targetOntologyVersion: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict()
export type NormalizationProvenance = z.infer<typeof NormalizationProvenance>

// --- §5 the Canonical Recipe ----------------------------------------------
export const CanonicalRecipe = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    title: z.string(),
    description: z.string().optional(),
    /** Source-provided only; a missing author stays missing (§5.1). */
    authors: z.array(z.string()).optional(),
    sourcePublisher: z.string().optional(),
    sourceName: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourceClassifications: z.array(SourceClassification).optional(),
    /** Multiple contextual yields are preserved, never collapsed (§5.3). */
    yields: z.array(RecipeYield),
    times: z.array(RecipeTime).optional(),
    equipment: z.array(Equipment).optional(),
    ingredientGroups: z.array(IngredientGroup),
    preparedComponents: z.array(PreparedComponent).optional(),
    instructionSections: z.array(InstructionSection),
    nutritionStatements: z.array(NutritionStatement).optional(),
    media: RecipeMedia.optional(),
    provenance: NormalizationProvenance,
  })
  .strict()
export type CanonicalRecipe = z.infer<typeof CanonicalRecipe>
