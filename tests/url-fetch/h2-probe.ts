/**
 * The child half of `url-security.h2.test.ts`. It runs in its own process for
 * one reason: the guard's connector builds its TLS socket with undici's default
 * options, so the only way to make a self-signed test certificate trusted is
 * `NODE_EXTRA_CA_CERTS`, which Node reads once at startup. A separate process is
 * how that gets set without either weakening the guard with a third test-only
 * seam or turning certificate verification off for a whole vitest worker.
 *
 * It serves HTTP/2 (with the HTTP/1.1 fallback still offered via ALPN, so the
 * negotiation is real rather than forced), drives `createSafeFetcher` against
 * it, and prints one JSON line the parent asserts on. It decides nothing.
 */
import { readFileSync } from "node:fs"
import { createSecureServer } from "node:http2"
import type { AddressInfo } from "node:net"
import { createSafeFetcher, SafeFetchError } from "../../src/security/safe-fetch.js"

const [keyPath, certPath] = process.argv.slice(2)
if (keyPath === undefined || certPath === undefined) {
  throw new Error("usage: h2-probe <key.pem> <cert.pem>")
}

const server = createSecureServer({
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
  allowHTTP1: true,
})

const protocols = new Set<string>()
/** How many times the endlessly-redirecting route was served, so the parent can
 * see that the chain was cut at the configured bound rather than at some later
 * number that also happens to be a bound. */
let hopRouteHits = 0
server.on("request", (req, res) => {
  protocols.add(req.httpVersion)
  res.on("error", () => {})
  const path = new URL(req.url ?? "/", "https://placeholder.invalid").pathname
  switch (path) {
    case "/redir-to-literal-private":
      res.writeHead(302, { location: "https://10.0.0.5/recipe" })
      return res.end()
    case "/redir-to-ftp":
      res.writeHead(302, { location: "ftp://example.test/x" })
      return res.end()
    case "/redir-without-location":
      res.writeHead(302)
      return res.end()
    case "/redir-hop": {
      hopRouteHits++
      const n = Number(
        new URL(req.url ?? "/", "https://placeholder.invalid").searchParams.get("n") ?? 0,
      )
      res.writeHead(302, { location: `/redir-hop?n=${n + 1}` })
      return res.end()
    }
    default:
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end("<h1>a recipe</h1>")
  }
})

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const port = (server.address() as AddressInfo).port

/** The URL names a host real DNS cannot answer, so only the pin can reach the server. */
const origin = `https://h2.test:${port}`
let resolverCalls = 0
const resolve = async (): Promise<string[]> => {
  resolverCalls++
  return ["127.0.0.1"]
}

async function attempt(
  path: string,
): Promise<{ ok: true; body: string } | { ok: false; code: string }> {
  const fetcher = createSafeFetcher({ allowLoopback: true, resolve, maxRedirects: 3 })
  try {
    const result = await fetcher.fetch(`${origin}${path}`)
    return { ok: true, body: new TextDecoder().decode(result.bytes) }
  } catch (error) {
    return { ok: false, code: error instanceof SafeFetchError ? error.reasonCode : String(error) }
  } finally {
    await fetcher.close()
  }
}

const report = {
  reachedNamedHost: await attempt("/ok"),
  redirectToPrivateLiteral: await attempt("/redir-to-literal-private"),
  redirectToForeignScheme: await attempt("/redir-to-ftp"),
  redirectWithoutLocation: await attempt("/redir-without-location"),
  redirectHopBound: await attempt("/redir-hop?n=0"),
  protocols: [...protocols],
  resolverCalls,
  hopRouteHits,
}

process.stdout.write(`${JSON.stringify(report)}\n`)
server.close()
