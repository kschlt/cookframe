/**
 * The guarded egress path for model-provider API calls (CFV1-SL1, ADR-0013:
 * "model egress is its own guarded module beside safe fetch, not an extension of
 * it").
 *
 * **Why this is a second module and not part of `safe-fetch`.** ADR-0010 put one
 * chokepoint in `src/security/` for URL *ingestion*: the address comes from a
 * source the user pasted, so it is attacker-influenced, and the whole mechanism
 * — resolve-and-pin, per-address classification, default-deny — exists to answer
 * "may this process talk to *that* address at all". Model egress asks nothing of
 * the sort. The endpoint is the operator's own configuration, fixed before any
 * source is read, and running it through an address policy would only ask
 * whether the operator's own provider is routable. The threats are different, so
 * the guard is different, and widening a module that had its own security review
 * to carry a second threat model would weaken the first. **The address policy is
 * deliberately not reused here**: classifying the operator's own configured
 * provider would answer a question nobody asked, and reusing it would suggest
 * this module inherits guarantees it does not have. Both modules live in
 * `src/security/`, which is what the chokepoint test enforces and what keeps
 * ADR-0010's invariant — read as "all egress in one directory" rather than
 * "through one function" — literally true.
 *
 * **What this guard is actually for.** The request carries a credential, so the
 * risks are about where that credential and this process's attention can be
 * sent:
 *
 * 1. **The endpoint cannot be steered by content.** It is fixed when the
 *    endpoint is created and the send function takes no address, so no captured
 *    page, model reply or source payload can redirect a call. This is structural
 *    rather than checked.
 * 2. **`https` only**, refused at construction rather than at send time, so a
 *    plaintext endpoint fails when the instance is configured, not on the first
 *    recipe.
 * 3. **A redirect is a refusal, never a hop.** Following one would hand the
 *    `authorization` header to whatever host the response named. `safe-fetch`
 *    follows redirects because fetching a page legitimately involves them;
 *    here there is exactly one correct destination.
 * 4. **Bounded in time and size**, both aborting the connection rather than
 *    resolving late or buffering without limit, so a hung or hostile endpoint
 *    cannot stall or exhaust the instance.
 * 5. **The credential never appears in anything this module produces.** It comes
 *    from the environment, is held only in this closure, and every message built
 *    here is scrubbed of it before it leaves — a response body is echoed back
 *    only in bounded, scrubbed form. It has no path into a snapshot, a canonical
 *    recipe, provenance or a log, because none of those is written from here and
 *    nothing this module returns carries it.
 *
 * As with ADR-0010 point 8, refusals carry a discriminable `code` rather than
 * relying on `instanceof`, so a caller (and a test) can distinguish "the
 * deadline elapsed" from "the provider said no".
 */

/** Discriminable refusal reasons for the model-egress guard. */
export const EgressReason = {
  /** The configured endpoint is not a parseable URL. */
  UNPARSEABLE_ENDPOINT: "UNPARSEABLE_ENDPOINT",
  /** The configured endpoint is not `https:`. */
  SCHEME_NOT_ALLOWED: "SCHEME_NOT_ALLOWED",
  /** The endpoint answered with a redirect; the guard refuses rather than hop. */
  REDIRECT_REFUSED: "REDIRECT_REFUSED",
  /** The deadline elapsed; the connection was aborted. */
  TIME_LIMIT: "TIME_LIMIT",
  /** The response exceeded the size bound; the connection was aborted. */
  SIZE_LIMIT: "SIZE_LIMIT",
  /** The response body is not the JSON the endpoint contract promises. */
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  /** The provider answered with a non-2xx status. */
  PROVIDER_REFUSED: "PROVIDER_REFUSED",
  /** A transport failure that is not one of the guard's own refusals. */
  TRANSPORT: "TRANSPORT",
} as const

export type EgressReason = (typeof EgressReason)[keyof typeof EgressReason]

/** A refusal from the model-egress guard, tagged with its {@link EgressReason}. */
export class ModelEgressError extends Error {
  readonly code: EgressReason
  /** Present only for {@link EgressReason.PROVIDER_REFUSED}. */
  readonly status?: number

