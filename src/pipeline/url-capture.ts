/**
 * CFV1-SL4 — the composite URL capture capability: deterministic first, model
 * fallback second, on the one {@link CaptureProvider} seam (ADR-0004).
 *
 * The S2 spike measured Recipe JSON-LD present and sufficient on almost every
 * fetched page, so the deterministic adapter ({@link createDeterministicUrlCaptureProvider})
 * is tried first and, when it maps a page, no model is called at all. The gap it
 * measured is JSON-LD *absence* on a genuinely unstructured page; that is the one
 * case this composite covers by falling back to a model reading the page.
 *
 * Two rules make the fallback safe rather than a bypass:
 *
 *  1. It catches ONLY {@link InsufficientRecipeJsonLdError} — the deterministic
 *     adapter's "I cannot map this" seam. It NEVER catches
 *     {@link MultipleRecipesError}: a page that holds several recipes is a refusal
 *     the pipeline owes the user (CFV1-MR1), not a gap to paper over, so it
 *     propagates untouched. Any other error propagates too.
 *
 *  2. What it hands the model is the EXTRACTED TEXT, not the raw HTML (ADR-0019
 *     §4a), and it stamps the capture as `sourceProvenance: "url"` — so the model
 *     path produces a `url` snapshot whose every block is verified against that
 *     extracted text (the CFV1-INJ anchor). The provenance is set HERE, by the
 *     path itself, not trusted from the caller: this composite is the URL path, so
 *     anything it routes to the model is url-provenance by construction, and a
 *     forgotten or wrong caller provenance cannot turn verification off.
 *
 * The model fallback is an injected {@link CaptureProvider}, exactly like the
 * deterministic one, so production wires a real model-backed provider and tests
 * wire a deterministic fake through the same path — no network or model here.
 */
import { htmlToText } from "./html-to-text.js"
import type { CaptureContext, CaptureProvider, CaptureResult } from "./providers.js"
import { InsufficientRecipeJsonLdError } from "./url-jsonld-adapter.js"

/**
 * Compose the deterministic URL adapter with a model fallback into one capture
 * provider. `deterministic` is tried first; only its
 * {@link InsufficientRecipeJsonLdError} routes to `modelFallback`, which is given
 * the page's extracted text as bytes and a url provenance. Every other error —
 * {@link MultipleRecipesError} above all — propagates unchanged.
 */
export function createUrlCaptureProvider(
  deterministic: CaptureProvider,
  modelFallback: CaptureProvider,
): CaptureProvider {
  return {
    async capture(input: Uint8Array, ctx: CaptureContext): Promise<CaptureResult> {
      try {
        return await deterministic.capture(input, ctx)
      } catch (error) {
        if (!(error instanceof InsufficientRecipeJsonLdError)) throw error
        // The deterministic path declined a mappable structure. Hand the model the
        // EXTRACTED text (never the raw HTML), stamped as a url capture so it is
        // verified against that text.
        const html = new TextDecoder().decode(input)
        const extractedText = htmlToText(html)
        const textBytes = new TextEncoder().encode(extractedText)
        return modelFallback.capture(textBytes, { ...ctx, sourceProvenance: "url" })
      }
    },
  }
}
