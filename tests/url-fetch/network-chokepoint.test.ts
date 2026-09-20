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
 * module can open its own socket. Today `src/security/` performs no network call
 * at all (the pre-flight is synchronous); when Slice 4 adds the undici connector
 * it lives here, inside the allowed directory, and this test keeps every other
 * module off the network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const srcDir = join(repoRoot, "src")

// The one directory permitted to open a network connection: the safe-fetch
// guard's own module (ADR-0010's single chokepoint).
const GUARD_DIR = join(srcDir, "security")

function tsFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (name.endsWith(".ts")) out.push(full)
  }
  return out
}

// The same deliberately-broad net of network-calling constructs SL0 uses. A
// false positive here means "route it through the guard, or move it into the
// guard module" — which is the point.
const NETWORK_PATTERNS: readonly RegExp[] = [
  /\bfetch\s*\(/,
  /https?\.request\s*\(/,
  /\bnew\s+Request\s*\(/,
  /\baxios\b/,
  /\bundici\b/,
  /\bgot\s*\(/,
]

function isUnderGuardDir(file: string): boolean {
  const rel = relative(GUARD_DIR, file)
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep))
}

describe("safe-fetch chokepoint", () => {
  it("no module outside the guard opens a network connection", () => {
    for (const file of tsFiles(srcDir)) {
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
