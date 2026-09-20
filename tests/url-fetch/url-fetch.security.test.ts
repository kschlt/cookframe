/**
 * URL-fetch security tests (CFV1-SL0, proof: contributes to
 * slice0/ci-job-coverage — the URL-fetch-security job).
 *
 * The CFV1-S3 spike established that a recipe URL is fetched server-side and
 * that Cookframe must never be tricked into fetching an internal address
 * (loopback, private network, link-local metadata) on behalf of a caller — an
 * SSRF guard is part of the contract with the outside world.
 *
 * SL0 ships no fetch layer, so this job is vacuous today — BUT loudly so. If a
 * URL guard exists (`src/security/url-guard.ts` exporting `isFetchableUrl`),
 * the battery below must pass. If it does not exist yet, the test asserts that
 * NO product code performs a network fetch, so the moment fetching is
 * introduced without a guard, this build turns red.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { NETWORK_PATTERNS, sourceFiles } from "./network-primitives.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")

async function loadGuard(): Promise<{ isFetchableUrl: (url: string) => boolean } | undefined> {
  // Non-literal specifier: the guard module does not exist yet, so this must
  // not be a statically-resolved import. It resolves once the module lands.
  const specifier = "../../src/security/url-guard.js"
  try {
    return (await import(specifier)) as {
      isFetchableUrl: (url: string) => boolean
    }
  } catch {
    return undefined
  }
}

describe("URL-fetch security", () => {
  it("no product code fetches without going through a URL guard", async () => {
    const guard = await loadGuard()
    if (guard !== undefined) return // guard exists; the battery below is the real check
    for (const file of sourceFiles(srcDir)) {
      const text = readFileSync(file, "utf8")
      for (const pattern of NETWORK_PATTERNS) {
        expect(
          pattern.test(text),
          `${file} performs a network call but src/security/url-guard.ts does not exist yet`,
        ).toBe(false)
      }
    }
  })

  it("the guard rejects internal targets and accepts public ones (when it exists)", async () => {
    const guard = await loadGuard()
    if (guard === undefined) return // covered by the vacuous-but-loud case above
    const unsafe = [
      "http://127.0.0.1/recipe",
      "http://localhost/recipe",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/recipe",
      "http://192.168.1.10/recipe",
      "http://[::1]/recipe",
      "file:///etc/passwd",
      "ftp://example.com/recipe",
    ]
    for (const url of unsafe) {
      expect(guard.isFetchableUrl(url), url).toBe(false)
    }
    for (const url of ["https://example.com/recipe", "http://example.com/recipe"]) {
      expect(guard.isFetchableUrl(url), url).toBe(true)
    }
  })
})
