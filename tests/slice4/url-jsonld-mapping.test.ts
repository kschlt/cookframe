/**
 * CFV1-SL4 — the DETERMINISTIC URL path: a page's Schema.org/Recipe JSON-LD
 * becomes the same Source Snapshot contract as an image capture, with no model
 * and no network.
 *
 * Scope / honesty (mirrors tests/slice1/capture.test.ts). This suite proves the
 * offline, deterministic half of Slice 4 — the JSON-LD → segmentation mapping and
 * its convergence on the shared capture spine. It deliberately does NOT claim the
 * criteria that need the live fetch or the model fallback:
 *   - the safe-fetch wiring and its adversarial bounds (`slice4/security-suite-*`,
 *     `slice4/bound-violation-fails-import`) belong to the unit that mounts the S5
 *     connector (`src/security/safe-fetch.ts`);
 *   - the model fallback for absent/insufficient JSON-LD
 *     (`slice4/fallback-covers-measured-gaps`) is the key-provider unit.
 * Here the deterministic path DECLINES an insufficient page by throwing, which is
 * exactly the seam that later routes to that fallback.
 *
 * Every fixture below is synthetic, self-authored recipe markup — no third-party
 * recipe text is used (CFV1-SL4 "What NOT"; the public-repo content rule).
 */
import { describe, expect, it } from "vitest"
import { SourceSnapshot } from "../../schema/index.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { ingest } from "../../src/pipeline/ingest.js"
import type {
  CaptureContext,
  CaptureProvider,
  CaptureResult,
  NormalizationContext,
} from "../../src/pipeline/providers.js"
import {
  createDeterministicUrlCaptureProvider,
  extractRecipeJsonLd,
  InsufficientRecipeJsonLdError,
  recipeToRawBlocks,
} from "../../src/pipeline/url-jsonld-adapter.js"

const policy = createContentDerivedBlockIdPolicy()

const captureCtx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-url-1",
  snapshotVersion: 0,
  sourceAdapter: "url-jsonld",
  adapterVersion: "0.0.0",
  runId: "url-run-1",
  ...over,
})

const normCtx = (runId: string): NormalizationContext => ({ runId, targetOntologyVersion: "1.0.0" })

