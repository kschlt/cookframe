/**
 * A recipe's picture of the dish, taken from the linked page's own structured
 * data when a URL is imported.
 *
 * Where the picture comes from is decided, and it is narrow on purpose: the
 * `image` a page's Recipe JSON-LD declares, and nothing else. Not the photograph
 * of a cookbook page (`docs/recipe-ontology.md` §7 says that is not a picture of
 * the dish), not an image the model names, not the first `<img>` in the markup.
 * A page that published its recipe as structured data stated which picture is
 * the dish's; a page that did not stated nothing, and nothing is guessed for it.
 * That is also why the model fallback path never gets a picture: it has no
 * structured data, so there is no declaration to follow.
 *
 * Three rules, each a sentence the coordinator's brief put in words:
 *
 *  1. **Fetched through the same guard as the page.** The picture's address is
 *     somebody else's text, so it goes through the safe-fetch connector like the
 *     page did (`createSafePictureByteSource`), with every address, redirect and
 *     deadline check, and a door that admits only what claims to be a picture.
 *  2. **Kept only if the bytes are a picture.** The label the publisher sent is
 *     their claim; {@link servedImageType} reads what the bytes are, the same
 *     reading the picture route makes before it serves them. Anything else is
 *     not kept, so it can never be served.
 *  3. **A picture never costs the import.** The recipe is the import; its
 *     picture is an addition to it. A declaration that is missing, unusable,
 *     refused, too large or not a picture leaves the recipe without one, and the
 *     page states that gap (`src/render/recipe-page.ts`) rather than failing the
 *     request that brought the recipe in.
 */
import type { RecipeMedia } from "../../schema/index.js"
import { servedImageType } from "../media/image-signature.js"
import type { UrlByteSource } from "../security/url-byte-source.js"
import type { ByteStore } from "../storage/index.js"

/** What keeping a declared picture needs: where to fetch it through, and where to keep it. */
export interface PictureDeps {
  /** The picture fetch, through the safe-fetch guard (`createSafePictureByteSource`). */
  readonly source: UrlByteSource
  /** Where the picture is kept: the instance's byte store (ADR-0009). */
  readonly store: ByteStore
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Every address a JSON-LD `image` value can spell, in the order it gives them.
 * Schema.org allows a URL, an `ImageObject` carrying one as `url` or
 * `contentUrl`, or a list of either; anything else spells no address.
 */
function imageCandidates(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(imageCandidates)
  if (isRecord(value)) {
    return [value.url, value.contentUrl].filter((v): v is string => typeof v === "string")
  }
  return []
}

/**
 * The address of the picture a Recipe JSON-LD node declares, resolved against
 * the page it came from, or `undefined` when it declares none that is usable.
 *
 * The first candidate that resolves to an `http:` or `https:` address wins. A
 * relative address is the page's own, so it is resolved against the page's
 * final address. Any other scheme is not followed here; the guard would refuse
 * it anyway, and refusing it here means it is never offered.
 */
export function declaredPictureUrl(recipe: unknown, pageUrl: string): string | undefined {
  if (!isRecord(recipe)) return undefined
  for (const candidate of imageCandidates(recipe.image)) {
    const trimmed = candidate.trim()
    if (trimmed === "") continue
    let resolved: URL
    try {
      resolved = new URL(trimmed, pageUrl)
    } catch {
      continue
    }
    if (resolved.protocol === "http:" || resolved.protocol === "https:") return resolved.toString()
  }
  return undefined
}

/**
 * Who the page says published it: the Recipe node's `publisher`, as a name.
 * `undefined` when it names none — the attribution is then absent, not
 * invented, and the page shows the picture without a credit line it cannot give.
 */
export function publisherOf(recipe: unknown): string | undefined {
  if (!isRecord(recipe)) return undefined
  const publisher = Array.isArray(recipe.publisher) ? recipe.publisher[0] : recipe.publisher
  const name = isRecord(publisher) ? publisher.name : publisher
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined
}

/**
 * Fetch, check and keep the picture `recipe` declares, and say what the
 * Canonical Recipe should carry about it. Resolves to `undefined` for every way
 * there is no picture to keep, and never rejects (rule 3 above).
 */
export async function keepDeclaredPicture(
  deps: PictureDeps,
  recipe: unknown,
  pageUrl: string,
): Promise<RecipeMedia | undefined> {
  const declared = declaredPictureUrl(recipe, pageUrl)
  if (declared === undefined) return undefined
  try {
    const fetched = await deps.source.load(declared)
    if (servedImageType(fetched.bytes) === undefined) return undefined
    const storageIdentity = await deps.store.put(fetched.bytes)
    const attribution = publisherOf(recipe)
    return {
      heroImage: {
        storageIdentity,
        origin: "source_url",
        originalSourceUrl: declared,
        ...(attribution === undefined ? {} : { attribution }),
      },
    }
  } catch {
    // Refused by the guard, over the size bound, unreachable, or a store that
    // could not keep it: each one is "no picture", and none of them is the
    // import's failure. The page states the gap.
    return undefined
  }
}
