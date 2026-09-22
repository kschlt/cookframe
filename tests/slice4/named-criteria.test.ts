/**
 * CFV1-SL4 — the named acceptance-criterion proofs whose evidence exists across
 * the slice but was not yet stated under the spec's exact proof ids. Each
 * `describe`/`it` string is the criterion id it satisfies.
 *
 *  - `slice4/url-import-provenance`: run identity, provider, model and
 *    prompt-component versions are recorded for URL imports — on the deterministic
 *    AND the fallback path — on the same terms as an image import.
 *  - `slice4/fetch-implementation-recorded`: OQ-16 is closed by ADR-0010 and the
 *    connector is built and is the seam the URL byte source calls.
 *  - `slice4/security-suite-green`: the S5 adversarial suite exercises the REAL
 *    connector implementation (not a stub), so "green" is green against the thing
 *    that ships.
 *  - `slice4/security-suite-green-in-ci`: the S5 suite is wired into CI and a
 *    failure in it fails the build (no `continue-on-error`).
 *
 * Every fixture is synthetic, self-authored markup — no third-party recipe text.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import { createModelCaptureProvider } from "../../src/pipeline/model-providers.js"
import type {
  CaptureContext,
  ModelExchange,
  ModelTransport,
  NormalizationContext,
} from "../../src/pipeline/providers.js"
import { createUrlCaptureProvider } from "../../src/pipeline/url-capture.js"
import { importFromUrl, type UrlImportDeps } from "../../src/pipeline/url-import.js"
import { createDeterministicUrlCaptureProvider } from "../../src/pipeline/url-jsonld-adapter.js"
import type { UrlByteSource, UrlFetchResult } from "../../src/security/url-byte-source.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...p: string[]) => readFileSync(join(repoRoot, ...p), "utf8")
const policy = createContentDerivedBlockIdPolicy()

/** A fake byte source that returns fixed bytes — no network, no guard here. */
const fakeByteSource = (bytes: Uint8Array): UrlByteSource => ({
  async load(url: string): Promise<UrlFetchResult> {
    return { bytes, finalUrl: url, contentType: "text/html" }
  },
  async close(): Promise<void> {},
})

/** A transport that replies with fixed text and records what it was asked. */
function scripted(reply: string): ModelTransport & { readonly seen: ModelExchange[] } {
  const seen: ModelExchange[] = []
  return {
    seen,
    async send(exchange) {
      seen.push(exchange)
      return { text: reply }
    },
  }
}

const stage = (transport: ModelTransport) => ({
  transport,
  promptText: "PROMPT",
  contractText: "CONTRACT",
})

