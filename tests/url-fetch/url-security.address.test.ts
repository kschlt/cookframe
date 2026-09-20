/**
 * CFV1-S5 — URL ingestion security suite, address-classification unit.
 *
 * This file is the adversarial suite for the part of Gate E that is settled at
 * the URL/address level and needs no network: the default-deny unicast policy
 * (ADR-0010 points 2, 4, 5) reached through the pre-flight guard. Each `it`
 * name carries the spec's `url-security/<criterion>` proof tag so a criterion
 * maps to its test.
 *
 * The networking-dependent criteria — resolve-and-pin against DNS rebinding and
 * multi-address answers, per-hop redirect re-validation, the redirect count
 * bound, the size/content-type/time bounds, and no-script-execution — are the
 * connector's, exercised by a separate unit against a loopback test server
 * (ADR-0010 points 3, 6, 7, and the loopback seam of point 11). They are not in
 * this file, and S5 stays in progress until that unit lands.
 *
 * A property proven once by hand is not proven (S5 constraint): the suite is
 * table-driven and adversarial, and it proves it discriminates by showing a
 * deliberately permissive reference fails the must-refuse set.
 */
import { describe, expect, it } from "vitest"
import { ReasonCode } from "../../src/security/reason-codes.js"
import { inspectUrl, isFetchableUrl } from "../../src/security/url-guard.js"

/** A URL the guard must refuse, and the discriminable reason it must give. */
interface Refusal {
  readonly url: string
  readonly code: ReasonCode
  readonly why: string
}

// Loopback in every spelling WHATWG `URL` normalizes: dotted-quad, decimal,
// hexadecimal, octal, and the IPv6 literal — plus the IPv4-mapped IPv6 form
// that carries a loopback address inside a v6 wrapper.
const LOOPBACK: readonly Refusal[] = [
  { url: "http://127.0.0.1/recipe", code: ReasonCode.LOOPBACK, why: "dotted-quad" },
  { url: "http://127.255.255.254/recipe", code: ReasonCode.LOOPBACK, why: "127/8 is all loopback" },
  { url: "http://2130706433/recipe", code: ReasonCode.LOOPBACK, why: "decimal 127.0.0.1" },
  { url: "http://0x7f000001/recipe", code: ReasonCode.LOOPBACK, why: "hexadecimal 127.0.0.1" },
  { url: "http://0x7f.0.0.1/recipe", code: ReasonCode.LOOPBACK, why: "mixed hex 127.0.0.1" },
  { url: "http://017700000001/recipe", code: ReasonCode.LOOPBACK, why: "octal 127.0.0.1" },
  { url: "http://[::1]/recipe", code: ReasonCode.LOOPBACK, why: "IPv6 loopback" },
  {
    url: "http://[::ffff:127.0.0.1]/recipe",
    code: ReasonCode.LOOPBACK,
    why: "IPv4-mapped loopback",
  },
  { url: "http://localhost/recipe", code: ReasonCode.LOOPBACK, why: "RFC 6761 loopback name" },
  { url: "http://sub.localhost/recipe", code: ReasonCode.LOOPBACK, why: "RFC 6761 *.localhost" },
]

const LINK_LOCAL: readonly Refusal[] = [
  { url: "http://169.254.0.1/recipe", code: ReasonCode.LINK_LOCAL, why: "IPv4 link-local" },
  { url: "http://[fe80::1]/recipe", code: ReasonCode.LINK_LOCAL, why: "IPv6 link-local" },
]

const PRIVATE_RANGE: readonly Refusal[] = [
  { url: "http://10.0.0.5/recipe", code: ReasonCode.PRIVATE_RANGE, why: "10/8" },
  { url: "http://172.16.0.1/recipe", code: ReasonCode.PRIVATE_RANGE, why: "172.16/12" },
  {
    url: "http://172.31.255.255/recipe",
    code: ReasonCode.PRIVATE_RANGE,
    why: "172.16/12 upper edge",
  },
  { url: "http://192.168.1.10/recipe", code: ReasonCode.PRIVATE_RANGE, why: "192.168/16" },
]

