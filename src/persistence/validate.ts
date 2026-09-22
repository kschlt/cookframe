/**
 * Validate-before-persist and sourceRef resolution for Slice 1 (CFV1-SL1).
 *
 * Validation is the contract's own Zod parse — there is no second copy of the
 * shape (ADR-0006; repo-config `slice0/schema-single-source-of-truth`). These
 * helpers only *call* the schemas, so nothing here declares a shape.
 *
 * Two distinct guards, matching the two SL1 criteria:
 *   - structural validation (`validateSnapshot` / `validateCanonical`): the Zod
 *     parse the repository runs before every write;
 *   - referential resolution (`resolveSourceRefs`): every `sourceRef` in a
 *     Canonical Recipe must resolve against the Snapshot it was normalized from,
 *     and an unresolvable ref FAILS rather than being silently dropped.
 */
import { CanonicalRecipe, CookingPlan, type SourceRef, SourceSnapshot } from "../../schema/index.js"

/** Parse (and thereby validate) a Source Snapshot; throws on invalid input. */
export function validateSnapshot(input: unknown): SourceSnapshot {
  return SourceSnapshot.parse(input)
}

/** Parse (and thereby validate) a Canonical Recipe; throws on invalid input. */
export function validateCanonical(input: unknown): CanonicalRecipe {
  return CanonicalRecipe.parse(input)
}

/** Parse (and thereby validate) a derived Cooking Plan; throws on invalid input. */
export function validateCookingPlan(input: unknown): CookingPlan {
  return CookingPlan.parse(input)
}

/** Raised when a Canonical Recipe references evidence absent from its Snapshot. */
export class UnresolvedSourceRefError extends Error {
  constructor(readonly ref: SourceRef) {
    super(
      `sourceRef does not resolve against the snapshot: ${
        ref.blockId !== undefined
          ? `blockId ${ref.blockId}`
          : `payloadPointer ${ref.payloadPointer}`
      }`,
    )
    this.name = "UnresolvedSourceRefError"
  }
}

/** Gather every `sourceRefs` entry anywhere in the Canonical Recipe tree. */
function collectSourceRefs(node: unknown, acc: SourceRef[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSourceRefs(item, acc)
    return
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "sourceRefs" && Array.isArray(value)) {
        acc.push(...(value as SourceRef[]))
      } else {
        collectSourceRefs(value, acc)
      }
    }
  }
}

/**
 * Assert that every sourceRef in `canonical` resolves against `snapshot`,
 * throwing {@link UnresolvedSourceRefError} on the first that does not — failing
 * closed, never dropping the ref (the omission-over-coercion contract).
 *
 * A `blockId` is fully resolved: it must name a block present in the snapshot.
 * A `payloadPointer` is resolved only as far as this unit needs: the snapshot
 * must carry a structured payload for the pointer to have anything to address.
 * Verifying that the pointer addresses an existing node *within* that payload is
 * deferred to the unit that first produces payload-pointer refs (none does yet;
 * the capture path that emits them is a later SL1 unit).
 */
export function resolveSourceRefs(snapshot: SourceSnapshot, canonical: CanonicalRecipe): void {
  const blockIds = new Set(snapshot.blocks.map((b) => b.id))
  const hasPayload = snapshot.structuredSourcePayload !== undefined
  const refs: SourceRef[] = []
  collectSourceRefs(canonical, refs)
  for (const ref of refs) {
    if (ref.blockId !== undefined) {
      if (!blockIds.has(ref.blockId)) throw new UnresolvedSourceRefError(ref)
    } else if (ref.payloadPointer !== undefined) {
      if (!hasPayload) throw new UnresolvedSourceRefError(ref)
    }
  }
}
