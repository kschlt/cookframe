/**
 * CFV1-SL5 — the mobile capture entry point, through to shopping.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies. The
 * suite drives the real `createIngestApp` in-process (`app.request`, ADR-0007),
 * composed with the real ingest command, the real block-id policy, the real
 * provisional repository and the real capability route — only the two model
 * capabilities are deterministic fakes behind the ADR-0004 seams, so no model
 * and no network is involved.
 *
 * Two of these are worth saying out loud, because they are the ones a weaker
 * suite would get wrong:
 *
 *  - `no-mobile-specific-contract` does not read this route's source and check
 *    that it calls `ingest`. It puts the SAME bytes through the mobile entry and
 *    through the Slice 1 entry with the same identity, and requires the two
 *    persisted results to be indistinguishable. A second pipeline that happened
 *    to agree would pass — and would be fine. A second pipeline that diverges
 *    anywhere the contract can see fails, which is the property the criterion is
 *    actually about.
 *  - `ingest-credential-is-submission-only` reads the route table off the app
 *    rather than asking about the routes it knows exist. A read route added
 *    later is caught by a proof written before it.
 */
import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { SourceSnapshot } from "../../schema/index.js"
import { createCapabilityApp } from "../../src/http/capability-app.js"
import type { IngestIdentity } from "../../src/http/ingest-app.js"
import { ACCEPTED_CAPTURE_TYPES, createIngestApp } from "../../src/http/ingest-app.js"
import { createIngestCredential } from "../../src/http/ingest-credential.js"
import type { RecipeRepository } from "../../src/persistence/index.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { ingest } from "../../src/pipeline/ingest.js"
import type { CaptureProvider, CaptureResult } from "../../src/pipeline/providers.js"
import {
  MultipleRecipesError,
  UnknownRecipeCountError,
} from "../../src/pipeline/recipe-inventory.js"
import { createInMemoryCapabilityStore } from "../../src/shopping/capability-token.js"

/**
 * Minted per run rather than written down.
 *
 * A credential-shaped literal in a test file is a real secret to every scanner
 * that reads the repository, and `secret-scan` refused this file over exactly
 * that — correctly, because a string that cannot be told apart from a secret
 * IS one as far as a scanner can know. Answering that by teaching the scanner
 * an exception would have made the repository's first gitleaks rule an excuse.
 *
 * Minting also makes the proofs below stronger: nothing they assert can depend
 * on one particular string, and a hard-coded secret in a test is the kind of
 * line people copy into something that matters.
 */
const CREDENTIAL = randomBytes(24).toString("base64url")
const WRONG = randomBytes(24).toString("base64url")

const policy = createContentDerivedBlockIdPolicy()

const PAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

const segmentation = [
  { order: 0, type: "title" as const, text: "Buttermilk Pancakes" },
  { order: 1, type: "ingredient" as const, text: "2 eggs" },
  { order: 2, type: "instruction" as const, text: "Whisk the eggs, then fold in the flour." },
]

/** A capture that succeeds, recording what it was handed. */
function capturingProvider(seen: Seen): CaptureProvider {
  return {
    async capture(input, ctx): Promise<CaptureResult> {
      seen.bytes = input
      seen.mediaType = ctx.sourceMediaType
      return { sourceType: "image", capturedText: "captured", blocks: segmentation }
    },
  }
}

/** A capture that refuses, as the shipped provider does for a multi-recipe page. */
function refusingProvider(error: Error): CaptureProvider {
  return {
    async capture(): Promise<CaptureResult> {
      throw error
    },
  }
}

/** Identity fixed, so two runs of the same bytes are comparable. */
const fixedIdentity = (): IngestIdentity => ({
  newSnapshotId: () => "snap-mobile-1",
  newCaptureRunId: () => "capture-run-1",
  newNormalizationRunId: () => "normalization-run-1",
})

/** What the capture provider was handed. `undefined` means it was never called. */
interface Seen {
  mediaType?: string | undefined
  bytes?: Uint8Array | undefined
}

interface Harness {
  readonly app: ReturnType<typeof createIngestApp>
  readonly repo: RecipeRepository
  readonly seen: Seen
}

function harness(capture?: CaptureProvider): Harness {
  const repo = createProvisionalStore()
  const seen: Seen = {}
  const app = createIngestApp({
    credential: createIngestCredential(CREDENTIAL),
    repo,
    capture: capture ?? capturingProvider(seen),
    normalization: createFakeNormalizationProvider(),
    policy,
    identity: fixedIdentity(),
    targetOntologyVersion: "1.0.0",
    sourceAdapter: "ios-shortcut",
    adapterVersion: "1.0.0",
  })
  return { app, repo, seen }
}

