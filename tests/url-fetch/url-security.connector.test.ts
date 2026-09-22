/**
 * CFV1-S5 — URL ingestion security suite, connector unit.
 *
 * This file is the adversarial suite for the part of Gate E that needs a live
 * connection: the undici connector's resolve-and-pin (ADR-0010 points 3-5),
 * per-hop redirect re-validation and the count bound (point 6), and the
 * fail-closed size / content-type / time bounds (point 7). The address-level
 * criteria live in `url-security.address.test.ts`; this file completes S5.
 *
 * Each network criterion is exercised against a loopback HTTP server through the
 * *test-only* seams ADR-0010 point 11 specifies — `allowLoopback`, so the
 * `127.0.0.1` server is reachable as the allowed leg of a chain, and a
 * deterministic `resolve`, so the resolve-and-pin proofs are hermetic. Neither
 * seam is ever passed in production, and the chokepoint test keeps this module
 * the only one that may open a socket.
 *
 * A property proven once by hand is not proven (S5 constraint): each `it` name
 * carries its `url-security/<criterion>` proof tag, refusals are asserted by
 * their discriminable reason code, and the size bound is shown to discriminate
 * against a permissive reader that would truncate and proceed.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ReasonCode } from "../../src/security/reason-codes.js"
import {
  createSafeFetcher,
  type Resolver,
  SafeFetchError,
  type SafeFetcher,
} from "../../src/security/safe-fetch.js"

let server: Server
let port: number

/** Adversarial routes. Each models one bypass or bound the guard must hold. */
function handle(req: IncomingMessage, res: ServerResponse): void {
  res.on("error", () => {}) // swallow ECONNRESET when the guard aborts mid-write
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
  const path = url.pathname

  switch (path) {
    case "/ok": {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end("<h1>a recipe</h1>")
      return
    }
    case "/script": {
      res.writeHead(200, { "content-type": "text/html" })
      // If this were ever executed it would set a global; it must arrive as data.
      res.end("<script>globalThis.__cookframe_pwned = true</script><h1>hi</h1>")
      return
    }
    case "/redir-to-ok": {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` })
      res.end()
      return
    }
    case "/redir-to-literal-private": {
      res.writeHead(302, { location: "http://10.0.0.5/recipe" })
      res.end()
      return
    }
    case "/redir-to-named-private": {
      res.writeHead(302, { location: `http://internal.test:${port}/recipe` })
      res.end()
      return
    }
    case "/redir-to-ftp": {
      res.writeHead(302, { location: "ftp://example.com/recipe" })
      res.end()
      return
    }
    case "/redir-without-location": {
      // A 302 whose Location is missing. Servers do emit these, and the shape a
      // careless refactor takes is to default the header rather than refuse.
      res.writeHead(302)
      res.end()
      return
    }
    case "/redir-hop": {
      // /redir-hop?n=K bounces to n=K-1, terminating at /ok — a chain of length K.
      const n = Number(url.searchParams.get("n") ?? "0")
      if (n > 0) {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/redir-hop?n=${n - 1}` })
        res.end()
      } else {
        res.writeHead(200, { "content-type": "text/html" })
        res.end("<h1>end</h1>")
      }
      return
    }
    case "/big": {
      const body = "x".repeat(8000)
      res.writeHead(200, { "content-type": "text/html", "content-length": String(body.length) })
      res.end(body)
      return
    }
    case "/gzip-big": {
      // A highly compressible 8 KB body: the *compressed* length declared here is
      // tiny, but the decompressed stream far exceeds a small bound. Counting on
      // Content-Length would wave it through — the guard must count decompressed.
      const compressed = gzipSync(Buffer.from("x".repeat(8000)))
      res.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
      })
      res.end(compressed)
      return
    }
    case "/chunked-big": {
      // No content-length: Node uses chunked transfer-encoding. The guard must
      // still bound it, on the decompressed stream rather than a declared length.
      res.writeHead(200, { "content-type": "text/html" })
      for (let i = 0; i < 8; i++) res.write("x".repeat(1000))
      res.end()
      return
    }
    case "/wrong-ct": {
      res.writeHead(200, { "content-type": "image/png" })
      res.end("not really a png")
      return
    }
    case "/no-ct": {
      res.writeHead(200)
      res.end("body with no content type")
      return
    }
    case "/slow-headers": {
      // Never send headers within the deadline: the header phase must time out.
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end("<h1>late</h1>")
      }, 2000).unref()
      return
    }
    case "/slow-body": {
      // Headers immediately, then a body that never completes within the deadline.
      res.writeHead(200, { "content-type": "text/html" })
      res.write("<h1>")
      setTimeout(() => res.end("late</h1>"), 2000).unref()
      return
    }
    default: {
      res.writeHead(404, { "content-type": "text/html" })
      res.end("nope")
      return
    }
  }
}

beforeAll(async () => {
  server = createServer(handle)
  server.on("clientError", (_err, socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** A fetcher wired to the loopback server via the test-only seams. */
function makeFetcher(overrides: Parameters<typeof createSafeFetcher>[0] = {}): SafeFetcher {
  return createSafeFetcher({ allowLoopback: true, ...overrides })
}

const local = (path: string): string => `http://127.0.0.1:${port}${path}`

/** Await a fetch and assert it refused with a specific discriminable code. */
async function expectRefusal(
  fetcher: SafeFetcher,
  input: string,
  code: ReasonCode,
): Promise<SafeFetchError> {
  try {
    await fetcher.fetch(input)
  } catch (error) {
    expect(error, `${input} threw a SafeFetchError`).toBeInstanceOf(SafeFetchError)
    const e = error as SafeFetchError
    expect(e.reasonCode, `${input} refused as ${code}`).toBe(code)
    return e
  }
  throw new Error(`${input} was expected to be refused as ${code}, but it resolved`)
}

describe("CFV1-S5 safe-fetch connector", () => {
  it("fetches an allowed loopback target through the seam (baseline)", async () => {
    const fetcher = makeFetcher()
    try {
      const result = await fetcher.fetch(local("/ok"))
      expect(result.contentType).toBe("text/html")
      expect(new TextDecoder().decode(result.bytes)).toContain("a recipe")
      expect(result.finalUrl).toBe(local("/ok"))
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/dns-rebinding-refused", async () => {
    // The TOCTOU bypass consumes two DNS answers: the first classified, the
    // second connected to. The connector resolves once and pins, so a resolver
    // that would flip to a private address on a *second* lookup never gets one.
    let calls = 0
    const flipping: Resolver = async () => {
      calls++
      return calls === 1 ? ["127.0.0.1"] : ["10.0.0.5"]
    }
    const fetcher = makeFetcher({ resolve: flipping })
    try {
      const result = await fetcher.fetch(`http://rebind.test:${port}/ok`)
      expect(new TextDecoder().decode(result.bytes)).toContain("a recipe")
      // Exactly one resolution took place: there is no second answer to rebind to.
      expect(calls).toBe(1)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/dns-rebinding-refused (the pinned address is the classified one)", async () => {
    // If the single resolution yields a private address, the connection is
    // refused — the address validated is exactly the address connected to.
    const toPrivate: Resolver = async () => ["10.0.0.5"]
    const fetcher = makeFetcher({ resolve: toPrivate })
    try {
      await expectRefusal(fetcher, `http://rebind.test:${port}/ok`, ReasonCode.PRIVATE_RANGE)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/dns-rebinding-refused (the validated address is the one connected to)", async () => {
    // The proof above it asserts that a resolver answering with a private
    // address is refused. That is a fact about `classifyAddress`, and it is
    // reached before the connector ever hands an address down — so it cannot
    // see WHICH address the connection is made to. Measured: replacing the
    // connector's pinned address with the original hostname leaves that proof
    // green, and reddens only `dns-rebinding-refused`, there with a bare
    // transport failure because `rebind.test` has no DNS entry. A foreign
    // failure, not an assertion about pinning.
    //
    // This one discriminates with two loopback addresses. The server for this
    // case listens on `127.0.0.2` and nothing listens on `127.0.0.1`. The URL
    // names `localhost`, which real DNS answers with `127.0.0.1`. So the fetch
    // can only succeed if the address the guard *validated* is the address it
    // *connected to*; a connector that passed the hostname down, or looked it
    // up a second time, reaches an empty port and this fails.
    const alt = createServer(handle)
    await new Promise<void>((resolve) => alt.listen(0, "127.0.0.2", () => resolve()))
    const altPort = (alt.address() as AddressInfo).port
    try {
      const toAlt: Resolver = async () => ["127.0.0.2"]
      const fetcher = makeFetcher({ resolve: toAlt })
      try {
        // The refusal is caught and restated rather than left to propagate: a
        // bare `TRANSPORT` escaping here would report the empty port, not the
        // property that was violated.
        let body: string
        try {
          body = new TextDecoder().decode(
            (await fetcher.fetch(`http://localhost:${altPort}/ok`)).bytes,
          )
        } catch (error) {
          const code = error instanceof SafeFetchError ? error.reasonCode : String(error)
          throw new Error(
            `the connection did not go to the validated address 127.0.0.2 — it was refused as ${code}, which is what reaching \`localhost\`'s own answer (127.0.0.1, nothing listening) looks like`,
          )
        }
        expect(body, "the server on the validated address answered").toContain("a recipe")
      } finally {
        await fetcher.close()
      }
    } finally {
      await new Promise<void>((resolve) => alt.close(() => resolve()))
    }
  })

  it("url-security/multi-address-answer-refused", async () => {
    // A name resolving to several addresses, one of them private, is refused
    // whole — the guard classifies every returned address, not just the first,
    // so Happy Eyeballs cannot race to the unvalidated one.
    const mixed: Resolver = async () => ["127.0.0.1", "10.0.0.5"]
    const fetcher = makeFetcher({ resolve: mixed })
    try {
      await expectRefusal(fetcher, `http://multi.test:${port}/ok`, ReasonCode.PRIVATE_RANGE)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/redirect-revalidation", async () => {
    // A chain whose *first* hop is allowed but whose *later* hop points at a
    // refused destination is refused at that hop, and the refusal names it.
    const fetcher = makeFetcher()
    try {
      const e = await expectRefusal(
        fetcher,
        local("/redir-to-literal-private"),
        ReasonCode.PRIVATE_RANGE,
      )
      expect(e.url, "the refusal names the offending hop").toBe("http://10.0.0.5/recipe")
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/redirect-revalidation (named host re-classified on connect)", async () => {
    // Same, but the later hop is a *name* that resolves to a private address —
    // caught by the connector on connect, not by the URL-level pre-flight.
    const resolve: Resolver = async (host) =>
      host === "internal.test" ? ["10.0.0.5"] : ["127.0.0.1"]
    const fetcher = makeFetcher({ resolve })
    try {
      await expectRefusal(fetcher, local("/redir-to-named-private"), ReasonCode.PRIVATE_RANGE)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/redirect-count-bound", async () => {
    const fetcher = makeFetcher({ maxRedirects: 2 })
    try {
      await expectRefusal(fetcher, local("/redir-hop?n=5"), ReasonCode.REDIRECT_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("follows a redirect within the bound to its terminal response", async () => {
    const fetcher = makeFetcher({ maxRedirects: 2 })
    try {
      const result = await fetcher.fetch(local("/redir-to-ok"))
      expect(result.finalUrl).toBe(local("/ok"))
      expect(new TextDecoder().decode(result.bytes)).toContain("a recipe")
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/redirect-invalid-refused", async () => {
    // Measured, and the reason this proof exists: `REDIRECT_INVALID` was named
    // nowhere in `tests/` before this one. Replacing the guard's refusal with
    // `response.headers.get("location") || "/ok"` — a default instead of a
    // refusal, which is what a refactor reaching for the simpler type does —
    // left every proof in this directory green. The promise was in
    // `safe-fetch.ts` and in ADR-0010's prose, and nothing held it.
    const fetcher = makeFetcher()
    try {
      await expectRefusal(fetcher, local("/redir-without-location"), ReasonCode.REDIRECT_INVALID)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/scheme-allowlist (reached by redirect)", async () => {
    const fetcher = makeFetcher()
    try {
      await expectRefusal(fetcher, local("/redir-to-ftp"), ReasonCode.SCHEME_NOT_ALLOWED)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/size-bound-fails-closed", async () => {
    const fetcher = makeFetcher({ maxBytes: 1000 })
    try {
      await expectRefusal(fetcher, local("/big"), ReasonCode.SIZE_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/size-bound-fails-closed (decompressed, not Content-Length)", async () => {
    // The bypass criterion 12 names: a small declared (compressed) length whose
    // decompressed stream overflows the bound. Counting on the decompressed
    // stream is what refuses it; a Content-Length check would let it through.
    const fetcher = makeFetcher({ maxBytes: 1000 })
    try {
      await expectRefusal(fetcher, local("/gzip-big"), ReasonCode.SIZE_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/chunked-response-bounded", async () => {
    // No declared length (chunked); the bound still holds on the read stream.
    const fetcher = makeFetcher({ maxBytes: 1000 })
    try {
      await expectRefusal(fetcher, local("/chunked-big"), ReasonCode.SIZE_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/content-type-bound-fails-closed", async () => {
    const fetcher = makeFetcher()
    try {
      await expectRefusal(fetcher, local("/wrong-ct"), ReasonCode.CONTENT_TYPE_NOT_ALLOWED)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/content-type-bound-fails-closed (absent type)", async () => {
    const fetcher = makeFetcher()
    try {
      await expectRefusal(fetcher, local("/no-ct"), ReasonCode.CONTENT_TYPE_NOT_ALLOWED)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/time-bound-fails-closed (header phase)", async () => {
    const fetcher = makeFetcher({ timeoutMs: 300 })
    try {
      await expectRefusal(fetcher, local("/slow-headers"), ReasonCode.TIME_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/time-bound-fails-closed (body phase)", async () => {
    const fetcher = makeFetcher({ timeoutMs: 300 })
    try {
      await expectRefusal(fetcher, local("/slow-body"), ReasonCode.TIME_LIMIT)
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/no-script-execution", async () => {
    // The guard returns bytes, never a stream and never executed content. Script
    // markup arrives as data, and nothing in the fetch path evaluates it.
    delete (globalThis as Record<string, unknown>).__cookframe_pwned
    const fetcher = makeFetcher()
    try {
      const result = await fetcher.fetch(local("/script"))
      const text = new TextDecoder().decode(result.bytes)
      expect(text).toContain("<script>")
      expect(text).toContain("__cookframe_pwned")
      expect((globalThis as Record<string, unknown>).__cookframe_pwned).toBeUndefined()
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/refusals-carry-reason-codes", async () => {
    // Every connector-phase refusal carries a discriminable, known, non-OK code
    // that survived undici's transport boundary.
    const fetcher = makeFetcher({ maxBytes: 1000, maxRedirects: 2 })
    const cases: ReadonlyArray<readonly [string, ReasonCode]> = [
      [local("/big"), ReasonCode.SIZE_LIMIT],
      [local("/wrong-ct"), ReasonCode.CONTENT_TYPE_NOT_ALLOWED],
      [local("/redir-hop?n=5"), ReasonCode.REDIRECT_LIMIT],
      [local("/redir-to-literal-private"), ReasonCode.PRIVATE_RANGE],
      [local("/redir-to-ftp"), ReasonCode.SCHEME_NOT_ALLOWED],
    ]
    try {
      for (const [input, code] of cases) {
        const e = await expectRefusal(fetcher, input, code)
        expect(e.reasonCode).not.toBe(ReasonCode.OK)
        expect(Object.values(ReasonCode), `${input} code is known`).toContain(e.reasonCode)
      }
    } finally {
      await fetcher.close()
    }
  })

  it("url-security/suite-rejects-permissive-reference (size bound discriminates)", async () => {
    // A permissive reader that truncates-and-proceeds returns a body the real
    // guard refuses — so the size-bound assertion genuinely bites rather than
    // passing vacuously.
    const permissiveReadTruncating = async (input: string, cap: number): Promise<Uint8Array> => {
      const res = await fetch(input) // deliberately ungated reference, test-only
      const full = new Uint8Array(await res.arrayBuffer())
      return full.subarray(0, cap) // truncate and proceed — the wrong behaviour
    }
    const guard = makeFetcher({ maxBytes: 1000 })
    try {
      // The permissive reference yields bytes; the real guard refuses.
      const lenient = await permissiveReadTruncating(local("/big"), 1000)
      expect(lenient.byteLength).toBe(1000)
      await expectRefusal(guard, local("/big"), ReasonCode.SIZE_LIMIT)
    } finally {
      await guard.close()
    }
  })
})
