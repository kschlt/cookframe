/**
 * run/a-heif-photograph-is-refused-before-the-model — a photograph the model
 * provider cannot read is answered with a sentence, not with a paid call that
 * ends in a 500.
 *
 * The provider's vision guide lists PNG, JPEG, WEBP and GIF. The photo route
 * accepted `image/heic` and `image/heif` as well, so a HEIC would have been
 * kept, handed to capture, sent, and refused by the vendor (from its
 * documentation; no HEIC has been sent to it from here). No proof saw it, because every proof
 * of the route ran on the deterministic fake, which reads any bytes. So a HEIC
 * is now refused in two places, and this file measures both on a running
 * instance:
 *
 * - by its declared type, at the door, like every other type off the list;
 * - by its bytes, when the label says JPEG and the body is a HEIF container.
 *   That is the case a phone set to High Efficiency produces if anything in
 *   front of the upload forgets to convert. It passed the door, so it is kept
 *   like any photograph this instance was sent; it is not read.
 *
 * The transport's own refusal, and the alignment of the two lists, are in
 * `tests/protections/vendor-image-formats.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ACCEPTED_CAPTURE_TYPES } from "../../src/http/ingest-app.js"
import { createFakeCaptureProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider } from "../../src/pipeline/providers.js"
import { scratchByteStore } from "../support/scratch-byte-store.js"
import { captureBody, INGEST_CREDENTIAL, startTestInstance, type TestInstance } from "./harness.js"

let running: TestInstance | undefined
afterEach(async () => {
  await running?.stop()
  running = undefined
})

/** Every file under `volume`, as bytes. */
function keptUnder(volume: string): Buffer[] {
  return readdirSync(volume, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name)))
}

/** An instance whose capture counts its reads, on a volume this file can look into. */
async function instance(): Promise<{ reads: () => number; volume: string }> {
  let reads = 0
  const fake = createFakeCaptureProvider()
  const counting: CaptureProvider = {
    capture: async (input, ctx) => {
      reads += 1
      return fake.capture(input, ctx)
    },
  }
  const { store, volume } = scratchByteStore()
  running = await startTestInstance({ scanStore: store, capture: counting })
  return { reads: () => reads, volume }
}

function submit(body: Uint8Array, contentType: string): Promise<Response> {
  return fetch(`${(running as TestInstance).origin}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${INGEST_CREDENTIAL}`, "content-type": contentType },
    body,
  })
}

/**
 * The start of a HEIC file: a box size, then the `ftyp` box and its `heic`
 * brand, which is how every file an iPhone camera writes in High Efficiency
 * begins. Synthetic; no real photograph is in this repository.
 */
const heic = new Uint8Array([
  0x00,
  0x00,
  0x00,
  0x18,
  ...new TextEncoder().encode("ftypheic"),
  0x00,
  0x00,
  0x00,
  0x00,
  ...new TextEncoder().encode("mif1heic"),
  ...new TextEncoder().encode("Synthetic HEIC Loaf"),
])

/** What a person reads on the phone when a photograph arrives in a format nothing here reads. */
const REFUSAL = {
  error: "unsupported_media_type",
  message: `this instance accepts ${ACCEPTED_CAPTURE_TYPES.join(", ")}; a HEIC or HEIF photo has to be sent as JPEG`,
}

/**
 * A HEIF-family body with the given `ftyp` brand. `heic` is an iPhone still;
 * `heix`, `mif1` and `msf1` are other HEIF brands a camera writes, and `avif` is
 * the same container around another codec. The provider reads none of them.
 */
const isoBody = (brand: string): Uint8Array =>
  new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    ...new TextEncoder().encode(`ftyp${brand}`),
    0x00,
    0x00,
    0x00,
    0x00,
    ...new TextEncoder().encode(`mif1${brand}`),
    ...new TextEncoder().encode("Synthetic HEIF Loaf"),
  ])

describe("run/a-heif-photograph-is-refused-before-the-model", () => {
  // Bytes that are NOT a HEIF container, so the byte check below cannot answer
  // for the type check: only the declared type refuses these. One named proof
  // per type rather than a table, so each name is one the proof-name guard reads.
  async function refusedByType(contentType: string): Promise<void> {
    const { reads } = await instance()
    const res = await submit(captureBody("Synthetic Loaf labelled HEIF"), contentType)
    expect(res.status, "a HEIF type passed the door").toBe(415)
    expect(await res.json()).toEqual(REFUSAL)
    expect(reads(), "a HEIF photograph was handed to capture").toBe(0)
  }

  it("refuses image/heic by its type, and says what to send instead", async () => {
    await refusedByType("image/heic")
  })

  it("refuses image/heif by its type, and says what to send instead", async () => {
    await refusedByType("image/heif")
  })

  it("refuses HEIF bytes under a JPEG label, after keeping them and before reading them", async () => {
    const { reads, volume } = await instance()
    const res = await submit(heic, "image/jpeg")
    expect(res.status, "the label was believed over the bytes").toBe(415)
    expect(await res.json()).toEqual(REFUSAL)
    expect(reads(), "HEIF bytes were handed to capture under a JPEG label").toBe(0)
    expect(
      keptUnder(volume).some((kept) => kept.equals(Buffer.from(heic))),
      "a photograph that passed the door was not kept",
    ).toBe(true)
  })

  it("refuses every brand of the container, not only an iPhone still's", async () => {
    // The check reads the container, not the brand after it. Held with brands
    // other than `heic`, so a check narrowed to the one brand the case above
    // uses cannot pass here.
    const { reads } = await instance()
    for (const brand of ["heix", "mif1", "msf1", "avif"]) {
      const res = await submit(isoBody(brand), "image/jpeg")
      expect(res.status, `only some brands were refused: ${brand} passed`).toBe(415)
    }
    expect(reads(), "a HEIF-family body was handed to capture").toBe(0)
  })

  it("tells a type that is not a photograph only what this instance accepts", async () => {
    // The HEIF sentence is advice for a HEIF photograph; a PDF gets the list.
    await instance()
    const res = await submit(captureBody("Synthetic Loaf as a PDF"), "application/pdf")
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      error: "unsupported_media_type",
      message: `this instance accepts ${ACCEPTED_CAPTURE_TYPES.join(", ")}`,
    })
  })

  it("reads the container's own marker, not the word wherever it appears", async () => {
    // `ftyp` at offset 4 is the container; the same four letters later in a
    // body are just bytes. A check that searched the whole body would refuse
    // a JPEG that happened to carry them.
    const { reads } = await instance()
    const res = await submit(captureBody("Synthetic Loaf, ftypheic in its method"), "image/jpeg")
    expect(res.status).toBe(201)
    expect(reads()).toBe(1)
  })
})
