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
 * **Grants are kept by the repository, not by this module (ADR-0032).**
 * "Permanent" has to survive the machine stopping when idle (ADR-0026), or the
 * URL Bring kept dies at the first stop while the recipe it names is still
 * there. So the store here holds nothing of its own: it mints, takes the token's
 * digest, and hands the digest to {@link RecipeRepository}. The repository never
 * sees the token, which is what keeps a leaked database from being a list of
 * working URLs.
 *
 * Minting is the one non-deterministic act (an unguessable secret needs a
 * CSPRNG); it is behind an injected {@link TokenMinter} so a test can mint
 * predictable tokens through the same path production uses (cf. the S5 seam
 * discipline). Everything else is deterministic. This module takes no network
 * primitive, so it sits outside `src/security/`, and declares no contract shape.
 */

import { createHash, randomBytes } from "node:crypto"
import type { RecipeRepository } from "../persistence/index.js"

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

/**
 * The digest a grant is kept under (ADR-0032): SHA-256 of the token, as
 * base64url.
 *
 * Unsalted on purpose. A salt defends a low-entropy secret against a table
 * built in advance, and this secret is 256 bits from a CSPRNG, so there is no
 * table to build. A salt would also cost the one read the serving route makes,
 * because a presented token could no longer be looked up by its digest.
 */
export function capabilityTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url")
}

class RepositoryCapabilityStore implements CapabilityStore {
  readonly #repo: RecipeRepository
  readonly #mint: TokenMinter

  constructor(repo: RecipeRepository, mint: TokenMinter) {
    this.#repo = repo
    this.#mint = mint
  }

  async issue(recipeId: string): Promise<CapabilityGrant> {
    // The store refuses a digest it already holds, active or revoked, and a
    // refusal is answered by minting again — never by overwriting.
    for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
      const token = this.#mint()
      const stored = await this.#repo.storeCapabilityGrant({
        tokenDigest: capabilityTokenDigest(token),
        recipeId,
      })
      if (stored) return { token, recipeId, revoked: false }
    }
    throw new Error("capability token minter produced repeated collisions")
  }

  async resolve(token: string): Promise<string | undefined> {
    return await this.#repo.resolveCapabilityGrant(capabilityTokenDigest(token))
  }

  async revoke(token: string): Promise<boolean> {
    return await this.#repo.revokeCapabilityGrant(capabilityTokenDigest(token))
  }
}

/**
 * Create the capability store over `repo` (ADR-0032). The grants live wherever
 * the repository keeps things, so a store built on the durable repository keeps
 * every grant across a restart, and one built on the provisional repository is a
 * test double that survives nothing.
 *
 * Production passes no options and gets the CSPRNG minter; a test may inject a
 * deterministic {@link TokenMinter}. The concrete class is unexported — callers
 * depend on {@link CapabilityStore} only.
 */
export function createCapabilityStore(
  repo: RecipeRepository,
  options?: CapabilityStoreOptions,
): CapabilityStore {
  return new RepositoryCapabilityStore(repo, options?.mint ?? createCryptoTokenMinter())
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
