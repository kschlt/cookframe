/**
 * CFV1-S5 — the safe-fetch chokepoint is the only network path (ADR-0010 point 1:
 * "one chokepoint … there is no second path to keep in sync — and no second path
 * to forget").
 *
 * SL0's `url-fetch.security.test.ts` scanned all of `src/` for an ungated network
 * call and failed the build if it found one — but only while no guard module
 * existed; once `src/security/url-guard.ts` landed, that scan returns early and
 * the static guarantee lapsed (noted in the PR #8 review). This restores it, and
 * strengthens it: a network-calling construct may appear ONLY inside the guard's
 * own module directory. Anywhere else in `src/` it is a bypass of the guard and
 * fails the build, whether or not the guard exists.
 *
 * This is the enforcement of ADR-0010's central decision. The guard's guarantee —
 * resolve-and-pin, per-hop revalidation, the bounds — protects nothing if another
 * module can open its own socket. The undici connector (`src/security/safe-fetch.ts`)
 * is the one network call in the tree; it lives inside the allowed directory, and
 * this test keeps every other module off the network.
 */
import { readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { NETWORK_PATTERNS, sourceFiles } from "./network-primitives.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")

// The one directory permitted to open a network connection: the safe-fetch
// guard's own module (ADR-0010's single chokepoint). The pattern set and file
// walk are shared with SL0's scan (./network-primitives.ts) so the two guards
// cannot drift.
const GUARD_DIR = join(srcDir, "security")

function isUnderGuardDir(file: string): boolean {
  const rel = relative(GUARD_DIR, file)
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep))
}

describe("safe-fetch chokepoint", () => {
  it("no module outside the guard opens a network connection", () => {
    for (const file of sourceFiles(srcDir)) {
      if (isUnderGuardDir(file)) continue
      const text = readFileSync(file, "utf8")
      for (const pattern of NETWORK_PATTERNS) {
        expect(
          pattern.test(text),
          `${relative(repoRoot, file)} makes a network call outside src/security/ — route it through the safe-fetch guard (ADR-0010: one chokepoint)`,
        ).toBe(false)
      }
    }
  })
})
