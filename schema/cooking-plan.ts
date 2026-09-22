import { z } from "zod"
import { SourceRef } from "./common.js"

/**
 * The derived Cooking Plan (CFV1-SL6) — the replaceable layer above the
 * Canonical Recipe (recipe-ontology §3, §11). The Canonical is authoritative:
 * where the two disagree, the plan is wrong, so this contract is written so
 * that most ways of disagreeing cannot be expressed.
 *
 * Three properties are structural here rather than checked downstream:
 *
 * 1. **No numbers.** Every amount, duration and temperature crosses into a plan
 *    as an already-worded `string`, taken from the Canonical's own
 *    `sourceText`. There is no `value`, `minValue` or `maxValue` anywhere below,
 *    so a deriver or a renderer cannot round "1–2 tsp" to 1.5 or put a figure on
 *    "a splash" — the numbers are not on the types they receive. That is the
 *    same guard `src/render/view-model.ts` uses for Slice 2, for the same
 *    reason, and it is what makes `slice6/no-amount-changes` and
 *    `slice6/no-temperature-changes` properties of the shape.
 *
 * 2. **Every fact carries its origin.** Each element below holds a
 *    {@link CanonicalOrigin} naming the Canonical element it came from. A plan
 *    element with no origin is not a plan element that renders badly; it is
 *    unrepresentable, so derivation fails instead (`slice6/…-traces-to-canonical`).
 *
 * 3. **A split or reserved amount is its own type.** {@link SplitAmount} and
 *    {@link ReservedAmount} are not {@link PlanAmount} with a flag: they are
 *    separate members of {@link UnitAmount}'s union, carried in their own
 *    fields. A renderer that showed one as an ordinary quantity would have to
 *    reach into the wrong field to do it. Missing a split silently is the
 *    failure this slice is written around, so it is closed in the type.
 */

// --- traceability ---------------------------------------------------------

/**
 * Which Canonical element a plan element derives from. `id` is the Canonical
 * id of that element; for the shapes the contract gives no id of their own —
 * cues, durations and temperatures — it is the id of the step that carries
 * them, and `index` is the position in that step's array. `sourceRefs` are the
 * Canonical's own, carried through unchanged, so a plan fact can be followed
 * all the way back to the captured evidence.
 */
export const CanonicalElementKind = z.enum([
  "step",
  "ingredient",
  "equipment",
  "preparedComponent",
  "stepPrerequisiteCue",
  "stepDoneness",
  "stepWait",
  "stepDuration",
  "stepTemperature",
])
export type CanonicalElementKind = z.infer<typeof CanonicalElementKind>