/** Wrap a JSON-LD value in a minimal synthetic HTML page and encode it as bytes. */
const page = (jsonLd: unknown): Uint8Array =>
  new TextEncoder().encode(
    `<!doctype html><html><head><title>fixture</title>` +
      `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
      `</head><body><p>rendered body, ignored by the adapter</p></body></html>`,
  )

/** A synthetic, self-authored complete Recipe (HowToStep instructions). */
const completeRecipe = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Synthetic Test Loaf",
  author: { "@type": "Person", name: "Fixture Author" },
  recipeYield: "1 loaf",
  prepTime: "PT10M",
  cookTime: "PT30M",
  totalTime: "PT40M",
  description: "A fixture recipe used only for tests.",
  recipeIngredient: ["200 g flour", "1 tsp salt", "300 ml water"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mix the flour and salt." },
    { "@type": "HowToStep", text: "Add water and stir to a dough." },
    { "@type": "HowToStep", text: "Bake until golden." },
  ],
}

const provider = createDeterministicUrlCaptureProvider()

describe("slice4/jsonld-deterministic-path", () => {
  it("maps a sufficient Recipe into a url segmentation with no model or network", async () => {
    const result = await provider.capture(page(completeRecipe), captureCtx())
    expect(result.sourceType).toBe("url")
    // The parsed Recipe is kept verbatim as the structured source payload.
    expect(result.structuredSourcePayload).toEqual(completeRecipe)

    const byType = (type: string) => result.blocks.filter((b) => b.type === type)
    expect(byType("title").map((b) => b.text)).toEqual(["Synthetic Test Loaf"])
    expect(byType("author").map((b) => b.text)).toEqual(["Fixture Author"])
    expect(byType("ingredient").map((b) => b.text)).toEqual([
      "200 g flour",
      "1 tsp salt",
      "300 ml water",
    ])
    expect(byType("instruction").map((b) => b.text)).toEqual([
      "Mix the flour and salt.",
      "Add water and stir to a dough.",
      "Bake until golden.",
    ])
    // The yield is carried as metadata, headed by its field name.
    expect(byType("metadata").some((b) => b.heading === "recipeYield" && b.text === "1 loaf")).toBe(
      true,
    )
    // Blocks arrive without ids — the policy is the sole source of ids.
    expect(result.blocks.every((b) => !("id" in b))).toBe(true)
  })

  it("is deterministic: the same page yields an identical capture result", async () => {
    const a = await provider.capture(page(completeRecipe), captureCtx())
    const b = await provider.capture(page(completeRecipe), captureCtx())
    expect(a).toEqual(b)
  })

  it("handles recipeInstructions as a list of plain strings", () => {
    const extraction = extractRecipeJsonLd(
      new TextDecoder().decode(
        page({
          ...completeRecipe,
          recipeInstructions: ["Step one.", "Step two.", "Step three."],
        }),
      ),
    )
    if (extraction.kind !== "sufficient") throw new Error("expected a sufficient recipe")
    const steps = recipeToRawBlocks(extraction.recipe)
      .filter((b) => b.type === "instruction")
      .map((b) => b.text)
    expect(steps).toEqual(["Step one.", "Step two.", "Step three."])
  })

  it("handles recipeInstructions as a bare string, split on its own line breaks", () => {
    const extraction = extractRecipeJsonLd(
      new TextDecoder().decode(
        page({ ...completeRecipe, recipeInstructions: "Mix.\nRest.\nBake." }),
      ),
    )
    if (extraction.kind !== "sufficient") throw new Error("expected a sufficient recipe")
    const steps = recipeToRawBlocks(extraction.recipe)
      .filter((b) => b.type === "instruction")
      .map((b) => b.text)
    expect(steps).toEqual(["Mix.", "Rest.", "Bake."])
  })

  it("handles nested HowToSections, carrying the section name as the block heading", () => {
    const extraction = extractRecipeJsonLd(
      new TextDecoder().decode(
        page({
          ...completeRecipe,
          recipeInstructions: [
            {
              "@type": "HowToSection",
              name: "Dough",
              itemListElement: [
                { "@type": "HowToStep", text: "Mix flour and water." },
                { "@type": "HowToStep", text: "Knead." },
              ],
            },
            {
              "@type": "HowToSection",
              name: "Bake",
              itemListElement: [{ "@type": "HowToStep", text: "Bake at 220C." }],
            },
          ],
        }),
      ),
    )
    if (extraction.kind !== "sufficient") throw new Error("expected a sufficient recipe")
    const steps = recipeToRawBlocks(extraction.recipe)
      .filter((b) => b.type === "instruction")
      .map((b) => ({ heading: b.heading, text: b.text }))
    expect(steps).toEqual([
      { heading: "Dough", text: "Mix flour and water." },
      { heading: "Dough", text: "Knead." },
      { heading: "Bake", text: "Bake at 220C." },
    ])
  })

  it("reads @type given as an array containing Recipe", () => {
    const html = new TextDecoder().decode(page({ ...completeRecipe, "@type": ["Thing", "Recipe"] }))
    expect(extractRecipeJsonLd(html).kind).toBe("sufficient")
  })

  it("finds the Recipe nested inside an @graph", () => {
    const html = new TextDecoder().decode(
      page({
        "@context": "https://schema.org",
        "@graph": [{ "@type": "WebPage", name: "A page" }, completeRecipe],
      }),
    )
    expect(extractRecipeJsonLd(html).kind).toBe("sufficient")
  })

  it("selects the richest Recipe when several are present", () => {
    const stub = { "@type": "Recipe", name: "Stub only" }
    const html = new TextDecoder().decode(
      page({ "@context": "https://schema.org", "@graph": [stub, completeRecipe] }),
    )
    const extraction = extractRecipeJsonLd(html)
    if (extraction.kind !== "sufficient") throw new Error("expected a sufficient recipe")
    expect(extraction.recipe["name"]).toBe("Synthetic Test Loaf")
  })
})

describe("slice4/contract-convergence-with-image-import", () => {
  it("produces a valid url Snapshot with policy-assigned ids and resolving refs, on the shared spine", async () => {
    const repo = createProvisionalStore()
    const { snapshot, canonical } = await ingest(
      repo,
      provider,
      createFakeNormalizationProvider(),
      policy,
      page(completeRecipe),
      captureCtx({ snapshotId: "snap-url-converge" }),
      normCtx("url-norm-1"),
    )
    // Same contract as an image import: the assembled snapshot conforms, and it is
    // a url snapshot.
    expect(() => SourceSnapshot.parse(snapshot)).not.toThrow()
    expect(snapshot.sourceType).toBe("url")
    // The block ids are exactly the policy's ids for the mapped segmentation — not
    // anything the source chose.
    const expectedIds = policy.assignIds(recipeToRawBlocks(completeRecipe)).map((b) => b.id)
    expect(snapshot.blocks.map((b) => b.id)).toEqual(expectedIds)
    // The spine appended a first Canonical version whose sourceRefs resolve — ingest
    // fails closed otherwise, so reaching here is the proof they resolved.
    expect(canonical.version).toBe(1)
    expect(await repo.loadSnapshot(snapshot.id)).toBeDefined()
    expect(await repo.listLibrary()).toHaveLength(1)
  })

  it("is deterministic end to end: the same page and context yield an identical snapshot", async () => {
    const repoA = createProvisionalStore()
    const repoB = createProvisionalStore()
    const a = await ingest(
      repoA,
      provider,
      createFakeNormalizationProvider(),
      policy,
      page(completeRecipe),
      captureCtx({ snapshotId: "snap-url-det" }),
      normCtx("url-norm-det"),
    )
    const b = await ingest(
      repoB,
      provider,
      createFakeNormalizationProvider(),
      policy,
      page(completeRecipe),
      captureCtx({ snapshotId: "snap-url-det" }),
      normCtx("url-norm-det"),
    )
    expect(a.snapshot).toEqual(b.snapshot)
  })
})

describe("slice4/no-snapshot-bypass", () => {
  it("the adapter yields only a segmentation, never a Snapshot or Canonical", async () => {
    const result = await provider.capture(page(completeRecipe), captureCtx())
    // A CaptureResult carries no snapshot identity/provenance and no ids: it cannot
    // stand in for a Snapshot, so the only route to one is captureSnapshot (which
    // validates). There is no deterministic-path shortcut around it.
    for (const key of ["id", "version", "captureProvenance"] as const) {
      expect(key in result).toBe(false)
    }
    expect(result.blocks.every((b) => !("id" in b))).toBe(true)
  })
})

describe("slice4/validate-before-persist-url-path", () => {
  it("a non-conforming url assembly is rejected before anything is persisted", async () => {
    const repo = createProvisionalStore()
    // A provider that corrupts the url adapter's output into an invalid sourceType:
    // the assembler must reject it at validation, before storeSnapshot.
    const broken: CaptureProvider = {
      async capture(input, ctx): Promise<CaptureResult> {
        const valid = await provider.capture(input, ctx)
        return {
          ...valid,
          sourceType: "not-a-source-type" as unknown as CaptureResult["sourceType"],
        }
      },
    }
    await expect(
      ingest(
        repo,
        broken,
        createFakeNormalizationProvider(),
        policy,
        page(completeRecipe),
        captureCtx({ snapshotId: "snap-url-invalid" }),
        normCtx("url-norm-invalid"),
      ),
    ).rejects.toThrow()
    expect(await repo.listLibrary()).toHaveLength(0)
  })
})

describe("slice4/deterministic-path-declines-insufficient", () => {
  it("throws for a page with no Recipe JSON-LD (reason no_recipe_jsonld)", async () => {
    const html = page({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Not a recipe",
    })
    await expect(provider.capture(html, captureCtx())).rejects.toBeInstanceOf(
      InsufficientRecipeJsonLdError,
    )
    const extraction = extractRecipeJsonLd(new TextDecoder().decode(html))
    expect(extraction).toEqual({
      kind: "insufficient",
      recipePresent: false,
      missingRequired: ["name", "recipeIngredient", "recipeInstructions", "recipeYield"],
    })
  })

  it("throws for a Recipe missing required fields, naming them (reason insufficient_recipe_jsonld)", async () => {
    const { recipeInstructions, ...withoutInstructions } = completeRecipe
    void recipeInstructions
    const html = page(withoutInstructions)
    await expect(provider.capture(html, captureCtx())).rejects.toMatchObject({
      reasonCode: "insufficient_recipe_jsonld",
      recipePresent: true,
      missingRequired: ["recipeInstructions"],
    })
  })
})
