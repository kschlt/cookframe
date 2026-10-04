/**
 * A recipe imported from a link brings the picture its page declares.
 *
 * Each `describe` string is the proof id it satisfies. The import runs through
 * the COMPOSED instance (`composeInstance`), with the shipped safe-fetch sources
 * for both the page and the picture; the only seam opened is the connector's
 * test-only `allowLoopback`, so a page on 127.0.0.1 is reachable. The pages and
 * pictures are served by this file: every recipe here is synthetic and every
 * picture is a few bytes this file generated, nobody's photograph and nobody's
 * recipe.
 *
 * The URL capture is the deterministic reader alone, not the composite
 * `main.ts` builds: what these proofs are about is what happens AFTER a page's
 * structured data was read, and the composite's model half cannot run here.
 * What holds that `main.ts` composes the composite is
 * `serve/a-url-import-runs-the-url-capture-path`.
 *
 * The claims:
 *
 *  1. A page whose Recipe JSON-LD declares an `image` gets that picture kept and
 *     shown, credited to the publisher it names, with the address it declared.
 *  2. What is kept is judged by the bytes, not the publisher's label, and no
 *     way a picture can fail costs the import its recipe.
 *  3. A page that declares nothing causes no picture fetch at all.
 *  4. The picture is the pipeline's: a normalizer that returns `media` cannot
 *     set it, and re-converting a stored source keeps the kept picture and
 *     fetches nothing.
 *  5. The running instance fetches pictures through the picture source, built
 *     by the shipped factory with no options.
 */

import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import ts from "typescript"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { CanonicalRecipe } from "../../schema/index.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { declaredPictureUrl, publisherOf } from "../../src/pipeline/hero-image.js"
import type { NormalizationProvider } from "../../src/pipeline/providers.js"
import { reprocess } from "../../src/pipeline/reprocess.js"
import { createDeterministicUrlCaptureProvider } from "../../src/pipeline/url-jsonld-adapter.js"
import { NO_PICTURE_OF_THE_DISH } from "../../src/render/recipe-page.js"
import {
  createSafePictureByteSource,
  createSafeUrlByteSource,
  type UrlByteSource,
} from "../../src/security/url-byte-source.js"
import { composeInstance } from "../../src/server/instance.js"
import type { ByteStore } from "../../src/storage/index.js"
import { scratchByteStore } from "../support/scratch-byte-store.js"
import { INGEST_CREDENTIAL, LIBRARY_CREDENTIAL, testInstanceDeps } from "./harness.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

// --- pictures made here -------------------------------------------------------

const chunk = (type: string, data: Uint8Array): Buffer => {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  typed.copy(out, 4)
  out.writeUInt32BE(crc32(typed), 8 + data.length)
  return out
}

/** A real one-pixel PNG, built from the format's own parts. */
function onePixelPng(): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 0x3c, 0x8a, 0xe0]))),
    chunk("IEND", new Uint8Array()),
  ])
}

const PNG = onePixelPng()
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1])
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x0c, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(4),
])
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>")

/**
 * The most a picture fetch may read, written out here and not imported: a proof
 * that sized its fixture from the source's own constant would follow that
 * constant wherever it moved, and hold nothing (review of #120).
 */
const PICTURE_BOUND = 5 * 1024 * 1024

/** A PNG padded to exactly `size` bytes: still a picture by its signature. */
const pngOfSize = (size: number): Buffer => Buffer.concat([PNG, Buffer.alloc(size - PNG.length)])

// --- the pages and pictures, served -------------------------------------------

/** Each picture address, what it answers with, and what it says the bytes are. */
const PICTURES: Record<string, { readonly type: string; readonly body: Buffer }> = {
  "/img/dish.png": { type: "image/png", body: PNG },
  "/moved/dish.png": { type: "image/png", body: PNG },
  "/img/jpeg-labelled-png": { type: "image/png", body: JPEG },
  "/img/html-labelled-png": { type: "image/png", body: HTML },
  "/img/png-labelled-html": { type: "text/html", body: PNG },
  "/img/dish.jpg": { type: "image/jpeg", body: JPEG },
  "/img/dish.webp": { type: "image/webp", body: WEBP },
  "/img/at-the-bound.png": { type: "image/png", body: pngOfSize(PICTURE_BOUND) },
  "/img/too-large.png": { type: "image/png", body: pngOfSize(PICTURE_BOUND + 1) },
}