export const CanonicalOrigin = z
  .object({
    element: CanonicalElementKind,
    id: z.string().min(1),
    index: z.number().int().nonnegative().optional(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type CanonicalOrigin = z.infer<typeof CanonicalOrigin>

// --- amounts --------------------------------------------------------------

/**
 * An amount a unit needs, in the source's own wording. `measurable` is not a
 * judgement made here: it records whether the Canonical's expression carried a
 * figure at all, which S4 established is already decided upstream, because
 * conversion omits a qualitative amount rather than coercing it to a number.
 * The renderer uses it to keep `to taste` out of the quantity position, where
 * S4's real-device pass found it reads as a count.
 */
export const PlanAmount = z
  .object({
    /** The source's wording of the quantity, with its unit. Empty when the source gave none. */
    text: z.string(),
    /** What the amount is of, as the Canonical names it. */
    itemText: z.string(),
    measurable: z.boolean(),
    origin: CanonicalOrigin,
  })
  .strict()
export type PlanAmount = z.infer<typeof PlanAmount>

/**
 * Part of an ingredient or component is used here and the rest is not — the
 * Canonical's `use_partial_unspecified` and `use_remaining`. Its own type, not
 * a flag, so it cannot be rendered through the ordinary-quantity path.
 */
export const SplitAmount = z
  .object({
    amount: PlanAmount,
    /** Which half of the split this use is. */
    portion: z.enum(["part_of", "remaining"]),
    /** The whole the part is taken from, worded as the Canonical words it. */
    wholeText: z.string(),
  })
  .strict()
export type SplitAmount = z.infer<typeof SplitAmount>

/**
 * An amount held back for a later unit — the Canonical's `reserve_for_later`.
 * Its own type for the same reason as {@link SplitAmount}.
 */
export const ReservedAmount = z
  .object({
    amount: PlanAmount,
    /** The unit that needs it later, when the Canonical says which. */
    neededAtUnit: z.number().int().positive().optional(),
  })
  .strict()
export type ReservedAmount = z.infer<typeof ReservedAmount>

// --- before you start -----------------------------------------------------

/**
 * A prerequisite that must already hold when a later unit begins — a
 * `prerequisiteCue` of a step that is not the first, which no earlier step
 * produces. S4's admission rule has three legs; only this one is a Canonical
 * fact, and `ADR-0023` records why the other two are not derived.
 */
export const PrerequisiteItem = z
  .object({
    text: z.string(),
    /** The 1-based unit that needs this to hold. Always greater than 1. */
    neededAtUnit: z.number().int().min(2),
    origin: CanonicalOrigin,
  })
  .strict()
export type PrerequisiteItem = z.infer<typeof PrerequisiteItem>

export const SetUpItem = z
  .object({
    text: z.string(),
    origin: CanonicalOrigin,
  })
  .strict()
export type SetUpItem = z.infer<typeof SetUpItem>

export const FetchItem = z
  .object({
    text: z.string(),
    amount: PlanAmount,
    origin: CanonicalOrigin,
  })
  .strict()
export type FetchItem = z.infer<typeof FetchItem>

// --- cooking units --------------------------------------------------------

/** A time, temperature or doneness cue that matters while this unit runs. */
export const CriticalParameter = z
  .object({
    text: z.string(),
    kind: z.enum(["duration", "temperature", "doneness", "wait"]),
    origin: CanonicalOrigin,
  })
  .strict()
export type CriticalParameter = z.infer<typeof CriticalParameter>

export const CookingUnit = z
  .object({
    /** 1-based position. Canonical order, never resequenced. */
    n: z.number().int().positive(),
    /** The step's own normalized action text, carried through unchanged. */
    actionText: z.string(),
    sectionTitle: z.string().optional(),
    amounts: z.array(PlanAmount),
    splits: z.array(SplitAmount),
    reserved: z.array(ReservedAmount),
    critical: z.array(CriticalParameter),
    produces: z.array(z.string()),
    origin: CanonicalOrigin,
  })
  .strict()
export type CookingUnit = z.infer<typeof CookingUnit>

// --- the plan -------------------------------------------------------------

/** How this plan came to exist, so a stale one can be told from a current one. */
export const PlanDerivation = z
  .object({
    /** The `schemaVersion` of the Canonical this plan was derived from. */
    canonicalSchemaVersion: z.string().min(1),
    /** The Canonical version ordinal, when the plan was derived from a stored one. */
    canonicalVersion: z.number().int().positive().optional(),
    /** Bumped when the derivation changes, so a stored plan can be told apart. */
    deriverVersion: z.string().min(1),
    /**
     * Which S4 layout recommendation the derivation followed. Recorded rather
     * than assumed, because the criterion is that the implementation says which
     * one it followed (`slice6/quantity-placement-follows-s4`).
     */
    quantityPlacement: z.enum(["separate_block", "inline"]),
    /**
     * Whether retrieval reminders for at-hand basics were suppressed. S4 could
     * not answer the readiness half of that claim, so the shipped default is
     * `false` and `OQ-37` stays open.
     */
    assumedAtHandSuppressed: z.boolean(),
  })
  .strict()
export type PlanDerivation = z.infer<typeof PlanDerivation>

export const CookingPlan = z
  .object({
    recipeId: z.string().min(1),
    title: z.string(),
    setUp: z.array(SetUpItem),
    startNow: z.array(PrerequisiteItem),
    fetchPrepare: z.array(FetchItem),
    units: z.array(CookingUnit),
    derivation: PlanDerivation,
  })
  .strict()
export type CookingPlan = z.infer<typeof CookingPlan>
