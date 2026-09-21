/**
 * Claim verification: a fact must be SUPPORTED by the block it cites, not merely
 * point at one that exists (CFV1-INJ).
 *
 * `resolveSourceRefs` (persistence) proves a ref names a real block. That is the
 * guarantee it was built for and it is not enough here. A model that fabricates
 * content fabricates the refs beside it, and a ref pointing at a block that
 * exists resolves whether or not the fact is in it — so against a page written
 * to induce invention, resolution passes by construction. This module closes
 * that gap by asking the question resolution does not: does the cited block
 * actually say this?
 *
 * **What is checked, and why that field.** The contract already carries the
 * source's own wording next to every normalized fact: the ontology's rule that
 * source wording is always retained (§5.2) means a node with `sourceRefs` also
 * carries `sourceText`. That field is the model's claim about what the page
 * said, and the cited block is what the page actually said, so comparing the two
 * needs no new field and no second model call. Parsed fields are deliberately
 * NOT compared — an ingredient's `name` is the contract's split-out form, not a
 * quotation, and CFV1-S1 measured exactly that divergence — so this verifies the
 * one field the ontology defines as verbatim.
 *
 * **The threshold is a measured decision, not a default.** See
 * `spikes/inj-threshold/CALIBRATION.md` for the runs, both tables and the
 * ordering. In short: the rule is normalized character containment, with a
 * token-coverage relaxation at {@link SUPPORT_COVERAGE_THRESHOLD} for the two
 * classes of legitimate divergence the corpus actually contains (a printed line
 * break hyphenating a word, and a model lemmatising an inflected adjective).
 * Over 696 claims from 20 real conversions, every threshold from 0.60 to 1.00
 * refuses the same two claims — the relaxation changes nothing on the corpus it
 * was calibrated against, which is the evidence that it was not fitted to it. It
 * is bounded rather than open because at 0.50 a legitimate short claim and a
 * fabrication that borrows half its vocabulary both score exactly 0.50, and no
 * threshold can admit one without admitting the other.
 */
import type { CanonicalRecipe, SourceRef, SourceSnapshot, SourceType } from "../../schema/index.js"

/**
 * How much of a claim's word sequence must appear, in order, in the cited text
 * when the claim is not contained in it outright.
 *
 * **0.70, chosen from a measured flat region rather than from the first value
 * that passed.** Over 696 claims from 20 real conversions every value from 0.60
 * to 1.00 refuses the same two claims and accepts the same 0.21% of null-model
 * claims; 0.50 is where it breaks, admitting 2.72%. 0.70 sits in that flat
 * region, so the guarantee does not balance on a knife edge.
 *
 * The flatness is the point. A threshold with no effect on the data it was
 * calibrated against cannot have been fitted to it; it is here for the case the
 * corpus is thin in and a fetched page will not be — a long quotation carrying
 * one lemmatised word, which scores about 0.91.
 *
 * 0.50 is the only value that would refuse nothing, and it is refused precisely
 * for that reason: a two-word claim with one word inflected and a fabricated
 * claim that borrows half its vocabulary BOTH score 0.50, so the populations
 * collide there. Two words with one of them wrong is not evidence.
 *
 * The calibration corpus is photographs, which carry OCR hyphenation a fetched
 * HTML page will not. It is therefore a HARDER population than the one this rule
 * governs, which is the conservative direction to be wrong in.
 */
export const SUPPORT_COVERAGE_THRESHOLD = 0.7

/** Raised when a cited block does not support the fact citing it. */
export class UnsupportedClaimError extends Error {
  constructor(
    readonly claim: string,
    readonly blockIds: readonly string[],
    readonly coverage: number,
  ) {
    super(
      `a fact is not supported by the source it cites (coverage ${coverage.toFixed(2)} < ` +
        `${SUPPORT_COVERAGE_THRESHOLD}): ${JSON.stringify(claim.slice(0, 200))} cited ` +
        `${blockIds.length > 0 ? `block(s) ${blockIds.join(", ")}` : "no block"}`,
    )
    this.name = "UnsupportedClaimError"
  }
}

/**
 * Fold away the differences that carry no meaning, and nothing else.
 *
 * Each step exists for a divergence the corpus actually showed: Unicode form and
 * typographic dashes/quotes (a page's punctuation is not a claim), a hyphen
 * before whitespace (a printed line break splitting a word — "ge-hen lassen" is
 * "gehen lassen"), whitespace runs, and case. Nothing here removes words or
 * reorders them, so two texts that normalize equal differ only in presentation.
 */
