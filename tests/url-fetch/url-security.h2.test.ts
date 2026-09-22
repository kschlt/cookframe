/**
 * CFV1-S5 — the safe-fetch guard over HTTP/2.
 *
 * Every other proof in this directory runs over plain-HTTP loopback, so none of
 * them has ever exercised an h2 connection. That was harmless while undici
 * spoke HTTP/1.1 unless asked otherwise. From undici 8 it is not: v8 negotiates
 * HTTP/2 by default whenever a TLS server offers it via ALPN, so the protocol
 * the guard's promises are carried over changed without a line of this
 * repository changing. Measured on this tree, two sequential fetches against
 * the same ALPN-offering server:
 *
 *   undici 7.29.1 — the server saw `1.1` twice, the connector ran twice
 *   undici 8.11.0 — the server saw `2.0` twice, the connector ran once
 *
 * The second line is the multiplexing: one connection now carries both
 * requests. That is not a weakening — the one connection is still the pinned,
 * classified address, and a request to an origin the resolver refuses still
 * never opens one — but it means "per connection" and "per request" stopped
 * being the same sentence, and nothing in the tree said so.
 *
 * So this file holds the same promises as the connector suite, over h2 instead
 * of h1. It fails closed in the way that matters: if undici ever stops
 * negotiating h2 here, the protocol assertion reddens and says the rest of the
 * file stopped measuring what its name claims, rather than passing quietly on
 * an HTTP/1.1 connection.
 *
 * The work happens in `h2-probe.ts`, a child process; see its header for why.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ReasonCode } from "../../src/security/reason-codes.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

type Attempt = { ok: true; body: string } | { ok: false; code: string }
interface Report {
  reachedNamedHost: Attempt
  redirectToPrivateLiteral: Attempt
  redirectToForeignScheme: Attempt
  redirectWithoutLocation: Attempt
  redirectHopBound: Attempt
  protocols: string[]
  resolverCalls: number
  hopRouteHits: number
}

let workDir: string
let report: Report

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "cookframe-h2-"))
  const keyPath = join(workDir, "key.pem")
  const certPath = join(workDir, "cert.pem")

  // A TLS server needs a certificate, and Node cannot author one. `openssl` is
  // installed by the dev image for this reason rather than inherited from the
  // base image by luck — the same argument the gitleaks scanner pin makes. If
  // it is missing this test FAILS; it never skips, because a skipped proof
  // reports success and that has cost this project a gate before. The failure
  // lands on the file, not on the tests: the run reports `Test Files 1 failed`
  // and exits 1, but the tally beside it reads as every test skipped, because
  // vitest counts the tests under a failed `beforeAll` as skipped. Read the
  // files line.
  const probe = spawnSync("openssl", ["version"], { encoding: "utf8" })
  expect(
    probe.error,
    "`openssl` is not on PATH, so the HTTP/2 proofs below cannot run — install it rather than skipping them",
  ).toBeUndefined()

  execFileSync(
    "openssl",
    // biome-ignore format: one flag per line is unreadable here
    ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
     "-days", "1", "-nodes", "-subj", "/CN=h2.test",
     "-addext", "subjectAltName=DNS:h2.test,IP:127.0.0.1"],
    { stdio: "ignore" },
  )

  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", join(here, "h2-probe.ts"), keyPath, certPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      // The certificate is self-signed, so it is trusted the way an operator
      // would trust a private CA. Verification stays ON — the alternative,
      // NODE_TLS_REJECT_UNAUTHORIZED, would disable it for everything.
      env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath },
      timeout: 60_000,
    },
  )
  expect(run.status, `the HTTP/2 probe failed:\n${run.stderr}`).toBe(0)
  const line = run.stdout.trim().split("\n").at(-1) ?? ""
  report = JSON.parse(line) as Report
}, 90_000)

afterAll(() => {
  if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
})

const refusedAs = (attempt: Attempt, code: ReasonCode, what: string): void => {
  expect(attempt.ok, `${what} resolved over HTTP/2 instead of being refused as ${code}`).toBe(false)
  if (!attempt.ok) expect(attempt.code, `${what} refused as ${code}`).toBe(code)
}

describe("CFV1-S5 safe-fetch over HTTP/2", () => {
  it("url-security/h2-is-what-was-measured — the transport really was HTTP/2", () => {
    // Without this the whole file could pass on an HTTP/1.1 connection and
    // report that the h2 path is guarded, which is the failure mode it exists
    // to close. The server offers h2 AND http/1.1 via ALPN, so seeing `2.0`
    // here is undici's own negotiation, not a protocol forced by the test.
    expect(
      report.protocols,
      "the server saw a protocol other than HTTP/2, so the proofs below did not measure the h2 path",
    ).toEqual(["2.0"])
  })

  it("url-security/h2-connector-pins — a named host is reachable over h2 only through the validated address", () => {
    // `h2.test` has no DNS entry. The connection can only have been made
    // because the connector handed undici the address the resolver returned and
    // `classifyAddress` allowed — so the chokepoint is still on the h2 path,
    // and it is still the classified address that is connected to.
    expect(
      report.reachedNamedHost.ok,
      `the h2 fetch of an unresolvable name failed as ${report.reachedNamedHost.ok ? "" : report.reachedNamedHost.code}, so the connector did not pin`,
    ).toBe(true)
    if (report.reachedNamedHost.ok) {
      expect(report.reachedNamedHost.body).toContain("a recipe")
    }
    expect(report.resolverCalls, "the connector never ran").toBeGreaterThan(0)
  })

  it("url-security/h2-redirect-revalidation — a hop to a private literal is refused over h2", () => {
    refusedAs(
      report.redirectToPrivateLiteral,
      ReasonCode.PRIVATE_RANGE,
      "an h2 redirect to 10.0.0.5",
    )
  })

  it("url-security/h2-scheme-allowlist — a hop to a foreign scheme is refused over h2", () => {
    refusedAs(
      report.redirectToForeignScheme,
      ReasonCode.SCHEME_NOT_ALLOWED,
      "an h2 redirect to ftp:",
    )
  })

  it("url-security/h2-redirect-invalid — a redirect without a Location is refused over h2", () => {
    refusedAs(
      report.redirectWithoutLocation,
      ReasonCode.REDIRECT_INVALID,
      "an h2 302 with no Location",
    )
  })

  it("url-security/h2-redirect-count-bound — the hop bound holds over h2, at the configured number", () => {
    refusedAs(report.redirectHopBound, ReasonCode.REDIRECT_LIMIT, "an unbounded h2 redirect chain")
    // The reason code alone does not measure the bound: a chain cut after a
    // thousand hops is also `REDIRECT_LIMIT`. Measured — raising the bound in
    // the guard left this file green until this assertion existed. The probe
    // configures `maxRedirects: 3`, so the endlessly-redirecting route may be
    // served at most four times: hops 0 through 3, with the fifth attempt
    // refused before the request goes out.
    expect(
      report.hopRouteHits,
      `the redirect route was served ${report.hopRouteHits} times for a bound of 3, so the chain was cut somewhere other than the configured bound`,
    ).toBeLessThanOrEqual(4)
  })
})
