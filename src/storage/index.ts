/**
 * Storage barrel (CFV1-SL1, ADR-0009). Exposes only the byte-store interface,
 * the opaque identity type, and the filesystem-store factory — never a concrete
 * store type (ADR-0009 confinement: no filesystem path or storage type appears
 * outside its implementation).
 */

export type { ByteStore, StorageIdentity } from "./byte-store.js"
export { createFilesystemByteStore } from "./filesystem-byte-store.js"