const submit = async (
  app: Harness["app"],
  options?: { credential?: string | null; contentType?: string; body?: Uint8Array },
): Promise<Response> => {
  const headers: Record<string, string> = {
    "content-type": options?.contentType ?? "image/jpeg",
  }
  const credential = options?.credential === undefined ? CREDENTIAL : options.credential
  if (credential !== null) headers["authorization"] = `Bearer ${credential}`
  return await app.request("/capture", {
    method: "POST",
    headers,
    body: options?.body ?? PAGE,
  })
}

describe("slice5/capture-entry-point-reaches-ingestion", () => {
  it("takes a photographed page and persists it through the existing path", async () => {
    const h = harness()
    const res = await submit(h.app)

    expect(res.status, await res.clone().text()).toBe(201)
    const body = (await res.json()) as { snapshotId: string; recipeId: string; title: string }
    expect(body.title).toBe("Buttermilk Pancakes")

    // It reached INGESTION, not just the handler: both halves of the spine are
    // persisted and the snapshot is the one the response names.
    const snapshot = await h.repo.loadSnapshot(body.snapshotId)
    expect(snapshot, "the submission was answered 201 but nothing was stored").toBeDefined()
    const canonical = await h.repo.loadLatestCanonical(body.recipeId)
    expect(canonical, "a snapshot was stored but no Canonical version was appended").toBeDefined()
    expect(canonical?.recipe.title).toBe("Buttermilk Pancakes")
  })

  it("hands the capture the bytes it was posted, and the media type it was told", async () => {
    // The phone is the only party that knows what it took the photo with; a
    // provider that has to sniff the bytes would take its text path on an image.
    const h = harness()
    await submit(h.app, { contentType: "image/heic" })
    expect(h.seen.bytes).toEqual(PAGE)
    expect(h.seen.mediaType).toBe("image/heic")
  })

  it("refuses a media type this instance does not accept, before capturing anything", async () => {
    const h = harness()
    const res = await submit(h.app, { contentType: "application/pdf" })
    expect(res.status).toBe(415)
    expect(h.seen.bytes, "an unsupported type was handed to capture anyway").toBeUndefined()
  })

  it.each(ACCEPTED_CAPTURE_TYPES)(
    "accepts %s, the types an iPhone actually produces",
    async (t) => {
      // Read off the declared list rather than a hand-written copy of it: a type
      // added to the allowlist and broken in the handler fails here.
      const h = harness()
      expect((await submit(h.app, { contentType: t })).status).toBe(201)
    },
  )
})

describe("slice5/ingest-requires-instance-credential", () => {
  it("refuses a submission carrying no credential, and stores nothing", async () => {
    const h = harness()
    const res = await submit(h.app, { credential: null })
    expect(res.status).toBe(401)
    expect(h.seen.bytes, "an unauthenticated body was handed to capture").toBeUndefined()
    expect(await h.repo.listLibrary()).toEqual([])
  })

  it("answers a wrong credential exactly as it answers none", async () => {
    // Two different answers would say whether a credential exists at all, which
    // is the oracle the capability route closes for tokens (ADR-0016).
    const h = harness()
    const absent = await submit(h.app, { credential: null })
    const wrong = await submit(h.app, { credential: WRONG })
    expect(wrong.status).toBe(absent.status)
    expect(await wrong.text()).toBe(await absent.text())
  })

  it("refuses a credential that is a prefix of the real one", async () => {
    const h = harness()
    const res = await submit(h.app, { credential: CREDENTIAL.slice(0, -1) })
    expect(res.status).toBe(401)
  })

  it("refuses an empty bearer value and a foreign scheme", async () => {
    const h = harness()
    for (const header of ["Bearer ", "Basic " + CREDENTIAL, CREDENTIAL]) {
      const res = await h.app.request("/capture", {
        method: "POST",
        headers: { "content-type": "image/jpeg", authorization: header },
        body: PAGE,
      })
      expect(res.status, `\`${header}\` was accepted`).toBe(401)
    }
  })

  it("refuses to be constructed with a credential short enough to guess", () => {
    // Fail closed at startup rather than serve an endpoint anyone can reach.
    expect(() => createIngestCredential("changeme")).toThrow(/at least 32 characters/)
  })
})