export function normalizeForSupport(text: string): string {
  let s = text.normalize("NFKC")
  for (const [from, to] of [
    ["‐", "-"],
    ["‑", "-"],
    ["‒", "-"],
    ["–", "-"],
    ["—", "-"],
    ["−", "-"],
    ["‘", "'"],
    ["’", "'"],
    ["‚", "'"],
    ["“", '"'],
    ["”", '"'],
    ["„", '"'],
    [" ", " "],
  ] as const) {
    s = s.split(from).join(to)
  }
  // A hyphen between two LETTERS is folded away, on both sides alike. In this
  // corpus it is a printed line break splitting a word ("ge-hen lassen" is
  // "gehen lassen") once capture has joined the lines; a genuine compound folds
  // to the same form in claim and block, so the comparison is unaffected either
  // way. Restricted to letters on purpose: "180-200" must not become "180200".
  s = s.replace(/(\p{L})-\s*(\p{L})/gu, "$1$2")
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Word tokens, Unicode-aware.
 *
 * `\w` is ASCII-only in JavaScript, so it splits "große" into "gro" and "e" and
 * "Schüssel" into "sch" and "ssel" — on a German corpus that is most of the
 * vocabulary. The fragmentation is symmetric, so it does not obviously break
 * anything, which is exactly why it survived: it silently changes what a
 * coverage ratio counts, and with it what the threshold means.
 */
const words = (text: string): string[] => normalizeForSupport(text).match(/[\p{L}\p{N}_]+/gu) ?? []

/**
 * The length of the longest common subsequence of two word arrays.
 *
 * Subsequence, not substring: the legitimate divergences are insertions inside
 * an otherwise intact quotation ("große Mixerschüssel" against "in einer großen
 * Mixerschüssel mischen"), and a substring measure scores those at the length of
 * their longest intact run instead of at what they share.
 */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  let previous = new Array<number>(b.length + 1).fill(0)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, current[j - 1] ?? 0)
    }
    ;[previous, current] = [current, previous]
    current.fill(0)
  }
  return previous[b.length] ?? 0
}

/**
 * How much of `claim` the `cited` text supports, in [0, 1].
 *
 * 1 when the claim is contained in the cited text after normalization — the
 * ordinary case, and the one that carries the real guarantee, because it means
 * the words are literally on the page. Otherwise the fraction of the claim's
 * words that appear in the cited text in order.
 */
export function supportCoverage(claim: string, cited: string): number {
  const normalizedClaim = normalizeForSupport(claim)
  if (normalizedClaim.length === 0) return 1
  if (normalizeForSupport(cited).includes(normalizedClaim)) return 1
  const claimWords = words(claim)
  if (claimWords.length === 0) return 1
  return lcsLength(claimWords, words(cited)) / claimWords.length
}

/**
 * Raised when a captured block carries text the input did not.
 *
 * The capture stage's counterpart to {@link UnsupportedClaimError}, and the
 * reason the chain holds. Verification at normalization compares the canonical
 * against the SNAPSHOT — but on the fallback path the snapshot is itself
 * produced by a model reading the page, so a model that invents a block at
 * capture time produces a snapshot its own canonical then verifies against
 * happily. Measured: an ingredient absent from the page survived the whole
 * chain. Anchoring capture on the bytes the pipeline actually holds is what
 * closes it, because those are the one thing in the chain the model does not
 * produce.
 */
export class UnsupportedCaptureError extends Error {
  constructor(
    readonly blockText: string,
    /**
     * How close the block came, for diagnosis only. The capture rule is
     * containment, so this number decides nothing — it is here so a refusal
     * says whether the block was a near miss or invented outright.
     */
    readonly coverage: number,
  ) {
    super(
      `a captured block carries text the source does not contain (nearest coverage ` +
        `${coverage.toFixed(2)}): ${JSON.stringify(blockText.slice(0, 200))}`,
    )
    this.name = "UnsupportedCaptureError"
  }
}

/**
 * Assert that every captured block's text is present in the input it was
 * captured from.
 *
 * Governs `url` and `text` sources only, for the reason the module docstring
 * gives: an image is a page the user physically holds, and its bytes are pixels
 * rather than text, so there is nothing to anchor against.
 *
 * **This imposes a requirement on whatever drives the fallback: hand capture the
 * page's TEXT, not its raw markup.** A block's words do not appear contiguously
 * in HTML once tags and entities sit between them, so a model handed raw markup
 * would be refused for extracting correctly. Extracting text deterministically
 * before the model sees it is the right shape anyway — it is the step that makes
 * the anchor model-independent — and this check makes that structural rather
 * than a note someone has to remember.
 */
