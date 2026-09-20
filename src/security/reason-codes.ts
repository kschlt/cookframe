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
} as const

export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode]
