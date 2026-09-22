/**
 * An instance-scoped shared secret, and the check that decides whether a
 * presented string is it (CFV1-SL5 for the ingest half, CFV1-RUN for the
 * library half; PDR-0003, PDR-0002).
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
 * takes a credential and returns anything but a boolean.
 *
 * Losing the phone therefore costs submission to one instance. It does not cost
 * the library, and it does not cost the model account.
 *
 * **Why this is a primitive with a purpose rather than one named credential.**
 * CFV1-RUN gave the library and recipe pages their first addresses, and they need
 * an access rule. Reusing the *ingest* secret for them would have been the
 * shortest wiring and would have broken PDR-0003's last clause outright: the
 * phone's credential would then open the library, and losing the device would
 * cost exactly what that record says it must not. So the instance configures two
 * distinct secrets that share this one mechanism, and each names itself at
 * construction so a misconfiguration says which one is wrong. See
 * `src/http/pages-app.ts`, where the rule is stated beside the route it guards,
 * and `docs/adr/ADR-0024-*` for the decision.
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
export const MIN_INSTANCE_CREDENTIAL_LENGTH = 32

/** Decides whether a presented credential is this instance's. Nothing else. */
export interface InstanceCredential {
  /**
   * `true` only for the configured secret. `undefined`, the empty string and any
   * other value are false — an absent credential is never treated as assent.
   */
  accepts(presented: string | undefined): boolean
}

/**
 * Build a credential check from a configured secret.
 *
 * `purpose` names the secret in the refusal only — it is never hashed, compared
 * or stored, so two credentials with the same purpose string are still two
 * different secrets. It exists because an operator who misconfigures one of the
 * instance's two credentials should be told which.
 *
 * Throws when the secret is too short to be one, so a misconfigured instance
 * fails at startup rather than serving an endpoint anyone can reach.
 */
export function createInstanceCredential(secret: string, purpose: string): InstanceCredential {
  if (secret.length < MIN_INSTANCE_CREDENTIAL_LENGTH) {
    throw new Error(
      `the ${purpose} must be at least ${MIN_INSTANCE_CREDENTIAL_LENGTH} characters, ` +
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

/** The one scheme this instance understands, with its single separating space. */
const BEARER_PREFIX = "Bearer "

/**
 * The credential out of an `Authorization` header, or `undefined`.
 *
 * Only the `Bearer` scheme, and the scheme name is matched case-insensitively
 * because RFC 7235 says it is case-insensitive and a phone's HTTP client is not
 * this project's to specify. The value itself is returned unchanged — trimming
 * or normalizing it would make two different secrets compare equal.
 *
 * Which is why this is a prefix test and not `/^Bearer (.+)$/`. In JavaScript
 * `$` matches before a final newline unless `m` is set, so that pattern quietly
 * dropped a trailing `\n` and returned a value the header did not carry — the
 * one case where the sentence above was false. Nothing was at risk (a value
 * with a newline is a different value and is refused either way), but a
 * docstring that promises verbatim and a function that sometimes strips is the
 * defect this repository keeps finding, in miniature. Found by review.
 */
export function bearerCredential(authorization: string | undefined): string | undefined {
  if (authorization === undefined) return undefined
  if (authorization.slice(0, BEARER_PREFIX.length).toLowerCase() !== BEARER_PREFIX.toLowerCase()) {
    return undefined
  }
  const value = authorization.slice(BEARER_PREFIX.length)
  return value === "" ? undefined : value
}