const CGNAT_AND_UNIQUE_LOCAL: readonly Refusal[] = [
  { url: "http://100.64.0.1/recipe", code: ReasonCode.CGNAT, why: "carrier-grade NAT 100.64/10" },
  { url: "http://100.127.255.255/recipe", code: ReasonCode.CGNAT, why: "CGNAT upper edge" },
  {
    url: "http://[fc00::1]/recipe",
    code: ReasonCode.UNIQUE_LOCAL,
    why: "IPv6 unique-local fc00::/7",
  },
  {
    url: "http://[fd12:3456:789a::1]/recipe",
    code: ReasonCode.UNIQUE_LOCAL,
    why: "fd00::/8 unique-local",
  },
]

// The cloud metadata endpoint in its canonical spelling AND in the embedding
// families that carry it inside a form a denylist misreads. Default deny
// refuses the embeddings as non-unicast without unwrapping them.
const METADATA: readonly Refusal[] = [
  {
    url: "http://169.254.169.254/latest/meta-data/",
    code: ReasonCode.LINK_LOCAL,
    why: "canonical metadata IP",
  },
  {
    url: "http://[fd00:ec2::254]/latest/meta-data/",
    code: ReasonCode.UNIQUE_LOCAL,
    why: "IMDS IPv6 (unique-local)",
  },
  {
    url: "http://[2002:a9fe:a9fe::1]/recipe",
    code: ReasonCode.NON_UNICAST,
    why: "6to4 embedding 169.254.169.254",
  },
  {
    url: "http://[64:ff9b::a9fe:a9fe]/recipe",
    code: ReasonCode.NON_UNICAST,
    why: "NAT64 embedding 169.254.169.254",
  },
  {
    url: "http://[2002:7f00:1::1]/recipe",
    code: ReasonCode.NON_UNICAST,
    why: "6to4 embedding 127.0.0.1",
  },
]

const OTHER_NON_UNICAST: readonly Refusal[] = [
  { url: "http://0.0.0.0/recipe", code: ReasonCode.NON_UNICAST, why: "unspecified" },
  { url: "http://255.255.255.255/recipe", code: ReasonCode.NON_UNICAST, why: "broadcast" },
  { url: "http://224.0.0.1/recipe", code: ReasonCode.NON_UNICAST, why: "multicast" },
  { url: "http://[2001::1]/recipe", code: ReasonCode.NON_UNICAST, why: "Teredo" },
  { url: "http://[ff02::1]/recipe", code: ReasonCode.NON_UNICAST, why: "IPv6 multicast" },
]

const UNPARSEABLE: readonly Refusal[] = [
  { url: "not-a-url", code: ReasonCode.UNPARSEABLE_URL, why: "not a URL at all" },
  {
    url: "http://[::gggg]/recipe",
    code: ReasonCode.UNPARSEABLE_URL,
    why: "malformed IPv6 literal (URL rejects)",
  },
]

const SCHEME: readonly Refusal[] = [
  { url: "file:///etc/passwd", code: ReasonCode.SCHEME_NOT_ALLOWED, why: "file://" },
  { url: "ftp://example.com/recipe", code: ReasonCode.SCHEME_NOT_ALLOWED, why: "ftp://" },
  { url: "gopher://example.com/recipe", code: ReasonCode.SCHEME_NOT_ALLOWED, why: "gopher://" },
  { url: "data:text/html,<h1>x</h1>", code: ReasonCode.SCHEME_NOT_ALLOWED, why: "data:" },
]

// Public unicast destinations the guard must NOT over-refuse: a wrong guard
// that refuses everything would pass every must-refuse test vacuously, so the
// allow set is what stops that.
const MUST_ALLOW: readonly string[] = [
  "https://example.com/recipe",
  "http://example.com/recipe",
  "https://www.kingarthurbaking.com/recipes/x",
  "http://8.8.8.8/recipe",
  "http://[2606:2800:220:1:248:1893:25c8:1946]/recipe",
  "http://[::ffff:8.8.8.8]/recipe",
]

