/**
 * A required field the source does not supply stays empty and says so
 * (PDR-0005).
 *
 * The case is `spikes/s1-photo-gate/VERDICT.md`, finding 3. A handwritten card
 * with no heading was captured into four `instruction` blocks and no `title`
 * block — correctly, the card has no title. The contract then required
 * `title: z.string()`, so normalization filled it with the full text of the
 * first instruction, and the stored recipe was titled with a sentence from its
 * own method. Nothing marked it as manufactured and nothing could: the field
 * was the one required content field on the contract with no `sourceRefs`, and
 * a check needs a ref to check.
 *
 * Every test below plants the violation it claims to guard. Where a test would
 * pass with the guard deleted it says so and names what it characterises
 * instead — a green assertion about existing behaviour is not a guard, and this
 * project has shipped fifteen of those.
 */
import { describe, expect, it } from "vitest"
import {
  CanonicalRecipe,
  SCHEMA_VERSION,
  type SourceSnapshot,
  SourceSnapshot as SourceSnapshotSchema,
} from "../../schema/index.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { UnsupportedClaimError, verifyClaimSupport } from "../../src/pipeline/claim-support.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import type { NormalizationContext, NormalizationProvider } from "../../src/pipeline/providers.js"
import { reprocess } from "../../src/pipeline/reprocess.js"
import { UngroundedTitleError, verifyTitleGrounding } from "../../src/pipeline/title-grounding.js"
import { renderLibraryPage, renderRecipePage } from "../../src/render/index.js"
import { mapCanonicalToSchemaOrg } from "../../src/shopping/schema-org-mapping.js"

// --- the card from the photo gate, reconstructed ---------------------------

/** The first instruction of the titleless card: what got stored as its title. */
const FIRST_STEP = "Zwiebeln in feine Ringe schneiden und in Butter glasig dünsten."

/**
 * The handwritten card: an `image` source segmented into instructions and
 * nothing else, because that is all the card carries. No `title` block, by
 * construction — capture was right about this page and the contract was not.
 */
const titlelessCard: SourceSnapshot = SourceSnapshotSchema.parse({
  id: "snap-card",
  version: 0,
  sourceType: "image",
  capturedText: FIRST_STEP,
  blocks: [
    { id: "b-instr-1", order: 0, type: "instruction", text: FIRST_STEP },
    { id: "b-instr-2", order: 1, type: "instruction", text: "Mit Brühe ablöschen." },
  ],
  captureProvenance: { sourceAdapter: "photo", adapterVersion: "1.0.0", runId: "r" },
})

/** The same page, but with the heading it would have had. */
const titledCard: SourceSnapshot = SourceSnapshotSchema.parse({
  ...titlelessCard,
  id: "snap-card-titled",
  blocks: [
    { id: "b-title", order: 0, type: "title", text: "Zwiebelsuppe" },
    ...titlelessCard.blocks.map((b) => ({ ...b, order: b.order + 1 })),
  ],
})

const provenance = (snapshotId: string) => ({
  sourceSnapshotId: snapshotId,
  sourceSnapshotVersion: 0,
  targetOntologyVersion: "1.0.0",
  runId: "run-1",
})

/** A canonical of the card, with whatever `title` a test wants to try. */
const canonicalOf = (snapshot: SourceSnapshot, title: unknown): unknown => ({
  id: `recipe-of-${snapshot.id}`,
  schemaVersion: SCHEMA_VERSION,
  title,
  yields: [],
  ingredientGroups: [],
  instructionSections: [
    {
      id: "is-1",
      sourceRefs: [{ blockId: "b-instr-1" }],
      steps: snapshot.blocks
        .filter((b) => b.type === "instruction")
        .map((b, i) => ({
          id: `st-${i + 1}`,
          sourceText: b.text,
          normalizedActionText: b.text,
          sourceRefs: [{ blockId: b.id }],
          ingredientUses: [],
          componentUses: [],
          equipmentUses: [],
          producesComponents: [],
          durations: [],
          temperatures: [],
          donenessCues: [],
          prerequisiteCues: [],
          waitCues: [],
        })),
    },
  ],
  provenance: provenance(snapshot.id),
})

/** The title as it was actually manufactured: the first step, citing the step. */
const manufacturedTitle = {
  state: "from_source",
  sourceText: FIRST_STEP,
  sourceRefs: [{ blockId: "b-instr-1" }],
}

const declaredGap = { state: "not_in_source" }

// --- the contract ----------------------------------------------------------

