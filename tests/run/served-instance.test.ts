/**
 * CFV1-RUN — what the running instance actually answers, over a real socket.
 *
 * Each `describe` string is the acceptance criterion it satisfies. Five of the
 * unit's nine live here, and they are here rather than in an in-process suite
 * for a reason the unit measured on its first smoke run: a Hono app exercised
 * with `app.request(...)` never touches the adapter that turns a response into
 * bytes on a socket, and that adapter is where the one defect this unit found
 * was hiding. See `run/absent-and-forbidden-are-one-answer`, which asks for the
 * same miss twice for exactly that reason.
 *
 * Nothing here needs an API key or a model call: the providers are the
 * repository's deterministic fakes, injected through the same seam production
 * uses (ADR-0004).
 */
import { afterEach, describe, expect, it } from "vitest"
import { NOT_FOUND_BODY, NOT_FOUND_STATUS } from "../../src/http/not-found.js"
import { createFakeCaptureProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider } from "../../src/pipeline/providers.js"
import { mapCanonicalToSchemaOrg } from "../../src/shopping/schema-org-mapping.js"
import {
  canonical,
  captureBody,
  INGEST_CREDENTIAL,
  LIBRARY_CREDENTIAL,
  shapeOf,
  startTestInstance,
  type TestInstance,
} from "./harness.js"

let running: TestInstance | undefined

afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** Start one instance for the current test and remember it for teardown. */
async function instance(): Promise<TestInstance> {
  running = await startTestInstance()
  return running
}

