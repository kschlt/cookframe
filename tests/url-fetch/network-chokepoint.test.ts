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
 * module can open its own socket. `src/security/` is the one directory that may
 * open one, and this test keeps every other module off the network.
 *
 * Two modules inside it do, for two different threat models: `safe-fetch.ts`
 * fetches attacker-influenced URLs (SSRF, the address policy), and
 * `model-egress.ts` posts to the operator's configured model endpoint (a fixed
 * address, a credential not to be forwarded). Allowing a whole directory would
 * otherwise let a third appear unnoticed, so the second assertion pins the list:
 * adding a module that opens a socket is a decision, and it has to be made here.
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

/**
 * Every module inside the guard directory, with what it is for. The scan above
 * exempts this whole directory, so a file added here is exempt the moment it
 * lands — which is fine for a guard and not fine silently. Declaring the
 * inventory turns "a second egress path appeared" into a failing test with a
 * message, so adding one stays a decision someone makes on purpose.
 *
 * Matching on the pattern set instead would not work here: these files talk
 * about network primitives in their own prose and names, and the set is built to
 * flag the words wherever they appear.
 */
const GUARD_MODULES = new Map([
  ["address-policy.ts", "ADR-0010 points 4-5: the default-deny address predicate"],
  ["reason-codes.ts", "ADR-0010 point 8: discriminable refusal codes; opens nothing"],
  ["safe-fetch.ts", "ADR-0010 point 1: the guarded URL-ingestion connector — OPENS SOCKETS"],
  ["url-guard.ts", "ADR-0010 point 2: URL-level pre-flight checks"],
  ["model-egress.ts", "CFV1-SL1: the guarded model-provider egress path — OPENS SOCKETS"],
])

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

  it("the exempt directory holds only the modules it is declared to hold", () => {
    const present = new Set<string>()
    for (const file of sourceFiles(srcDir)) {
      if (!isUnderGuardDir(file)) continue
      const name = relative(GUARD_DIR, file)
      present.add(name)
      expect(
        GUARD_MODULES.has(name),
        `src/security/${name} sits in the one directory the chokepoint scan exempts but is not declared in GUARD_MODULES — say what it is for and, if it opens a socket, which record allows it`,
      ).toBe(true)
    }
    for (const [name, why] of GUARD_MODULES) {
      expect(
        present.has(name),
        `GUARD_MODULES lists src/security/${name} (${why}) but no such module exists — the inventory is stale`,
      ).toBe(true)
    }
  })
})
