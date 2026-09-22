/**
 * The instance-scoped ingest credential (CFV1-SL5, PDR-0003).
 *
 * PDR-0003 draws the line this module sits on: the Shortcut is the product's
 * mobile client, it authenticates to the ingest endpoint, and what it holds is
 * "scoped to submitting a capture to that one instance, and to nothing else. It
 * is not a model-provider credential, it cannot be exchanged for one, and it
 * grants no access to the library beyond submission." PDR-0001's eighth
 * invariant states the first half as non-negotiable.
 *
 * The scoping is structural rather than promised. This module offers exactly one
 * operation — decide whether a presented string is the configured one — and
 * nothing here reads, derives, wraps or returns any other credential. There is
 * no exchange endpoint to forget to guard, because there is no function that
 * takes an ingest credential and returns anything but a boolean.
 *
 * Losing the phone therefore costs submission to one instance. It does not cost
 * the library, and it does not cost the model account.
 */
import { createHash, timingSafeEqual } from "node:crypto"

/**
 * The shortest secret this will accept.
 *
 * A credential that may leave the device has to survive being guessed offline;
 * 32 characters is the length the token minter already mints elsewhere
 * (`CAPABILITY_TOKEN_BYTES`, base64url). Refusing a short one at construction is
 * the fail-closed half: an instance configured with `"changeme"` should not
 * start, rather than run and be discovered.
 */
export const MIN_INGEST_CREDENTIAL_LENGTH = 32

/** Decides whether a presented credential is this instance's. Nothing else. */
export interface IngestCredential {
  /**
   * `true` only for the configured secret. `undefined`, the empty string and any
   * other value are false — an absent credential is never treated as assent.
   */
  accepts(presented: string | undefined): boolean
}

/**
 * Build the credential check from the configured secret.
 *
 * Throws when the secret is too short to be one, so a misconfigured instance
 * fails at startup rather than serving an endpoint anyone can reach.
 */
export function createIngestCredential(secret: string): IngestCredential {
  if (secret.length < MIN_INGEST_CREDENTIAL_LENGTH) {
    throw new Error(
      `the ingest credential must be at least ${MIN_INGEST_CREDENTIAL_LENGTH} characters, ` +
        `so a guess cannot be cheap; got ${secret.length}`,
    )
  }
  // Digested before comparing, so the comparison is over two equal-length
  // buffers whatever was presented. `timingSafeEqual` throws on a length
  // mismatch, and catching that would make the reply's TIMING depend on the
  // guess's length — a free character-count oracle for anyone probing.
  const expected = createHash("sha256").update(secret, "utf8").digest()
  return {
    accepts(presented: string | undefined): boolean {
      if (presented === undefined || presented === "") return false
      const offered = createHash("sha256").update(presented, "utf8").digest()
      return timingSafeEqual(expected, offered)
    },
  }
}

/**
 * The credential out of an `Authorization` header, or `undefined`.
 *
 * Only the `Bearer` scheme, and the scheme name is matched case-insensitively
 * because RFC 7235 says it is case-insensitive and a phone's HTTP client is not
 * this project's to specify. The value itself is returned unchanged — trimming
 * or normalizing it would make two different secrets compare equal.
 */
export function bearerCredential(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined
  const match = /^Bearer (.+)$/i.exec(authorization)
  return match?.[1]
}
