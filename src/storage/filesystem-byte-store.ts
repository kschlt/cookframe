/**
 * The filesystem byte store for Slice 1 (CFV1-SL1, ADR-0009).
 *
 * ADR-0009 settles byte storage as a filesystem volume behind the
 * `storageIdentity` indirection, chosen so an operator backs up a directory and
 * nothing more. This is that store, and the ONLY module that knows a filesystem
 * path: the concrete class is not exported, so callers see only {@link ByteStore}
 * and {@link createFilesystemByteStore}, and a stored-byte location never appears
 * elsewhere in the tree (ADR-0009 confinement).
 *
 * Addressing is content-derived: the identity is the SHA-256 digest of the
 * bytes, so `put` is idempotent (identical content, identical location) and the
 * identity is opaque and store-assigned, never caller-supplied. The scheme is a
 * private, replaceable detail — a later S3-compatible store (the reversible move
 * ADR-0009 keeps open) assigns its own identities behind the same interface.
 *
 * The volume directory is a constructor argument: it is genuine deployment
 * configuration (where the volume is mounted), not a test seam — production
 * passes the real mount path, and the store holds nothing else about the world.
 */
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ByteStore, StorageIdentity } from "./byte-store.js"

/** The one addressing scheme this store issues. `<algorithm>:<hex digest>`. */
const ALGORITHM = "sha256"
/** A well-formed identity this store could have issued — nothing else maps to a path. */
const IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  )
}

class FilesystemByteStore implements ByteStore {
  readonly #volumeDir: string

  constructor(volumeDir: string) {
    this.#volumeDir = volumeDir
  }

  async put(content: Uint8Array): Promise<StorageIdentity> {
    const hex = createHash(ALGORITHM).update(content).digest("hex")
    // The sole point where a StorageIdentity is minted (ADR-0009 confinement).
    const identity = `${ALGORITHM}:${hex}` as StorageIdentity
    const path = this.#pathForHex(hex)
    await mkdir(dirname(path), { recursive: true })
    // Content-addressed: writing the same bytes to the same location is a
    // deterministic no-op rewrite, never a second file.
    await writeFile(path, content)
    return identity
  }

  async get(identity: StorageIdentity): Promise<Uint8Array | undefined> {
    // Fail closed: an identity the store could not have issued names nothing.
    // Because a well-formed identity is `sha256:` + 64 hex chars, it can carry
    // no path separator or `..`, so this check alone confines every lookup to
    // the volume — a crafted handle can never resolve to a path outside it.
    if (!IDENTITY_PATTERN.test(identity)) return undefined
    const hex = identity.slice(ALGORITHM.length + 1)
    try {
      return await readFile(this.#pathForHex(hex))
    } catch (err) {
      if (isEnoent(err)) return undefined
      throw err
    }
  }

  /** Map a validated hex digest to its location, fanned out to keep dirs shallow. */
  #pathForHex(hex: string): string {
    return join(this.#volumeDir, ALGORITHM, hex.slice(0, 2), hex)
  }
}

/** Construct a filesystem byte store rooted at `volumeDir` (the mounted volume). */
export function createFilesystemByteStore(volumeDir: string): ByteStore {
  return new FilesystemByteStore(volumeDir)
}
