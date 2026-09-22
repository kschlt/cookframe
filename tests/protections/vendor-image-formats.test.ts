/**
 * protections/the-photo-door-is-no-wider-than-the-vendor — every image format
 * the photo route accepts is one the model provider reads, and an image the
 * provider does not read is refused before a request is sent.
 *
 * Both lists are pinned exactly rather than required to overlap. Overlap would
 * be satisfied by a route that accepted HEIC as long as the transport's list
 * grew HEIC too, and the transport's list is not ours to grow: it is what the
 * provider's vision guide says (PNG, JPEG, WEBP, non-animated GIF), read on
 * 2026-09-22. A change to either list is a change to this file, which is where
 * the reason for it has to be written.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { ACCEPTED_CAPTURE_TYPES } from "../../src/http/ingest-app.js"
import {
  createOpenAITransport,
  OPENAI_IMAGE_MEDIA_TYPES,
  UnsupportedImageMediaTypeError,
} from "../../src/pipeline/openai-transport.js"
import type { ModelExchange } from "../../src/pipeline/providers.js"
import { type PlistValue, parsePlist } from "../slice5/plist.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

type Dict = Record<string, PlistValue>
const dict = (value: PlistValue | undefined): Dict => (value ?? {}) as Dict
/** A Shortcut text field's literal: `{ Value: { string } }`. */
const textOf = (field: PlistValue | undefined): unknown => dict(dict(field)["Value"])["string"]

/**
 * The `Content-Type` every upload in the committed Shortcut declares, read from
 * the plist's own header table rather than searched for in its text.
 */
function shortcutContentTypes(): unknown[] {
  const root = dict(
    parsePlist(readFileSync(join(repoRoot, "shortcut", "Capture Recipe.plist"), "utf8")),
  )
  const actions = (root["WFWorkflowActions"] ?? []) as Dict[]
  return actions
    .filter((a) => a["WFWorkflowActionIdentifier"] === "is.workflow.actions.downloadurl")
    .flatMap((a) => {
      const headers = dict(dict(a["WFWorkflowActionParameters"])["WFHTTPHeaders"])
      const items = (dict(headers["Value"])["WFDictionaryFieldValueItems"] ?? []) as Dict[]
      return items
        .filter((i) => textOf(i["WFKey"]) === "Content-Type")
        .map((i) => textOf(i["WFValue"]))
    })
}

/**
 * A transport pointed at a name that resolves nowhere (`.invalid` is reserved
 * for that), so a request that is actually sent fails as a network error and
 * can never reach a vendor or cost anything.
 */
const transport = () =>
  createOpenAITransport({
    apiKey: "not-a-key",
    model: "not-a-model",
    endpoint: "https://unbound.invalid/v1/chat/completions",
    timeoutMs: 5_000,
  })

const withImage = (mediaType: string): ModelExchange => ({
  system: "SYSTEM",
  parts: [
    { kind: "text", text: "RAW SOURCE (photographed recipe page):" },
    { kind: "image", mediaType, bytes: new Uint8Array([1, 2, 3]) },
  ],
  jsonOnly: true,
})

describe("protections/the-photo-door-is-no-wider-than-the-vendor", () => {
  it("names the formats the provider documents, and no other", () => {
    expect([...OPENAI_IMAGE_MEDIA_TYPES].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ])
  })

  it("accepts at the photo route exactly the formats a phone sends that the provider reads", () => {
    expect([...ACCEPTED_CAPTURE_TYPES].sort()).toEqual(["image/jpeg", "image/png", "image/webp"])
    for (const type of ACCEPTED_CAPTURE_TYPES) {
      expect(
        OPENAI_IMAGE_MEDIA_TYPES,
        `${type} is accepted but the provider cannot read it`,
      ).toContain(type)
    }
  })

  it("accepts what the one client this slice ships declares it sends", () => {
    // The narrowing makes the Shortcut's declared type load-bearing: a Shortcut
    // that declared image/heic would have every capture refused at the door,
    // and nothing else in the tree would notice. This pins the LABEL the
    // committed Shortcut declares, not the bytes its camera action produces;
    // whether those are JPEG is a question for a phone, and the byte check in
    // the route is what answers a HEIC sent under this label.
    const declared = shortcutContentTypes()
    expect(declared, "the Shortcut declares no Content-Type on its upload").toHaveLength(1)
    expect(
      ACCEPTED_CAPTURE_TYPES,
      `the one client this slice ships sends ${String(declared[0])}, which the door refuses`,
    ).toContain(declared[0])
  })

  // One named proof per format rather than a table, so each name is one the
  // proof-name guard reads.
  async function refusedBeforeSending(mediaType: string): Promise<void> {
    const error = await transport()
      .send(withImage(mediaType))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnsupportedImageMediaTypeError)
    expect((error as UnsupportedImageMediaTypeError).mediaType).toBe(mediaType)
  }

  it("refuses an image/heic image before the request is sent", async () => {
    await refusedBeforeSending("image/heic")
  })

  it("refuses an image/heif image before the request is sent", async () => {
    await refusedBeforeSending("image/heif")
  })

  it("refuses any format outside the provider's list, not only the two this unit is about", async () => {
    // The rule is an allowlist. Held with formats that are neither HEIC nor
    // HEIF, so a check written as a denylist of those two cannot pass here.
    for (const mediaType of ["image/tiff", "image/bmp", "image/avif"]) {
      const error = await transport()
        .send(withImage(mediaType))
        .catch((e: unknown) => e)
      expect(error, `${mediaType} was sent to a provider that does not read it`).toBeInstanceOf(
        UnsupportedImageMediaTypeError,
      )
    }
  })

  it("sends a format the provider reads, so the refusal above is not a refusal of everything", async () => {
    const error = await transport()
      .send(withImage("image/jpeg"))
      .catch((e: unknown) => e)
    expect(error, "a JPEG was refused as a format the provider does not read").not.toBeInstanceOf(
      UnsupportedImageMediaTypeError,
    )
    expect(error, "a request to an address that resolves nowhere cannot succeed").toBeInstanceOf(
      Error,
    )
  })
})
