/**
 * run/a-link-can-be-imported-from-a-running-instance — the behavioural half of
 * CFV1-URLR.
 *
 * `serve/every-ingest-entry-point-is-reachable` reads the tree and requires the
 * HTTP layer to CALL each way into the pipeline. It cannot see whether the call
 * sits on a path a request reaches, and it says so. This is what sees that: a
 * real instance on a real port, asked to import a real link, with the shipped
 * safe-fetch byte source doing the fetch.
 *
 * Nothing here is constructed that a production instance does not construct.
 * The one difference is `allowLoopback`, which the connector exposes as its
 * test-only seam so a proof can reach a server on 127.0.0.1 — a production
 * instance passes no options and the same address is refused, which the last
 * case measures rather than assumes. That difference is the reason this proof
 * can exist at all, and keeping it to exactly that one flag is what keeps the
 * proof about the instance rather than about a fixture.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createFakeCaptureProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureContext, CaptureProvider } from "../../src/pipeline/providers.js"
import { createUrlCaptureProvider } from "../../src/pipeline/url-capture.js"
import { createDeterministicUrlCaptureProvider } from "../../src/pipeline/url-jsonld-adapter.js"
import type { UrlByteSource } from "../../src/security/url-byte-source.js"
import { createSafeUrlByteSource } from "../../src/security/url-byte-source.js"
import { INGEST_CREDENTIAL, startTestInstance, type TestInstance } from "./harness.js"

const recipe = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Synthetic Test Loaf",
  recipeYield: "1 loaf",
  recipeIngredient: ["200 g flour", "1 tsp salt", "300 ml water"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mix the flour and salt." },
    { "@type": "HowToStep", text: "Add water and stir to a dough." },
    { "@type": "HowToStep", text: "Bake until golden." },
  ],
}

const pageHtml = (jsonLd: unknown): string =>
  `<!doctype html><html><head><title>fixture</title>` +
  `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
  `</head><body><p>rendered body, ignored by the adapter</p></body></html>`

let pages: Server
let pagePort: number
let instance: TestInstance

/**
 * **The URL capture path as `main.ts` composes it**, with two things recorded.
 *
 * The first version of this proof passed `createDeterministicUrlCaptureProvider()`
 * in as the instance's `capture`, and that is what the review blocked: the
 * instance under test had the deterministic reader because the TEST gave it one,
 * while `main.ts` gave the model provider to both entries, so a fetched page
 * went to the model whole and the reader was never on the path. A proof that
 * builds its own subject — the shape this unit was written against, one layer
 * down.
 *
 * What is built here is therefore `createUrlCaptureProvider(...)`, the same
 * composite the entry point composes, with the deterministic half SHIPPED. The
 * model half cannot be: a real one calls a model over the network. So the
 * fallback is a fake, and the consequence is stated rather than glossed —
 * nothing here shows that `main.ts` composes this pair. What shows that is
 * `serve/a-url-import-runs-the-url-capture-path`, which reads the composition
 * root; this file shows what the composed pair DOES.
 *
 * Two recorders, each for a claim no stored value can carry:
 *
 * - `seen` holds the context the composite was handed. `sourceProvenance` is
 *   consumed by the provider and never persisted, so no assertion about the
 *   snapshot could see it.
 * - `fallbackCalls` holds what reached the model half. That it is NOT called for
 *   a page carrying usable JSON-LD is the whole point of the composite, and an
 *   absence is not visible anywhere else.
 */
const seen: CaptureContext[] = []
const fallbackCalls: { text: string; ctx: CaptureContext }[] = []

const modelFallback: CaptureProvider = {
  capture: async (input, ctx) => {
    fallbackCalls.push({ text: new TextDecoder().decode(input), ctx })
    return createFakeCaptureProvider().capture(input, ctx)
  },
}

const recordingCapture = (): CaptureProvider => {
  const real = createUrlCaptureProvider(createDeterministicUrlCaptureProvider(), modelFallback)
  return {
    capture: async (input, ctx) => {
      seen.push(ctx)
      return real.capture(input, ctx)
    },
  }
}

/**
 * A page with NO structured data at all — the case the composite's model
 * fallback exists for. Its prose is distinctive so a proof can tell the text the
 * model was handed from the markup it was wrapped in.
 */
const plainHtml =
  `<!doctype html><html><head><title>fixture</title></head><body>` +
  `<h1>Synthetic Plain Loaf</h1>` +
  `<p>Mix two hundred grams of flour with a teaspoon of salt, then bake.</p>` +
  `</body></html>`

function handle(req: IncomingMessage, res: ServerResponse): void {
  res.on("error", () => {})
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(req.url === "/plain" ? plainHtml : pageHtml(recipe))
}

beforeAll(async () => {
  pages = createServer(handle)
  await new Promise<void>((resolve) => pages.listen(0, "127.0.0.1", resolve))
  pagePort = (pages.address() as AddressInfo).port
  instance = await startTestInstance({
    // The shipped source, with the connector's one test-only seam open so a
    // loopback page is reachable. Everything else is the production connector.
    byteSource: createSafeUrlByteSource({ allowLoopback: true }),
    urlCapture: recordingCapture(),
  })
})

