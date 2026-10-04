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

/** The committed Shortcut's actions, in the order Shortcuts runs them. */
function shortcutActions(): Dict[] {
  const root = dict(
    parsePlist(readFileSync(join(repoRoot, "shortcut", "Capture Recipe.plist"), "utf8")),
  )
  return (root["WFWorkflowActions"] ?? []) as Dict[]
}

const UPLOAD = "is.workflow.actions.downloadurl"
const CAMERA = "is.workflow.actions.takephoto"
const CONVERT = "is.workflow.actions.image.convert"

const parametersOf = (action: Dict | undefined): Dict =>
  dict(action?.["WFWorkflowActionParameters"])

/**
 * The `Content-Type` every upload in the committed Shortcut declares, read from
 * the plist's own header table rather than searched for in its text.
 */
function shortcutContentTypes(actions: Dict[] = shortcutActions()): unknown[] {
  return actions
    .filter((a) => a["WFWorkflowActionIdentifier"] === UPLOAD)
    .flatMap((a) => {
      const headers = dict(parametersOf(a)["WFHTTPHeaders"])
      const items = (dict(headers["Value"])["WFDictionaryFieldValueItems"] ?? []) as Dict[]
      return items
        .filter((i) => textOf(i["WFKey"]) === "Content-Type")
        .map((i) => textOf(i["WFValue"]))
    })
}

/**
 * Where each action in the image's path takes its image from. An action that is
 * not here takes nothing, so a lineage ends at it. Only an EXPLICIT reference
 * is followed: an action left without one would take whatever ran just before
 * it, which is exactly the kind of position-dependence this file refuses.
 */
const IMAGE_INPUT: Readonly<Record<string, string>> = {
  [UPLOAD]: "WFRequestVariable",
  [CONVERT]: "WFInput",
}

/**
 * The media type each `Convert Image` format produces. Deliberately only the
 * formats a JPEG/PNG/WEBP door could accept; `Match Input`, `HEIF` and the rest
 * map to nothing, so a conversion to any of them names no type at all.
 */
const CONVERTED_MEDIA_TYPE: Readonly<Record<string, string>> = {
  JPEG: "image/jpeg",
  PNG: "image/png",
}

/** One step of an upload body's history: which action made it, and at what position. */
interface Step {
  readonly identifier: unknown
  readonly index: number
  readonly format?: unknown
  readonly quality?: unknown
  readonly keepsMetadata?: unknown
}

/**
 * The history of what the one upload sends, read backwards from its body
 * through each explicit action-output reference to an action that takes no
 * image. Every reference must name an action that has ALREADY run — Shortcuts
 * runs actions in order, and an output that does not exist yet is no input —
 * so an action moved below the one that reads it breaks the chain here rather
 * than producing a lineage that only looks right.
 */
function uploadLineage(actions: Dict[]): Step[] {
  const uploads = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action["WFWorkflowActionIdentifier"] === UPLOAD)
  expect(uploads, "the Shortcut does not upload exactly once").toHaveLength(1)
  const byUuid = new Map(actions.map((action, index) => [parametersOf(action)["UUID"], index]))

  const steps: Step[] = []
  let at = uploads[0]?.index ?? -1
  for (;;) {
    const action = actions[at]
    const identifier = action?.["WFWorkflowActionIdentifier"]
    const parameters = parametersOf(action)
    steps.unshift({
      identifier,
      index: at,
      ...(identifier === CONVERT
        ? {
            format: parameters["WFImageFormat"],
            quality: parameters["WFImageCompressionQuality"],
            keepsMetadata: parameters["WFImagePreserveMetadata"],
          }
        : {}),
    })
    const key = IMAGE_INPUT[String(identifier)]
    if (key === undefined) return steps
    const reference = dict(dict(parameters[key])["Value"])
    expect(reference["Type"], `action ${at} takes its image from no action's output`).toBe(
      "ActionOutput",
    )
    const from = byUuid.get(reference["OutputUUID"])
    expect(from, `action ${at} takes its image from an action that does not exist`).toBeDefined()
    expect(
      from as number,
      `action ${at} takes its image from action ${String(from)}, which has not run yet`,
    ).toBeLessThan(at)
    at = from as number
  }
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
    // and nothing else in the tree would notice. The LABEL is held here; that
    // the bytes match it is the next proof's.
    const declared = shortcutContentTypes()
    expect(declared, "the Shortcut declares no Content-Type on its upload").toHaveLength(1)
    expect(
      ACCEPTED_CAPTURE_TYPES,
      `the one client this slice ships sends ${String(declared[0])}, which the door refuses`,
    ).toContain(declared[0])
  })

  it("sends the photograph converted to the type it declares, not as the camera made it", () => {
    // A camera set to High Efficiency makes HEIC, and an iPhone does that by
    // default, so a label alone proved nothing about the bytes. What the upload
    // sends is traced back through the definition: it must be a Convert Image
    // of the photograph, run between the camera and the upload, to a format
    // whose type is the declared one and one the door accepts. Pinned as the
    // WHOLE chain, so a step added to it is a change to this file.
    //
    // What this cannot reach: that Shortcuts' Convert Image, given `JPEG`,
    // writes JPEG bytes. The identifier and parameter names are the documented
    // ones, not ones a device has run (OQ-38). The route's byte check answers
    // a HEIC that arrives anyway.
    const actions = shortcutActions()
    const lineage = uploadLineage(actions)
    expect(
      lineage.map((step) => step.identifier),
      "the upload does not send the photograph through Convert Image",
    ).toEqual([CAMERA, CONVERT, UPLOAD])

    const format = String(lineage[1]?.format)
    const made = CONVERTED_MEDIA_TYPE[format]
    expect(
      made,
      `Convert Image makes \`${format}\`, which names no type the door reads`,
    ).toBeDefined()
    expect(ACCEPTED_CAPTURE_TYPES).toContain(made)
    expect(
      shortcutContentTypes(actions),
      `the upload declares a type other than the ${String(made)} it sends`,
    ).toEqual([made])
  })

  it("drops the photograph's metadata in the conversion, so where it was taken is not sent", () => {
    // The image goes on to a model provider, and a recipe needs no location.
    // The Shortcut and its README both promise this, so the flag is held here:
    // a conversion that keeps metadata is red, and so is one that leaves the
    // flag out and takes whatever Shortcuts defaults to. The quality is pinned
    // beside it; nothing promises 0.85, but a change to it belongs here.
    // Dropping metadata drops EXIF Orientation too; whether the rotation is
    // applied to the pixels first is OQ-49.
    const conversion = uploadLineage(shortcutActions()).find((step) => step.identifier === CONVERT)
    expect(conversion, "the upload sends no Convert Image output").toBeDefined()
    expect(
      conversion?.keepsMetadata,
      "Convert Image does not say it drops metadata, so a location can reach the provider",
    ).toBe(false)
    expect(conversion?.quality, "the JPEG quality changed without this file saying why").toBe(0.85)
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