describe("slice5/ingest-credential-is-submission-only", () => {
  it("offers exactly one route, and it is a submission", () => {
    // The route table is read OFF the app, so a read route added later fails a
    // proof written before it existed.
    const h = harness()
    const routes = h.app.routes.map((r) => `${r.method} ${r.path}`)
    expect(routes).toEqual(["POST /capture"])
  })

  it("reaches no library content, even with a valid credential", async () => {
    // A recipe exists and has a capability grant; this app is not a way to it.
    const h = harness()
    await submit(h.app)
    const [entry] = await h.repo.listLibrary()
    expect(entry, "the fixture did not actually produce a library entry").toBeDefined()
    const store = createInMemoryCapabilityStore()
    const grant = await store.issue(entry?.recipeId ?? "")

    for (const path of [
      "/capture",
      "/library",
      `/r/${grant.token}`,
      `/capture/${entry?.recipeId}`,
      "/",
    ]) {
      const res = await h.app.request(path, {
        method: "GET",
        headers: { authorization: `Bearer ${CREDENTIAL}` },
      })
      expect(res.status, `${path} served something to the ingest credential`).toBe(404)
    }
  })

  it("cannot be exchanged for anything: the credential object returns only a verdict", () => {
    // There is no function here that takes the ingest credential and yields a
    // value. What cannot be asked for cannot be leaked by a handler that forgets.
    const credential = createIngestCredential(CREDENTIAL)
    expect(Object.keys(credential)).toEqual(["accepts"])
    expect(typeof credential.accepts(CREDENTIAL)).toBe("boolean")
    expect(credential.accepts(CREDENTIAL)).toBe(true)
    expect(credential.accepts(WRONG)).toBe(false)
  })

  it("never echoes the credential back, on success or on refusal", async () => {
    const h = harness()
    const ok = await (await submit(h.app)).text()
    const refused = await (await submit(h.app, { credential: WRONG })).text()
    expect(ok).not.toContain(CREDENTIAL)
    expect(refused).not.toContain(CREDENTIAL)
    expect(refused).not.toContain(WRONG)
  })
})

describe("slice5/no-mobile-specific-contract", () => {
  it("persists exactly what the Slice 1 entry persists, for the same bytes", async () => {
    // The criterion is about the RESULT, so this compares results. A mobile
    // path that produced a differently-shaped Snapshot or Canonical — an extra
    // field, a different adapter name, a different block-id derivation — would
    // fall outside reprocessing and comparison for every recipe captured that
    // way, and would fail here whatever the route's source says.
    const viaMobile = harness()
    await submit(viaMobile.app)

    const directRepo = createProvisionalStore()
    const direct = await ingest(
      directRepo,
      capturingProvider({}),
      createFakeNormalizationProvider(),
      policy,
      PAGE,
      {
        snapshotId: "snap-mobile-1",
        snapshotVersion: 0,
        sourceAdapter: "ios-shortcut",
        adapterVersion: "1.0.0",
        runId: "capture-run-1",
        sourceMediaType: "image/jpeg",
      },
      { runId: "normalization-run-1", targetOntologyVersion: "1.0.0" },
    )

    const mobileSnapshot = await viaMobile.repo.loadSnapshot("snap-mobile-1")
    expect(mobileSnapshot).toEqual(direct.snapshot)
    const mobileCanonical = await viaMobile.repo.loadLatestCanonical(direct.canonical.recipeId)
    expect(mobileCanonical).toEqual(direct.canonical)
  })

  it("stores a Snapshot the one contract accepts, with no mobile-only field", async () => {
    // Validated against the shipped schema, and then against it in STRICT mode:
    // an extra mobile-only field would survive a permissive parse and is exactly
    // the "mobile-specific variant" the constraint forbids.
    const h = harness()
    const res = await submit(h.app)
    const { snapshotId } = (await res.json()) as { snapshotId: string }
    const stored = await h.repo.loadSnapshot(snapshotId)
    expect(() => SourceSnapshot.strict().parse(stored)).not.toThrow()
  })
})