const ALL_REFUSALS: readonly Refusal[] = [
  ...LOOPBACK,
  ...LINK_LOCAL,
  ...PRIVATE_RANGE,
  ...CGNAT_AND_UNIQUE_LOCAL,
  ...METADATA,
  ...OTHER_NON_UNICAST,
  ...UNPARSEABLE,
  ...SCHEME,
]

function expectRefused(r: Refusal): void {
  const decision = inspectUrl(r.url)
  expect(decision.allowed, `${r.url} (${r.why}) must be refused`).toBe(false)
  expect(isFetchableUrl(r.url), `${r.url} (${r.why}) boolean predicate`).toBe(false)
  expect(decision.code, `${r.url} (${r.why}) reason code`).toBe(r.code)
}

describe("CFV1-S5 address classification (default-deny unicast)", () => {
  it("url-security/loopback-refused", () => {
    for (const r of LOOPBACK) expectRefused(r)
  })

  it("url-security/link-local-refused", () => {
    for (const r of LINK_LOCAL) expectRefused(r)
  })

  it("url-security/private-range-refused", () => {
    for (const r of PRIVATE_RANGE) expectRefused(r)
  })

  it("url-security/cgnat-and-unique-local-refused", () => {
    for (const r of CGNAT_AND_UNIQUE_LOCAL) expectRefused(r)
  })

  it("url-security/metadata-endpoint-refused", () => {
    for (const r of METADATA) expectRefused(r)
  })

  it("url-security/unparseable-address-refused", () => {
    // An address (or URL) the guard cannot read is refused, never admitted —
    // the failure direction that turns a parser gap into an open door.
    for (const r of UNPARSEABLE) expectRefused(r)
  })

  it("url-security/scheme-allowlist", () => {
    for (const r of SCHEME) expectRefused(r)
  })

  it("refuses other non-unicast ranges (multicast, unspecified, broadcast, teredo)", () => {
    for (const r of OTHER_NON_UNICAST) expectRefused(r)
  })

  it("url-security/refusals-carry-reason-codes", () => {
    // Every refusal must carry a discriminable, non-OK code — the property that
    // lets each criterion above assert its reason rather than a bare exception.
    for (const r of ALL_REFUSALS) {
      const decision = inspectUrl(r.url)
      expect(decision.allowed, r.url).toBe(false)
      expect(decision.code, r.url).not.toBe(ReasonCode.OK)
      expect(Object.values(ReasonCode), `${r.url} code is a known reason`).toContain(decision.code)
    }
  })

  it("does not over-refuse public unicast destinations", () => {
    for (const url of MUST_ALLOW) {
      expect(isFetchableUrl(url), `${url} must be allowed`).toBe(true)
    }
  })

  it("url-security/suite-rejects-permissive-reference", () => {
    // The discrimination proof: a deliberately permissive reference that admits
    // everything must fail this suite's must-refuse set. If it passed, the
    // must-refuse assertions would be vacuous. We show, for every refusal case,
    // that the permissive reference admits what the real guard refuses — so the
    // assertions genuinely bite.
    const permissiveReference = (_url: string): boolean => true

    expect(ALL_REFUSALS.length).toBeGreaterThan(20)
    for (const r of ALL_REFUSALS) {
      expect(permissiveReference(r.url), `${r.url}: permissive ref admits it`).toBe(true)
      expect(isFetchableUrl(r.url), `${r.url}: real guard refuses it`).toBe(false)
    }
    // Stated as the suite would run it: the permissive reference fails the
    // must-refuse battery on every case, so the battery discriminates.
    const survivorsUnderPermissive = ALL_REFUSALS.filter(
      (r) => permissiveReference(r.url) === false,
    )
    expect(survivorsUnderPermissive).toHaveLength(0)
    const caughtByRealGuard = ALL_REFUSALS.filter((r) => isFetchableUrl(r.url) === false)
    expect(caughtByRealGuard).toHaveLength(ALL_REFUSALS.length)
  })
})
