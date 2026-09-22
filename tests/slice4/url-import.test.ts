/**
 * CFV1-SL4 — the URL IMPORT wiring: fetch a page through the safe-fetch guard and
 * run it through the same ingest spine an image import uses, end to end.
 *
 * This is the unit the deterministic-mapping suite (`url-jsonld-mapping.test.ts`)
 * deliberately deferred: it mounts the S5 safe-fetch connector
 * (`src/security/safe-fetch.ts`) behind the pipeline-facing `UrlByteSource`
 * (`src/security/url-byte-source.ts`) and proves the live half of Slice 4 —
 *   - `slice4/bound-violation-fails-import`: the fetch goes THROUGH the guard, so
 *     the guard's fail-closed bounds (size, content-type) and scheme refusal
 *     decide the import, and a refused fetch persists nothing;
 *   - `slice4/contract-convergence-with-image-import`: a URL import that clears
 *     the guard produces the same `SourceSnapshot` + `CanonicalRecipe` contract,
 *     on the same `ingest(...)` spine, as any other source.
 *
 * It is fully offline and free of cost: the page is served by a loopback
 * `node:http` server, reached through the test-only seams ADR-0010 point 11
 * specifies (`allowLoopback`, so the `127.0.0.1` server is the allowed leg).
 * Neither seam is ever passed in production. The model fallback for insufficient
 * JSON-LD stays the key-provider unit's; here an insufficient page is DECLINED by
 * the deterministic capture provider, and that refusal, like a guard refusal,
 * persists nothing.
 *
 * Every fixture is synthetic, self-authored recipe markup — no third-party recipe
 * text (CFV1-SL4 "What NOT"; the public-repo content rule).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureContext, NormalizationContext } from "../../src/pipeline/providers.js"
import { importFromUrl, type UrlImportDeps } from "../../src/pipeline/url-import.js"
import {
  createDeterministicUrlCaptureProvider,
  InsufficientRecipeJsonLdError,
  recipeToRawBlocks,
} from "../../src/pipeline/url-jsonld-adapter.js"
import { SafeFetchError } from "../../src/security/safe-fetch.js"
import { createSafeUrlByteSource, type UrlByteSource } from "../../src/security/url-byte-source.js"

/** A synthetic, self-authored complete Recipe served by the loopback fixture. */
const completeRecipe = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Synthetic Test Loaf",
  author: { "@type": "Person", name: "Fixture Author" },
  recipeYield: "1 loaf",
  recipeIngredient: ["200 g flour", "1 tsp salt", "300 ml water"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mix the flour and salt." },
    { "@type": "HowToStep", text: "Add water and stir to a dough." },
    { "@type": "HowToStep", text: "Bake until golden." },
  ],
}

/** A Recipe missing a required field (recipeInstructions): the deterministic path declines it. */
const { recipeInstructions: _omitted, ...thinRecipe } = completeRecipe
void _omitted

/** Wrap a JSON-LD value in a minimal synthetic HTML page. */
const pageHtml = (jsonLd: unknown): string =>
  `<!doctype html><html><head><title>fixture</title>` +
  `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
  `</head><body><p>rendered body, ignored by the adapter</p></body></html>`

let server: Server
let port: number

function handle(req: IncomingMessage, res: ServerResponse): void {
  res.on("error", () => {}) // swallow ECONNRESET when the guard aborts mid-write
  const path = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname
  switch (path) {
    case "/recipe": {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(pageHtml(completeRecipe))
      return
    }
    case "/thin": {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(pageHtml(thinRecipe))
      return
    }
    case "/wrong-ct": {
      // A content type outside the guard's allowlist: the fetch must refuse it
      // before the adapter ever sees the bytes.
      res.writeHead(200, { "content-type": "image/png" })
      res.end(pageHtml(completeRecipe))
      return
    }
    default: {
      res.writeHead(404, { "content-type": "text/html" })
      res.end("nope")
      return
    }
  }
}

beforeAll(async () => {
  server = createServer(handle)
  server.on("clientError", (_err, socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const local = (path: string): string => `http://127.0.0.1:${port}${path}`

const policy = createContentDerivedBlockIdPolicy()

const captureCtx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-url-import-1",
  snapshotVersion: 0,
  sourceAdapter: "url-jsonld",
  adapterVersion: "0.0.0",
  runId: "url-import-run-1",
  ...over,
})

const normCtx = (runId: string): NormalizationContext => ({ runId, targetOntologyVersion: "1.0.0" })

/**
 * Assemble the import deps around a byte source. Every collaborator is injected
 * (ADR-0004): the same spine an image import uses, with the URL byte source added.
 */
const deps = (byteSource: UrlByteSource): UrlImportDeps => ({
  byteSource,
  repo: createProvisionalStore(),
  capture: createDeterministicUrlCaptureProvider(),
  normalization: createFakeNormalizationProvider(),
  policy,
})

