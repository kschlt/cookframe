/**
 * The safe-fetch guard: the product's one outbound HTTP path (CFV1-S5, the
 * implementation half of Gate E; ADR-0010).
 *
 * URL ingestion fetches attacker-influenced addresses from the instance's own
 * network position, and `PDR-0002` gives it no platform egress isolation to
 * fall back on — so this module is the *only* boundary. Every guarantee below
 * is structural rather than a check that has to be remembered:
 *
 *   - **One chokepoint (ADR-0010 point 1).** Every TCP connection passes through
 *     a custom undici `connect` connector. It fires for IP-literal hosts, which
 *     the socket `lookup` option does not — that gap is the published advisory
 *     class this design exists to close.
 *   - **Resolve-and-pin (points 3-5).** A named host is resolved *inside* the
 *     connector; every returned address is classified under the default-deny
 *     unicast policy, and the connection is pinned to the single validated
 *     address. There is no window between check and connect, so DNS rebinding is
 *     closed by construction, and Happy Eyeballs cannot race to an unvalidated
 *     address because undici is handed one IP, not a name.
 *   - **Manual bounded redirects (point 6).** Redirects are followed by this
 *     module, not undici: the count is bounded and every hop is re-inspected for
 *     scheme and re-connected through the connector, so a *later* hop pointing at
 *     a refused destination is refused at that hop.
 *   - **Bounds are ours and fail closed (point 7).** Content type is checked on
 *     the headers before the body is read; size is counted on the *decompressed*
 *     stream, never `Content-Length`; one deadline spans the whole chain. Every
 *     bound aborts the connection rather than merely rejecting a promise.
 *   - **A typed result, not a `Response` (point 10).** Callers receive validated
 *     bytes with their content type and final URL — never a raw stream that has
 *     not been through the bounds, and never a cross-undici-major `instanceof`
 *     hazard.
 *   - **Refusals carry a discriminable `code` (point 8).** Error identity does
 *     not survive undici's transport boundary, so a refusal is a `SafeFetchError`
 *     whose string `reasonCode` survives as `.cause` and is recovered by walking
 *     the cause chain.
 *
 * The loopback seam (point 11) and the resolver seam are **test-only constructor
 * arguments production never passes** — never an environment variable, never a
 * default. A CI server lives on `127.0.0.1` and is otherwise refused; the
 * deterministic resolver lets the resolve-and-pin proofs be written without real
 * DNS. Both are a security surface: reaching them in production wiring is a
 * defect, which is why they are arguments a caller must deliberately supply.
 */
import { lookup as dnsLookup } from "node:dns/promises"
import { Agent, buildConnector, fetch as undiciFetch } from "undici"
import { type AddressDecision, classifyAddress, isIpLiteral } from "./address-policy.js"
import { ReasonCode } from "./reason-codes.js"
import { inspectUrl, type UrlDecision } from "./url-guard.js"

/** A refusal or transport failure, tagged with a code that survives the transport boundary. */
export class SafeFetchError extends Error {
  readonly reasonCode: ReasonCode
  /** The URL of the hop the refusal was taken on, when a redirect chain is involved. */
  readonly url?: string
  constructor(
    reasonCode: ReasonCode,
    message: string,
    options?: { cause?: unknown; url?: string },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = "SafeFetchError"
    this.reasonCode = reasonCode
    if (options?.url !== undefined) this.url = options.url
  }
}

/** The validated outcome of a safe fetch: bytes that have been through every bound. */
export interface SafeFetchResult {
  /** The final URL after any redirects were followed. */
  readonly finalUrl: string
  /** The response content-type essence (media type without parameters), lower-cased. */
  readonly contentType: string
  /** The decompressed response body, already bounded in size. */
  readonly bytes: Uint8Array
}

/**
 * Turns a hostname into the address strings to classify. Production uses DNS;
 * the tests inject a deterministic resolver so the resolve-and-pin proofs need
 * no real network. A resolver that returns no address is a refusal, not a pass.
 */
export type Resolver = (hostname: string) => Promise<readonly string[]>

export interface SafeFetcherOptions {
  /**
   * TEST-ONLY seam (ADR-0010 point 11). Permit loopback so a `127.0.0.1` test
   * server is reachable as the allowed leg of a chain. Production never passes
   * this; leaving it unset keeps loopback refused like every other non-unicast.
   */
  readonly allowLoopback?: boolean
  /**
   * TEST-ONLY seam. A deterministic stand-in for DNS so the resolve-and-pin and
   * multi-address proofs are hermetic. Production never passes this; the default
   * resolves through the platform.
   */
  readonly resolve?: Resolver
  /** Maximum decompressed response bytes before the connection is aborted. */
  readonly maxBytes?: number
  /** Maximum redirect hops before the chain is refused. */
  readonly maxRedirects?: number
  /** Whole-chain deadline in milliseconds, spanning header and body phases. */
  readonly timeoutMs?: number
  /** Allowed content-type essences (lower-cased, no parameters). */
  readonly allowedContentTypes?: readonly string[]
}

