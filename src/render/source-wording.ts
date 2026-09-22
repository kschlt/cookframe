/**
 * Rendering a source-grounded quantity, duration or yield.
 *
 * Slice 2's fabrication risk is not in the model — the Canonical Recipe already
 * keeps a range as a range and a qualitative quantity as its wording. It is in
 * the formatter, which is where "1–2 tsp" becomes 1.5 and "a splash" becomes a
 * number nobody wrote (CFV1-SL2 Hints).
 *
 * The guard here is structural rather than disciplinary. Every renderable value
 * is narrowed to {@link SourceWorded} on the way in, so a formatter **cannot**
 * read `value`, `minValue` or `maxValue`: they are not on the type it receives.
 * Coercion is not forbidden, it is unavailable.
 */

/**
 * The only part of a `ValueExpression` or `DurationExpression` rendering may
 * see. Structural typing lets either be passed directly; neither's numeric
 * fields are reachable through this type.
 */
export interface SourceWorded {
  readonly sourceText: string
}

/** The source's own wording, unchanged. A range stays a range (§5.9). */
export function wording(value: SourceWorded): string {
  return value.sourceText
}

/**
 * The source's wording with its unit, for the shapes that carry the unit beside
 * the expression rather than inside it. The unit is source-provided and is not
 * converted, per `OQ-20` being out of V1 scope.
 */
export function wordingWithUnit(value: SourceWorded, unit: string | undefined): string {
  const text = wording(value)
  return unit === undefined || unit === "" ? text : `${text} ${unit}`
}

/**
 * What a page shows where the source gave no title.
 *
 * A gap is shown, not filled: the page says the source had no title rather than
 * borrowing a sentence from the method, which is the manufactured title
 * `spikes/s1-photo-gate/VERDICT.md` found stored. It is a label about the
 * SOURCE, so it reads the same wherever it appears — heading, card, document
 * title, image alt text — and a reader who sees it knows what they are looking
 * at instead of reading a title that was never written.
 */
export const NO_TITLE_IN_SOURCE = "No title in the source"