  constructor(code: EgressReason, message: string, status?: number) {
    super(message)
    this.name = "ModelEgressError"
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export interface ModelEndpointOptions {
  /** The provider's fixed API endpoint. Operator configuration, never content. */
  readonly endpoint: string
  /** The credential sent as `authorization`. Never logged, never re-emitted. */
  readonly credential: string
  /** Whole-call deadline. Default 120s — a vision call on a large page is slow. */
  readonly timeoutMs?: number
  /** Response size bound. Default 4 MiB, far above any conforming reply. */
  readonly maxResponseBytes?: number
}

export interface EgressResult {
  /** The parsed JSON body. Shape is the provider's; this guard does not read it. */
  readonly json: unknown
  /** Wall-clock time for the whole call, for cost and latency accounting. */
  readonly latencyMs: number
}

/**
 * A send function bound to one endpoint. It takes a body and nothing else —
 * in particular no address, which is what makes guarantee 1 structural.
 */
export type ModelEndpoint = (body: unknown) => Promise<EgressResult>

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
/**
 * How much of a refusal body to quote back. Counted in UTF-16 code units,
 * because `String.prototype.slice` is, and a limit that claims bytes while
 * counting something else is the kind of small lie that becomes a bug.
 */
const ERROR_EXCERPT_CHARS = 512

/**
 * Remove every occurrence of the credential from text this module is about to
 * emit. The scrub is unconditional rather than dependent on where the text came
 * from, because the point is that no path out of this module can carry it.
 */
function scrub(text: string, credential: string): string {
  return credential.length > 0 ? text.split(credential).join("[redacted]") : text
}

/**
 * Bind a guarded JSON POST to one provider endpoint.
 *
 * Throws {@link ModelEgressError} at construction if the endpoint is unusable,
 * so a misconfigured instance fails at startup rather than mid-conversion.
 */
export function createModelEndpoint(options: ModelEndpointOptions): ModelEndpoint {
  let url: URL
  try {
    url = new URL(options.endpoint)
  } catch {
    throw new ModelEgressError(
      EgressReason.UNPARSEABLE_ENDPOINT,
      "model endpoint is not a parseable URL",
    )
  }
  if (url.protocol !== "https:") {
    throw new ModelEgressError(
      EgressReason.SCHEME_NOT_ALLOWED,
      `model endpoint scheme ${url.protocol} is not https:`,
    )
  }

  const endpoint = url.toString()
  const credential = options.credential
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES

  return async function send(body: unknown): Promise<EgressResult> {
    const started = Date.now()
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credential}`,
        },
        body: JSON.stringify(body),
        // A 3xx is refused below rather than followed: a hop would carry the
        // credential to whatever host the response named.
        redirect: "manual",
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(deadline)
      if (controller.signal.aborted) {
        throw new ModelEgressError(
          EgressReason.TIME_LIMIT,
          `model endpoint did not answer within ${timeoutMs}ms`,
        )
      }
      throw new ModelEgressError(
        EgressReason.TRANSPORT,
        scrub(err instanceof Error ? err.message : String(err), credential),
      )
    }

    try {
      if (res.status >= 300 && res.status < 400) {
        throw new ModelEgressError(
          EgressReason.REDIRECT_REFUSED,
          `model endpoint answered ${res.status}; redirects are not followed`,
          res.status,
        )
      }
      // The body phase needs its own translation. Aborting a fetch errors its
      // body stream, so a deadline that elapses after the headers have arrived
      // surfaces as the runtime's own `AbortError` — which carries a numeric
      // `code` of its own and would reach a caller dispatching on `code` as a
      // number where an `EgressReason` is promised. Everything this module
      // throws is typed, on every path.
      let text: string
      try {
        text = await readBounded(res, maxResponseBytes, controller.signal)
      } catch (err) {
        if (err instanceof ModelEgressError) throw err
        if (controller.signal.aborted) {
          throw new ModelEgressError(
            EgressReason.TIME_LIMIT,
            `model endpoint body did not complete within ${timeoutMs}ms`,
          )
        }
        throw new ModelEgressError(
          EgressReason.TRANSPORT,
          scrub(err instanceof Error ? err.message : String(err), credential),
        )
      }
      if (!res.ok) {
        // Scrub first, then cut: cutting first can split the credential and
        // leave a leading fragment that the scrub no longer matches.
        throw new ModelEgressError(
          EgressReason.PROVIDER_REFUSED,
          `model endpoint answered ${res.status}: ${scrub(text, credential).slice(
            0,
            ERROR_EXCERPT_CHARS,
          )}`,
          res.status,
        )
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new ModelEgressError(
          EgressReason.MALFORMED_RESPONSE,
          "model endpoint answered with a body that is not JSON",
        )
      }
      return { json, latencyMs: Date.now() - started }
    } finally {
      clearTimeout(deadline)
    }
  }
}

/**
 * Read the body while counting bytes, aborting as soon as the bound is passed
 * rather than buffering the whole answer and measuring afterwards.
 *
 * The deadline is not re-checked here. It belongs to the one `AbortController`
 * the call is made with: aborting a fetch errors its body stream, so a stalled
 * body is interrupted by that signal rather than by a check between reads,
 * which a stalled read never reaches. A second deadline here would look
 * load-bearing and never fire.
 */
async function readBounded(
  res: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const body = res.body
  if (body === null) return ""
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxResponseBytes) {
        await reader.cancel()
        throw new ModelEgressError(
          EgressReason.SIZE_LIMIT,
          `model endpoint response exceeded ${maxResponseBytes} bytes`,
        )
      }
      chunks.push(value)
    }
  } finally {
    // A reader whose stream errored is already released; releasing twice throws.
    if (!signal.aborted) {
      try {
        reader.releaseLock()
      } catch {
        // The stream errored out from under us; nothing to release.
      }
    }
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