export function verifyCaptureSupport(
  sourceType: SourceType,
  inputText: string,
  blocks: readonly { readonly text: string }[],
): void {
  if (sourceType !== "url" && sourceType !== "text") return
  const normalizedInput = normalizeForSupport(inputText)
  for (const block of blocks) {
    if (block.text.trim() === "") continue
    const normalizedBlock = normalizeForSupport(block.text)
    if (normalizedBlock === "" || normalizedInput.includes(normalizedBlock)) continue
    throw new UnsupportedCaptureError(block.text, supportCoverage(block.text, inputText))
  }
}

/** One verbatim claim and the refs in scope for it. */
interface Claim {
  readonly text: string
  readonly refs: readonly SourceRef[]
}

/**
 * Collect every `sourceText` with the refs that ground it.
 *
 * Refs are inherited from the nearest enclosing node that declares a non-empty
 * `sourceRefs`, which is how the contract nests them: a `ValueExpression` inside
 * an `IngredientUse` carries the quotation while the use carries the citation.
 */
function collectClaims(node: unknown, inherited: readonly SourceRef[], acc: Claim[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectClaims(item, inherited, acc)
    return
  }
  if (node === null || typeof node !== "object") return
  const record = node as Record<string, unknown>
  const own = record.sourceRefs
  const scope = Array.isArray(own) && own.length > 0 ? (own as SourceRef[]) : inherited
  const text = record.sourceText
  if (typeof text === "string" && text.trim() !== "") acc.push({ text, refs: scope })
  for (const [key, value] of Object.entries(record)) {
    if (key === "sourceRefs" || key === "sourceText") continue
    collectClaims(value, scope, acc)
  }
}

/**
 * Whether a snapshot's text is governed by claim verification.
 *
 * `url` and `text` sources carry words written by someone else — a fetched page,
 * or a paste of one — which is the threat CFV1-INJ exists for. The image path is
 * deliberately excluded and the item says so: a photograph is a page the user
 * physically holds, a different threat model, and the calibration measured a
 * false-refusal rate on real photographs (OCR hyphenation, a vision model
 * lemmatising) that a hard failure there would not be worth.
 *
 * Derived from the snapshot rather than passed as a flag, so no caller can
 * forget it and no configuration can switch it off for the path that needs it.
 */
export function claimsAreVerified(snapshot: SourceSnapshot): boolean {
  return snapshot.sourceType === "url" || snapshot.sourceType === "text"
}

/**
 * Assert that every verbatim claim in `canonical` is supported by the snapshot
 * blocks it cites, throwing {@link UnsupportedClaimError} on the first that is
 * not.
 *
 * Fails on the FIRST unsupported claim rather than on a rate. A rate would
 * separate the populations more comfortably — a fabricated conversion scored
 * 0.12-0.33 claim support against a real page, a legitimate one 1.00 — but the
 * harm from one invented ingredient is not proportional to its share of the
 * recipe, so a rate is the wrong shape for it. The cost of the strict form is a
 * small false-refusal rate on legitimate pages — 2 of 20 real conversions in the
 * calibration, on a corpus harder than this rule governs — and a refusal is
 * recoverable where an invented allergen in a persisted recipe is not.
 */
export function verifyClaimSupport(snapshot: SourceSnapshot, canonical: CanonicalRecipe): void {
  if (!claimsAreVerified(snapshot)) return
  const blockText = new Map(snapshot.blocks.map((b) => [b.id, b.text]))
  const claims: Claim[] = []
  collectClaims(canonical, [], claims)
  for (const claim of claims) {
    const ids = claim.refs.map((r) => r.blockId).filter((id): id is string => id !== undefined)
    // Refs are resolved elsewhere; an id absent here contributes no evidence
    // rather than throwing, so this module reports unsupported claims and
    // `resolveSourceRefs` keeps reporting unresolvable refs.
    // Scored against each cited block SEPARATELY, best block wins — never
    // against their concatenation.
    //
    // Joining them made the haystack the model's to choose. Coverage counts a
    // claim's words appearing in order anywhere in the text it is scored
    // against, so adding a block can only raise it: an invented "225 g
    // Backpulver" scores 0.33 against the one block that plausibly grounds it
    // and 1.00 against every block joined, by borrowing "225 g" from one line
    // and "Backpulver" from another. The model writes its own refs, so it was
    // choosing its own evidence — the exact failure this module's docstring
    // names, reached by widening the citation instead of inventing a ref.
    //
    // A `sourceText` is one fact's wording from one place in the source, so
    // the best single block is the right question; a claim no single cited
    // block supports is unsupported however many are named.
    const coverage = ids
      .map((id) => blockText.get(id))
      .filter((text): text is string => text !== undefined)
      .reduce((best, text) => Math.max(best, supportCoverage(claim.text, text)), 0)
    if (coverage < SUPPORT_COVERAGE_THRESHOLD) {
      throw new UnsupportedClaimError(claim.text, ids, coverage)
    }
  }
}
