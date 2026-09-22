/**
 * A real byte store on a directory of its own, for proofs that submit a
 * photograph without being about where it is kept.
 *
 * Since the photo route keeps every photograph before capture reads it, a
 * composition that submits one needs a store, and the question is which. This
 * answers it with the SHIPPED filesystem store on a fresh temporary directory
 * rather than a stub, for the reason `tests/security/unsupplied-byte-source.ts`
 * refuses a stub: a store that pretended to keep bytes would let a proof about
 * keeping them pass with nothing kept. The proof that IS about keeping them,
 * `run/a-photograph-is-kept-on-the-volume`, supplies its own directory and reads
 * that one, so what a default holds can never be what that proof finds.
 *
 * The directory is left for the operating system to reclaim. Each one holds the
 * few bytes of synthetic text a fake capture reads, and cleaning up would mean
 * a teardown in every composition that never looks inside.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ByteStore, createFilesystemByteStore } from "../../src/storage/index.js"

/** A filesystem byte store on a new, empty directory, and that directory. */
export function scratchByteStore(): { readonly store: ByteStore; readonly volume: string } {
  const volume = mkdtempSync(join(tmpdir(), "cookframe-scans-"))
  return { store: createFilesystemByteStore(volume), volume }
}
