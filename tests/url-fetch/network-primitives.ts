/**
 * Shared network-primitive detection for the safe-fetch static guards (CFV1-S5).
 *
 * Two suites enforce ADR-0010's "one chokepoint": `network-chokepoint.test.ts`
 * (a network-calling construct may appear ONLY inside `src/security/`) and
 * `url-fetch.security.test.ts` (SL0's vacuous-but-loud check, active only while no
 * guard module exists). They MUST agree on what counts as a network primitive, so
 * the pattern set and the file walk live here once rather than drifting in two
 * copies.
 *
 * The net is deliberately broad — a false positive means "route it through the
 * guard, or move it into the guard module", which is the point (ADR-0010). It is
 * also deliberately *precise* about the lookalikes that are NOT network calls
 * (`map.get(...)`, a field named `request`), so the guard cannot be defeated by a
 * primitive it forgot to list nor watered down into uselessness; both directions
 * are pinned by `network-primitives.test.ts`.
 */
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Constructs that open, or name a module capable of opening, an outbound network
 * connection. Each requires a call `(` or an import specifier, so member access
 * that merely shares a name (`Map.prototype.get`, a `request` field) does not
 * match. `undici` matches by name because importing it outside the guard is a
 * bypass; the guard's own module lives under `src/security/`, which the chokepoint
 * scan excludes, so the real connector may use it there.
 */
export const NETWORK_PATTERNS: readonly RegExp[] = [
  /\bfetch\s*\(/, // global fetch
  /\bhttps?\s*\.\s*request\s*\(/, // http(s).request(...)
  /\bhttps?\s*\.\s*get\s*\(/, // http(s).get(...)
  /\bhttp2\s*\.\s*(?:connect|request)\s*\(/, // http2 client
  /\bnet\s*\.\s*(?:connect|createConnection)\s*\(/, // raw TCP
  /\btls\s*\.\s*connect\s*\(/, // raw TLS
  /\bdgram\s*\.\s*createSocket\s*\(/, // UDP
  /\bnew\s+WebSocket\b/, // WebSocket client
  /\bnew\s+Request\s*\(/, // fetch Request input
  /["']node:(?:net|tls|dgram|http2)["']/, // raw-socket / rebinding-prone imports
  /\baxios\b/,
  /\bundici\b/,
  /\bgot\s*\(/,
]

/** Recursively list the source files a guard scan should read (.ts/.mts/.cts/.tsx). */
export function sourceFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(?:ts|mts|cts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
