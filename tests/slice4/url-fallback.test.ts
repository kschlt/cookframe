/**
 * CFV1-SL4 — the composite URL capture path: deterministic JSON-LD first, model
 * fallback on absence, on the one capture spine (ADR-0004).
 *
 * The `describe` strings that read as criterion ids are the proofs this unit
 * satisfies. The suite drives the REAL composite ({@link createUrlCaptureProvider})
 * over the REAL deterministic adapter and the REAL model capture provider (through
 * a scripted transport — no network, no model), so the ADR-0019 §4a anchor and the
 * CFV1-MR1 interlock are exercised on the production code paths, not stubbed.
 *
 * Every fixture is synthetic, self-authored markup — no third-party recipe text
 * (CFV1-SL4 "What NOT"; the public-repo content rule).
 */
import { describe, expect, it } from "vitest"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { htmlToText } from "../../src/pipeline/html-to-text.js"
import { ingest } from "../../src/pipeline/ingest.js"
import { createModelCaptureProvider } from "../../src/pipeline/model-providers.js"
import type {
  CaptureContext,
  ModelExchange,
  ModelTransport,
  NormalizationContext,
} from "../../src/pipeline/providers.js"
import { MultipleRecipesError } from "../../src/pipeline/recipe-inventory.js"
import { createUrlCaptureProvider } from "../../src/pipeline/url-capture.js"
import { importFromUrl, type UrlImportDeps } from "../../src/pipeline/url-import.js"
import { createDeterministicUrlCaptureProvider } from "../../src/pipeline/url-jsonld-adapter.js"
import type { UrlByteSource, UrlFetchResult } from "../../src/security/url-byte-source.js"

const policy = createContentDerivedBlockIdPolicy()

const captureCtx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-url-fallback-1",
  snapshotVersion: 0,
  sourceAdapter: "url",
  adapterVersion: "0.0.0",
  runId: "url-fallback-run-1",
  ...over,
})

const normCtx = (runId: string): NormalizationContext => ({ runId, targetOntologyVersion: "1.0.0" })

/** A transport that replies with fixed text and records what it was asked. */
function scripted(reply: string): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: reply }
    },
  }
}

const stage = (transport: ModelTransport) => ({
  transport,
  promptText: "PROMPT",
  contractText: "CONTRACT",
})

/** A synthetic recipe page with NO Recipe JSON-LD: the measured fallback gap. */
const unstructuredPage =
  `<!doctype html><html><head><title>fixture</title></head><body>` +
  `<h1>Synthetic Fallback Loaf</h1>` +
  `<p>Zutaten:</p>` +
  `<ul><li>200&nbsp;g Mehl</li><li>1 TL Salz</li><li>300 ml Wasser</li></ul>` +
  `<p>Zubereitung: Alles verr&uuml;hren und backen.</p>` +
  `</body></html>`
const unstructuredBytes = new TextEncoder().encode(unstructuredPage)

/** The extracted text a model on the fallback path actually reads. */
const extractedText = htmlToText(unstructuredPage)

/** A capture reply whose blocks are all spans of the extracted text (honest). */
const honestFallbackReply = JSON.stringify({
  capturedText: extractedText,
  recipeCount: 1,
  recipeTitles: ["Synthetic Fallback Loaf"],
  blocks: [
    { order: 0, type: "title", text: "Synthetic Fallback Loaf" },
    { order: 1, type: "ingredient", text: "200 g Mehl" },
    { order: 2, type: "ingredient", text: "1 TL Salz" },
    { order: 3, type: "ingredient", text: "300 ml Wasser" },
    { order: 4, type: "instruction", text: "Alles verrühren und backen." },
  ],
})

/** A synthetic page carrying sufficient Recipe JSON-LD: the deterministic path handles it. */
const sufficientRecipe = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Synthetic Structured Loaf",
  recipeYield: "1 loaf",
  recipeIngredient: ["200 g flour", "1 tsp salt"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix and bake." }],
}
const structuredBytes = new TextEncoder().encode(
  `<!doctype html><html><head>` +
    `<script type="application/ld+json">${JSON.stringify(sufficientRecipe)}</script>` +
    `</head><body></body></html>`,
)

