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
 * So the rule here is about the EVIDENCE first, and it runs on every source
 * type:
 *
 * > A title in state `from_source` must cite at least one snapshot block whose
 * > `type` is `title`, AND its wording must be carried by one of those blocks.
 *
 * **Both halves, because either alone leaves the defect reachable.** An earlier
 * version of this module checked only the block type and returned at the first
 * `title` ref, never comparing the wording to what that block says. Review
 * planted two titles against it and both were accepted: a freely invented name
 * citing the real title block, and — worse — the manufactured method-step title
 * this module exists to refuse, which walked straight through as soon as the
 * model listed the title block beside the instruction one. On an `image` source
 * nothing else in the tree looks at the wording, so both were storable. The
 * type check answers "did the source name the recipe here"; only the wording
 * check answers "and is this what it said".
 *
 * **Scored per cited title block, never against their concatenation.** That is
 * the lesson `claim-support` paid three review rounds for: the model writes its
 * own refs, so scoring against joined text lets it widen its own haystack until
 * anything fits.
 *
 * The capture stage makes the type half answerable. It segments a source into
 * typed blocks and `title` is one of the types it assigns (`prompts/capture`,
 * `BlockType`); the deterministic JSON-LD adapter emits a `title` block exactly
 * when the page carries a `name`. A source with no title therefore has no title
 * block, and the only thing a normalizer can truthfully say about it is
 * `not_in_source` — which is now a thing it can say.
 *
 * **Why comparing the wording is fair even on a photograph.** ADR-0019 excuses
 * `image` sources from claim verification because a photo's bytes are pixels
 * and there is nothing to anchor against. That reasoning does not reach here:
 * the anchor is the `title` block's own text, produced by the same capture
 * stage, and on both the two-call and the combined path the title is COPIED
 * from that block rather than re-read from the page. `normalizeForSupport`
 * folds the presentation differences that survive OCR — Unicode form,
 * typographic punctuation, a hyphen at a printed line break, case — so what
 * remains is a difference in words.
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
import { normalizeForSupport } from "./claim-support.js"

/**
 * Raised when a recipe claims a title from its source but cites no block that
 * could be one.
 *
 * Distinct from `UnsupportedClaimError`: that one says the cited block does not
 * contain the wording, this one says the wording may well be there but the
 * source never used it as a name. The two are not interchangeable and a caller
 * can tell them apart.
 */
export type UngroundedTitleReason =
  /** Nothing the title cites is a block the source used as a name. */
  | "no_title_block_cited"
  /** A title block is cited, but does not carry the wording claimed from it. */
  | "wording_not_in_the_title_block"

export class UngroundedTitleError extends Error {
  constructor(
    /**
     * Which half failed. One error class, because a caller catches the same
     * thing either way, with the half named — the two are different lies and a
     * refusal that does not say which is not diagnosable.
     */
    readonly reason: UngroundedTitleReason,
    readonly title: string,
    /** The block types the title actually cited, in citation order. */
    readonly citedBlockTypes: readonly string[],
  ) {
    const cited =
      citedBlockTypes.length === 0
        ? "no block of the snapshot"
        : `block type(s) ${citedBlockTypes.join(", ")}`
    super(
      (reason === "no_title_block_cited"
        ? `a title declares the source but cites no title block — the source does not ` +
          `name the recipe here (cited ${cited})`
        : `a title declares the source but the title block it cites does not carry its ` +
          `wording — the source names the recipe something else (cited ${cited})`) +
        `: ${JSON.stringify(title.slice(0, 200))}`,
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
  const blocks = new Map(snapshot.blocks.map((b) => [b.id, b] as const))

  // Every ref is collected before anything is decided. Returning at the first
  // `title` ref is what made the manufactured title reachable: one correct ref
  // beside a wrong one ended the check before the wording was ever compared.
  const citedTypes: string[] = []
  const titleTexts: string[] = []
  for (const ref of title.sourceRefs) {
    // A ref that resolves to nothing contributes no evidence rather than
    // throwing here: `resolveSourceRefs` is what reports an unresolvable ref,
    // and the two checks stay separate so neither reports the other's failure.
    const block = ref.blockId === undefined ? undefined : blocks.get(ref.blockId)
    if (block === undefined) continue
    citedTypes.push(block.type)
    if (block.type === "title") titleTexts.push(block.text)
  }
  if (titleTexts.length === 0) {
    throw new UngroundedTitleError("no_title_block_cited", title.sourceText, citedTypes)
  }

  // A title that normalizes to nothing is a value the source did not give,
  // wearing whitespace. `.min(1)` on the contract admits " ", and every string
  // contains the empty string, so this would otherwise pass by construction.
  const claim = normalizeForSupport(title.sourceText)
  if (claim !== "" && titleTexts.some((text) => normalizeForSupport(text).includes(claim))) {
    return
  }
  throw new UngroundedTitleError("wording_not_in_the_title_block", title.sourceText, citedTypes)
}
