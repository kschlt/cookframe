/**
 * run/a-photograph-is-kept-on-the-volume — a running instance keeps what it is
 * sent (PDR-0001 invariant 10, ADR-0009).
 *
 * A real instance on a real port, with the SHIPPED filesystem byte store on a
 * directory this file owns, and the deterministic fakes for the model. The store
 * is supplied here, not found: which store `main.ts` builds, and on which
 * directory, is read from the composition root by
 * `serve/a-photograph-is-kept-before-it-is-read` and
 * `slice1/storage-identity-confinement`, and the spawned process in
 * `run/the-process-serves-and-stops` is required to have written to the
 * directory its operator named. This file owns what the route DOES with a
 * store: that the photograph lands on it, whatever happens after.
 *
 * The volume is read without knowing its layout. Every file under it is read
 * back and compared with the bytes sent; a file holding exactly those bytes is
 * the claim. Checking by calling the store's own `put` would write the file
 * being looked for, and a check that creates its own evidence passes with the
 * route doing nothing.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createFakeCaptureProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider } from "../../src/pipeline/providers.js"
import type { ByteStore } from "../../src/storage/index.js"
import { scratchByteStore } from "../support/scratch-byte-store.js"
import {
  captureBody,
  INGEST_CREDENTIAL,
  LIBRARY_CREDENTIAL,
  startTestInstance,
  type TestInstance,
} from "./harness.js"

let running: TestInstance | undefined
afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** Every file under `volume`, as bytes. */
function keptUnder(volume: string): Uint8Array[] {
  return readdirSync(volume, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => new Uint8Array(readFileSync(join(entry.parentPath, entry.name))))
}

const holds = (volume: string, bytes: Uint8Array): boolean =>
  keptUnder(volume).some((kept) => Buffer.from(kept).equals(Buffer.from(bytes)))

function submit(instance: TestInstance, body: Uint8Array): Promise<Response> {
  return fetch(`${instance.origin}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${INGEST_CREDENTIAL}`, "content-type": "image/jpeg" },
    body,
  })
}

async function libraryPage(instance: TestInstance): Promise<string> {
  const res = await fetch(`${instance.origin}/`, {
    headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` },
  })
  expect(res.status).toBe(200)
  return await res.text()
}

describe("run/a-photograph-is-kept-on-the-volume", () => {
  it("keeps the photograph it was sent, byte for byte", async () => {
    const { store, volume } = scratchByteStore()
    running = await startTestInstance({ scanStore: store })

    // The floor: an empty volume, so what is found below was written by this
    // submission and by nothing before it.
    expect(keptUnder(volume)).toEqual([])

    const photograph = captureBody("Synthetic Kept Loaf")
    const res = await submit(running, photograph)
    expect(res.status).toBe(201)
    expect(holds(volume, photograph), "the volume holds no file with the submitted bytes").toBe(
      true,
    )
  })

  it("keeps it when capture then fails, because that photograph is the one worth having", async () => {
    // The route keeps before it reads. A capture that fails — or a page refused
    // as several recipes, which the scan-to-shop measurement found wrong two
    // times out of three — is exactly when the pixels are the only way to try
    // again. Kept-after-read would pass the case above and lose this one.
    const failing: CaptureProvider = {
      capture: async () => {
        throw new Error("the model could not read this page")
      },
    }
    const { store, volume } = scratchByteStore()
    running = await startTestInstance({ scanStore: store, capture: failing })

    const photograph = captureBody("Synthetic Unreadable Loaf")
    const res = await submit(running, photograph)
    expect(res.status).toBe(500)
    expect(holds(volume, photograph), "a failed capture lost its photograph").toBe(true)
    // And nothing half-made reached the library.
    expect(await libraryPage(running)).toContain("No recipes saved yet.")
  })

  it("refuses the submission, before any model reads it, when the photograph cannot be kept", async () => {
    // A store that cannot write is the instance's fault. Answering 201 without
    // the photograph would claim a capture the invariant says is incomplete,
    // and reading it first would pay for a model call on a submission about to
    // be refused.
    const refusing: ByteStore = {
      put: async () => {
        throw new Error("the volume is not writable")
      },
      get: async () => undefined,
    }
    let reads = 0
    const fake = createFakeCaptureProvider()
    const counting: CaptureProvider = {
      capture: async (input, ctx) => {
        reads += 1
        return fake.capture(input, ctx)
      },
    }
    running = await startTestInstance({ scanStore: refusing, capture: counting })

    const res = await submit(running, captureBody("Synthetic Unkept Loaf"))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "capture_failed" })
    expect(reads, "the model was asked to read a photograph that could not be kept").toBe(0)
    expect(await libraryPage(running)).toContain("No recipes saved yet.")
  })
})
