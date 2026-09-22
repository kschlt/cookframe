/**
 * CFV1-MR1 — a source holding several recipes is DETECTED and REFUSED, never
 * silently truncated to one.
 *
 * The failure this closes was measured, not imagined: the first real-photograph
 * capture run put a magazine spread carrying four recipes through the pipeline
 * and got one recipe back. Not an error, not a warning — one correct recipe,
 * with nothing anywhere to show that three others had been on the page. Nothing
 * in that output is wrong, so nothing looks wrong, and the only evidence of the
 * loss was the page the user no longer has in front of them.
 *
 * Both entry paths had the hole for different reasons, so both are proved here:
 * the URL path chose it explicitly, picking the richest `Recipe` node and
 * reporting nothing about the rest; the image path inherited it from the
 * contract, where one snapshot describes one recipe and nothing asked whether
 * the source agreed.
 *
 * Every proof runs with no network and no model — the URL half needs neither by
 * construction, and the capture half uses a scripted transport.
 */
import { describe, expect, it } from "vitest"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { ingest } from "../../src/pipeline/ingest.js"
import { createModelCaptureProvider, ModelReplyError } from "../../src/pipeline/model-providers.js"
import type { CaptureContext, ModelExchange, ModelTransport } from "../../src/pipeline/providers.js"
import {
  MultipleRecipesError,
  UnknownRecipeCountError,
} from "../../src/pipeline/recipe-inventory.js"
import {
  createDeterministicUrlCaptureProvider,
  extractRecipeJsonLd,
  InsufficientRecipeJsonLdError,
} from "../../src/pipeline/url-jsonld-adapter.js"

const captureCtx: CaptureContext = {
  snapshotId: "snap-mr1",
  snapshotVersion: 0,
  sourceAdapter: "fixture",
  adapterVersion: "0.0.0",
  runId: "mr1-run",
  captureModel: "test-model",
  sourceMediaType: "text/plain",
}

/** Wrap JSON-LD in a minimal synthetic page. Self-authored: no third-party text. */
const page = (jsonLd: unknown): Uint8Array =>
  new TextEncoder().encode(
    `<!doctype html><html><head><script type="application/ld+json">` +
      `${JSON.stringify(jsonLd)}</script></head><body></body></html>`,
  )

const recipe = (name: string, over: Record<string, unknown> = {}) => ({
  "@type": "Recipe",
  name,
  recipeYield: "4 servings",
  recipeIngredient: ["200 g flour", "1 tsp salt"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Mix and bake." }],
  ...over,
})

const graph = (...recipes: unknown[]) => ({ "@context": "https://schema.org", "@graph": recipes })

/** A transport that records every exchange and replies with each text in turn. */
function sequence(...replies: string[]): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: replies[Math.min(seen.length - 1, replies.length - 1)] as string }
    },
  }
}

const stage = (transport: ModelTransport) => ({
  transport,
  promptText: "PROMPT",
  contractText: "CONTRACT",
  markerSource: () => "TEST-MARKER",
})

/** A capture reply carrying whatever inventory the case needs. */
const captureReply = (inventory: Record<string, unknown>): string =>
  JSON.stringify({
    sourceType: "text",
    capturedText: "Pfannkuchen\n200 g Mehl\nAlles verruehren.",
    blocks: [
      { id: "x", order: 0, type: "title", text: "Pfannkuchen" },
      { id: "y", order: 1, type: "ingredient", text: "200 g Mehl" },
      { id: "z", order: 2, type: "instruction", text: "Alles verruehren." },
    ],
    ...inventory,
  })

const source = new TextEncoder().encode("Pfannkuchen\n200 g Mehl\nAlles verruehren.")