afterAll(async () => {
  await instance.stop()
  await new Promise<void>((resolve) => pages.close(() => resolve()))
})

const submit = async (url: unknown, over?: { credential?: string | null }): Promise<Response> => {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const credential = over === undefined ? INGEST_CREDENTIAL : over.credential
  if (typeof credential === "string") headers.authorization = `Bearer ${credential}`
  return fetch(`${instance.origin}/capture/url`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  })
}

describe("run/a-link-can-be-imported-from-a-running-instance", () => {
  it("imports the recipe at a link and stores it where the library reads", async () => {
    const res = await submit(`http://127.0.0.1:${pagePort}/recipe`)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; snapshotId: string }

    // Not the response's own word for it: the recipe is read back out of the
    // repository the instance was composed with. A route that answered 201 and
    // stored nothing would pass a status assertion and fail this one.
    const stored = await instance.repo.loadSnapshot(body.snapshotId)
    expect(stored?.id).toBe(body.snapshotId)

    // And the LIBRARY, which is a different read off a different map: the
    // snapshot is what came in, the library row is what a person opens. A route
    // that captured and never normalised would satisfy the snapshot assertion
    // above and leave this listing empty.
    const library = await instance.repo.listLibrary()
    expect(library.map((entry) => entry.recipeId)).toContain(body.recipeId)
    expect(library.find((entry) => entry.recipeId === body.recipeId)?.title).toBe(
      "Synthetic Test Loaf",
    )
  })

  it("stores the snapshot under the URL entry's own adapter identity", async () => {
    const res = await submit(`http://127.0.0.1:${pagePort}/recipe`)
    const body = (await res.json()) as { snapshotId: string }
    const stored = await instance.repo.loadSnapshot(body.snapshotId)

    // The photo path stamps `ios-shortcut`. A snapshot's provenance is meant to
    // say which way the recipe came in, and one address reusing the other's name
    // would make the two indistinguishable afterwards.
    expect(stored?.captureProvenance.sourceAdapter).toBe("url-import")
  })

  /**
   * ADR-0019: PROVENANCE, not media type, is what earns a model-backed provider
   * its verification exemption. A URL import that reached capture as a
   * photograph would hand someone else's words the exemption meant for pixels —
   * and since the field is never persisted, no assertion about the stored
   * snapshot could see it. The provider is asked instead.
   *
   * It fails closed on an ABSENT provenance, so a bare "this is safe" would be
   * true for the wrong reason: what is asserted is the value, not the absence of
   * harm.
   */
  it("hands capture the provenance that denies a fetched page the photo exemption", async () => {
    seen.length = 0
    await submit(`http://127.0.0.1:${pagePort}/recipe`)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.sourceProvenance).toBe("url")
  })

  it("answers an unauthenticated submission the same way the photo address does", async () => {
    expect((await submit(`http://127.0.0.1:${pagePort}/recipe`, { credential: null })).status).toBe(
      401,
    )
    expect(
      (await submit(`http://127.0.0.1:${pagePort}/recipe`, { credential: "wrong" })).status,
    ).toBe(401)
  })

  it("names a submission with no link as the caller's mistake, not as a refusal", async () => {
    const res = await submit(undefined)
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: "missing_url" })
  })

  /**
   * The refusal, end to end and through the composed instance — and the reason
   * the wording is built from the code rather than relayed.
   *
   * `file:` is refused by the URL guard before a socket is opened, so this also
   * shows the guard is genuinely in the path: a route that fetched around it
   * would answer 201 here.
   */
  it("hands the guard's verdict back as the verdict, and nothing else of it", async () => {
    const res = await submit("file:///etc/passwd")
    expect(res.status).toBe(422)
    const body = (await res.json()) as { reasonCode: string; message: string }
    expect(body.reasonCode).toBe("SCHEME_NOT_ALLOWED")
    // The sentence is the scheme's own, not the catch-all: "that link points at
    // an address this instance will not fetch from" would be true here and
    // useless, because the thing to change is the scheme and it would not say so.
    expect(body.message).toContain("http and https")
    // The sentence is ours. What must NOT be here is the path the caller asked
    // about coming back out of the instance, which is what relaying the error's
    // own message would have done.
    expect(body.message).not.toContain("/etc/passwd")
    expect(JSON.stringify(body)).not.toContain("/etc/passwd")
  })

  /**
   * The composite, from the outside: a page that publishes its recipe
   * machine-readably is read by the deterministic adapter, and the model half is
   * NOT reached.
   *
   * An absence, asserted as the value it is: `fallbackCalls` is cleared first, so
   * "empty" means "nothing arrived during this import" rather than "nothing has
   * ever arrived". The mutation this is written against is the one the review
   * found — handing the route the photo path's provider — under which every page
   * goes to the model and this list holds one entry.
   */
  it("reads a page's own structured data, and the model is not called at all", async () => {
    fallbackCalls.length = 0
    const res = await submit(`http://127.0.0.1:${pagePort}/recipe`)
    expect(res.status).toBe(201)
    expect(fallbackCalls).toHaveLength(0)
  })

  /**
   * And the other half of the composite: a page carrying no structured data
   * reaches the model — with the page's TEXT, never its markup (ADR-0019 §4a).
   *
   * Both halves are asserted, because "reached the model" alone would pass for a
   * route that handed over the raw HTML, which is exactly the state this unit was
   * blocked for. The provenance travels with it, so the model-backed provider
   * verifies against that text instead of taking the vision exemption.
   */
  it("reaches the model with the page's text, not its markup, when there is no structured data", async () => {
    fallbackCalls.length = 0
    const res = await submit(`http://127.0.0.1:${pagePort}/plain`)
    expect(res.status).toBe(201)
    expect(fallbackCalls).toHaveLength(1)

    const handed = fallbackCalls[0]
    expect(handed?.text).toContain("Synthetic Plain Loaf")
    expect(handed?.text).toContain("two hundred grams of flour")
    expect(handed?.text).not.toContain("<h1")
    expect(handed?.text).not.toContain("<!doctype")
    expect(handed?.ctx.sourceProvenance).toBe("url")
  })

  it("refuses a private address as an address, without naming which range", async () => {
    // A private-range literal, refused before a socket is opened. The seam this
    // instance opens is `allowLoopback` and nothing else — measured, not
    // assumed: `http://localhost:<port>` is admitted here, so the loopback NAME
    // rule is opened by that flag too, and a proof written around the name
    // would have been measuring the seam rather than the guard.
    const res = await submit("http://10.0.0.1/recipe")
    expect(res.status).toBe(422)
    const body = (await res.json()) as { reasonCode: string; message: string }
    expect(body.reasonCode).toBe("PRIVATE_RANGE")
    // Seven address reason codes collapse to one sentence, so the sentence
    // cannot say which range a host landed in. The code still can, and the
    // caller holding the ingest credential is the operator — but the words a
    // person sees are not where that detail belongs.
    expect(body.message).not.toContain("10.0.0.1")
    expect(body.message).toContain("an address this instance will not fetch from")
  })
})

