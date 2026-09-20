/**
 * The URL-level pre-flight of the safe-fetch guard (CFV1-S5).
 *
 * This is the *cheap early reject* of ADR-0010: a synchronous, resolution-free
 * check of the URL string itself. It settles three things that can be decided
 * from the URL alone, before any socket is opened:
 *
 *   1. The scheme is on the allowlist (http/https) — refused otherwise, and
 *      refused per hop when a redirect changes it (the connector re-checks).
 *   2. An IP-literal host is classified immediately. WHATWG `URL` has already
 *      folded decimal, hexadecimal and octal spellings to canonical form, so
 *      `http://0x7f000001/`, `http://2130706433/` and `http://127.0.0.1/` all
 *      arrive here as `127.0.0.1` — spelling bypasses are a parsing problem the
 *      platform solved (ADR-0010 point 2).
 *   3. RFC 6761 loopback *names* (`localhost`, `*.localhost`) are refused
 *      without a lookup, because they are defined to resolve to loopback.
 *
 * What this pre-flight deliberately does NOT do is decide a *named* host. It
 * cannot: the safe answer for `http://internal.corp/` depends on what the name
 * resolves to, and resolving-then-fetching separately is the TOCTOU bypass
 * ADR-0010 exists to close. For a name it returns `OK` meaning "nothing to
 * refuse at the URL level"; the authoritative decision is the connector's,
 * taken against the resolved address and pinned to it (ADR-0010 points 3–5).
 * The guarantee never rests on this function.
 */
import { classifyAddress, isIpLiteral } from "./address-policy.js"
import { ReasonCode } from "./reason-codes.js"

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"])

export interface UrlDecision {
  readonly allowed: boolean
  readonly code: ReasonCode
}

/** RFC 6761 reserves `localhost` and any `*.localhost` name to loopback. */
function isReservedLoopbackName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  return h === "localhost" || h.endsWith(".localhost")
}

/**
 * The URL-level pre-flight decision, with a discriminable reason code. A named
 * host that survives it yields `{ allowed: true, code: OK }` — pre-flight
 * clearance only, not a licence to connect (see the module note).
 */
export function inspectUrl(input: string): UrlDecision {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { allowed: false, code: ReasonCode.UNPARSEABLE_URL }
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { allowed: false, code: ReasonCode.SCHEME_NOT_ALLOWED }
  }

  // WHATWG URL brackets IPv6 literals; strip the brackets for classification.
  let hostname = url.hostname
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1)
  }

  if (isReservedLoopbackName(hostname)) {
    return { allowed: false, code: ReasonCode.LOOPBACK }
  }

  if (isIpLiteral(hostname)) {
    const decision = classifyAddress(hostname)
    return { allowed: decision.allowed, code: decision.code }
  }

  // Named host: the URL alone cannot decide it. Defer to the connector.
  return { allowed: true, code: ReasonCode.OK }
}

/**
 * The boolean pre-flight predicate SL0's URL-fetch-security job contracts for.
 * `true` means the URL passed the cheap URL-level check; for a named host the
 * connector still makes the authoritative decision.
 */
export function isFetchableUrl(input: string): boolean {
  return inspectUrl(input).allowed
}