/** A synthetic page carrying TWO differently-named recipes: a CFV1-MR1 refusal. */
const multiRecipeBytes = new TextEncoder().encode(
  `<!doctype html><html><head>` +
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "Recipe", name: "Stub only" }, sufficientRecipe],
    })}</script>` +
    `</head><body></body></html>`,
)

describe("slice4/fallback-covers-measured-gaps", () => {
  it("maps a JSON-LD-absent page to a url snapshot via the model fallback, on the shared spine", async () => {
    const transport = scripted(honestFallbackReply)
    const capture = createUrlCaptureProvider(
      createDeterministicUrlCaptureProvider(),
      createModelCaptureProvider(stage(transport)),
    )
    const repo = createProvisionalStore()
    const { snapshot, canonical } = await ingest(
      repo,
      capture,
      createFakeNormalizationProvider(),
      policy,
      unstructuredBytes,
      captureCtx({ snapshotId: "snap-fallback-converge" }),
      normCtx("fallback-norm-1"),
    )

    // The model WAS called (the deterministic path declined), and it was handed
    // the EXTRACTED text, not the raw HTML (ADR-0019 §4a).
    expect(transport.seen).toHaveLength(1)
    const sealedPart = transport.seen[0]?.parts.find(
      (p) => p.kind === "text" && p.text.includes("200 g Mehl"),
    )
    expect(sealedPart).toBeDefined()
    expect(transport.seen[0]?.parts.some((p) => p.kind === "text" && p.text.includes("<li>"))).toBe(
      false,
    )

    // Same contract as any source: a url snapshot on the shared spine, persisted,
    // with a first Canonical version whose refs resolved (ingest fails closed
    // otherwise). This is the convergence + no-bypass property on the fallback path.
    expect(snapshot.sourceType).toBe("url")
    expect(snapshot.blocks.map((b) => b.text)).toContain("300 ml Wasser")
    // A model-read page publishes no machine-readable structure of its own.
    expect(snapshot.structuredSourcePayload).toBeUndefined()
    expect(canonical.version).toBe(1)
    expect(await repo.loadSnapshot(snapshot.id)).toBeDefined()
    expect(await repo.listLibrary()).toHaveLength(1)
  })

  it("verifies the fallback capture against the extracted text and refuses an invented block", async () => {
    // The discriminator: the model returns a block that is NOT in the extracted
    // text. The url path is verified (Unit 1 keyed the exemption on provenance),
    // so the anchor refuses it and NOTHING is persisted — the fallback is not a
    // bypass around CFV1-INJ.
    const fabricating = JSON.stringify({
      capturedText: extractedText,
      recipeCount: 1,
      recipeTitles: ["Synthetic Fallback Loaf"],
      blocks: [
        { order: 0, type: "title", text: "Synthetic Fallback Loaf" },
        // Never on the page:
        { order: 1, type: "ingredient", text: "500 g Zucker" },
      ],
    })
    const capture = createUrlCaptureProvider(
      createDeterministicUrlCaptureProvider(),
      createModelCaptureProvider(stage(scripted(fabricating))),
    )
    const repo = createProvisionalStore()
    await expect(
      ingest(
        repo,
        capture,
        createFakeNormalizationProvider(),
        policy,
        unstructuredBytes,
        captureCtx(),
        normCtx("fallback-invent"),
      ),
    ).rejects.toThrow()
    expect(await repo.listLibrary()).toHaveLength(0)
  })
})

describe("slice4/fallback-does-not-swallow-a-multi-recipe-refusal (CFV1-MR1 interlock)", () => {
  it("propagates MultipleRecipesError and never reaches the model", async () => {
    const transport = scripted(honestFallbackReply)
    const capture = createUrlCaptureProvider(
      createDeterministicUrlCaptureProvider(),
      createModelCaptureProvider(stage(transport)),
    )
    const repo = createProvisionalStore()
    await expect(
      ingest(
        repo,
        capture,
        createFakeNormalizationProvider(),
        policy,
        multiRecipeBytes,
        captureCtx(),
        normCtx("fallback-multi"),
      ),
    ).rejects.toBeInstanceOf(MultipleRecipesError)
    // The fallback catches ONLY InsufficientRecipeJsonLdError, so a multi-recipe
    // page never becomes a model-read import — the model is never called.
    expect(transport.seen).toHaveLength(0)
    expect(await repo.listLibrary()).toHaveLength(0)
  })
})

describe("slice4/deterministic-path-is-used-when-json-ld-is-sufficient", () => {
  it("maps structured JSON-LD without calling the model", async () => {
    const transport = scripted(honestFallbackReply)
    const capture = createUrlCaptureProvider(
      createDeterministicUrlCaptureProvider(),
      createModelCaptureProvider(stage(transport)),
    )
    const repo = createProvisionalStore()
    const { snapshot } = await ingest(
      repo,
      capture,
      createFakeNormalizationProvider(),
      policy,
      structuredBytes,
      captureCtx({ snapshotId: "snap-structured" }),
      normCtx("structured-norm"),
    )
    // Deterministic-first: the model was not called at all.
    expect(transport.seen).toHaveLength(0)
    expect(snapshot.sourceType).toBe("url")
    // The deterministic adapter attests the page's own machine-readable structure.
    expect(snapshot.structuredSourcePayload).toBeDefined()
  })
})

describe("slice4/fallback-composes-into-importFromUrl", () => {
  /** A fake byte source that returns fixed bytes — no network, no guard here. */
  const fakeByteSource = (bytes: Uint8Array): UrlByteSource => ({
    async load(url: string): Promise<UrlFetchResult> {
      return { bytes, finalUrl: url, contentType: "text/html" }
    },
    async close(): Promise<void> {},
  })

  it("drives the fetched bytes through the composite capture and persists a url snapshot", async () => {
    const transport = scripted(honestFallbackReply)
    const deps: UrlImportDeps = {
      byteSource: fakeByteSource(unstructuredBytes),
      repo: createProvisionalStore(),
      capture: createUrlCaptureProvider(
        createDeterministicUrlCaptureProvider(),
        createModelCaptureProvider(stage(transport)),
      ),
      normalization: createFakeNormalizationProvider(),
      policy,
    }
    const { snapshot } = await importFromUrl(
      deps,
      "https://example.test/recipe",
      captureCtx({ snapshotId: "snap-import-fallback" }),
      normCtx("import-fallback-norm"),
    )
    expect(snapshot.sourceType).toBe("url")
    expect(transport.seen).toHaveLength(1)
    expect(await deps.repo.listLibrary()).toHaveLength(1)
  })
})
