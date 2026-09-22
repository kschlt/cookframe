/**
 * run/a-photograph-reaches-the-model-as-a-photograph — the photo address hands
 * the shipped capture provider a photograph, and the provider treats it as one.
 *
 * The provider decides between two readings from `sourceProvenance` alone
 * (ADR-0019): `"photo"` sends the bytes as an image and takes the verification
 * exemption a page the user held earns; anything else, an absent provenance
 * included, decodes the bytes as UTF-8 and verifies the capture against that
 * text. The photo route shipped stating only the media type, which is not what
 * the provider reads. Measured before it was closed, on a 200 KB body: one
 * exchange with no image part and 189,574 characters of decoded bytes in the
 * fenced text part, the model told `sourceType is "text"`, capture refused
 * against the mojibake, a 500, and nothing in the library. Every photograph a
 * running instance was sent failed that way, after a model call.
 *
 * No proof saw it, because every proof of the photo route ran on the
 * deterministic fake, which ignores provenance. So the provider here is the
 * shipped one, over a transport that records instead of reaching a vendor — and
 * because this file builds that provider itself, the last case reads the
 * composition root to show it is the one `main.ts` gives the photo route.
 * Without that case this file would show what the provider does when it is
 * called, never that the route calls it.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createModelCaptureProvider } from "../../src/pipeline/model-providers.js"
import type { ModelExchange, ModelTransport } from "../../src/pipeline/providers.js"
import { fieldsAssignedIn } from "../protections/url-capture-wiring.js"
import { INGEST_CREDENTIAL, startTestInstance, type TestInstance } from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * What the model would say about a photographed page. None of this text is in
 * the submitted bytes, so a capture verified against those bytes refuses it —
 * which is exactly what a photograph is exempt from, and the only reason a
 * correct route can answer 201 with it.
 */
const reply = JSON.stringify({
  sourceType: "image",
  capturedText: "Pfannkuchen\n200 g Mehl\nAlles verruehren.",
  blocks: [
    { id: "x", order: 0, type: "title", text: "Pfannkuchen" },
    { id: "y", order: 1, type: "ingredient", text: "200 g Mehl" },
    { id: "z", order: 2, type: "instruction", text: "Alles verruehren." },
  ],
  recipeCount: 1,
  recipeTitles: ["Pfannkuchen"],
})

const seen: ModelExchange[] = []
const recording: ModelTransport = {
  async send(exchange) {
    seen.push(exchange)
    return { text: reply }
  },
}

/**
 * A PNG signature followed by a readable run of ASCII. Real image bytes decode
 * to noise nobody could search for; this run survives UTF-8 decoding intact, so
 * a text part that carries it is a text part that carries the photograph.
 * PNG rather than JPEG because the provider falls back to `image/jpeg` when no
 * media type reaches it, and a JPEG would pass that fallback for the wrong reason.
 */
const MARKER = "these-bytes-are-a-photograph-not-text"
const photograph = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new TextEncoder().encode(MARKER),
  0x00,
  0xff,
  0xfe,
])

let instance: TestInstance
let status: number
let body: { snapshotId?: string }

beforeAll(async () => {
  instance = await startTestInstance({
    capture: createModelCaptureProvider({
      transport: recording,
      promptText: "PROMPT",
      contractText: "CONTRACT",
      maxAttempts: 1,
    }),
  })
  const res = await fetch(`${instance.origin}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${INGEST_CREDENTIAL}`, "content-type": "image/png" },
    body: photograph,
  })
  status = res.status
  body = (await res.json()) as { snapshotId?: string }
})

afterAll(async () => {
  await instance.stop()
})

describe("run/a-photograph-reaches-the-model-as-a-photograph", () => {
  it("hands the model the photograph as an image, in the media type it was sent", () => {
    expect(seen, "the model is asked once per capture").toHaveLength(1)
    const images = seen[0]?.parts.filter((part) => part.kind === "image") ?? []
    expect(images, "a photograph that reaches the model as no image was read as text").toHaveLength(
      1,
    )
    const [image] = images
    expect(image?.kind === "image" && image.mediaType, "the media type the phone sent").toBe(
      "image/png",
    )
    expect(
      image?.kind === "image" && Buffer.from(image.bytes).equals(Buffer.from(photograph)),
    ).toBe(true)
  })

  it("puts none of the photograph's bytes in front of the model as text", () => {
    const texts = seen.flatMap((exchange) => [
      exchange.system,
      ...exchange.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])),
    ])
    expect(texts.filter((text) => text.includes(MARKER))).toEqual([])
  })

  it("imports it as a photographed source, without verifying it against its bytes", async () => {
    expect(status, "a capture verified against pixels decoded as text is refused").toBe(201)
    const snapshot = await instance.repo.loadSnapshot(body.snapshotId ?? "")
    expect(snapshot?.sourceType).toBe("image")
  })

  it("is the provider the composition root gives the photo route", () => {
    const main = readFileSync(join(repoRoot, "src", "server", "main.ts"), "utf8")
    const capture = fieldsAssignedIn(main, "src/server/main.ts").filter(
      (f) => f.field === "capture",
    )
    expect(
      capture.map((f) => f.value),
      "the photo route's provider, named once in the composition root",
    ).toEqual(["modelCapture"])
    const built = main.match(/const modelCapture = (\w+)\(/g) ?? []
    expect(built, "modelCapture is built once, by the provider this file drives").toEqual([
      "const modelCapture = createModelCaptureProvider(",
    ])
  })
})
