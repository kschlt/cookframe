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
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SourceSnapshot } from "../../schema/index.js"
import { createCapabilityApp } from "../../src/http/capability-app.js"
import type { IngestIdentity } from "../../src/http/ingest-app.js"
import {
  ACCEPTED_CAPTURE_TYPES,
  createIngestApp,
  MAX_CAPTURE_BYTES,
} from "../../src/http/ingest-app.js"
import { bearerCredential, createInstanceCredential } from "../../src/http/instance-credential.js"
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
import { createCapabilityStore } from "../../src/shopping/capability-token.js"
import { dictionaryKeysRead, parsePlist } from "./plist.js"

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

/** What a 201 carries. `title` is a declared state, never a string (PDR-0005). */
interface Created {
  readonly snapshotId: string
  readonly recipeId: string
  readonly title: { state: string; sourceText?: string }
  readonly message: string
}

/** A capture of a page with no heading — the case PDR-0005 was written for. */
function titlelessProvider(seen: Seen): CaptureProvider {
  return {
    async capture(input, ctx): Promise<CaptureResult> {
      seen.bytes = input
      seen.mediaType = ctx.sourceMediaType
      return {
        sourceType: "image",
        capturedText: "captured",
        blocks: segmentation.filter((b) => b.type !== "title"),
      }
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
    credential: createInstanceCredential(CREDENTIAL, "ingest credential"),
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
    const body = (await res.json()) as Created
    expect(body.title).toMatchObject({ state: "from_source", sourceText: "Buttermilk Pancakes" })
    expect(body.message).toBe("Imported: Buttermilk Pancakes")

    // It reached INGESTION, not just the handler: both halves of the spine are
    // persisted and the snapshot is the one the response names.
    const snapshot = await h.repo.loadSnapshot(body.snapshotId)
    expect(snapshot, "the submission was answered 201 but nothing was stored").toBeDefined()
    const canonical = await h.repo.loadLatestCanonical(body.recipeId)
    expect(canonical, "a snapshot was stored but no Canonical version was appended").toBeDefined()
    expect(canonical?.recipe.title).toMatchObject({
      state: "from_source",
      sourceText: "Buttermilk Pancakes",
    })
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

  it("tells the person the source gave no title, instead of showing them one", async () => {
    // PDR-0005's case, on the route most likely to produce it: a photograph of a
    // handwritten card with no heading. The web page says "No title in the
    // source" rather than borrowing a sentence from the method; if this endpoint
    // answered with a borrowed sentence, or with a placeholder in a field called
    // `title`, the defect that record closed would be back — the person reading
    // it on a phone cannot tell a manufactured name from a real one.
    const seen: Seen = {}
    const h = harness(titlelessProvider(seen))
    const res = await submit(h.app)

    expect(res.status, await res.clone().text()).toBe(201)
    const body = (await res.json()) as Created
    expect(body.title).toEqual({ state: "not_in_source" })
    expect(body.message).toBe("Imported. No title in the source, so this recipe has none.")

    // No name anywhere in the answer, in any field. A sentence about the absence
    // is not a name; a name would be a string the Shortcut could display as one.
    const raw = JSON.stringify(body)
    for (const block of segmentation) {
      expect(raw, `the response carried the page's own wording as a title`).not.toContain(
        block.text,
      )
    }

    // And the stored record agrees with what the person was told.
    const canonical = await h.repo.loadLatestCanonical(body.recipeId)
    expect(canonical?.recipe.title).toEqual({ state: "not_in_source" })
  })

  it("refuses a type a prefix check would have let through", async () => {
    // The point of an ALLOWLIST rather than a `startsWith("image/")` test. A GIF
    // and a TIFF are images and neither is a type this instance's capture path
    // is built for, so `application/pdf` above cannot tell the two designs
    // apart — these can.
    const h = harness()
    for (const contentType of ["image/gif", "image/tiff", "image/svg+xml"]) {
      expect((await submit(h.app, { contentType })).status, contentType).toBe(415)
    }
    expect(h.seen.bytes, "an unsupported image type was handed to capture anyway").toBeUndefined()
  })

  it("reads the media type case-insensitively, as the header field is defined", async () => {
    // A media type is case-insensitive (RFC 9110 §8.3.1) and a client is free to
    // send `IMAGE/JPEG`. Refusing that would be this instance inventing a rule
    // the protocol does not have, and the person would meet it as a capture that
    // simply does not work on their phone.
    const h = harness()
    expect((await submit(h.app, { contentType: "IMAGE/JPEG" })).status).toBe(201)
    expect((await submit(h.app, { contentType: "Image/Heic; charset=utf-8" })).status).toBe(201)
    expect(h.seen.mediaType, "the type reached capture in the header's own casing").toBe(
      "image/heic",
    )
  })

  it("refuses an empty submission instead of capturing nothing", async () => {
    // A Shortcut whose photo action returned nothing posts an empty body. Handing
    // that to capture spends a paid model call on no image and can persist a
    // snapshot of nothing, which is a record no reprocess can ever repair.
    const h = harness()
    const res = await submit(h.app, { body: new Uint8Array(0) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("empty_capture")
    expect(h.seen.bytes, "an empty body was handed to capture").toBeUndefined()
    expect(await h.repo.listLibrary(), "an empty body reached persistence").toEqual([])
  })

  it("refuses a submission past the size bound, and captures nothing from it", async () => {
    // The bound is a bound: one byte over is refused, and the refusal happens
    // before capture, so an oversized body cannot be truncated into a page that
    // looks whole. `MAX_CAPTURE_BYTES` is read off the module rather than
    // written down here, so raising it cannot leave this proof testing a number
    // the route no longer uses.
    const h = harness()
    const res = await submit(h.app, { body: new Uint8Array(MAX_CAPTURE_BYTES + 1) })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toBe("capture_too_large")
    expect(h.seen.bytes, "an oversized body was handed to capture").toBeUndefined()
    expect(await h.repo.listLibrary(), "an oversized body reached persistence").toEqual([])

    // And the bound admits what it says it admits, so it cannot pass by refusing
    // everything: exactly at the limit is accepted.
    const atLimit = new Uint8Array(MAX_CAPTURE_BYTES)
    atLimit.set(PAGE)
    expect((await submit(h.app, { body: atLimit })).status).toBe(201)
  })

  it("refuses an over-declared submission before the handler runs at all", async () => {
    // The half the docstring used to claim and the code did not do. `bodyLimit`
    // sits in front of the handler and answers on `Content-Length` alone.
    //
    // Proved by ORDER rather than by asserting the stream was untouched: the
    // request below also carries an unsupported media type, which the handler
    // answers 415. A 413 can therefore only come from something that ran
    // BEFORE the handler — the handler's own size comparison is four
    // statements past the point where this request would already have been
    // refused. Swap the order and this goes red.
    const h = harness()
    const res = await h.app.request("/capture", {
      method: "POST",
      headers: {
        authorization: `Bearer ${CREDENTIAL}`,
        "content-type": "application/pdf",
        "content-length": String(MAX_CAPTURE_BYTES + 1),
      },
      body: PAGE,
    })
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toBe("capture_too_large")
    expect(h.seen.bytes, "an over-declared body reached capture").toBeUndefined()
  })

  it("answers with every field the committed Shortcut reads, on every outcome", async () => {
    // The client and this endpoint are two halves of one contract, and only one
    // half is a TypeScript file. The keys are read out of the committed
    // definition and required to be present in a real response, so renaming a
    // response field — or pointing the Shortcut at one that does not exist —
    // fails here instead of on a phone. `title` deliberately is NOT among them:
    // since PDR-0005 it is a state, not a sentence, and the client reads the
    // sentence the instance composed.
    const plist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "shortcut")
    const keys = dictionaryKeysRead(
      parsePlist(readFileSync(join(plist, "Capture Recipe.plist"), "utf8")),
    )
    expect(keys.length, "the Shortcut reads no response field at all").toBeGreaterThan(0)

    const answers = [
      await submit(harness().app),
      await submit(
        harness(refusingProvider(new MultipleRecipesError({ count: 2, titles: ["A", "B"] }))).app,
      ),
      await submit(
        harness(refusingProvider(new UnknownRecipeCountError("the model gave no count"))).app,
      ),
    ]
    for (const res of answers) {
      const body = (await res.json()) as Record<string, unknown>
      for (const key of keys) {
        expect(Object.keys(body), `HTTP ${res.status} carries no \`${key}\``).toContain(key)
      }
    }
  })
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

  it("takes the value verbatim, and the scheme name case-insensitively", async () => {
    // Two claims the docstring makes, neither of which had a proof. The second
    // is RFC 7235: the scheme name is case-insensitive and a phone's HTTP
    // client is not this project's to specify.
    expect(bearerCredential(`bearer ${CREDENTIAL}`)).toBe(CREDENTIAL)
    expect(bearerCredential(`BEARER ${CREDENTIAL}`)).toBe(CREDENTIAL)

    // The first is the one review found false. `/^Bearer (.+)$/` matches before
    // a final newline unless `m` is set, so it returned a value the header did
    // not carry — the one case where "unchanged" was not true. Nothing was at
    // risk, because a value with a newline is a different value and is refused
    // either way; what was wrong was a comment promising something the code
    // did not do, which is this repository's recurring defect in miniature.
    expect(bearerCredential(`Bearer ${CREDENTIAL}\n`)).toBe(`${CREDENTIAL}\n`)
    expect(bearerCredential(`Bearer  ${CREDENTIAL}`)).toBe(` ${CREDENTIAL}`)
    expect(bearerCredential("Bearer ")).toBeUndefined()
    expect(bearerCredential("Bearer")).toBeUndefined()
    expect(bearerCredential(undefined)).toBeUndefined()

    // Asserted on the function and NOT end to end, deliberately: measured here,
    // `new Headers({ authorization: "Bearer abc\n" }).get(...)` yields
    // `"Bearer abc"`, so the header layer strips the newline before this
    // function ever sees it. An end-to-end case would pass whatever this
    // function does — it would be measuring undici, not the route. Which also
    // bounds what the advisory was worth: over real HTTP the input cannot
    // arrive. The fix is for the docstring's claim, not for a reachable bug.
  })

  it("refuses to be constructed with a credential short enough to guess", () => {
    // Fail closed at startup rather than serve an endpoint anyone can reach.
    expect(() => createInstanceCredential("changeme", "ingest credential")).toThrow(
      /at least 32 characters/,
    )
  })
})

describe("slice5/ingest-credential-is-submission-only", () => {
  it("offers exactly one route, and it is a submission", () => {
    // The route table is read OFF the app, so a read route added later fails a
    // proof written before it existed.
    //
    // Deduplicated, because Hono lists one entry per HANDLER and this address
    // carries a `bodyLimit` middleware in front of its handler. What the
    // criterion is about is the set of addresses this app answers on, and that
    // set is what is compared: a second path, or a second method on this path,
    // still fails.
    const h = harness()
    const routes = [...new Set(h.app.routes.map((r) => `${r.method} ${r.path}`))].sort()
    expect(routes).toEqual(["POST /capture"])
  })

  it("reaches no library content, even with a valid credential", async () => {
    // A recipe exists and has a capability grant; this app is not a way to it.
    const h = harness()
    await submit(h.app)
    const [entry] = await h.repo.listLibrary()
    expect(entry, "the fixture did not actually produce a library entry").toBeDefined()
    const store = createCapabilityStore(h.repo)
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
    const credential = createInstanceCredential(CREDENTIAL, "ingest credential")
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

    const store = createCapabilityStore(h.repo)
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
    const store = createCapabilityStore(h.repo)
    const grant = await store.issue("recipe-that-was-never-captured")
    const shopping = createCapabilityApp({ store, repo: h.repo })
    expect((await shopping.request(`/r/${grant.token}`)).status).toBe(404)
  })
})
