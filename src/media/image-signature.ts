/**
 * The image formats this instance serves, read from the bytes themselves.
 *
 * A picture of a dish comes from somebody else's web page, so whatever label it
 * arrived with is that publisher's claim, and a stored file carries no label at
 * all. What a response says it is therefore has to follow from what the bytes
 * ARE, measured here, and from nothing else. Anything these signatures do not
 * recognise is not served: a guessed type is how an HTML or SVG document handed
 * over as a "picture" would run as a page on this instance's origin. `#105`
 * measured the same shape on the way in, where a HEIC labelled as a JPEG passed
 * the door on its label.
 *
 * The set is the three the photo route admits (`src/http/ingest-app.ts`), and
 * the signatures are the formats' own: JPEG starts `FF D8 FF`, PNG with its
 * eight-byte signature, WebP as a RIFF container whose form type is `WEBP`.
 *
 * Two readers, one rule: the picture route asks before it serves, and a URL
 * import asks before it keeps a picture it fetched (`src/pipeline/hero-image.ts`),
 * so what is kept and what is served are judged by the same bytes.
 */

/** The content types a served picture can carry. */
export type ServedImageType = "image/jpeg" | "image/png" | "image/webp"

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0): boolean =>
  bytes.length >= at + prefix.length && prefix.every((byte, i) => bytes[at + i] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/** The type these bytes are, or `undefined` when they are none of the three. */
export function servedImageType(bytes: Uint8Array): ServedImageType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png"
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp"
  return undefined
}