describe("run/the-library-is-not-public", () => {
  it("refuses a request for the library without the instance credential", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "Buttermilk Pancakes"))

    const res = await fetch(`${it_.origin}/`)

    expect(res.status).toBe(NOT_FOUND_STATUS)
    // Not merely "not 200": the title of a recipe in the library must not appear
    // in the refusal, which is the way a listing leaks without serving.
    expect(await res.text()).toBe(NOT_FOUND_BODY)
  })

  it("serves the library to a request that carries the credential", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "Buttermilk Pancakes"))

    const res = await fetch(`${it_.origin}/`, {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8")
    // The operator's library is private, so no cache between the origin and the
    // reader may keep it for whoever asks next (PDR-0002).
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.text()).toContain("Buttermilk Pancakes")
  })

  it("refuses a WRONG credential, and the phone's is a wrong one (PDR-0003)", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "Buttermilk Pancakes"))

    // The ingest credential is a real, configured, instance-scoped secret — and
    // PDR-0003 says it "grants no access to the library beyond submission", and
    // that losing the device does not expose the library. Wiring both routes to
    // one secret is the shortest correct-looking implementation and would pass
    // every other case in this file. This is the case that would not survive it.
    const withPhone = await fetch(`${it_.origin}/`, {
      headers: { authorization: `Bearer ${INGEST_CREDENTIAL}` },
    })
    expect(withPhone.status).toBe(NOT_FOUND_STATUS)
    expect(await withPhone.text()).toBe(NOT_FOUND_BODY)

    // And the phone's credential still works for what it is for, so the case
    // above is about scope rather than about a broken credential.
    const submitted = await fetch(`${it_.origin}/capture`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INGEST_CREDENTIAL}`,
        "content-type": "image/jpeg",
      },
      body: captureBody("Rye Loaf"),
    })
    expect(submitted.status).toBe(201)
  })

  it("refuses a recipe page without the credential, for a recipe that exists", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "Buttermilk Pancakes"))

    const res = await fetch(`${it_.origin}/recipes/recipe-A`)
    expect(res.status).toBe(NOT_FOUND_STATUS)
    expect(await res.text()).toBe(NOT_FOUND_BODY)

    const admitted = await fetch(`${it_.origin}/recipes/recipe-A`, {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })
    expect(admitted.status).toBe(200)
    expect(await admitted.text()).toContain("Buttermilk Pancakes")
  })
})

describe("run/the-capability-url-needs-no-credential", () => {
  it("serves a capability URL to a caller holding no credential at all", async () => {
    const it_ = await instance()
    const recipe = canonical("recipe-A", "Buttermilk Pancakes")
    await it_.repo.appendCanonicalVersion(recipe)
    const grant = await it_.capabilityStore.issue("recipe-A")

    // No `authorization` header anywhere. Bring fetches this server-side and
    // cannot authenticate (ADR-0011, ADR-0017); the token in the path IS the
    // authority, which is why the same instance treats these two routes
    // oppositely on purpose.
    const res = await fetch(`${it_.origin}/r/${grant.token}`)

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/ld+json")
    expect(await res.text()).toBe(JSON.stringify(mapCanonicalToSchemaOrg(recipe).recipe))
  })

  it("and the capability route grants nothing beyond its one recipe", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "A"))
    await it_.repo.appendCanonicalVersion(canonical("recipe-B", "B"))
    const grant = await it_.capabilityStore.issue("recipe-A")

    // Holding a valid token is not holding the library: the same caller, with
    // the same token, reaches neither the listing nor the other recipe.
    const library = await fetch(`${it_.origin}/`, {
      headers: { authorization: `Bearer ${grant.token}` },
    })
    expect(library.status).toBe(NOT_FOUND_STATUS)

    const other = await fetch(`${it_.origin}/recipes/recipe-B`, {
      headers: { authorization: `Bearer ${grant.token}` },
    })
    expect(other.status).toBe(NOT_FOUND_STATUS)
  })
})

describe("run/absent-and-forbidden-are-one-answer", () => {
  it("answers a forbidden recipe, an absent recipe and an unknown token identically", async () => {
    const it_ = await instance()
    await it_.repo.appendCanonicalVersion(canonical("recipe-A", "Buttermilk Pancakes"))
    const grant = await it_.capabilityStore.issue("recipe-A")
    await it_.capabilityStore.revoke(grant.token)

    // Everything a caller holding NOTHING can learn about this instance. If any
    // two of these differ in status, body or content type, the pair is an
    // oracle: ask for an id, and the answer tells you whether it exists.
    const shapes = await Promise.all(
      [
        // exists, but they hold no credential
        `${it_.origin}/recipes/recipe-A`,
        // does not exist
        `${it_.origin}/recipes/recipe-Z`,
        // a token that was never issued
        `${it_.origin}/r/never-issued-token`,
        // a token that was issued and revoked
        `${it_.origin}/r/${grant.token}`,
        // not an address at all
        `${it_.origin}/nothing-here`,
        // the library itself
        `${it_.origin}/`,
      ].map(async (url) => shapeOf(await fetch(url))),
    )

    const first = shapes[0]
    expect(first).toEqual({
      status: NOT_FOUND_STATUS,
      contentType: "text/plain; charset=utf-8",
      body: NOT_FOUND_BODY,
    })
    for (const shape of shapes) expect(shape).toEqual(first)
  })

  it("and the SECOND miss is the same as the first, over a real socket", async () => {
    const it_ = await instance()

    // This case exists because of a measured defect, and it is the one case in
    // this suite that a second reviewer would call redundant. It is not.
    //
    // `@hono/node-server` writes the content length back into the headers record
    // a handler passed to `c.body(...)`:
    //     header["Content-Length"] = Buffer.byteLength(body)
    // A module-level constant handed to `c.body` is therefore mutated by the
    // first response that uses it, and carries a NUMBER afterwards. Hono's next
    // response over that record throws `TypeError: v is not iterable`, so the
    // second miss the process ever serves is a 500 — an instance that tells one
    // caller "Not Found" and the next one "Internal Server Error" has the oracle
    // back, and a smoke test that asks once sees nothing wrong.
    //
    // It survived nineteen pull requests because `app.request(...)` never
    // reaches that code. Asking twice is what makes the proof discriminating.
    //
    // **All three shared values, not just one.** `not-found.ts` exports a body,
    // a status and a headers object; only the OBJECT can be mutated, because a
    // string and a number are immutable in JavaScript and the adapter writes
    // into a record. The comparison below is over all three response fields
    // anyway — status, content type and body — so a second response that
    // differed in any of them fails here.
    const first = await shapeOf(await fetch(`${it_.origin}/nothing-here`))
    const second = await shapeOf(await fetch(`${it_.origin}/nothing-else`))
    const third = await shapeOf(await fetch(`${it_.origin}/recipes/recipe-Z`))

    expect(first.status).toBe(NOT_FOUND_STATUS)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })
})

describe("run/one-store-per-process", () => {
  it("the import path writes what the pages and the capability URL read", async () => {
    const it_ = await instance()

    // Written through the ingest route, over the socket — nothing in this test
    // touches the repository to put it there.
    const submitted = await fetch(`${it_.origin}/capture`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INGEST_CREDENTIAL}`,
        "content-type": "image/jpeg",
      },
      body: captureBody("Sourdough Rye"),
    })
    expect(submitted.status).toBe(201)
    const created = (await submitted.json()) as { recipeId: string }

    // Read back through the OTHER two paths. A second store anywhere in the
    // process — a page route that constructed its own, a capability route given
    // a different repository — makes both of these misses, and no amount of
    // reading the composition root proves it the way this does.
    const page = await fetch(`${it_.origin}/recipes/${created.recipeId}`, {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })
    expect(page.status).toBe(200)

    const grant = await it_.capabilityStore.issue(created.recipeId)
    const served = await fetch(`${it_.origin}/r/${grant.token}`)
    expect(served.status).toBe(200)

    // And the listing sees it too, which is the read a projection would be the
    // first thing to serve from somewhere else.
    const library = await fetch(`${it_.origin}/`, {
      headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
    })
    expect(await library.text()).toContain(created.recipeId)
  })
})