/** A page with sufficient Recipe JSON-LD: the deterministic path. */
const structuredBytes = new TextEncoder().encode(
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Synthetic Structured Loaf",
    recipeYield: "1 loaf",
    recipeIngredient: ["200 g flour", "1 tsp salt"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Mix and bake." }],
  })}</script></head><body></body></html>`,
)

/** A page with no Recipe JSON-LD: the model fallback path. */
const unstructuredPage =
  `<html><body><h1>Synthetic Fallback Loaf</h1>` +
  `<ul><li>200 g Mehl</li></ul><p>Alles verruehren.</p></body></html>`
const unstructuredBytes = new TextEncoder().encode(unstructuredPage)

const fallbackReply = JSON.stringify({
  capturedText: "Synthetic Fallback Loaf\n200 g Mehl\nAlles verruehren.",
  recipeCount: 1,
  recipeTitles: ["Synthetic Fallback Loaf"],
  blocks: [
    { order: 0, type: "title", text: "Synthetic Fallback Loaf" },
    { order: 1, type: "ingredient", text: "200 g Mehl" },
    { order: 2, type: "instruction", text: "Alles verruehren." },
  ],
})

const captureCtx = (over?: Partial<CaptureContext>): CaptureContext => ({
  snapshotId: "snap-provenance",
  snapshotVersion: 0,
  sourceAdapter: "url",
  adapterVersion: "1.4.0",
  runId: "url-capture-run",
  captureModel: "fake-capture-1",
  capturePromptVersions: ["capture-prompt@2"],
  ...over,
})

const normCtx = (): NormalizationContext => ({
  runId: "url-norm-run",
  targetOntologyVersion: "1.0.0",
  normalizationModel: "fake-norm-1",
  normalizationPromptVersions: ["normalization-prompt@2"],
})

describe("slice4/url-import-provenance", () => {
  const deps = (bytes: Uint8Array, transport: ModelTransport): UrlImportDeps => ({
    byteSource: fakeByteSource(bytes),
    repo: createProvisionalStore(),
    capture: createUrlCaptureProvider(
      createDeterministicUrlCaptureProvider(),
      createModelCaptureProvider(stage(transport)),
    ),
    normalization: createFakeNormalizationProvider(),
    policy,
  })

  it("records capture and normalization provenance on the deterministic path", async () => {
    const transport = scripted(fallbackReply)
    const { snapshot, canonical } = await importFromUrl(
      deps(structuredBytes, transport),
      "https://example.test/structured",
      captureCtx({ snapshotId: "snap-prov-det" }),
      normCtx(),
    )
    // Provenance is recorded on the same terms as an image import
    // (cf. slice1/capture-records-provenance): provider, versions, run id, model.
    const p = snapshot.captureProvenance
    expect(p.sourceAdapter).toBe("url")
    expect(p.adapterVersion).toBe("1.4.0")
    expect(p.runId).toBe("url-capture-run")
    expect(p.model).toBe("fake-capture-1")
    expect(p.capturePromptVersions).toEqual(["capture-prompt@2"])
    // The normalization run identity is stamped on the Canonical.
    expect(canonical.recipe.provenance.runId).toBe("url-norm-run")
    expect(canonical.recipe.provenance.normalizationModel).toBe("fake-norm-1")
    expect(canonical.recipe.provenance.normalizationPromptVersions).toEqual([
      "normalization-prompt@2",
    ])
    expect(canonical.recipe.provenance.sourceSnapshotId).toBe("snap-prov-det")
  })

  it("records the same provenance classes on the model fallback path", async () => {
    const transport = scripted(fallbackReply)
    const { snapshot, canonical } = await importFromUrl(
      deps(unstructuredBytes, transport),
      "https://example.test/unstructured",
      captureCtx({ snapshotId: "snap-prov-fb" }),
      normCtx(),
    )
    // The fallback WAS taken, and provenance is recorded on the same terms.
    expect(transport.seen).toHaveLength(1)
    const p = snapshot.captureProvenance
    expect(p.sourceAdapter).toBe("url")
    expect(p.runId).toBe("url-capture-run")
    expect(p.model).toBe("fake-capture-1")
    expect(p.capturePromptVersions).toEqual(["capture-prompt@2"])
    expect(canonical.recipe.provenance.runId).toBe("url-norm-run")
    expect(canonical.recipe.provenance.sourceSnapshotId).toBe("snap-prov-fb")
  })
})

describe("slice4/fetch-implementation-recorded", () => {
  it("closes OQ-16 via ADR-0010 and builds the connector the byte source calls", () => {
    // OQ-16 is recorded closed, decided by ADR-0010.
    const openQuestions = read("docs", "open-questions.md")
    expect(openQuestions).toMatch(/OQ-16[^\n]*closed by ADR-0010/)
    expect(
      existsSync(
        join(repoRoot, "docs", "adr", "ADR-0010-safe-url-fetch-is-guarded-at-the-connector.md"),
      ),
    ).toBe(true)
    // The connector is built, and the URL byte source is its one caller.
    const connector = read("src", "security", "safe-fetch.ts")
    expect(connector).toMatch(/export function createSafeFetcher/)
    // undici is the direct dependency the connector needs for a dispatcher.
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }
    expect(pkg.dependencies["undici"]).toBeTruthy()
    const byteSource = read("src", "security", "url-byte-source.ts")
    expect(byteSource).toMatch(/from "\.\/safe-fetch\.js"/)
    expect(byteSource).toMatch(/createSafeFetcher\(/)
  })
})

describe("slice4/security-suite-green", () => {
  it("holds the REAL connector implementation to its bounds, not a stub", () => {
    // "Green" is only meaningful if the adversarial suite exercises the shipping
    // implementation. The S5 connector suite imports the production factory
    // directly, so its passing run is a verdict on what ships.
    const connectorSuite = read("tests", "url-fetch", "url-security.connector.test.ts")
    expect(connectorSuite).toMatch(/createSafeFetcher/)
    expect(connectorSuite).toMatch(/from "\.\.\/\.\.\/src\/security\/safe-fetch\.js"/)
    // The address-classification suite exists too — the other half of the S5 net.
    expect(existsSync(join(repoRoot, "tests", "url-fetch", "url-security.address.test.ts"))).toBe(
      true,
    )
  })
})

describe("slice4/security-suite-green-in-ci", () => {
  it("runs the S5 suite in CI as a build-failing step", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    // The script that runs the S5 suite targets the S5 directory.
    expect(pkg.scripts["test:url-fetch-security"]).toMatch(/vitest run tests\/url-fetch/)
    const workflow = parseYaml(read(".github", "workflows", "ci.yml")) as {
      jobs: Record<
        string,
        { steps?: Array<Record<string, unknown>>; "continue-on-error"?: unknown }
      >
    }
    const job = workflow.jobs["url-fetch-security"]
    expect(job, "no url-fetch-security job in ci.yml").toBeTruthy()
    const runs = (job?.steps ?? []).map((s) => String(s["run"] ?? "")).join("\n")
    expect(runs).toMatch(/test:url-fetch-security/)
    // A failure fails the build: the job does not swallow its own failure.
    expect(job?.["continue-on-error"]).not.toBe(true)
  })
})
