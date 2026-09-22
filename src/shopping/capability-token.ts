/**
 * The capability token for the shopping path (CFV1-SL3, OQ-17).
 *
 * A capability URL is a bearer credential: it is designed on the assumption that
 * it leaves the user's device (S3 Q6/Q7 — Bring retains the source URL as
 * `linkOutUrl` and re-fetches it server-side). Two properties make that
 * assumption survivable, and this module is where both live:
 *
 *  - **exactly one recipe.** A token resolves to a single `recipeId` and nothing
 *    else. The interface offers no way to list grants, enumerate tokens, or reach
 *    a second recipe from one token, so possession of a token off-device grants
 *    no ambient authority beyond that one recipe.
 *  - **revocable, permanent otherwise.** OQ-17 is decided (Kornelius, 2026-09-21):
 *    the token is permanent-but-revocable, NOT auto-expiring — because Bring
 *    retains the URL and may re-fetch it later, an auto-expiry would break a
 *    legitimately-retained link, whereas revocation is the deliberate kill switch
 *    for an exposed one. So there is no expiry; a token resolves until it is
 *    revoked, after which it resolves to nothing.
 *
 * The secret goes in the URL **path**, never the query string (S3 Q6: Bring
 * forwards the URL as given and a query token's survival depends on the host).
 * The token is minted as a base64url string, which is path-safe by construction,
 * and {@link capabilityPath} places it in a path segment.
 *
 * Minting is the one non-deterministic act (an unguessable secret needs a
 * CSPRNG); it is behind an injected {@link TokenMinter} so a test can mint
 * predictable tokens through the same path production uses (cf. the S5 seam
 * discipline). Everything else is deterministic. This module takes no network
 * primitive, so it sits outside `src/security/`, and declares no contract shape.
 */

import { randomBytes } from "node:crypto"

/** Token entropy: 256 bits, emitted as 43 base64url characters (no padding). */
export const CAPABILITY_TOKEN_BYTES = 32

/** A single capability grant: one token, the one recipe it reaches, its state. */
export interface CapabilityGrant {
  /** The unguessable secret. Path-safe; belongs in the URL path, never the query. */
  readonly token: string
  /** The single recipe this token grants — and the only thing it grants. */
  readonly recipeId: string
  /** A revoked grant resolves to nothing; revocation is the token's only end. */
  readonly revoked: boolean
}

/** Mints a fresh, unguessable, path-safe capability secret. */
export type TokenMinter = () => string

/** The production minter: 256 bits of CSPRNG randomness as a base64url string. */
export function createCryptoTokenMinter(): TokenMinter {
  return () => randomBytes(CAPABILITY_TOKEN_BYTES).toString("base64url")
}

/**
 * The capability store. It issues tokens, resolves an active token to its one
 * recipe, and revokes. It deliberately exposes NO enumeration — there is no way
 * to list tokens or recipes — so a token is the only handle to its recipe and
 * carries no authority beyond it.
 */
export interface CapabilityStore {
  /** Issue a fresh token granting exactly `recipeId`. Each call mints a new token. */
  issue(recipeId: string): Promise<CapabilityGrant>
  /**
   * Resolve an active token to its recipe id, or `undefined` when the token is
   * unknown OR revoked. The two are indistinguishable to a holder, so a revoked
   * or guessed token leaks nothing.
   */
  resolve(token: string): Promise<string | undefined>
  /**
   * Revoke a token. Returns `true` when an active grant was revoked, `false` when
   * the token is unknown or was already revoked. Idempotent.
   */
  revoke(token: string): Promise<boolean>
}

export interface CapabilityStoreOptions {
  /** Test-only seam: a deterministic minter. Production omits it and gets the CSPRNG one. */
  readonly mint?: TokenMinter
}

/** How many times to re-mint on the astronomically-unlikely event of a collision. */
const MAX_MINT_ATTEMPTS = 8

class InMemoryCapabilityStore implements CapabilityStore {
  readonly #grants = new Map<string, CapabilityGrant>()
  readonly #mint: TokenMinter

  constructor(mint: TokenMinter) {
    this.#mint = mint
  }

  async issue(recipeId: string): Promise<CapabilityGrant> {
    let token = this.#mint()
    for (let attempt = 1; this.#grants.has(token); attempt++) {
      if (attempt >= MAX_MINT_ATTEMPTS) {
        throw new Error("capability token minter produced repeated collisions")
      }
      token = this.#mint()
    }
    const grant: CapabilityGrant = { token, recipeId, revoked: false }
    this.#grants.set(token, grant)
    return grant
  }

  async resolve(token: string): Promise<string | undefined> {
    const grant = this.#grants.get(token)
    if (grant === undefined || grant.revoked) return undefined
    return grant.recipeId
  }

  async revoke(token: string): Promise<boolean> {
    const grant = this.#grants.get(token)
    if (grant === undefined || grant.revoked) return false
    this.#grants.set(token, { ...grant, revoked: true })
    return true
  }
}

/**
 * Create an in-memory capability store. Production passes no options and gets the
 * CSPRNG minter; a test may inject a deterministic {@link TokenMinter}. The
 * concrete class is unexported — callers depend on {@link CapabilityStore} only.
 */
export function createInMemoryCapabilityStore(options?: CapabilityStoreOptions): CapabilityStore {
  return new InMemoryCapabilityStore(options?.mint ?? createCryptoTokenMinter())
}

/** The base64url alphabet: exactly the characters that are safe in a URL path segment. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Whether `token` is safe to place in a URL path segment without escaping. */
export function isPathSafeToken(token: string): boolean {
  return token.length > 0 && BASE64URL.test(token)
}

/**
 * The capability URL path for a token — the secret in the PATH, never the query
 * (S3 Q6). The token must be path-safe; a token that is not is a programming
 * error, since minted tokens always are.
 */
export function capabilityPath(token: string): string {
  if (!isPathSafeToken(token)) {
    throw new Error("capability token is not path-safe")
  }
  return `/r/${token}`
}

/**
 * The absolute capability URL for a token — the one address ADR-0017 hands to
 * Bring, which fetches it server-side from its own infrastructure.
 *
 * It takes the base URL rather than deriving one, and that is the whole reason
 * this function exists beside {@link capabilityPath}. The serving route is
 * origin-agnostic on purpose (`src/http/capability-app.ts`), so nothing on the
 * serving side knows what a caller would have to type to reach it; the one place
 * that knows is the operator's configuration, `PUBLIC_BASE_URL`. Deriving it
 * from the request's `Host` header instead would have been one line shorter and
 * would put a value a caller controls into a URL this instance hands to a third
 * party.
 *
 * The base's own path is KEPT: an instance behind a reverse proxy at
 * `https://example.test/cookframe` serves its recipes under that prefix, and
 * `new URL("/r/…", base)` would have silently dropped it. Trailing slashes on
 * the base are collapsed so `https://example.test/` and `https://example.test`
 * produce the same URL rather than one with `//r/` in it.
 */
export function capabilityUrl(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}${capabilityPath(token)}`
}