describe("multi-recipe/refuses-with-inventory", () => {
  it("refuses a page holding three recipes, and says which three", async () => {
    const provider = createDeterministicUrlCaptureProvider()
    const bytes = page(graph(recipe("Linsensuppe"), recipe("Pfannkuchen"), recipe("Apfelkuchen")))
    const error = await provider.capture(bytes, captureCtx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleRecipesError)
    const refusal = error as MultipleRecipesError
    expect(refusal.recipeCount).toBe(3)
    expect(refusal.recipeTitles).toEqual(["Linsensuppe", "Pfannkuchen", "Apfelkuchen"])
  })

  it("refuses a CAPTURED source the model reports as holding four, and says which four", async () => {
    // The magazine spread, in the shape the measurement found it: the model
    // transcribes one recipe correctly and reports that the page held four.
    // Before this, that reply produced a valid snapshot and nothing else.
    const transport = sequence(
      captureReply({
        recipeCount: 4,
        recipeTitles: ["Linsensuppe", "Pfannkuchen", "Apfelkuchen", null],
      }),
    )
    const error = await createModelCaptureProvider(stage(transport))
      .capture(source, captureCtx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleRecipesError)
    const refusal = error as MultipleRecipesError
    expect(refusal.recipeCount).toBe(4)
    // A recipe the model could not title is reported as untitled rather than
    // dropped, so the count and the titles can never disagree.
    expect(refusal.recipeTitles).toEqual(["Linsensuppe", "Pfannkuchen", "Apfelkuchen", undefined])
    expect(refusal.message).toContain("(untitled)")
  })

  it("counts one recipe once, however many times the page emits it", async () => {
    // The discriminating negative for the counting rule itself. Pages routinely
    // emit the same recipe inside `@graph` and again standalone; counting those
    // as two would refuse an ordinary single-recipe page, and a guard that
    // refuses everything satisfies every other criterion here.
    const provider = createDeterministicUrlCaptureProvider()
    const twice = page(graph(recipe("Linsensuppe"), recipe("Linsensuppe", { author: "A" })))
    await expect(provider.capture(twice, captureCtx)).resolves.toBeDefined()
  })
})

describe("multi-recipe/refusal-is-typed-and-distinct", () => {
  it("is distinguishable from an unreadable source without reading the message", async () => {
    const provider = createDeterministicUrlCaptureProvider()
    const many = await provider
      .capture(page(graph(recipe("A"), recipe("B"))), captureCtx)
      .catch((e: unknown) => e)
    const unreadable = await provider
      .capture(page({ "@type": "Thing", name: "not a recipe" }), captureCtx)
      .catch((e: unknown) => e)

    expect(many).toBeInstanceOf(MultipleRecipesError)
    expect(unreadable).toBeInstanceOf(InsufficientRecipeJsonLdError)
    // Neither is an instance of the other. That is load-bearing rather than
    // tidy: `InsufficientRecipeJsonLdError` is the seam a later model fallback
    // catches to cover a page the deterministic reader could not map, and a
    // multi-recipe page must NOT route there — extracting one recipe from it by
    // any means is the truncation this unit exists to stop.
    expect(many).not.toBeInstanceOf(InsufficientRecipeJsonLdError)
    expect(unreadable).not.toBeInstanceOf(MultipleRecipesError)
    expect((many as MultipleRecipesError).reasonCode).toBe("multiple_recipes")
    expect((unreadable as InsufficientRecipeJsonLdError).reasonCode).toBe("no_recipe_jsonld")
  })

  it("is not a reply failure, so it is never retried", async () => {
    // A count is a property of the SOURCE, not of the reply. Conflating the two
    // spends a paid call on an input that can never conform, however often it
    // is asked.
    const transport = sequence(captureReply({ recipeCount: 2, recipeTitles: ["A", "B"] }))
    const error = await createModelCaptureProvider(stage(transport))
      .capture(source, captureCtx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleRecipesError)
    expect(error).not.toBeInstanceOf(ModelReplyError)
    expect(transport.seen).toHaveLength(1)
  })
})

describe("multi-recipe/fails-closed-on-unknown-count", () => {
  const unknown = [
    ["the key is absent entirely", {}],
    // This case exists because a mutation found the others insufficient. With a
    // one-entry titles list the length check agrees with a count defaulted to
    // one, so ONLY the count check can refuse here. Without it, `recipeCount ??
    // 1` — the exact defect this describe block is named for — left all seven
    // cases green, each of them refused by the titles branch instead.
    ["the count is absent but the titles would fit one", { recipeTitles: ["A"] }],
    ["the count is null but the titles would fit one", { recipeCount: null, recipeTitles: ["A"] }],
    ["the count is null", { recipeCount: null, recipeTitles: [] }],
    ["the count is a string", { recipeCount: "1", recipeTitles: ["A"] }],
    ["the count is not an integer", { recipeCount: 1.5, recipeTitles: ["A"] }],
    ["the count is zero", { recipeCount: 0, recipeTitles: [] }],
    ["there is no titles list", { recipeCount: 1 }],
    ["the titles do not line up with the count", { recipeCount: 3, recipeTitles: ["A"] }],
  ] as const

  for (const [what, inventory] of unknown) {
    it(`refuses rather than assuming one recipe when ${what}`, async () => {
      const transport = sequence(captureReply(inventory))
      const error = await createModelCaptureProvider(stage(transport))
        .capture(source, captureCtx)
        .catch((e: unknown) => e)
      // The whole point: an unknown count is exactly the state that "assume one
      // and transcribe the first" is indistinguishable from.
      expect(error).toBeInstanceOf(UnknownRecipeCountError)
      expect((error as UnknownRecipeCountError).reasonCode).toBe("unknown_recipe_count")
    })
  }

  it("a reply that is unusable fails as unusable, not as a count problem", async () => {
    // Ordering matters for diagnosis: a reply with no blocks is broken in a way
    // the model can repair, and reporting it as a count problem would send the
    // caller after the wrong thing — and would skip the retry it deserves.
    const transport = sequence(JSON.stringify({ sourceType: "text", capturedText: "x" }))
    const error = await createModelCaptureProvider(stage(transport))
      .capture(source, captureCtx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelReplyError)
    expect(error).not.toBeInstanceOf(UnknownRecipeCountError)
  })
})

