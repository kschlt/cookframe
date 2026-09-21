/**
 * CFV1-SL3 — the capability token: the bearer credential for the shopping path,
 * proving the offline capability-URL criteria (OQ-17).
 *
 * Scope. This suite proves the token MODEL — single-recipe scope, revocation,
 * no ambient authority, and the decided format/lifetime (permanent-but-revocable,
 * secret in the path). It does NOT stand up the HTTP route that serves a recipe
 * at the capability path; that is the serving-layer unit (ADR-0007). The
 * properties here are what that route will rest on: "exposes exactly one recipe"
 * is a property of what the token can reach, not only of what a page renders.
 *
 * Tokens are minted through the same path production uses; a deterministic minter
 * is injected so the assertions are hermetic, and the CSPRNG minter's format and
 * uniqueness are checked separately.
 */
import { describe, expect, it } from "vitest"
import {
  CAPABILITY_TOKEN_BYTES,
  type CapabilityStore,
  capabilityPath,
  createCryptoTokenMinter,
  createInMemoryCapabilityStore,
  isPathSafeToken,
  type TokenMinter,
} from "../../src/shopping/capability-token.js"

/** A deterministic minter yielding tok-1, tok-2, … so assertions are hermetic. */
const sequentialMinter = (): TokenMinter => {
  let n = 0
  return () => {
    n += 1
    return `tok-${n}`
  }
}

const store = (mint: TokenMinter = sequentialMinter()): CapabilityStore =>
  createInMemoryCapabilityStore({ mint })

describe("slice3/capability-url-single-recipe", () => {
  it("resolves a token to exactly its one recipe, and exposes no way to reach another", async () => {
    const s = store()
    const a = await s.issue("recipe-A")
    const b = await s.issue("recipe-B")

    // Each token reaches its own recipe and only that one.
    expect(await s.resolve(a.token)).toBe("recipe-A")
    expect(await s.resolve(b.token)).toBe("recipe-B")
    expect(a.token).not.toBe(b.token)

    // The store's surface is issue/resolve/revoke — there is no enumeration by
    // which one token could reach another recipe or list what exists.
    const surface = s as unknown as Record<string, unknown>
    for (const method of ["list", "listAll", "all", "entries", "keys", "grants"] as const) {
      expect(surface[method]).toBeUndefined()
    }
  })

  it("returns undefined for a token that was never issued, leaking nothing", async () => {
    const s = store()
    await s.issue("recipe-A")
    expect(await s.resolve("tok-does-not-exist")).toBeUndefined()
  })
})

describe("slice3/capability-url-revocable", () => {
  it("stops resolving once revoked", async () => {
    const s = store()
    const grant = await s.issue("recipe-A")
    expect(await s.resolve(grant.token)).toBe("recipe-A")

    expect(await s.revoke(grant.token)).toBe(true)
    expect(await s.resolve(grant.token)).toBeUndefined()
  })

  it("is idempotent and honest about what it revoked", async () => {
    const s = store()
    const grant = await s.issue("recipe-A")
    expect(await s.revoke(grant.token)).toBe(true) // an active grant was revoked
    expect(await s.revoke(grant.token)).toBe(false) // already revoked
    expect(await s.revoke("never-issued")).toBe(false) // unknown token
  })

  it("revokes one token without affecting another for the same recipe", async () => {
    const s = store()
    const first = await s.issue("recipe-A")
    const second = await s.issue("recipe-A")
    expect(first.token).not.toBe(second.token)

    await s.revoke(first.token)
    // The second grant to the same recipe is untouched.
    expect(await s.resolve(first.token)).toBeUndefined()
    expect(await s.resolve(second.token)).toBe("recipe-A")
  })
})

describe("slice3/capability-url-no-ambient-authority", () => {
  it("a revoked or unknown token is indistinguishable, so it leaks no state", async () => {
    const s = store()
    const grant = await s.issue("recipe-A")
    await s.revoke(grant.token)

    // A revoked token and a never-issued token both resolve to undefined — a
    // holder cannot tell "was real, now revoked" from "never existed".
    expect(await s.resolve(grant.token)).toBeUndefined()
    expect(await s.resolve("never-existed")).toBeUndefined()
  })

  it("possession of one token grants nothing about another token or recipe", async () => {
    const s = store()
    const a = await s.issue("recipe-A")
    const b = await s.issue("recipe-B")
    // Holding token A cannot be turned into recipe B or token B via any operation.
    expect(await s.resolve(a.token)).toBe("recipe-A")
    expect(await s.resolve(a.token)).not.toBe("recipe-B")
    // Revoking A does not touch B.
    await s.revoke(a.token)
    expect(await s.resolve(b.token)).toBe("recipe-B")
  })
})

describe("slice3/capability-token-format-and-lifetime", () => {
  it("mints an unguessable, path-safe secret (256 bits, base64url) — OQ-17 format", () => {
    const mint = createCryptoTokenMinter()
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const token = mint()
      // 32 bytes base64url with no padding is 43 characters, all path-safe.
      expect(token).toHaveLength(43)
      expect(isPathSafeToken(token)).toBe(true)
      expect(token).not.toContain("=")
      tokens.add(token)
    }
    // No collisions across 1000 mints — the entropy is real, not sequential.
    expect(tokens.size).toBe(1000)
    expect(CAPABILITY_TOKEN_BYTES).toBe(32)
  })

  it("is permanent-but-revocable: a token resolves indefinitely until revoked — OQ-17 lifetime", async () => {
    // There is no expiry seam and no clock: the only thing that ends a token is
    // revoke. So resolving many times never lapses on its own.
    const s = store()
    const grant = await s.issue("recipe-A")
    for (let i = 0; i < 5; i++) expect(await s.resolve(grant.token)).toBe("recipe-A")
    await s.revoke(grant.token)
    expect(await s.resolve(grant.token)).toBeUndefined()
  })

  it("places the secret in the URL path, never the query (S3 Q6)", () => {
    const mint = createCryptoTokenMinter()
    const token = mint()
    const path = capabilityPath(token)
    // The secret is a path segment; there is no query string.
    expect(path).toBe(`/r/${token}`)
    expect(path).not.toContain("?")
    expect(path.startsWith("/r/")).toBe(true)
    // A non-path-safe token is a programming error, refused rather than escaped.
    expect(() => capabilityPath("has space")).toThrow()
    expect(() => capabilityPath("has/slash")).toThrow()
    expect(isPathSafeToken("a?b")).toBe(false)
  })
})
