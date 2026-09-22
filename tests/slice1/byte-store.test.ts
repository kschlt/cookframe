/**
 * CFV1-SL1 — the byte store behind `storageIdentity` (ADR-0009).
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * The suite exercises the real filesystem store against a throwaway volume: the
 * captured bytes round-trip through their store-assigned identity, and the
 * identity indirection is confined — a caller cannot mint an identity, no
 * filesystem path leaks past the store's module, and a crafted handle resolves
 * to nothing outside the volume.
 *
 * This unit builds ONLY the byte store; it does not add a Source Snapshot schema
 * field for the scan's identity (that association is a separate, schema-touching
 * decision) and it does not wire the store into the capture path.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as storageBarrel from "../../src/storage/index.js"
import {
  type ByteStore,
  createFilesystemByteStore,
  type StorageIdentity,
} from "../../src/storage/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Cast a raw string to the branded type — legitimate only for a test probe. */
const asIdentity = (s: string): StorageIdentity => s as unknown as StorageIdentity

let volumeDir: string
let store: ByteStore

beforeEach(() => {
  volumeDir = mkdtempSync(join(tmpdir(), "cookframe-bytes-"))
  store = createFilesystemByteStore(volumeDir)
})

afterEach(() => {
  rmSync(volumeDir, { recursive: true, force: true })
})

describe("slice1/captured-image-retrievable", () => {
  it("returns the stored bytes unchanged, addressed by the identity the store assigned", async () => {
    // A payload with NUL and high bytes: proves byte fidelity, not text handling.
    const content = new Uint8Array([0, 1, 2, 0, 255, 254, 128, 0, 42])
    const identity = await store.put(content)
    const back = await store.get(identity)
    if (back === undefined) throw new Error("expected the stored bytes to be retrievable")
    expect(Array.from(back)).toEqual(Array.from(content))
  })

  it("gives identical content the same identity, so a re-store is idempotent", async () => {
    const content = new TextEncoder().encode("the same captured scan")
    const first = await store.put(content)
    const second = await store.put(content)
    expect(second).toBe(first)
    // Idempotent on disk too: one location under the volume, not two.
    expect(filesUnder(volumeDir)).toHaveLength(1)
  })

  it("gives different content different identities", async () => {
    const a = await store.put(new TextEncoder().encode("scan A"))
    const b = await store.put(new TextEncoder().encode("scan B"))
    expect(a).not.toBe(b)
  })

  it("returns undefined for a well-formed identity that was never stored", async () => {
    await store.put(new TextEncoder().encode("stored"))
    const neverStored = asIdentity(`sha256:${"0".repeat(64)}`)
    expect(await store.get(neverStored)).toBeUndefined()
  })
})

describe("slice1/storage-identity-confinement", () => {
  it("exposes only the interface and factory, never the concrete store type", () => {
    const names = Object.keys(storageBarrel)
    expect(names).toContain("createFilesystemByteStore")
    expect(names).not.toContain("FilesystemByteStore")
  })

  it("no caller mints an identity: only the store's own module casts to StorageIdentity", () => {
    const offenders: string[] = []
    for (const file of tsFiles(join(repoRoot, "src"))) {
      if (relative(join(repoRoot, "src", "storage"), file).startsWith("..")) {
        // outside src/storage/: no module may construct a StorageIdentity
        if (/\bas\s+(?:unknown\s+as\s+)?StorageIdentity\b/.test(readFileSync(file, "utf8"))) {
          offenders.push(relative(repoRoot, file))
        }
      }
    }
    expect(offenders, `StorageIdentity minted outside the store: ${offenders.join(", ")}`).toEqual(
      [],
    )
  })

  it("no module outside src/storage/ reaches the filesystem", () => {
    // ADR-0009: no filesystem path appears outside the storage implementation.
    // A byte location is derived only inside src/storage/; nothing else in the
    // product touches node:fs, so no other module can resolve an identity to a
    // path (persistence is in-memory this slice).
    //
    // ONE exemption, added by CFV1-RUN when the instance first became a process
    // that starts: the composition root reads the prompt files and the `schema/`
    // source it hands the model, both fixed repository assets resolved from
    // `import.meta.url`. It is named as a single path rather than a directory,
    // so a second module beside it is still caught, and the rule this guard
    // actually protects is untouched — the case above forbids minting a
    // `StorageIdentity` anywhere outside the store WITH NO exemption, so the
    // entry point still cannot resolve one to a path. What is exempted is
    // reading a constant path; what is not is deriving one.
    const compositionRoot = join(repoRoot, "src", "server", "main.ts")
    const offenders: string[] = []
    for (const file of tsFiles(join(repoRoot, "src"))) {
      if (file === compositionRoot) continue
      if (relative(join(repoRoot, "src", "storage"), file).startsWith("..")) {
        if (/from\s+["']node:fs(?:\/promises)?["']/.test(readFileSync(file, "utf8"))) {
          offenders.push(relative(repoRoot, file))
        }
      }
    }
    expect(offenders, `filesystem access outside src/storage/: ${offenders.join(", ")}`).toEqual([])
  })

  it("and the exempted composition root reads assets, never a byte location", () => {
    // The exemption above is only as narrow as this case makes it. The entry
    // point may read files that ship with the repository; it may not touch the
    // byte store's volume, name a storage path, or take a path from anything a
    // caller sent.
    const root = readFileSync(join(repoRoot, "src", "server", "main.ts"), "utf8")
    expect(root).not.toMatch(/StorageIdentity/)
    expect(root).not.toMatch(/createFilesystemByteStore|STORAGE_ROOT/)
    // Every path it builds starts from the module's own location.
    expect(root).toMatch(/fileURLToPath\(import\.meta\.url\)/)

    // The case above is the one that makes the exemption an exemption rather
    // than a hole with a comment beside it: EVERY read in the exempted file is
    // rooted at the repository, so none of them can be handed a path that came
    // from configuration, from a request, or from anywhere else. A read of
    // `process.env["SOMETHING"]` passes all three assertions above and fails
    // this one.
    const reads = [...root.matchAll(/readFileSync\(([^)]*)/g)].map((m) => (m[1] ?? "").trim())
    expect(reads.length, "no read in the exempted file — the exemption is unused").toBeGreaterThan(
      0,
    )
    for (const argument of reads) {
      expect(
        argument,
        `a read in the composition root is not rooted at the repository: readFileSync(${argument}`,
      ).toMatch(/^join\(repoRoot,/)
    }
    // What is NOT claimed: that a path assembled under `repoRoot` cannot
    // traverse out of it. Nothing here builds one from anything but a
    // module-level literal, and proving traversal-safety is the byte store's
    // job, behind the identity this file may not mint.
  })

  it("a crafted identity resolves to nothing and never escapes the volume", async () => {
    // Plant a secret OUTSIDE the volume, then hand the store an identity that,
    // joined naively to the volume dir, would reach it. A store that used the
    // identity as a path segment would leak the secret; this one refuses it.
    const outside = mkdtempSync(join(tmpdir(), "cookframe-outside-"))
    try {
      const secret = join(outside, "secret.txt")
      writeFileSync(secret, "TOP SECRET — must never be returned")
      const traversal = relative(volumeDir, secret) // e.g. ../cookframe-outside-XXXX/secret.txt
      for (const crafted of [
        traversal,
        `sha256:${traversal}`,
        "sha256:not-hex",
        "../etc/passwd",
        "",
      ]) {
        expect(await store.get(asIdentity(crafted))).toBeUndefined()
      }
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (name.endsWith(".ts")) out.push(full)
  }
  return out
}

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...filesUnder(full))
    else out.push(full)
  }
  return out
}
