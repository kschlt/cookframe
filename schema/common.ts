import { z } from "zod"

/**
 * Shared value objects for the Cookframe contract. Every object is `.strict()`
 * so that an unknown key is rejected rather than silently carried — the
 * structural half of the ontology's "do not invent" rule (recipe-ontology §5).
 */

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
    value: z.number().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    qualifierText: z.string().optional(),
  })
  .strict()
export type ValueExpression = z.infer<typeof ValueExpression>

/** A source-grounded duration, e.g. "10 min", "10–12 min", "overnight". */
export const DurationExpression = z
  .object({
    sourceText: z.string(),
    kind: ValueExpressionKind,
    value: z.number().optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
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