const recipe = (extra: Record<string, unknown>): Record<string, unknown> => ({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Synthetic Picture Loaf",
  recipeYield: "1 loaf",
  recipeIngredient: ["200 g flour", "1 tsp salt", "300 ml water"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mix the flour and salt." },
    { "@type": "HowToStep", text: "Add water and stir to a dough." },
    { "@type": "HowToStep", text: "Bake until golden." },
  ],
  ...extra,
})

const publisher = { publisher: { "@type": "Organization", name: "Fixture Kitchen" } }

/** Each page address and the Recipe node it publishes. */
const PAGES: Record<string, Record<string, unknown>> = {
  "/page/declared": recipe({ image: "/img/dish.png", ...publisher }),
  "/page/declared-no-publisher": recipe({ image: "/img/dish.png" }),
  "/page/jpeg-labelled-png": recipe({ image: "/img/jpeg-labelled-png", ...publisher }),
  "/page/html-labelled-png": recipe({ image: "/img/html-labelled-png" }),
  "/page/png-labelled-html": recipe({ image: "/img/png-labelled-html" }),
  "/page/jpeg": recipe({ image: "/img/dish.jpg" }),
  "/page/webp": recipe({ image: "/img/dish.webp" }),
  "/page/at-the-bound": recipe({ image: "/img/at-the-bound.png" }),
  "/page/too-large": recipe({ image: "/img/too-large.png" }),
  "/page/missing": recipe({ image: "/img/nowhere.png" }),
  "/page/private-address": recipe({ image: "http://10.255.255.1/dish.png" }),
  "/page/data-uri": recipe({ image: `data:image/png;base64,${PNG.toString("base64")}` }),
  "/page/no-image": recipe({ ...publisher }),
  // Reached only through `/go/moved`: its picture address is relative to where
  // the page actually is, not to the link that was submitted.
  "/moved/page": recipe({ image: "dish.png" }),
}

/** Addresses that redirect, and where to. */
const REDIRECTS: Record<string, string> = { "/go/moved": "/moved/page" }

const pageHtml = (jsonLd: unknown): string =>
  `<!doctype html><html><head><title>fixture</title>` +
  `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
  `</head><body><p>rendered body, ignored by the adapter</p></body></html>`

/**
 * Every request this server answered, by path, in order: pages, redirects and
 * pictures alike, counted before anything answers. A proof about what an import
 * fetched states the whole sequence, so a fetch it did not expect shows up
 * whatever its address looks like (review of #120: a filter on picture-shaped
 * paths missed the import fetching its own page again through the picture door).
 */
const requests: string[] = []

function handle(req: IncomingMessage, res: ServerResponse): void {
  res.on("error", () => {})
  const path = req.url ?? ""
  requests.push(path)
  const redirect = REDIRECTS[path]
  if (redirect !== undefined) {
    res.writeHead(302, { location: redirect })
    res.end()
    return
  }
  const page = PAGES[path]
  if (page !== undefined) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(pageHtml(page))
    return
  }
  const picture = PICTURES[path]
  if (picture === undefined) {
    res.writeHead(404, { "content-type": "text/plain" })
    res.end("not here")
    return
  }
  res.writeHead(200, { "content-type": picture.type, "content-length": picture.body.length })
  res.end(picture.body)
}

let server: Server
let origin: string
const sources: UrlByteSource[] = []

beforeAll(async () => {
  server = createServer(handle)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const source of sources) await source.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// --- the instance -------------------------------------------------------------

interface Library {
  readonly app: ReturnType<typeof composeInstance>
  readonly repo: ReturnType<typeof testInstanceDeps>["repo"]
  readonly store: ByteStore
  readonly normalization: NormalizationProvider
}

function library(normalization: NormalizationProvider = createFakeNormalizationProvider()) {
  const store = scratchByteStore().store
  const byteSource = createSafeUrlByteSource({ allowLoopback: true })
  const pictureSource = createSafePictureByteSource({ allowLoopback: true })
  sources.push(byteSource, pictureSource)
  const { deps, repo } = testInstanceDeps({
    scanStore: store,
    byteSource,
    pictureSource,
    urlCapture: createDeterministicUrlCaptureProvider(),
  })
  return { app: composeInstance({ ...deps, normalization }), repo, store, normalization }
}

interface Imported {
  readonly status: number
  readonly recipeId: string
  readonly snapshotId: string
  readonly recipe: CanonicalRecipe | undefined
}

async function importPage(lib: Library, path: string): Promise<Imported> {
  const res = await lib.app.request("/capture/url", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${INGEST_CREDENTIAL}` },
    body: JSON.stringify({ url: `${origin}${path}` }),
  })
  const body = (await res.json()) as { recipeId?: string; snapshotId?: string }
  const recipeId = body.recipeId ?? ""
  return {
    status: res.status,
    recipeId,
    snapshotId: body.snapshotId ?? "",
    recipe: (await lib.repo.loadLatestCanonical(recipeId))?.recipe,
  }
}

