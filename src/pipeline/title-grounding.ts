/**
 * A title that declares the source must cite the source's own title.
 *
 * `RecipeTitle` (schema) gives a source with no title a legal way to say so, and
 * gives a title that IS in the source the two fields every other fact carries:
 * `sourceText` beside `sourceRefs`. That alone buys two checks for free —
 * `resolveSourceRefs` proves the cited block exists, and `verifyClaimSupport`
 * proves the block contains the wording. It is still not enough, for one
 * measured reason: **claim verification is deliberately off for `image`
 * sources** (`claimsAreVerified`), and the defect this module exists for was
 * observed on a photograph. On that path a title citing any block at all would
 * pass every check in the tree.
 *
 * And containment would not have caught it either. The manufactured title in
 * `spikes/s1-photo-gate/VERDICT.md` was the *full text of the first
 * instruction* — so it is contained in the block it would cite, exactly, and
 * scores 1.00. Every wording-based rule accepts it. What is wrong with it is not
 * the wording but the EVIDENCE: a method step is not where a source names a
 * recipe.
 *
 * So the rule here is about the kind of evidence, and it runs on every source
 * type:
 *
 * > A title in state `from_source` must cite at least one snapshot block whose
 * > `type` is `title`.
 *
 * The capture stage already makes that answerable. It segments a source into
 * typed blocks and `title` is one of the types it assigns (`prompts/capture`,
 * `BlockType`); the deterministic JSON-LD adapter emits a `title` block exactly
 * when the page carries a `name`. A source with no title therefore has no title
 * block, and the only thing a normalizer can truthfully say about it is
 * `not_in_source` — which is now a thing it can say.
 *
 * **What this refuses, and what it costs.** It refuses a title grounded only on
 * a `payloadPointer`, and a title grounded only on a block of some other type.
 * Neither can arise on a path that exists today: every producer of a canonical
 * goes through a snapshot, and the one adapter that emits a structured payload
 * emits the `title` block beside it. A wider rule would have to admit evidence
 * on the strength of its wording, which is the thing that cannot tell the
 * observed defect from a real title. If a later source shape grounds a title
 * somewhere else, this fails closed and someone extends it on purpose.
 */
import type { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"

/**
 * Raised when a recipe claims a title from its source but cites no block that
 * could be one.
 *
 * Distinct from `UnsupportedClaimError`: that one says the cited block does not
 * contain the wording, this one says the wording may well be there but the
 * source never used it as a name. The two are not interchangeable and a caller
 * can tell them apart.
 */
export class UngroundedTitleError extends Error {
  constructor(
    readonly title: string,
    /** The block types the title actually cited, in citation order. */
    readonly citedBlockTypes: readonly string[],
  ) {
    super(
      `a title declares the source but cites no title block — the source does not ` +
        `name the recipe here (cited ${
          citedBlockTypes.length === 0
            ? "no block of the snapshot"
            : `block type(s) ${citedBlockTypes.join(", ")}`
        }): ${JSON.stringify(title.slice(0, 200))}`,
    )
    this.name = "UngroundedTitleError"
  }
}

/**
 * Assert that `canonical`'s title is grounded in evidence that can be a title,
 * throwing {@link UngroundedTitleError} when it is not.
 *
 * A `not_in_source` title is the declared gap and has nothing to ground, so it
 * returns. Unlike claim verification this consults no source type: the check is
 * about which block was cited, and that question is as answerable for a
 * photograph as for a page.
 */
export function verifyTitleGrounding(snapshot: SourceSnapshot, canonical: CanonicalRecipe): void {
  const title = canonical.title
  if (title.state !== "from_source") return
  const blockType = new Map(snapshot.blocks.map((b) => [b.id, b.type]))
  const citedTypes: string[] = []
  for (const ref of title.sourceRefs) {
    // A ref that resolves to nothing contributes no evidence rather than
    // throwing here: `resolveSourceRefs` is what reports an unresolvable ref,
    // and the two checks stay separate so neither reports the other's failure.
    const type = ref.blockId === undefined ? undefined : blockType.get(ref.blockId)
    if (type === "title") return
    if (type !== undefined) citedTypes.push(type)
  }
  throw new UngroundedTitleError(title.sourceText, citedTypes)
}