describe("title-gap/a-source-with-no-title-can-say-so", () => {
  it("accepts the declared gap", () => {
    expect(() => CanonicalRecipe.parse(canonicalOf(titlelessCard, declaredGap))).not.toThrow()
  })

  it("rejects the bare string the contract used to require", () => {
    // The planted violation is the pre-change shape itself: this recipe is
    // exactly what normalization stored for the card, and it no longer parses.
    const result = CanonicalRecipe.safeParse(canonicalOf(titlelessCard, FIRST_STEP))
    expect(result.success).toBe(false)
  })

  it("rejects a title that claims the source but cites nothing", () => {
    const result = CanonicalRecipe.safeParse(
      canonicalOf(titledCard, { state: "from_source", sourceText: "Zwiebelsuppe", sourceRefs: [] }),
    )
    expect(result.success, "an empty sourceRefs is the ungrounded field again").toBe(false)
  })

  it("rejects a title that claims the source with empty wording", () => {
    const result = CanonicalRecipe.safeParse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    expect(result.success).toBe(false)
  })

  it("rejects a state it does not define, rather than carrying it", () => {
    const result = CanonicalRecipe.safeParse(
      canonicalOf(titlelessCard, { state: "derived_from_method" }),
    )
    expect(result.success).toBe(false)
  })
})

// --- the grounding check ---------------------------------------------------