export interface SafeFetcher {
  /** Fetch a URL under the full guard, returning validated bytes or throwing a `SafeFetchError`. */
  fetch(input: string): Promise<SafeFetchResult>
  /** Release the underlying connection pool. */
  close(): Promise<void>
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CONTENT_TYPES: readonly string[] = [
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/ld+json",
  "text/plain",
]

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** WHATWG `URL` brackets IPv6 literals; the classifier wants the bare address. */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
}

/** The default-deny policy with the test-only loopback exception folded in. */
function classifyForConnect(literal: string, allowLoopback: boolean): AddressDecision {
  const decision = classifyAddress(literal)
  if (!decision.allowed && allowLoopback && decision.code === ReasonCode.LOOPBACK) {
    return { allowed: true, code: ReasonCode.OK, range: decision.range }
  }
  return decision
}

/**
 * The URL-level pre-flight with the test-only loopback exception folded in, so a
 * literal loopback host (the `127.0.0.1` test server) survives the cheap reject
 * when the seam is set — consistently with the connector's `classifyForConnect`.
 * Production leaves `allowLoopback` false, so loopback URLs are refused here
 * exactly as they are without the seam.
 */
function preflightUrl(input: string, allowLoopback: boolean): UrlDecision {
  const decision = inspectUrl(input)
  if (!decision.allowed && allowLoopback && decision.code === ReasonCode.LOOPBACK) {
    return { allowed: true, code: ReasonCode.OK }
  }
  return decision
}

const defaultResolver: Resolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true })
  return answers.map((a) => a.address)
}

/**
 * Resolve a host to the single IP the connection will be pinned to. An IP
 * literal is classified as itself. A name is resolved once, and **every**
 * returned address is classified: if any is non-unicast the whole answer is
 * refused (a mixed public/private answer is itself a rebinding signal), so no
 * connection can reach an unvalidated address.
 */
async function resolveAndPin(
  host: string,
  allowLoopback: boolean,
  resolve: Resolver,
): Promise<string> {
  if (isIpLiteral(host)) {
    const decision = classifyForConnect(host, allowLoopback)
    if (!decision.allowed) {
      throw new SafeFetchError(decision.code, `address ${host} refused (${decision.code})`)
    }
    return host
  }

  const addresses = await resolve(host)
  if (addresses.length === 0) {
    throw new SafeFetchError(ReasonCode.UNPARSEABLE_ADDRESS, `no address resolved for ${host}`)
  }
  for (const address of addresses) {
    const decision = classifyForConnect(address, allowLoopback)
    if (!decision.allowed) {
      throw new SafeFetchError(
        decision.code,
        `resolved address ${address} for ${host} refused (${decision.code})`,
      )
    }
  }
  // Every resolved address validated: pin to one so undici never re-resolves.
  const pinned = addresses[0]
  if (pinned === undefined) {
    throw new SafeFetchError(ReasonCode.UNPARSEABLE_ADDRESS, `no address resolved for ${host}`)
  }
  return pinned
}

type Connector = ReturnType<typeof buildConnector>

/**
 * The custom undici connector: the single point every connection passes through.
 * It resolves and classifies the destination, then hands the base connector one
 * pinned IP while preserving the original hostname as the TLS `servername`.
 */
function createGuardedConnector(allowLoopback: boolean, resolve: Resolver): Connector {
  const base = buildConnector({})
  const connect: Connector = (options, callback) => {
    void (async () => {
      try {
        const host = stripBrackets(options.hostname)
        const pinned = await resolveAndPin(host, allowLoopback, resolve)
        base({ ...options, hostname: pinned, servername: options.servername || host }, callback)
      } catch (error) {
        callback(error as Error, null)
      }
    })()
  }
  return connect
}