describe("run/a-stop-leaves-nothing-half-written", () => {
  it("lets an in-flight submission finish, and leaves a whole record", async () => {
    // A capture slow enough that the stop lands in the middle of it. The delay
    // sits on the injected provider, so the request really is in flight INSIDE
    // the process rather than merely late in arriving.
    const inner = createFakeCaptureProvider()
    const slow: CaptureProvider = {
      async capture(bytes, ctx) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return inner.capture(bytes, ctx)
      },
    }
    running = await startTestInstance({ capture: slow })
    const it_ = running

    const inFlight = fetch(`${it_.origin}/capture`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INGEST_CREDENTIAL}`,
        "content-type": "image/jpeg",
      },
      body: captureBody("Half Written"),
    })

    // Long enough to be inside the capture, short enough to be well before it
    // returns. The assertion below is what makes this a measurement rather than
    // a hope: a stop that cut the request off would not answer 201.
    //
    // **Would a no-op `stop()` pass this?** No, and it was measured rather than
    // reasoned: a stop that severs in-flight connections fails the 201, a stop
    // that never releases the store fails `closed.count`, and a stop that does
    // nothing at all leaves the port answering and fails the last line. All
    // three are planted mutations and all three are red.
    await new Promise((resolve) => setTimeout(resolve, 80))
    const stopped = it_.stop()

    const res = await inFlight
    expect(res.status).toBe(201)
    const created = (await res.json()) as { snapshotId: string; recipeId: string }

    await stopped
    running = undefined

    // The record is WHOLE: the snapshot the submission stored and the recipe
    // normalized from it are both present. A stop between the two writes is the
    // failure this criterion names, and it would leave the first without the
    // second.
    expect(await it_.repo.loadSnapshot(created.snapshotId)).toBeDefined()
    expect(await it_.repo.loadLatestCanonical(created.recipeId)).toBeDefined()

    // The store handle was released, once, and only after the request was
    // answered — CFV1-PG's `close()` arrives on this seam.
    expect(it_.closed.count).toBe(1)

    // And nothing is listening afterwards: the next request does not arrive
    // half-served, it does not arrive at all.
    await expect(fetch(`${it_.origin}/`)).rejects.toThrow()
  })

  it("holds no deferred work: a stop needs nothing drained beyond the request", async () => {
    // ADR-0008 forbids a queue, a broker and a worker, and PDR-0004's background
    // generation is explicitly not an exception. What that BUYS is this: an idle
    // instance can be stopped immediately, because there is nothing it owes.
    //
    // Stated exactly, because the criterion's second clause is easy to overclaim:
    // this measures that a stop with nothing in flight completes, and that the
    // instance served nothing afterwards. It does NOT measure that a record
    // survives a restart — that is the store's property, not this seam's, and
    // it is measured at the store: `persistence/a-restart-keeps-the-library`
    // (CFV1-PG), and — since CFV1-WIRE wired the durable store into the entry
    // point — across two real processes at `wire/a-restart-keeps-the-library`.
    // This suite injects its own store, so neither property is this seam's.
    const it_ = await instance()
    await fetch(`${it_.origin}/nothing-here`)

    await it_.stop()
    running = undefined

    expect(it_.closed.count).toBe(1)
    await expect(fetch(`${it_.origin}/`)).rejects.toThrow()
  })
})
