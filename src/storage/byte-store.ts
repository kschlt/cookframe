/**
 * The narrow byte-storage interface for Slice 1 (CFV1-SL1, ADR-0009).
 *
 * ADR-0009 makes byte storage "a filesystem volume, addressed through the
 * existing `storageIdentity` indirection", and requires that "no filesystem path
 * appears outside the storage implementation" — the same confinement ADR-0003
 * sets for persistence. This module declares only the interface and the opaque
 * identity type; the concrete store lives behind {@link ByteStore} and is built
 * through a factory, so no path and no storage type leaks past its own file.
 *
 * `storageIdentity` is the ONLY handle the rest of the system has on stored
 * bytes. It is *assigned by the store* on `put` and treated as opaque by every
 * caller — the {@link StorageIdentity} brand makes that structural: a value of
 * this type cannot be constructed outside the store without an explicit cast, so
 * "no caller constructs one" is enforced by the type rather than by discipline.
 *
 * No contract shape is declared here (repo-config `slice0/schema-single-source-
 * of-truth`); the identity is a plain string and this unit adds no schema field.
 * Associating a Source Snapshot with the identity of its retained scan is a
 * separate, schema-touching decision and is deliberately NOT taken here.
 */

declare const storageIdentityBrand: unique symbol

/**
 * An opaque handle to bytes held by a {@link ByteStore}. Minted only by the
 * store (from `put`); its internal spelling — and therefore how it maps to a
 * location — is the store's private business and is never parsed by a caller.
 */
export type StorageIdentity = string & { readonly [storageIdentityBrand]: "StorageIdentity" }

/**
 * ADR-0009 byte storage: retained scan images (and, where retained, hero media)
 * live behind this interface. Two operations, both addressed by the opaque
 * {@link StorageIdentity}; there is no update or delete path (scan deletion stays
 * disabled per PDR-0001 invariant 10 until the capture-quality gate passes).
 */
export interface ByteStore {
  /**
   * Store `content` and return the store-assigned identity that addresses it.
   * Identical content yields the same identity, so a re-store is idempotent
   * rather than a duplicate — which also bounds the orphaned-file failure mode
   * ADR-0009 names (a re-run writes the same location, not a new one).
   */
  put(content: Uint8Array): Promise<StorageIdentity>

  /**
   * Return the bytes addressed by `identity`, or `undefined` when nothing is
   * stored for it. An identity the store could not have issued resolves to
   * `undefined` too — it never reaches a location, so a malformed or crafted
   * handle can name nothing outside the volume (fail closed).
   */
  get(identity: StorageIdentity): Promise<Uint8Array | undefined>
}
