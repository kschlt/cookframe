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
import type { NormalizationProvider } from "./providers.js"

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
        title: titleBlock?.text ?? `Untitled (${snapshot.id})`,
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