/** Recover the guard's own reason code from an error undici may have rewrapped. */
function extractReasonCode(error: unknown): ReasonCode | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current != null; depth++) {
    if (typeof current === "object" && "reasonCode" in current) {
      const code = (current as { reasonCode: unknown }).reasonCode
      if (typeof code === "string") return code as ReasonCode
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Read a response body, counting decompressed bytes and aborting the connection
 * the moment the bound is crossed. undici's `fetch` decompresses per
 * `Content-Encoding`, so the bytes counted here are the real, decompressed size
 * — a compressed payload declaring a small length cannot overflow it.
 */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) {
        controller.abort() // tear the connection down; do not truncate and proceed
        throw new SafeFetchError(ReasonCode.SIZE_LIMIT, `response exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error
    if (controller.signal.aborted) {
      throw new SafeFetchError(ReasonCode.TIME_LIMIT, "deadline exceeded reading body", {
        cause: error,
      })
    }
    throw new SafeFetchError(ReasonCode.TRANSPORT, "transport failure reading body", {
      cause: error,
    })
  } finally {
    // Releasing an already-errored reader can throw; never let that mask the
    // real refusal we are propagating.
    try {
      reader.releaseLock()
    } catch {
      /* the connection is torn down regardless */
    }
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Create a safe fetcher. With no options this is the production guard: default
 * deny, real DNS, the default bounds. The test-only seams (`allowLoopback`,
 * `resolve`) are the only way loopback becomes reachable or DNS becomes
 * deterministic, and production passes neither.
 */
export function createSafeFetcher(options: SafeFetcherOptions = {}): SafeFetcher {
  const allowLoopback = options.allowLoopback ?? false
  const resolve = options.resolve ?? defaultResolver
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const allowedContentTypes = options.allowedContentTypes ?? DEFAULT_CONTENT_TYPES

  const agent = new Agent({ connect: createGuardedConnector(allowLoopback, resolve) })

  async function fetchOnce(url: string, signal: AbortSignal): Promise<Response> {
    return undiciFetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      // A referrer/UA is out of scope; the guard is about *where* not *who*.
    }) as unknown as Promise<Response>
  }

  async function fetch(input: string): Promise<SafeFetchResult> {
    // Cheap early reject: scheme and IP-literal host, decided from the URL alone.
    const preflight = preflightUrl(input, allowLoopback)
    if (!preflight.allowed) {
      throw new SafeFetchError(preflight.code, `pre-flight refused (${preflight.code})`, {
        url: input,
      })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let currentUrl = input
      for (let hop = 0; ; hop++) {
        if (hop > maxRedirects) {
          throw new SafeFetchError(
            ReasonCode.REDIRECT_LIMIT,
            `redirect chain exceeded ${maxRedirects} hops`,
            { url: currentUrl },
          )
        }

        // Re-inspect every hop: a redirect that changes scheme or points at an
        // IP-literal internal address is refused here before any socket opens;
        // a named internal host is refused by the connector on connect.
        const hopCheck = preflightUrl(currentUrl, allowLoopback)
        if (!hopCheck.allowed) {
          throw new SafeFetchError(hopCheck.code, `hop refused (${hopCheck.code})`, {
            url: currentUrl,
          })
        }

        let response: Response
        try {
          response = await fetchOnce(currentUrl, controller.signal)
        } catch (error) {
          const code = extractReasonCode(error)
          if (code !== undefined) {
            throw new SafeFetchError(code, `connect refused (${code})`, {
              cause: error,
              url: currentUrl,
            })
          }
          if (controller.signal.aborted) {
            throw new SafeFetchError(ReasonCode.TIME_LIMIT, "deadline exceeded before headers", {
              cause: error,
              url: currentUrl,
            })
          }
          throw new SafeFetchError(ReasonCode.TRANSPORT, "transport failure before headers", {
            cause: error,
            url: currentUrl,
          })
        }

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location")
          await response.body?.cancel()
          if (location === null || location === "") {
            throw new SafeFetchError(
              ReasonCode.REDIRECT_INVALID,
              `redirect ${response.status} without a Location`,
              { url: currentUrl },
            )
          }
          let next: URL
          try {
            next = new URL(location, currentUrl)
          } catch {
            throw new SafeFetchError(
              ReasonCode.REDIRECT_INVALID,
              `redirect Location is not a valid URL: ${location}`,
              { url: currentUrl },
            )
          }
          currentUrl = next.toString()
          continue
        }

        // Terminal response: content type is checked before the body is read.
        const rawContentType = response.headers.get("content-type") ?? ""
        const essence = rawContentType.split(";")[0]?.trim().toLowerCase() ?? ""
        if (!allowedContentTypes.includes(essence)) {
          await response.body?.cancel()
          throw new SafeFetchError(
            ReasonCode.CONTENT_TYPE_NOT_ALLOWED,
            `content type not allowed: ${essence === "" ? "(absent)" : essence}`,
            { url: currentUrl },
          )
        }

        const bytes = await readBounded(
          response.body as ReadableStream<Uint8Array> | null,
          maxBytes,
          controller,
        )
        return { finalUrl: currentUrl, contentType: essence, bytes }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function close(): Promise<void> {
    await agent.close()
  }

  return { fetch, close }
}