describe("multi-recipe/single-recipe-source-unaffected", () => {
  it("still ingests a one-recipe page end to end, through the shared spine", async () => {
    const { snapshot, canonical } = await ingest(
      createProvisionalStore(),
      createDeterministicUrlCaptureProvider(),
      createFakeNormalizationProvider(),
      createContentDerivedBlockIdPolicy(),
      page(recipe("Linsensuppe")),
      { ...captureCtx, sourceAdapter: "url-jsonld" },
      { runId: "mr1-norm", targetOntologyVersion: "1.0.0" },
    )
    expect(snapshot.blocks.length).toBeGreaterThan(0)
    expect(snapshot.sourceType).toBe("url")
    expect(canonical.recipe.provenance.sourceSnapshotId).toBe(snapshot.id)
  })

  it("still captures a one-recipe modelled source, inventory and all", async () => {
    const transport = sequence(captureReply({ recipeCount: 1, recipeTitles: ["Pfannkuchen"] }))
    const result = await createModelCaptureProvider(stage(transport)).capture(source, captureCtx)
    expect(result.blocks).toHaveLength(3)
    // The inventory is EVIDENCE, not a fact about the source, so it drives the
    // refusal and is then discarded — the same rule already settled for block
    // ids, identity, provenance and `structuredSourcePayload`. A count that
    // reached the contract would be a model's claim wearing a record's
    // authority, and nothing downstream could tell the difference.
    expect(JSON.stringify(result)).not.toContain("recipeCount")
    expect(JSON.stringify(result)).not.toContain("recipeTitles")
  })
})

describe("multi-recipe/jsonld-counts-without-a-model", () => {
  it("counts the page's own Recipe nodes with no model in the picture", () => {
    // The cheapest proof in the item and the strongest: no transport, no
    // provider, no fixture photograph. The old behaviour discarded here
    // silently, with no model involved at all.
    const extraction = extractRecipeJsonLd(
      new TextDecoder().decode(page(graph(recipe("A"), recipe("B"), recipe("C")))),
    )
    expect(extraction.kind).toBe("multiple")
    if (extraction.kind !== "multiple") throw new Error("unreachable")
    expect(extraction.inventory.count).toBe(3)
    expect(extraction.inventory.titles).toEqual(["A", "B", "C"])
  })

  it("refuses several recipes BEFORE asking whether one of them is sufficient", () => {
    // A page with three recipes is not a page to extract one from, however
    // complete that one is. Deciding sufficiency first would route a
    // multi-recipe page into the `insufficient` seam, which is the fallback's
    // door — and the fallback would dutifully import one of the three.
    const extraction = extractRecipeJsonLd(
      new TextDecoder().decode(
        page(graph(recipe("Complete"), { "@type": "Recipe", name: "Fragment at the page edge" })),
      ),
    )
    expect(extraction.kind).toBe("multiple")
  })
})

describe("multi-recipe/no-second-model-call", () => {
  it("reads the inventory from the reply the conversion already paid for", async () => {
    // ADR-0014 fixes one physical model call per conversion. Asking "how many
    // recipes were there" in a call of its own would double the bill for a
    // question the model has already answered by looking at the source.
    const single = sequence(captureReply({ recipeCount: 1, recipeTitles: ["Pfannkuchen"] }))
    await createModelCaptureProvider(stage(single)).capture(source, captureCtx)
    expect(single.seen).toHaveLength(1)

    const several = sequence(captureReply({ recipeCount: 3, recipeTitles: ["A", "B", "C"] }))
    await createModelCaptureProvider(stage(several))
      .capture(source, captureCtx)
      .catch(() => undefined)
    expect(several.seen).toHaveLength(1)
  })

  it("the URL path asks nothing of any model, and has no transport to ask with", async () => {
    const provider = createDeterministicUrlCaptureProvider()
    await provider.capture(page(graph(recipe("A"), recipe("B"))), captureCtx).catch(() => undefined)
    // `createDeterministicUrlCaptureProvider` takes no config at all, so there
    // is no seam through which a call could have been made.
    expect(createDeterministicUrlCaptureProvider.length).toBe(0)
  })
})
