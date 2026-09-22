/**
 * CFV1-SL5 — how long the scan-to-shop path actually takes.
 *
 * The product's central claim is low friction: photograph a recipe, get a
 * shopping list. This slice is where that claim stops being asserted, so the
 * measurement is the point of the unit rather than a nicety attached to it.
 *
 * It measures the WHOLE path the instance owns, in one timed region: the
 * submission arriving at the mobile entry point, capture, block-id assignment,
 * persistence, normalization, and the recipe coming back out of the capability
 * URL as the Schema.org document Bring fetches. Nothing here times a component
 * and calls it the journey — the spec's `What NOT` forbids exactly that, and the
 * stage split printed beside the total is reported as a breakdown OF the total,
 * never in place of it.
 *
 * **What it cannot measure, stated rather than left to be assumed:** the shutter
 * and the upload. No phone and no mobile network are reachable from where this
 * runs, so the figure is instance-side — from the request arriving to the
 * shopping document being served. The two missing legs are real friction and are
 * registered in `MEASUREMENT.md`, not quietly folded in.
 *
 * A distribution, never a best case. The friction a user feels is the slow tail,
 * and one good run says nothing about it.
 *
 * Usage:
 *   tsx spikes/sl5-scan-to-shop/run.mts --photos <dir> [--out <file>] [--fake]
 *
 * `--fake` runs the identical path with deterministic providers and no network,
 * which is how the harness is got right before a run that costs real money.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createCapabilityApp } from "../../src/http/capability-app.js"
import { createIngestApp } from "../../src/http/ingest-app.js"
import { createIngestCredential } from "../../src/http/ingest-credential.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import {
  createFakeCaptureProvider,
  createFakeNormalizationProvider,
} from "../../src/pipeline/fake-providers.js"
import {
  createModelCaptureProvider,
  createModelNormalizationProvider,
} from "../../src/pipeline/model-providers.js"
import { createOpenAITransport } from "../../src/pipeline/openai-transport.js"
import type { CaptureProvider, NormalizationProvider } from "../../src/pipeline/providers.js"
import { createInMemoryCapabilityStore } from "../../src/shopping/capability-token.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const fake = process.argv.includes("--fake")
const photosDir = arg("--photos")
const outFile = arg("--out") ?? join(repoRoot, "spikes", "sl5-scan-to-shop", "measurements.json")
if (photosDir === undefined) throw new Error("--photos <dir> is required")

const API_KEY = process.env["OPENAI_API_KEY"]
const MODEL = process.env["OPENAI_MODEL"]
if (!fake && (API_KEY === undefined || MODEL === undefined)) {
  throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required unless --fake is given")
}

/** The credential the run configures its own instance with. Never a real one. */
const CREDENTIAL = "sl5-scan-to-shop-measurement-run-credential"

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

function sniff(bytes: Uint8Array, name: string): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"
  return MEDIA_TYPES[name.slice(name.lastIndexOf(".")).toLowerCase()]
}

const contractText = [
  "schema/version.ts",
  "schema/common.ts",
  "schema/source-snapshot.ts",
  "schema/canonical-recipe.ts",
]
  .map((rel) => `// ==== ${rel} ====\n${readFileSync(join(repoRoot, rel), "utf8")}`)
  .join("\n\n")

/** Token accounting, so what the run cost is measured rather than guessed. */
const tally = { calls: 0, inputTokens: 0, outputTokens: 0 }

function providers(): { capture: CaptureProvider; normalization: NormalizationProvider } {
  if (fake) {
    return { capture: createFakeCaptureProvider(), normalization: createFakeNormalizationProvider() }
  }
  const inner = createOpenAITransport({ apiKey: API_KEY as string, model: MODEL as string })
  const transport = {
    async send(exchange: Parameters<typeof inner.send>[0]) {
      const reply = await inner.send(exchange)
      tally.calls += 1
      tally.inputTokens += reply.usage?.inputTokens ?? 0
      tally.outputTokens += reply.usage?.outputTokens ?? 0
      return reply
    },
  }
  return {
    capture: createModelCaptureProvider({
      transport,
      promptText: readFileSync(join(repoRoot, "prompts/capture/v1.md"), "utf8"),
      contractText,
    }),
    normalization: createModelNormalizationProvider({
      transport,
      promptText: readFileSync(join(repoRoot, "prompts/normalization/v1.md"), "utf8"),
      contractText,
    }),
  }
}

interface Run {
  readonly photo: string
  readonly bytes: number
  readonly outcome: "shoppable" | "refused" | "failed"
  /** The whole instance-side journey: submission in, shopping document out. */
  readonly totalMs: number
  /** A breakdown OF the total, never a substitute for it. */
  readonly submitMs: number
  readonly handoffMs: number
  readonly detail?: string
}

/** The distribution. A single figure is the thing this is here not to report. */
function distribution(values: readonly number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
  return {
    n: sorted.length,
    minMs: sorted[0] ?? Number.NaN,
    p50Ms: at(0.5),
    p90Ms: at(0.9),
    maxMs: sorted[sorted.length - 1] ?? Number.NaN,
  }
}