describe("slice4/contract-convergence-with-image-import (url import)", () => {
  it("fetches a page through the guard and converges on the shared snapshot contract", async () => {
    const byteSource = createSafeUrlByteSource({ allowLoopback: true })
    const d = deps(byteSource)
    try {
      const { snapshot, canonical } = await importFromUrl(
        d,
        local("/recipe"),
        captureCtx({ snapshotId: "snap-url-import-converge" }),
        normCtx("url-import-norm-1"),
      )

      // Same contract as an image import: a url snapshot on the shared spine.
      expect(snapshot.sourceType).toBe("url")
      // The parsed Recipe survived the fetch → adapter path verbatim.
      expect(snapshot.structuredSourcePayload).toEqual(completeRecipe)
      // Block ids are exactly the policy's ids for the mapped segmentation.
      const expectedIds = policy.assignIds(recipeToRawBlocks(completeRecipe)).map((b) => b.id)
      expect(snapshot.blocks.map((b) => b.id)).toEqual(expectedIds)
      // Provenance from the capture context is stamped on the snapshot.
      expect(snapshot.captureProvenance.sourceAdapter).toBe("url-jsonld")
      expect(snapshot.captureProvenance.runId).toBe("url-import-run-1")
      // The spine appended a first Canonical version whose refs resolved (ingest
      // fails closed otherwise), and the snapshot is persisted.
      expect(canonical.version).toBe(1)
      expect(await d.repo.loadSnapshot(snapshot.id)).toBeDefined()
      expect(await d.repo.listLibrary()).toHaveLength(1)
    } finally {
      await byteSource.close()
    }
  })
})

describe("slice4/bound-violation-fails-import (url import goes through the guard)", () => {
  it("refuses a URL whose scheme is off the allowlist, persisting nothing", async () => {
    // A non-http(s) scheme proves the fetch is the guarded connector, not a raw
    // request: only the guard would refuse file:// as SCHEME_NOT_ALLOWED.
    const byteSource = createSafeUrlByteSource({ allowLoopback: true })
    const d = deps(byteSource)
    try {
      await expect(
        importFromUrl(d, "file:///etc/passwd", captureCtx(), normCtx("url-import-scheme")),
      ).rejects.toMatchObject({ reasonCode: "SCHEME_NOT_ALLOWED" })
      await expect(
        importFromUrl(d, "file:///etc/passwd", captureCtx(), normCtx("url-import-scheme")),
      ).rejects.toBeInstanceOf(SafeFetchError)
      expect(await d.repo.listLibrary()).toHaveLength(0)
    } finally {
      await byteSource.close()
    }
  })

  it("fails the import closed when the size bound is exceeded, persisting nothing", async () => {
    // A byte source with a tiny size bound: the guard aborts the connection
    // before the body completes, so the import raises SIZE_LIMIT and nothing is
    // captured or stored.
    const byteSource = createSafeUrlByteSource({ allowLoopback: true, maxBytes: 16 })
    const d = deps(byteSource)
    try {
      await expect(
        importFromUrl(d, local("/recipe"), captureCtx(), normCtx("url-import-size")),
      ).rejects.toMatchObject({ reasonCode: "SIZE_LIMIT" })
      expect(await d.repo.listLibrary()).toHaveLength(0)
    } finally {
      await byteSource.close()
    }
  })

  it("fails the import closed when the content type is off the allowlist, persisting nothing", async () => {
    const byteSource = createSafeUrlByteSource({ allowLoopback: true })
    const d = deps(byteSource)
    try {
      await expect(
        importFromUrl(d, local("/wrong-ct"), captureCtx(), normCtx("url-import-ct")),
      ).rejects.toMatchObject({ reasonCode: "CONTENT_TYPE_NOT_ALLOWED" })
      expect(await d.repo.listLibrary()).toHaveLength(0)
    } finally {
      await byteSource.close()
    }
  })
})

describe("slice4/deterministic-path-declines-over-fetch", () => {
  it("fetches successfully but declines an insufficient page, persisting nothing", async () => {
    // The fetch clears the guard (200 text/html), so this proves the DECLINE is
    // the deterministic adapter's, not the guard's — the seam that later routes to
    // the model fallback. Either way, an incomplete import stores nothing.
    const byteSource = createSafeUrlByteSource({ allowLoopback: true })
    const d = deps(byteSource)
    try {
      await expect(
        importFromUrl(d, local("/thin"), captureCtx(), normCtx("url-import-thin")),
      ).rejects.toBeInstanceOf(InsufficientRecipeJsonLdError)
      expect(await d.repo.listLibrary()).toHaveLength(0)
    } finally {
      await byteSource.close()
    }
  })
})