describe("slice5/multi-recipe-refusal-reaches-the-person", () => {
  const refusal = () =>
    new MultipleRecipesError({
      count: 3,
      titles: ["Quick Tomato Soup", undefined, "Leek and Potato Soup"],
    })

  it("answers with the refusal itself, carrying the count and every title", async () => {
    const h = harness(refusingProvider(refusal()))
    const res = await submit(h.app)

    expect(res.status, "a refusal about the SOURCE was answered as a server fault").toBe(422)
    const body = (await res.json()) as {
      reasonCode: string
      recipeCount: number
      recipeTitles: (string | null)[]
      message: string
    }
    expect(body.reasonCode).toBe("multiple_recipes")
    expect(body.recipeCount).toBe(3)
    // Every title, including the one that has none — reported as such rather
    // than dropped, so the count and the titles can never disagree.
    expect(body.recipeTitles).toHaveLength(3)
    expect(body.recipeTitles[0]).toBe("Quick Tomato Soup")
    expect(body.recipeTitles[2]).toBe("Leek and Potato Soup")
  })

  it("carries every machine-readable field the refusal declares", async () => {
    // Read off the ERROR, not off a list written here. A refusal that grows a
    // field and an endpoint that forgets it fail this before a user meets it.
    const declared = Object.keys(refusal()).filter((k) => k !== "name")
    expect(declared.length, "the refusal declares nothing to carry").toBeGreaterThan(0)

    const h = harness(refusingProvider(refusal()))
    const body = (await (await submit(h.app)).json()) as Record<string, unknown>
    for (const field of declared) {
      expect(Object.keys(body), `the refusal's \`${field}\` never reaches the phone`).toContain(
        field,
      )
    }
  })

  it("says it in words a person can act on, naming the count and each title", async () => {
    const h = harness(refusingProvider(refusal()))
    const { message } = (await (await submit(h.app)).json()) as { message: string }

    expect(message).toContain("3")
    expect(message).toContain("Quick Tomato Soup")
    expect(message).toContain("Leek and Potato Soup")
    // The untitled one is named as untitled rather than silently missing from
    // the sentence — a shortened list would repeat, in the message, the loss the
    // refusal exists to report.
    expect(message).toMatch(/without a title/)
    expect(message).not.toMatch(/undefined|null|\[object/)
    // And it is not the generic failure. That wording is indistinguishable from
    // a broken instance, and would send the user to look for a fault that is not
    // there: the page is fine and their next action is obvious once told.
    expect(message).not.toMatch(/went wrong|try again later/i)
  })

  it("is not answered as, or confusable with, an instance fault", async () => {
    const h = harness(refusingProvider(refusal()))
    const refused = await submit(h.app)
    const broken = await submit(harness(refusingProvider(new Error("disk on fire"))).app)

    expect(broken.status).toBe(500)
    expect(refused.status).not.toBe(broken.status)
    // And the instance's own fault says nothing further: no message from inside.
    expect(await broken.text()).not.toContain("disk on fire")
  })

  it("answers an unestablished count as its own refusal too", async () => {
    // Failing closed: a source whose count is unknown is refused, never assumed
    // to hold one — that assumption is what lost three recipes in the first place.
    const h = harness(refusingProvider(new UnknownRecipeCountError("the model gave no count")))
    const res = await submit(h.app)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { reasonCode: string; message: string }
    expect(body.reasonCode).toBe("unknown_recipe_count")
    expect(body.message).toMatch(/could not be established/)
  })

  it("persists nothing when the page is refused", async () => {
    // A partial recipe from a refused page would be the silent truncation with
    // an error message attached.
    const h = harness(refusingProvider(refusal()))
    await submit(h.app)
    expect(await h.repo.listLibrary()).toEqual([])
  })
})

describe("slice5/handoff-succeeds", () => {
  it("carries a phone-captured recipe through to the Bring handoff", async () => {
    // The scan-to-shop path, composed: the photo is submitted from the phone,
    // and the recipe that lands is served at its capability URL as the
    // Schema.org/Recipe document Bring fetches server-side (ADR-0017).
    const h = harness()
    const { recipeId } = (await (await submit(h.app)).json()) as { recipeId: string }

    const store = createInMemoryCapabilityStore()
    const grant = await store.issue(recipeId)
    const shopping = createCapabilityApp({ store, repo: h.repo })

    const res = await shopping.request(`/r/${grant.token}`)
    expect(res.status, "the handoff could not fetch the recipe the phone captured").toBe(200)
    expect(res.headers.get("content-type")).toBe("application/ld+json")
    const served = (await res.json()) as { name?: string; "@type"?: string }
    expect(served["@type"]).toBe("Recipe")
    expect(served.name).toBe("Buttermilk Pancakes")
  })

  it("hands over nothing for a recipe the phone did not capture", async () => {
    // The handoff succeeding is not the same as the handoff being open: a token
    // for a recipe that was never ingested is the same 404 as any other miss.
    const h = harness()
    const store = createInMemoryCapabilityStore()
    const grant = await store.issue("recipe-that-was-never-captured")
    const shopping = createCapabilityApp({ store, repo: h.repo })
    expect((await shopping.request(`/r/${grant.token}`)).status).toBe(404)
  })
})
