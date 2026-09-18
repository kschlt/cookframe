import { z } from "zod"

/**
 * Layer A — the durable, source-faithful capture record kept after the transient
 * scan image is discarded (recipe-ontology §3 Layer A). It may contain capture
 * errors and is NOT semantically equivalent to the original pixels.
 */

export const SourceType = z.enum(["image", "url", "text", "other"])
export type SourceType = z.infer<typeof SourceType>

export const BlockType = z.enum([
  "title",
  "metadata",
  "ingredient_group",
  "ingredient",
  "instruction_group",
  "instruction",
  "note",
  "author",
  "other",
])
export type BlockType = z.infer<typeof BlockType>

/**
 * A captured block. Its `id` is stable within the snapshot so normalized facts
 * can reference the evidence they were produced from (recipe-ontology §4).
 */
export const SnapshotBlock = z
  .object({
    id: z.string().min(1),
    order: z.number().int().nonnegative(),
    type: BlockType,
    heading: z.string().optional(),
    text: z.string(),
  })
  .strict()
export type SnapshotBlock = z.infer<typeof SnapshotBlock>

/** Identity of the capture run that produced the snapshot (recipe-ontology §4). */
export const CaptureProvenance = z
  .object({
    sourceAdapter: z.string().min(1),
    adapterVersion: z.string().min(1),
    model: z.string().optional(),
    capturePromptVersions: z.array(z.string()).optional(),
    runId: z.string().min(1),
  })
  .strict()
export type CaptureProvenance = z.infer<typeof CaptureProvenance>

export const SourceSnapshot = z
  .object({
    id: z.string().min(1),
    /** Monotonic snapshot version, distinct from the contract SCHEMA_VERSION. */
    version: z.number().int().nonnegative(),
    sourceType: SourceType,
    sourceUrl: z.string().optional(),
    sourceSite: z.string().optional(),
    sourceAttribution: z.string().optional(),
    capturedText: z.string(),
    /** Structured payload when available, e.g. Recipe JSON-LD. Shape is source-defined. */
    structuredSourcePayload: z.unknown().optional(),
    blocks: z.array(SnapshotBlock),
    captureProvenance: CaptureProvenance,
  })
  .strict()
export type SourceSnapshot = z.infer<typeof SourceSnapshot>
