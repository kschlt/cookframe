/**
 * The address policy: the allow decision for a *resolved IP address* (CFV1-S5,
 * per ADR-0010 points 4–5).
 *
 * The policy is **default-deny unicast**: an address is permitted only if its
 * range classifies as `unicast`. This is the crux of SSRF safety, and it is
 * deliberately written as an allowlist rather than a denylist:
 *
 *   - A denylist of loopback/private/link-local/CGNAT is defeated by families
 *     that *embed* a forbidden address in a form the denylist misreads —
 *     6to4 `2002:7f00:1::1` carries 127.0.0.1, NAT64 `64:ff9b::a9fe:a9fe`
 *     carries 169.254.169.254. Default deny refuses both because neither is
 *     `unicast`, without having to enumerate or unwrap them.
 *   - An address family nobody has anticipated yet is refused, not admitted —
 *     the correct direction for a guard to be wrong in.
 *   - An address the parser cannot read is a refusal, never a pass. Library
 *     predicates in this space commonly answer "not private" for unparseable
 *     input, which is wide open when called on a URL hostname; the predicate
 *     here is ours and fails closed (ADR-0010 point 5).
 *
 * The classification table — the part most easily got wrong by hand — comes
 * from `ipaddr.js` (single-file, MIT, zero production dependencies). The allow
 * decision is ours.
 *
 * This module is pure: it classifies a *literal address string*. It performs
 * no DNS resolution and no I/O. Turning a hostname into the address(es) to
 * classify, and pinning the connection to the classified one, is the
 * connector's job (ADR-0010 point 3) and is not in this unit.
 */
import ipaddr from "ipaddr.js"
import { ReasonCode } from "./reason-codes.js"

export interface AddressDecision {
  readonly allowed: boolean
  readonly code: ReasonCode
  /** The `ipaddr.js` range label the decision was taken on, for diagnostics. */
  readonly range: string
}

/**
 * Non-`unicast` ranges the criteria name individually get a specific code so a
 * test can assert the reason, not merely the refusal. Every other non-unicast
 * range (multicast, unspecified, broadcast, reserved, 6to4, NAT64, Teredo, …)
 * falls through to `NON_UNICAST` — refused all the same.
 */
const RANGE_TO_CODE: Readonly<Record<string, ReasonCode>> = {
  loopback: ReasonCode.LOOPBACK,
  linkLocal: ReasonCode.LINK_LOCAL,
  private: ReasonCode.PRIVATE_RANGE,
  carrierGradeNat: ReasonCode.CGNAT,
  uniqueLocal: ReasonCode.UNIQUE_LOCAL,
}

/** Whether a hostname is an IP literal (in any spelling) rather than a name. */
export function isIpLiteral(host: string): boolean {
  return ipaddr.isValid(host)
}

/**
 * Classify a literal IP address string under the default-deny unicast policy.
 * An IPv4-mapped IPv6 address is unwrapped to its IPv4 form first, so an
 * embedded loopback/private address is classified as what it really is (and an
 * embedded public address stays permitted).
 */
export function classifyAddress(literal: string): AddressDecision {
  let addr: ipaddr.IPv4 | ipaddr.IPv6
  try {
    addr = ipaddr.parse(literal)
  } catch {
    return { allowed: false, code: ReasonCode.UNPARSEABLE_ADDRESS, range: "unparseable" }
  }

  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
    addr = addr.toIPv4Address()
  }

  const range: string = addr.range()
  if (range === "unicast") {
    return { allowed: true, code: ReasonCode.OK, range }
  }
  return { allowed: false, code: RANGE_TO_CODE[range] ?? ReasonCode.NON_UNICAST, range }
}
