/**
 * Discriminable refusal reason codes for the safe-URL-fetch guard (CFV1-S5,
 * per ADR-0010 point 8).
 *
 * Error identity does not survive the connector/transport boundary — undici
 * rewraps thrown errors — and S5's acceptance criteria are stated *per reason*.
 * A plain string tag survives every boundary, so refusals carry one of these
 * codes rather than being distinguished by `instanceof`. This is the seam that
 * lets a test assert "refused *as loopback*" instead of merely "threw".
 *
 * `OK` is the sole non-refusal value: it means the checked stage found nothing
 * to refuse. For a named host at the pre-flight stage that is *not* a clearance
 * to connect — it means the cheap URL-level check passed and the authoritative
 * decision is the connector's, taken against the resolved address (ADR-0010
 * points 3–5).
 */
export const ReasonCode = {
  /** Nothing to refuse at the stage that produced this code. */
  OK: "OK",
  /** The input is not a parseable URL. */
  UNPARSEABLE_URL: "UNPARSEABLE_URL",
  /** The URL's scheme is not on the fetch allowlist (http/https). */
  SCHEME_NOT_ALLOWED: "SCHEME_NOT_ALLOWED",
  /** An IP literal that no parser can read — refused, never admitted. */
  UNPARSEABLE_ADDRESS: "UNPARSEABLE_ADDRESS",
  /** 127.0.0.0/8, ::1, and RFC 6761 loopback names. */
  LOOPBACK: "LOOPBACK",
  /** 169.254.0.0/16 (incl. the cloud metadata endpoint) and fe80::/10. */
  LINK_LOCAL: "LINK_LOCAL",
  /** RFC 1918 ranges: 10/8, 172.16/12, 192.168/16. */
  PRIVATE_RANGE: "PRIVATE_RANGE",
  /** Carrier-grade NAT, 100.64.0.0/10 (RFC 6598). */
  CGNAT: "CGNAT",
  /** IPv6 unique-local, fc00::/7 (RFC 4193). */
  UNIQUE_LOCAL: "UNIQUE_LOCAL",
  /**
   * Any address whose range is not `unicast`: multicast, unspecified,
   * broadcast, reserved, and the *embedding* families 6to4 / NAT64 / Teredo
   * that carry a forbidden address inside a form a denylist misreads. Default
   * deny catches these by construction (ADR-0010 point 4).
   */
  NON_UNICAST: "NON_UNICAST",

  // --- Connector-phase refusals (ADR-0010 points 6, 7): the bounds the guard
  // owns and enforces once a connection is permitted. Each fails *closed* —
  // exceeding a bound aborts the connection rather than truncating and
  // proceeding (S5 constraint) — and each carries its own code so a criterion
  // can be asserted per reason across the transport boundary.

  /** The decompressed response exceeded the size bound; the connection was aborted. */
  SIZE_LIMIT: "SIZE_LIMIT",
  /** The response content type is absent or outside the allowlist. */
  CONTENT_TYPE_NOT_ALLOWED: "CONTENT_TYPE_NOT_ALLOWED",
  /** The whole-chain deadline elapsed, in the header phase or the body phase. */
  TIME_LIMIT: "TIME_LIMIT",
  /** The redirect chain was longer than the bound. */
  REDIRECT_LIMIT: "REDIRECT_LIMIT",
  /** A 3xx response carried no usable `Location`, so the next hop is undecidable. */
  REDIRECT_INVALID: "REDIRECT_INVALID",
  /**
   * An underlying transport failure that is not one of the guard's own refusals
   * (connection reset, DNS failure, TLS error). Distinct from a policy refusal:
   * the guard did not decide against the address, the network did.
   */
  TRANSPORT: "TRANSPORT",
} as const

export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode]