/**
 * The connector behind the byte source holds a connection pool open across
 * calls, so an instance that stopped without releasing it would leave one — and
 * one released EARLY, while an import is still fetching, would turn a clean stop
 * into a half-written record, which is the ordering `closeStore` is documented
 * for and this seam inherits.
 *
 * Written because the condition existed and nothing measured it: `closeByteSource`
 * could be deleted from `stopServer` and every other proof in this repository
 * stayed green. A condition whose removal kills no fixture has two possible
 * causes, and this one was the second — the fixture had never been written.
 */
describe("run/a-stop-releases-the-fetch-pool", () => {
  /**
   * **The duration, measured rather than left to a default.** This proof takes a
   * fixed 3.26 seconds — three runs, 3262/3261/3263 ms — and that time is not
   * this proof's doing: the already-merged `run/a-stop-leaves-nothing-half-written`
   * measures 3262 ms for the same shape, and the byte source itself loads in
   * 30 ms and closes in 3. It is the cost of draining an instance whose client
   * still holds a keep-alive socket, and it is the same for any proof that stops
   * one mid-request.
   *
   * The bound below is therefore CHOSEN, not measured: 15 s is the measured cost
   * with room for a loaded machine. What it is not is the 5 s default, against
   * which a 1.7 s margin would make a red here read like a flake — which is the
   * defect `CFV1-TMO` is about, and the reason this number is written down with
   * its measurement instead of inherited.
   */
  it("closes the byte source once, and not before the import it is serving is answered", async () => {
    const order: string[] = []
    const real = createSafeUrlByteSource({ allowLoopback: true })
    const slow: UrlByteSource = {
      load: async (url) => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        return real.load(url)
      },
      close: async () => {
        order.push("closed")
        await real.close()
      },
    }

    const running = await startTestInstance({ byteSource: slow, urlCapture: recordingCapture() })
    const inFlight = fetch(`${running.origin}/capture/url`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INGEST_CREDENTIAL}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: `http://127.0.0.1:${pagePort}/recipe` }),
    })

    // Inside the fetch, well before it returns. A stop that severed the
    // connection would fail the 201 below rather than the ordering.
    await new Promise((resolve) => setTimeout(resolve, 80))
    const stopped = running.stop()

    const res = await inFlight
    // The body is read as well as the status, so "answered" means the whole
    // response arrived rather than only its headers.
    expect((await res.json()) as { recipeId: string }).toHaveProperty("recipeId")
    order.push("answered")
    expect(res.status).toBe(201)

    await stopped
    // Once, and after — not merely "at some point". A close that ran on the way
    // in would satisfy a bare count and is the failure this is written against.
    expect(order).toEqual(["answered", "closed"])
  }, 15_000)
})