const libraryGet = (lib: Library, path: string) =>
  lib.app.request(path, { headers: { authorization: `Bearer ${LIBRARY_CREDENTIAL}` } })

/** A sentence as the page carries it: apostrophes arrive as `&#39;`. */
const asServed = (sentence: string): string => sentence.replaceAll("'", "&#39;")

// --- 1. declared, kept, shown -------------------------------------------------

describe("picture/a-linked-page-brings-the-picture-it-declares", () => {
  it("keeps the declared picture, credited to the publisher, at the address declared", async () => {
    const lib = library()
    const imported = await importPage(lib, "/page/declared")

    expect(imported.status).toBe(201)
    expect(imported.recipe?.media, "the import kept no picture").toEqual({
      heroImage: {
        storageIdentity: expect.any(String),
        origin: "source_url",
        originalSourceUrl: `${origin}/img/dish.png`,
        attribution: "Fixture Kitchen",
      },
    })
    const kept = await lib.store.get(
      imported.recipe?.media?.heroImage?.storageIdentity as Parameters<ByteStore["get"]>[0],
    )
    expect(kept?.length).toBe(PNG.length)
    expect(new Uint8Array(kept ?? []), "the identity on the recipe names other bytes").toEqual(
      new Uint8Array(PNG),
    )
  })

  it("shows it on the recipe's page and serves it at the recipe's picture address", async () => {
    const lib = library()
    const { recipeId } = await importPage(lib, "/page/declared")

    const page = await (await libraryGet(lib, `/recipes/${recipeId}`)).text()
    expect(page).toContain(`<img src="/recipes/${recipeId}/picture"`)
    expect(page).toContain('<p class="meta">Fixture Kitchen</p>')

    const picture = await libraryGet(lib, `/recipes/${recipeId}/picture`)
    expect(picture.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(new Uint8Array(PNG))
  })

  it("resolves a relative address against where the page was, after its redirects", async () => {
    const lib = library()
    const imported = await importPage(lib, "/go/moved")
    expect(imported.recipe?.media?.heroImage?.originalSourceUrl).toBe(`${origin}/moved/dish.png`)
  })

  it("gives no credit line where the page names no publisher, rather than inventing one", async () => {
    const lib = library()
    const imported = await importPage(lib, "/page/declared-no-publisher")
    expect(imported.recipe?.media?.heroImage).toEqual({
      storageIdentity: expect.any(String),
      origin: "source_url",
      originalSourceUrl: `${origin}/img/dish.png`,
    })
  })

  it("reads every form JSON-LD spells a picture's address in, and refuses the rest", () => {
    const page = "https://example.invalid/recipes/loaf"
    const table: [string, unknown, string | undefined][] = [
      ["a URL", "https://cdn.example.invalid/a.png", "https://cdn.example.invalid/a.png"],
      ["a relative URL", "/img/a.png", "https://example.invalid/img/a.png"],
      [
        "a protocol-relative URL",
        "//cdn.example.invalid/a.png",
        "https://cdn.example.invalid/a.png",
      ],
      [
        "a list, first usable wins",
        ["", "https://x.invalid/b.png", "https://x.invalid/c.png"],
        "https://x.invalid/b.png",
      ],
      [
        "an ImageObject",
        { "@type": "ImageObject", url: "https://x.invalid/d.png" },
        "https://x.invalid/d.png",
      ],
      [
        "an ImageObject's contentUrl",
        { contentUrl: "https://x.invalid/e.png" },
        "https://x.invalid/e.png",
      ],
      ["a list of ImageObjects", [{ url: "https://x.invalid/f.png" }], "https://x.invalid/f.png"],
      ["a data: URI", "data:image/png;base64,AAAA", undefined],
      ["a javascript: URI", "javascript:alert(1)", undefined],
      ["a file: URI", "file:///etc/passwd", undefined],
      ["an empty string", "   ", undefined],
      ["a number", 42, undefined],
      ["nothing", undefined, undefined],
    ]
    expect(
      table.map(([name, image]) => [
        name,
        declaredPictureUrl(image === undefined ? {} : { image }, page),
      ]),
    ).toEqual(table.map(([name, , expected]) => [name, expected]))
    expect(declaredPictureUrl("not a node", page)).toBeUndefined()
  })

  it("reads the publisher's name in every form, and none where there is none", () => {
    const table: [string, unknown, string | undefined][] = [
      [
        "an Organization",
        { "@type": "Organization", name: " Fixture Kitchen " },
        "Fixture Kitchen",
      ],
      ["a plain name", "Fixture Kitchen", "Fixture Kitchen"],
      ["a list", [{ name: "First Kitchen" }, { name: "Second" }], "First Kitchen"],
      ["a nameless Organization", { "@type": "Organization" }, undefined],
      ["an empty name", { name: "" }, undefined],
      ["nothing", undefined, undefined],
    ]
    expect(
      table.map(([name, value]) => [
        name,
        publisherOf(value === undefined ? {} : { publisher: value }),
      ]),
    ).toEqual(table.map(([name, , expected]) => [name, expected]))
  })
})

// --- 2. judged by the bytes, and never the import's failure -------------------

describe("picture/the-picture-door-admits-what-the-instance-serves", () => {
  it("keeps each format the instance serves, labelled as itself, and serves it as itself", async () => {
    const lib = library()
    const cases: [string, string][] = [
      ["/page/declared", "image/png"],
      ["/page/jpeg", "image/jpeg"],
      ["/page/webp", "image/webp"],
    ]
    const outcomes = []
    for (const [path] of cases) {
      const { recipeId, recipe: kept } = await importPage(lib, path)
      const picture = await libraryGet(lib, `/recipes/${recipeId}/picture`)
      outcomes.push([path, kept?.media?.heroImage?.origin, picture.headers.get("content-type")])
    }
    expect(outcomes).toEqual(cases.map(([path, type]) => [path, "source_url", type]))
  })

  it("keeps a picture of exactly the bound, and not one byte more", async () => {
    const lib = library()
    const at = await importPage(lib, "/page/at-the-bound")
    const over = await importPage(lib, "/page/too-large")
    expect([at.status, over.status]).toEqual([201, 201])
    expect(at.recipe?.media?.heroImage?.origin, "a picture at the bound was refused").toBe(
      "source_url",
    )
    expect(over.recipe?.media, "a picture over the bound was kept").toBeUndefined()
  })

  it("fetches the page, then the one picture it declares, and nothing else", async () => {
    const lib = library()
    const before = requests.length
    await importPage(lib, "/page/declared")
    expect(requests.slice(before)).toEqual(["/page/declared", "/img/dish.png"])
  })
})

describe("picture/a-declared-picture-is-judged-by-its-bytes", () => {
  it("keeps JPEG bytes labelled PNG, and serves them as what they are", async () => {
    const lib = library()
    const { recipeId, recipe: kept } = await importPage(lib, "/page/jpeg-labelled-png")
    expect(kept?.media?.heroImage?.origin).toBe("source_url")
    const picture = await libraryGet(lib, `/recipes/${recipeId}/picture`)
    expect(picture.headers.get("content-type")).toBe("image/jpeg")
  })

  it("imports the recipe without a picture for every way a declared picture fails", async () => {
    const lib = library()
    const cases = [
      "/page/html-labelled-png",
      "/page/png-labelled-html",
      "/page/too-large",
      "/page/missing",
      "/page/private-address",
      "/page/data-uri",
    ]
    const outcomes = []
    for (const path of cases) {
      const imported = await importPage(lib, path)
      const page = await (await libraryGet(lib, `/recipes/${imported.recipeId}`)).text()
      outcomes.push({
        path,
        status: imported.status,
        title: imported.recipe?.title.state,
        media: imported.recipe?.media,
        gap: page.includes(asServed(NO_PICTURE_OF_THE_DISH.none_kept)),
      })
    }
    expect(outcomes).toEqual(
      cases.map((path) => ({
        path,
        status: 201,
        title: "from_source",
        media: undefined,
        gap: true,
      })),
    )
  })
})

// --- 3. nothing declared, nothing fetched -------------------------------------

describe("picture/no-declaration-fetches-nothing", () => {
  it("makes no picture request for a page that declares no picture", async () => {
    const lib = library()
    const before = requests.length
    const imported = await importPage(lib, "/page/no-image")
    expect(imported.status).toBe(201)
    expect(imported.recipe?.media).toBeUndefined()
    expect(requests.slice(before), "the import fetched more than its page").toEqual([
      "/page/no-image",
    ])
  })
})

// --- 4. the pipeline's picture ------------------------------------------------

describe("picture/the-picture-is-the-pipelines", () => {
  /** A normalizer that names a picture: the identity of a kept photograph. */
  const naming = (identity: string): NormalizationProvider => {
    const fake = createFakeNormalizationProvider()
    return {
      normalize: async (snapshot, ctx) => ({
        ...(await fake.normalize(snapshot, ctx)),
        media: { heroImage: { storageIdentity: identity, origin: "other" } },
      }),
    }
  }

  it("does not let a normalizer set a picture, where the page declares none", async () => {
    const store = scratchByteStore().store
    const photograph = await store.put(JPEG)
    const lib = library(naming(photograph))
    const imported = await importPage(lib, "/page/no-image")

    expect(imported.status).toBe(201)
    expect(imported.recipe?.media, "the normalizer chose the recipe's picture").toBeUndefined()
  })

  it("keeps the declared picture over the one a normalizer names", async () => {
    const lib = library(naming("sha256:0000"))
    const imported = await importPage(lib, "/page/declared")
    expect(imported.recipe?.media?.heroImage?.originalSourceUrl).toBe(`${origin}/img/dish.png`)
    expect(imported.recipe?.media?.heroImage?.storageIdentity).not.toBe("sha256:0000")
  })

  it("carries the kept picture when a stored source is re-converted, and fetches nothing", async () => {
    const lib = library()
    const imported = await importPage(lib, "/page/declared")
    const before = requests.length

    const again = await reprocess(lib.repo, naming("sha256:0000"), imported.snapshotId, {
      runId: "reprocess-1",
      targetOntologyVersion: "1.0.0",
    })
    expect(again.version).toBe(2)
    expect(again.recipe.media).toEqual(imported.recipe?.media)
    expect(requests.slice(before), "re-converting fetched something").toEqual([])
  })
})

// --- 5. the running instance's picture source ---------------------------------

describe("picture/the-instance-fetches-pictures-through-the-picture-source", () => {
  /**
   * Read from the composition root's syntax, because the running process cannot
   * fetch a picture in a proof (production refuses loopback, which is the point
   * of the guard). Two things: the instance's `pictureSource` field is bound to
   * a value built by `createSafePictureByteSource()` with NO arguments, so none
   * of the test-only seams; and the route hands that field, not the page
   * source, to the import. Text, not behaviour, and it says so.
   */
  const initializerOf = (file: ts.SourceFile, name: string): ts.Expression | undefined => {
    let found: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        found = node.initializer
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    return found
  }

  const fieldValue = (file: ts.SourceFile, field: string): ts.Node[] => {
    const out: ts.Node[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === field) out.push(node.name)
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === field) {
        out.push(node.initializer)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    return out
  }

  const parse = (path: string): ts.SourceFile =>
    ts.createSourceFile(
      path,
      readFileSync(join(repoRoot, path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    )

  it("builds the instance's picture source with the shipped factory and no options", () => {
    const main = parse("src/server/main.ts")
    const values = fieldValue(main, "pictureSource")
    expect(values.length, "main.ts hands the instance no pictureSource").toBe(1)
    const value = values[0] as ts.Node
    const call = ts.isIdentifier(value) ? initializerOf(main, value.text) : (value as ts.Expression)
    expect(call !== undefined && ts.isCallExpression(call)).toBe(true)
    const built = call as ts.CallExpression
    expect(built.expression.getText(main)).toBe("createSafePictureByteSource")
    expect(built.arguments.length, "a production picture source with test-only seams").toBe(0)
  })

  it("hands the import the picture source and the instance's store", () => {
    const route = parse("src/http/ingest-app.ts")
    const values = fieldValue(route, "pictures").map((node) => node.getText(route))
    expect(values).toEqual(["{ source: deps.pictureSource, store: deps.scanStore }"])
  })
})
