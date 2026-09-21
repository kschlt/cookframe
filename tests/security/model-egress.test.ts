/**
 * CFV1-SL1 — the model-egress guard (ADR-0013: model egress is its own guarded
 * module beside safe fetch, not an extension of it).
 *
 * Every proof here drives the real module. `fetch` is stubbed, so nothing leaves
 * the process, but the module under test is the one the product ships: what is
 * being proved is the guard's own behaviour, not a re-implementation of it.
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  EgressReason,
  ModelEgressError,
  createModelEndpoint,
} from "../../src/security/model-egress.js"

const CREDENTIAL = "sk-test-do-not-log-me"
const ENDPOINT = "https://api.example.test/v1/chat"

/** A stub standing in for the provider; records what the guard actually sent. */
function respond(init: {
  status?: number
  body?: string
  headers?: Record<string, string>
  delayMs?: number
  chunks?: string[]
}) {
  const calls: { url: string; init: RequestInit }[] = []
  const stub = vi.fn(async (url: string | URL, requestInit: RequestInit) => {
    calls.push({ url: String(url), init: requestInit })
    if (init.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, init.delayMs))
      // A caller that aborts mid-flight rejects rather than resolving.
      if (requestInit.signal?.aborted) throw new Error("aborted")
    }
    const body =
      init.chunks !== undefined
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of init.chunks ?? []) {
                controller.enqueue(new TextEncoder().encode(chunk))
              }
              controller.close()
            },
          })
        : (init.body ?? "{}")
    return new Response(body, {
      status: init.status ?? 200,
      headers: init.headers ?? { "content-type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", stub)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("model-egress/endpoint-is-configuration-not-content", () => {
  it("binds the endpoint at construction, so a send carries no address", () => {
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    // Structural, not checked at run time: the send function's only parameter is
    // the body, so no captured page, model reply or payload can steer egress.
    expect(send.length).toBe(1)
  })

  it("sends to the configured endpoint whatever the body says", async () => {
    const calls = respond({})
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    await send({ url: "https://attacker.test/collect", endpoint: "https://attacker.test" })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
  })

  it("refuses a non-https endpoint when the instance is configured", () => {
    expect(() =>
      createModelEndpoint({ endpoint: "http://api.example.test/v1", credential: CREDENTIAL }),
    ).toThrow(
      expect.objectContaining({ code: EgressReason.SCHEME_NOT_ALLOWED }) as unknown as Error,
    )
  })

  it("refuses an unparseable endpoint when the instance is configured", () => {
    expect(() => createModelEndpoint({ endpoint: "not a url", credential: CREDENTIAL })).toThrow(
      expect.objectContaining({ code: EgressReason.UNPARSEABLE_ENDPOINT }) as unknown as Error,
    )
  })
})

describe("model-egress/redirect-is-refused-never-followed", () => {
  it("refuses a 3xx rather than carrying the credential to the named host", async () => {
    const calls = respond({
      status: 302,
      headers: { location: "https://attacker.test/collect" },
    })
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    await expect(send({})).rejects.toThrow(
      expect.objectContaining({ code: EgressReason.REDIRECT_REFUSED }) as unknown as Error,
    )
    // One call, to the configured host: the redirect was not a hop.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(ENDPOINT)
    // And the request itself asked the runtime not to follow one on its own.
    expect(calls[0]?.init.redirect).toBe("manual")
  })
})

describe("model-egress/credential-never-leaves-the-module", () => {
  it("scrubs the credential out of a provider's refusal message", async () => {
    // A provider that echoes the key back is the case that matters: the guard
    // builds the error, so the scrub is the module's guarantee, not the API's.
    respond({
      status: 401,
      body: JSON.stringify({ error: { message: `bad key ${CREDENTIAL}` } }),
    })
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    const error = await send({}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelEgressError)
    expect((error as ModelEgressError).code).toBe(EgressReason.PROVIDER_REFUSED)
    expect((error as ModelEgressError).status).toBe(401)
    expect((error as Error).message).not.toContain(CREDENTIAL)
    expect((error as Error).message).toContain("[redacted]")
  })

  it("scrubs the credential out of a transport failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect failed while sending ${CREDENTIAL}`)
      }),
    )
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    const error = await send({}).catch((e: unknown) => e)
    expect((error as ModelEgressError).code).toBe(EgressReason.TRANSPORT)
    expect((error as Error).message).not.toContain(CREDENTIAL)
  })

  it("sends the credential as a header and never in the body", async () => {
    const calls = respond({})
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    await send({ model: "a-model", messages: [] })
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${CREDENTIAL}`)
    expect(String(calls[0]?.init.body)).not.toContain(CREDENTIAL)
  })
})

describe("model-egress/bounds-fail-closed", () => {
  it("aborts a response that passes the size bound instead of buffering it", async () => {
    respond({ chunks: ["x".repeat(600), "x".repeat(600)] })
    const send = createModelEndpoint({
      endpoint: ENDPOINT,
      credential: CREDENTIAL,
      maxResponseBytes: 1000,
    })
    await expect(send({})).rejects.toThrow(
      expect.objectContaining({ code: EgressReason.SIZE_LIMIT }) as unknown as Error,
    )
  })

  it("refuses when the deadline elapses instead of waiting", async () => {
    respond({ delayMs: 200 })
    const send = createModelEndpoint({
      endpoint: ENDPOINT,
      credential: CREDENTIAL,
      timeoutMs: 20,
    })
    await expect(send({})).rejects.toThrow(
      expect.objectContaining({ code: EgressReason.TIME_LIMIT }) as unknown as Error,
    )
  })

  it("refuses a body that is not the JSON the endpoint contract promises", async () => {
    respond({ body: "<html>gateway error</html>" })
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    await expect(send({})).rejects.toThrow(
      expect.objectContaining({ code: EgressReason.MALFORMED_RESPONSE }) as unknown as Error,
    )
  })

  it("returns the parsed body and a latency the caller can account with", async () => {
    respond({ body: JSON.stringify({ ok: true }) })
    const send = createModelEndpoint({ endpoint: ENDPOINT, credential: CREDENTIAL })
    const result = await send({})
    expect(result.json).toEqual({ ok: true })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