describe("title-gap/a-manufactured-title-is-refused", () => {
  it("refuses the photo-gate title: a title citing an instruction block", () => {
    const canonical = CanonicalRecipe.parse(canonicalOf(titlelessCard, manufacturedTitle))
    expect(() => verifyTitleGrounding(titlelessCard, canonical)).toThrow(UngroundedTitleError)
  })

  it("names what was cited and which half failed, so a refusal is diagnosable", () => {
    const canonical = CanonicalRecipe.parse(canonicalOf(titlelessCard, manufacturedTitle))
    try {
      verifyTitleGrounding(titlelessCard, canonical)
      expect.unreachable("the manufactured title must be refused")
    } catch (error) {
      expect(error).toBeInstanceOf(UngroundedTitleError)
      expect((error as UngroundedTitleError).citedBlockTypes).toEqual(["instruction"])
      expect((error as UngroundedTitleError).reason).toBe("no_title_block_cited")
    }
  })

  it("accepts a title citing the source's own title block", () => {
    const canonical = CanonicalRecipe.parse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "Zwiebelsuppe",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    expect(() => verifyTitleGrounding(titledCard, canonical)).not.toThrow()
  })

  it("accepts a title that cites the title block among others, WHEN the wording matches", () => {
    // The wording is what makes this legal, not the presence of the ref. The
    // sibling test below plants the same citation shape with the method step's
    // wording and requires a refusal; until review, only this half existed and
    // the citation shape alone was treated as sufficient.
    const canonical = CanonicalRecipe.parse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "Zwiebelsuppe",
        sourceRefs: [{ blockId: "b-instr-1" }, { blockId: "b-title" }],
      }),
    )
    expect(() => verifyTitleGrounding(titledCard, canonical)).not.toThrow()
  })

  it("refuses the photo-gate title even when the title block is cited beside it", () => {
    // Found by review on a head where this passed. Citing a `title` block ended
    // the check before the wording was compared, so the manufactured
    // method-step title — the one defect this module exists for — went through
    // as soon as the model listed the real title block too.
    const canonical = CanonicalRecipe.parse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "Zwiebeln schneiden.",
        sourceRefs: [{ blockId: "b-instr-1" }, { blockId: "b-title" }],
      }),
    )
    expect(() => verifyTitleGrounding(titledCard, canonical)).toThrow(UngroundedTitleError)
  })

  it("refuses an invented title that cites the real title block", () => {
    // Also found by review. The card is a photograph, so claim verification is
    // off (ADR-0019) and nothing else in the tree looks at the wording: a name
    // nobody wrote was storable as the source's own words.
    const canonical = CanonicalRecipe.parse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "Omas beste Rindersuppe mit Einlage",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    try {
      verifyTitleGrounding(titledCard, canonical)
      expect.unreachable("an invented title must be refused")
    } catch (error) {
      expect(error).toBeInstanceOf(UngroundedTitleError)
      expect((error as UngroundedTitleError).reason).toBe("wording_not_in_the_title_block")
    }
  })

  it("refuses a title that normalizes to nothing", () => {
    // `.min(1)` admits " ", and every string contains the empty string, so a
    // whitespace title would be accepted by containment alone — absence in a
    // new disguise, on the field built to make absence sayable.
    const canonical = CanonicalRecipe.parse(
      canonicalOf(titledCard, {
        state: "from_source",
        sourceText: "   ",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    expect(() => verifyTitleGrounding(titledCard, canonical)).toThrow(UngroundedTitleError)
  })

  it("accepts the source's own heading read past a parenthetical", () => {
    // Containment, not equality: taking part of the heading the source wrote is
    // not inventing, and a capture that keeps a subtitle in the same block must
    // not force a refusal.
    const withSubtitle = SourceSnapshotSchema.parse({
      ...titledCard,
      id: "snap-card-subtitle",
      blocks: titledCard.blocks.map((b) =>
        b.type === "title" ? { ...b, text: "Zwiebelsuppe (Grundrezept)" } : b,
      ),
    })
    const canonical = CanonicalRecipe.parse(
      canonicalOf(withSubtitle, {
        state: "from_source",
        sourceText: "Zwiebelsuppe",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    expect(() => verifyTitleGrounding(withSubtitle, canonical)).not.toThrow()
  })

  it("compares against each cited title block separately, never against them joined", () => {
    // `claim-support` paid three review rounds for this: the model writes its
    // own refs, so scoring against joined text lets it widen its own haystack.
    // "Zwiebelsuppe mit Speck" is in neither block and in their concatenation.
    const twoHeadings = SourceSnapshotSchema.parse({
      ...titledCard,
      id: "snap-two-headings",
      blocks: [
        { id: "b-title", order: 0, type: "title", text: "Zwiebelsuppe mit" },
        { id: "b-title-2", order: 1, type: "title", text: "Speck" },
        ...titlelessCard.blocks.map((b) => ({ ...b, order: b.order + 2 })),
      ],
    })
    const canonical = CanonicalRecipe.parse(
      canonicalOf(twoHeadings, {
        state: "from_source",
        sourceText: "Zwiebelsuppe mit Speck",
        sourceRefs: [{ blockId: "b-title" }, { blockId: "b-title-2" }],
      }),
    )
    expect(() => verifyTitleGrounding(twoHeadings, canonical)).toThrow(UngroundedTitleError)
  })

  it("has nothing to check on a declared gap", () => {
    const canonical = CanonicalRecipe.parse(canonicalOf(titlelessCard, declaredGap))
    expect(() => verifyTitleGrounding(titlelessCard, canonical)).not.toThrow()
  })

  it("refuses a title grounded only on a payload pointer", () => {
    // Fails closed on evidence no path produces today. A `payloadPointer` says
    // where in the source's structured data a value sits, not that the source
    // used it as a name, and the one adapter that emits a payload emits a
    // `title` block beside it. Admitting pointers would need its own evidence.
    const withPayload = SourceSnapshotSchema.parse({
      ...titlelessCard,
      structuredSourcePayload: { name: "Zwiebelsuppe" },
    })
    const canonical = CanonicalRecipe.parse(
      canonicalOf(withPayload, {
        state: "from_source",
        sourceText: "Zwiebelsuppe",
        sourceRefs: [{ payloadPointer: "/name" }],
      }),
    )
    expect(() => verifyTitleGrounding(withPayload, canonical)).toThrow(UngroundedTitleError)
  })
})

describe("title-gap/wording-checks-cannot-catch-it", () => {
  it("claim verification passes the manufactured title, which is why the other check exists", () => {
    // CHARACTERISATION, not a guard: it is green with `verifyTitleGrounding`
    // deleted, and that is the point it makes. Two independent reasons claim
    // verification cannot close this, both load-bearing:
    //   1. `claimsAreVerified` is false for `image`, and the card is a photo;
    //   2. even on a `url` page the manufactured title IS the cited block's
    //      text, so containment scores it 1.00.
    const canonical = CanonicalRecipe.parse(canonicalOf(titlelessCard, manufacturedTitle))
    expect(() => verifyClaimSupport(titlelessCard, canonical)).not.toThrow()

    const asWebPage = SourceSnapshotSchema.parse({ ...titlelessCard, sourceType: "text" })
    expect(() => verifyClaimSupport(asWebPage, canonical)).not.toThrow()
  })

  it("but a title whose wording is NOT on the page is now refused on a text source", () => {
    // The half the union buys for free: `sourceText` beside `sourceRefs` is
    // what `collectClaims` walks, so the title became a verified claim by
    // acquiring the two fields. Plant the violation: a title citing the real
    // title block with wording that block does not carry.
    const asWebPage = SourceSnapshotSchema.parse({ ...titledCard, sourceType: "text" })
    const canonical = CanonicalRecipe.parse(
      canonicalOf(asWebPage, {
        state: "from_source",
        sourceText: "Franzoesische Zwiebelsuppe nach Grossmutters Art",
        sourceRefs: [{ blockId: "b-title" }],
      }),
    )
    expect(() => verifyClaimSupport(asWebPage, canonical)).toThrow(UnsupportedClaimError)
  })
})

// --- the chokepoint --------------------------------------------------------

const ctx: NormalizationContext = { runId: "run-1", targetOntologyVersion: "1.0.0" }

const providerReturning = (title: unknown): NormalizationProvider => ({
  async normalize(snapshot) {
    return CanonicalRecipe.parse(canonicalOf(snapshot, title))
  },
})

describe("title-gap/nothing-manufactured-reaches-the-store", () => {
  it("refuses the ingest and persists no version", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(titlelessCard)
    await expect(
      reprocess(repo, providerReturning(manufacturedTitle), titlelessCard.id, ctx),
    ).rejects.toThrow(UngroundedTitleError)
    // Fails closed: the refusal is worth nothing if a half-valid record landed.
    expect(await repo.loadLatestCanonical(`recipe-of-${titlelessCard.id}`)).toBeUndefined()
  })

  it("stores the card when the gap is declared", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(titlelessCard)
    const stored = await reprocess(repo, providerReturning(declaredGap), titlelessCard.id, ctx)
    expect(stored.recipe.title).toEqual({ state: "not_in_source" })
  })

  it("lists the stored card with no title rather than a stand-in", async () => {
    const repo = createProvisionalStore()
    await repo.storeSnapshot(titlelessCard)
    await reprocess(repo, providerReturning(declaredGap), titlelessCard.id, ctx)
    const [entry] = await repo.listLibrary()
    expect(entry).toBeDefined()
    expect(entry && "title" in entry, "a gap contributes no title key at all").toBe(false)
  })

  it("the fake normalization provider declares the gap instead of inventing one", async () => {
    // It used to fall back to `Untitled (<snapshot id>)`: a small version of
    // the same defect, in the seam every test in the repo runs through.
    const canonical = await createFakeNormalizationProvider().normalize(titlelessCard, ctx)
    expect(canonical.title).toEqual({ state: "not_in_source" })
  })
})

// --- what a reader sees ----------------------------------------------------

const titlelessRecipe = CanonicalRecipe.parse(canonicalOf(titlelessCard, declaredGap))
const titledRecipe = CanonicalRecipe.parse(
  canonicalOf(titledCard, {
    state: "from_source",
    sourceText: "Zwiebelsuppe",
    sourceRefs: [{ blockId: "b-title" }],
  }),
)

describe("title-gap/the-gap-is-visible-when-reading", () => {
  it("heads the page with the gap, not with a sentence from the method", () => {
    const html = renderRecipePage(titlelessRecipe)
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]
    expect(heading, "the page has a heading").toBeDefined()
    expect(heading).toContain("No title in the source")
    // The planted violation of the render: a fallback to recipe text. The step
    // is on the page, in the method, and must not be in the heading.
    expect(heading).not.toContain("Zwiebeln in feine Ringe")
    expect(html, "the step is still shown where it belongs").toContain("Zwiebeln in feine Ringe")
  })

  it("says it in the document title too, where nothing else can be shown", () => {
    const html = renderRecipePage(titlelessRecipe)
    const documentTitle = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]
    expect(documentTitle).toBe("No title in the source")
  })

  it("lists the card as a gap rather than under a borrowed name", () => {
    const html = renderLibraryPage([titlelessRecipe])
    expect(html).toContain("No title in the source")
    expect(html).not.toContain("Zwiebeln in feine Ringe")
  })

  it("still shows a real title as itself", () => {
    const html = renderRecipePage(titledRecipe)
    expect(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]).toBe("Zwiebelsuppe")
    expect(html).not.toContain("No title in the source")
  })
})

describe("title-gap/the-gap-crosses-the-schema-org-boundary", () => {
  it("omits `name` and records the omission rather than inventing one", () => {
    const result = mapCanonicalToSchemaOrg(titlelessRecipe)
    expect("name" in result.recipe, "no name at all, not an empty or borrowed one").toBe(false)
    expect(result.titleState).toBe("absent")
    expect(result.omissions).toContainEqual({
      field: "name",
      reason: "not_in_source",
      sourceText: "",
    })
  })

  it("carries a real title across unchanged", () => {
    const result = mapCanonicalToSchemaOrg(titledRecipe)
    expect(result.recipe.name).toBe("Zwiebelsuppe")
    expect(result.titleState).toBe("present")
    expect(result.omissions.filter((o) => o.field === "name")).toHaveLength(0)
  })
})
