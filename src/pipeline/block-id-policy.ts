/**
 * Deterministic block-id assignment for capture (CFV1-SL1).
 *
 * The CFV1-S6 spike measured the one real fidelity variable to be block-id
 * determinism, and found it *input-driven, not architecture-driven*: a model
 * left to choose ids re-labels the same content differently run to run, so the
 * id set "wanders" — the exact thing the capture prompt forbids (see
 * `spikes/s6-fidelity/FINDINGS.md`). S6's cross-cutting requirement, which holds
 * regardless of how OQ-24 (one model call or two) is settled, is: **make capture
 * ids deterministic rather than left to the model.**
 *
 * This module is that policy, behind an interface so the derivation strategy is
 * swappable and so both OQ-24 variants route their captured segmentation through
 * the same seam: capture produces a *segmentation* (blocks without a trusted id)
 * and the policy assigns the ids. A model-proposed id is structurally not an
 * input here — {@link RawBlock} has no `id` field — so it cannot leak into the
 * snapshot.
 *
 * Scope and honesty: this makes id *assignment* deterministic given a
 * segmentation. It does NOT make *segmentation* deterministic — whether the same
 * source is split into the same blocks is a property of the capture prompt/model
 * (S6's residual, unstructured-input risk) and is out of this module's reach. A
 * block id is therefore local to its snapshot version and reproducible from that
 * version's block content — never a stable cross-capture key.
 *
 * No contract shape is declared here (repo-config `slice0/schema-single-source-
 * of-truth`); the block type is imported from the contract and the result is a
 * plain `SnapshotBlock[]` the caller validates on the way into persistence.
 */
import { createHash } from "node:crypto"
import type { SnapshotBlock } from "../../schema/index.js"

/**
 * A captured block as the segmentation produces it: everything a
 * {@link SnapshotBlock} carries EXCEPT the id. Omitting `id` from the input is
 * the structural guarantee that a model-chosen id can never reach the snapshot —
 * the policy is the sole source of ids.
 */
export type RawBlock = Omit<SnapshotBlock, "id">

/** Assigns deterministic ids to a captured segmentation. */
export interface BlockIdPolicy {
  /**
   * Return the blocks with ids assigned. The input order is preserved; each
   * output block carries the same `order`, `type`, `heading` and `text` it came
   * in with, plus a policy-assigned `id`.
   */
  assignIds(rawBlocks: readonly RawBlock[]): SnapshotBlock[]
}

/** Normalize text for hashing: collapse runs of whitespace and trim. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/**
 * The default policy: an id is derived from the block's CONTENT — its type,
 * heading and text — and nothing else. Position is deliberately excluded, so the
 * same content yields the same id even if the segmentation reorders it; the id
 * reflects what the block *is*, not where it sits. Two blocks with byte-identical
 * content would collide, so a stable per-content occurrence suffix keeps ids
 * unique within the snapshot (block ids must be unique for sourceRefs to
 * resolve) without reintroducing model choice.
 *
 * The derivation reads only the block's own content: no snapshot id, run id or
 * timestamp enters it, which is what makes an id reproducible from the snapshot
 * version alone and local to it.
 */
class ContentDerivedBlockIdPolicy implements BlockIdPolicy {
  assignIds(rawBlocks: readonly RawBlock[]): SnapshotBlock[] {
    const seen = new Map<string, number>()
    return rawBlocks.map((block) => {
      const digest = createHash("sha256")
        .update(block.type)
        .update("\u0000")
        .update(normalize(block.heading ?? ""))
        .update("\u0000")
        .update(normalize(block.text))
        .digest("hex")
        .slice(0, 12)
      const occurrence = seen.get(digest) ?? 0
      seen.set(digest, occurrence + 1)
      const id = occurrence === 0 ? `b-${digest}` : `b-${digest}-${occurrence}`
      return {
        id,
        order: block.order,
        type: block.type,
        ...(block.heading !== undefined ? { heading: block.heading } : {}),
        text: block.text,
      }
    })
  }
}

/** Construct the default content-derived block-id policy. */
export function createContentDerivedBlockIdPolicy(): BlockIdPolicy {
  return new ContentDerivedBlockIdPolicy()
}
