import { z } from "zod"

/**
 * Shared value objects for the Cookframe contract. Every object is `.strict()`
 * so that an unknown key is rejected rather than silently carried — the
 * structural half of the ontology's "do not invent" rule (recipe-ontology §5).
 */

/**
 * A finite numeric value for a source-grounded quantity (CFV1-FIN).
 *
 * This `.finite()` is a decision, not a default. Zod's bare `number` rejects
 * `NaN` but ACCEPTS both `Infinity` and `-Infinity`, so a non-finite value would
 * pass the contract and reach every consumer as a validated number — "it parsed"
 * would mean less than a consumer assumes. That is not hypothetical: the
 * Schema.org mapping published `PTInfinityH` from such a value, in the one module
 * whose rule is omit-never-coerce, with nothing recorded as omitted. A quantity
 * read from a source is always finite; a non-finite one is an artifact of
 * computation, never of the source, so the boundary rejects it here rather than
 * leaning on a guard at one consumer. `.finite()` rejects `NaN`, `Infinity` and
 * `-Infinity` alike, deciding all three non-finite values in one place.
 *
 * Scope is exactly the free scalar quantity fields below. The integer count
 * fields elsewhere (`z.number().int()…` in source-snapshot.ts and
 * canonical-recipe.ts) are already closed — `.int()` rejects every non-finite
 * value — so they are deliberately left unchanged.
 *
 * A stored recipe carrying a non-finite value in one of these fields would now
 * stop parsing. Nothing has ever produced one (JSON cannot even encode
 * `Infinity`), so no migration is needed; the change only closes the
 * computed-value path that could mint one in memory.
 */
const FiniteNumber = z.number().finite()

/**
 * Traceability from a normalized fact back to the captured evidence it came
 * from: a Source Snapshot block, or a stable address within a structured
 * source payload (recipe-ontology §4). At least one locator must be present.
 */
export const SourceRef = z
  .object({
    blockId: z.string().min(1).optional(),
    payloadPointer: z.string().min(1).optional(),
  })
  .strict()
  .refine((r) => r.blockId !== undefined || r.payloadPointer !== undefined, {
    message: "a sourceRef must name a blockId or a payloadPointer",
  })
export type SourceRef = z.infer<typeof SourceRef>

/**
 * A source-grounded quantity that is not necessarily an exact scalar
 * (recipe-ontology §5.2). Source wording is always retained; common
 * non-scalar forms are never coerced into invented numbers.
 */
export const ValueExpressionKind = z.enum([
  "exact",
  "range",
  "approximate",
  "minimum",
  "maximum",
  "qualitative",
  "none",
])
export type ValueExpressionKind = z.infer<typeof ValueExpressionKind>

export const ValueExpression = z
  .object({
    sourceText: z.string(),
    kind: ValueExpressionKind,
    value: FiniteNumber.optional(),
    minValue: FiniteNumber.optional(),
    maxValue: FiniteNumber.optional(),
    qualifierText: z.string().optional(),
  })
  .strict()
export type ValueExpression = z.infer<typeof ValueExpression>

/** A source-grounded duration, e.g. "10 min", "10–12 min", "overnight". */
export const DurationExpression = z
  .object({
    sourceText: z.string(),
    kind: ValueExpressionKind,
    value: FiniteNumber.optional(),
    minValue: FiniteNumber.optional(),
    maxValue: FiniteNumber.optional(),
    unit: z.string().optional(),
    qualifierText: z.string().optional(),
  })
  .strict()
export type DurationExpression = z.infer<typeof DurationExpression>

/** A short source-grounded cue (doneness, prerequisite, wait) with its refs. */
export const Cue = z
  .object({
    sourceText: z.string(),
    sourceRefs: z.array(SourceRef),
  })
  .strict()
export type Cue = z.infer<typeof Cue>
