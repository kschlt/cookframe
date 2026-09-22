/**
 * Deterministic in-repo fake for the ADR-0004 normalization capability
 * (CFV1-SL1). It turns a Source Snapshot into a minimal but schema-valid
 * Canonical Recipe, with every `sourceRef` pointing at a real snapshot block,
 * and stamps run provenance from the context. No model, no network.
 *
 * It exists so the append-and-compare spine can be exercised end to end without
 * a real provider: the recipe identity is derived deterministically from the
 * snapshot id, so two normalization runs of the same snapshot produce two
 * versions of the *same* recipe (distinguished only by `provenance.runId`) —
 * exactly what op 5 (`readTwoRuns`) and `reprocess` need. Real capture and
 * normalization providers replace this behind the same seam.
 */
import { type CanonicalRecipe, SCHEMA_VERSION } from "../../schema/index.js"
import type { RawBlock } from "./block-id-policy.js"
import type { CaptureProvider, CaptureResult, NormalizationProvider } from "./providers.js"

/**
 * Create a deterministic fake capture provider (no model, no network). It decodes
 * the input bytes as UTF-8 and segments on blank lines: the first block is the
 * title, the rest are instruction blocks, in reading order. The segmentation is a
 * pure function of the bytes, so the same input always yields the same
 * segmentation — the "stable segmentation" precondition under which the block-id
 * policy makes ids stable. It assigns NO ids: {@link CaptureResult} carries
 * {@link RawBlock}s, and the policy is the sole source of ids. Real vision
 * capture replaces this behind the same seam.
 */
export function createFakeCaptureProvider(): CaptureProvider {
  return {
    async capture(input): Promise<CaptureResult> {
      const capturedText = new TextDecoder().decode(input)
      const segments = capturedText
        .split(/\n\s*\n/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s.length > 0)
      const blocks: RawBlock[] = segments.map((text, index) => ({
        order: index,
        type: index === 0 ? "title" : "instruction",
        text,
      }))
      return { sourceType: "image", capturedText, blocks }
    },
  }
}

/** Create a deterministic fake normalization provider (no model, no network). */
export function createFakeNormalizationProvider(): NormalizationProvider {
  return {
    async normalize(snapshot, ctx): Promise<CanonicalRecipe> {
      const titleBlock = snapshot.blocks.find((b) => b.type === "title")
      const ingredientBlock = snapshot.blocks.find((b) => b.type === "ingredient")
      const instructionBlock = snapshot.blocks.find((b) => b.type === "instruction")

      const provenance = {
        sourceSnapshotId: snapshot.id,
        sourceSnapshotVersion: snapshot.version,
        targetOntologyVersion: ctx.targetOntologyVersion,
        runId: ctx.runId,
        ...(ctx.normalizationModel !== undefined
          ? { normalizationModel: ctx.normalizationModel }
          : {}),
        ...(ctx.normalizationPromptVersions !== undefined
          ? { normalizationPromptVersions: [...ctx.normalizationPromptVersions] }
          : {}),
      }

      const recipe: CanonicalRecipe = {
        id: `recipe-of-${snapshot.id}`,
        schemaVersion: SCHEMA_VERSION,
        // The fake used to fall back to `Untitled (<snapshot id>)` here, which
        // is a small version of the defect the title union exists for: a value
        // the source never carried, indistinguishable from one it did. With no
        // title block there is nothing to ground a title on, so it declares the
        // gap.
        title:
          titleBlock === undefined
            ? { state: "not_in_source" as const }
            : {
                state: "from_source" as const,
                sourceText: titleBlock.text,
                sourceRefs: [{ blockId: titleBlock.id }],
              },
        yields: [],
        ingredientGroups: ingredientBlock
          ? [
              {
                id: "ig-1",
                sourceRefs: [{ blockId: ingredientBlock.id }],
                ingredients: [
                  {
                    id: "ing-1",
                    sourceText: ingredientBlock.text,
                    name: ingredientBlock.text,
                    qualifiers: [],
                    scalingEligibility: "unknown",
                    sourceRefs: [{ blockId: ingredientBlock.id }],
                  },
                ],
              },
            ]
          : [],
        instructionSections: instructionBlock
          ? [
              {
                id: "is-1",
                sourceRefs: [{ blockId: instructionBlock.id }],
                steps: [
                  {
                    id: "step-1",
                    sourceText: instructionBlock.text,
                    normalizedActionText: instructionBlock.text,
                    sourceRefs: [{ blockId: instructionBlock.id }],
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
            ]
          : [],
        provenance,
      }
      return recipe
    },
  }
}