async function main(): Promise<void> {
  const { capture, normalization } = providers()
  const repo = createProvisionalStore()
  const store = createInMemoryCapabilityStore()
  let n = 0
  const ingestApp = createIngestApp({
    credential: createIngestCredential(CREDENTIAL),
    repo,
    capture,
    normalization,
    policy: createContentDerivedBlockIdPolicy(),
    identity: {
      newSnapshotId: () => `scan-${String(++n).padStart(2, "0")}`,
      newCaptureRunId: () => `capture-${n}`,
      newNormalizationRunId: () => `normalize-${n}`,
    },
    targetOntologyVersion: "1.0.0",
    sourceAdapter: "ios-shortcut",
    adapterVersion: "1.0.0",
  })
  const shoppingApp = createCapabilityApp({ store, repo })

  const files = readdirSync(photosDir as string)
    .map((f) => join(photosDir as string, f))
    .filter((f) => {
      try {
        return sniff(readFileSync(f).subarray(0, 4), f) !== undefined
      } catch {
        return false
      }
    })
    .sort()

  console.log(`# CFV1-SL5 scan-to-shop — ${fake ? "FAKE providers" : `model ${MODEL}`}`)
  console.log(`# ${files.length} photo(s) from ${photosDir}\n`)

  const runs: Run[] = []
  for (const file of files) {
    const bytes = new Uint8Array(readFileSync(file))
    const mediaType = sniff(bytes, file) as string
    const photo = file.slice(file.lastIndexOf("/") + 1)

    // ONE timed region, opened before the submission and closed when the
    // shopping document is in hand. The stage marks are read inside it.
    const t0 = performance.now()
    const submitted = await ingestApp.request("/capture", {
      method: "POST",
      headers: { authorization: `Bearer ${CREDENTIAL}`, "content-type": mediaType },
      body: bytes,
    })
    const tSubmitted = performance.now()

    if (submitted.status === 422) {
      const body = (await submitted.json()) as { reasonCode: string; message: string }
      const total = performance.now() - t0
      runs.push({
        photo,
        bytes: bytes.byteLength,
        outcome: "refused",
        totalMs: total,
        submitMs: tSubmitted - t0,
        handoffMs: 0,
        detail: body.reasonCode,
      })
      console.log(`  ${photo}  refused (${body.reasonCode})  ${total.toFixed(0)} ms`)
      continue
    }
    if (submitted.status !== 201) {
      const total = performance.now() - t0
      runs.push({
        photo,
        bytes: bytes.byteLength,
        outcome: "failed",
        totalMs: total,
        submitMs: tSubmitted - t0,
        handoffMs: 0,
        detail: `HTTP ${submitted.status}`,
      })
      console.log(`  ${photo}  FAILED (HTTP ${submitted.status})  ${total.toFixed(0)} ms`)
      continue
    }

    const { recipeId } = (await submitted.json()) as { recipeId: string }
    const grant = await store.issue(recipeId)
    const served = await shoppingApp.request(`/r/${grant.token}`)
    const shoppable = served.status === 200
    // The document is read, not merely responded to: a 200 whose body never
    // arrives is not a shopping list.
    if (shoppable) await served.text()
    const t1 = performance.now()

    runs.push({
      photo,
      bytes: bytes.byteLength,
      outcome: shoppable ? "shoppable" : "failed",
      totalMs: t1 - t0,
      submitMs: tSubmitted - t0,
      handoffMs: t1 - tSubmitted,
      ...(shoppable ? {} : { detail: `handoff HTTP ${served.status}` }),
    })
    console.log(
      `  ${photo}  ${shoppable ? "shoppable" : "FAILED at handoff"}  ${(t1 - t0).toFixed(0)} ms`,
    )
  }

  const shoppable = runs.filter((r) => r.outcome === "shoppable")
  const report = {
    measuredAt: new Date().toISOString(),
    providers: fake ? "fake" : (MODEL ?? "unknown"),
    photos: runs.length,
    outcomes: {
      shoppable: shoppable.length,
      refused: runs.filter((r) => r.outcome === "refused").length,
      failed: runs.filter((r) => r.outcome === "failed").length,
    },
    /** Instance-side: submission in, shopping document out. Shutter and upload excluded. */
    endToEnd: distribution(shoppable.map((r) => r.totalMs)),
    breakdown: {
      submit: distribution(shoppable.map((r) => r.submitMs)),
      handoff: distribution(shoppable.map((r) => r.handoffMs)),
    },
    modelCalls: fake ? undefined : tally,
    runs,
  }
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`\n# end to end, instance-side (n=${report.endToEnd["n"]})`)
  for (const key of ["minMs", "p50Ms", "p90Ms", "maxMs"]) {
    console.log(`  ${key.padEnd(6)} ${(report.endToEnd[key] ?? Number.NaN).toFixed(0)} ms`)
  }
  if (!fake) {
    console.log(
      `\n# model: ${tally.calls} calls, ${tally.inputTokens} input, ${tally.outputTokens} output tokens`,
    )
  }
  console.log(`\n# written to ${outFile}`)
}

await main()
