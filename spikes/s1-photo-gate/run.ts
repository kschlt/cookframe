/**
 * CFV1-S1 — run real photographs through the real pipeline (OQ-14, Gate A).
 *
 * The S1 spike delivered a pre-registered threshold, a self-tested scorer and a
 * verdict format, and returned INCONCLUSIVE: its fixtures were self-authored, so
 * the truth and the capture shared an author and 100% proved nothing. What it
 * said it needed was "a fixture set whose ground truth is independent of the
 * capture". This runner is the capture half of that: the maintainer's own
 * photographs, through the product's real capture and normalization
 * capabilities, against a real model.
 *
 * It composes only product code — `ingest`, the provisional store, the
 * content-derived block-id policy, `createModelCaptureProvider` /
 * `createModelNormalizationProvider` — plus the transport beside it. Nothing is
 * re-implemented here, so what it exercises is what would ship.
 *
 * PRIVACY / COPYRIGHT: the photographs are personal and the recipes are
 * third-party. Inputs are read from outside the repository and every output is
 * written under `evals/fixtures/private/`, which `.gitignore` excludes. Nothing
 * this script writes may be committed (S1 constraint; evals/README.md).
 *
 * USAGE:
 *   OPENAI_MODEL=gpt-5.4 npx tsx spikes/s1-photo-gate/run.ts --photos <dir>
 *   OPENAI_MODEL=gpt-5.4 npx tsx spikes/s1-photo-gate/run.ts --photos <dir> --limit 1
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createProvisionalStore } from "../../src/persistence/provisional-store.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { ingest } from "../../src/pipeline/ingest.js"
import {
  createModelCaptureProvider,
  createModelNormalizationProvider,
} from "../../src/pipeline/model-providers.js"
import { createOpenAITransport } from "../../src/pipeline/openai-transport.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_MODEL
const photosDir = arg("--photos")
const limit = Number(arg("--limit") ?? "0")
/**
 * Where snapshots and canonicals land. Defaults to the private gate directory;
 * `--out` exists so a re-run can be compared against an earlier one instead of
 * overwriting it — a run costs real money, so clobbering it is a bug.
 */
const outDir = arg("--out") ?? join(repoRoot, "evals", "fixtures", "private", "s1-gate")

if (!API_KEY) throw new Error("OPENAI_API_KEY is not set.")
if (!MODEL) throw new Error('OPENAI_MODEL is not set, e.g. OPENAI_MODEL="gpt-5.4".')
if (!photosDir) throw new Error("--photos <dir> is required (a directory of photographs).")

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

/** Sniff the media type from the file's magic bytes; extensions may be absent. */
function sniff(bytes: Uint8Array, name: string): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png"
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase()
  return MEDIA_TYPES[ext]
}

const contractText = [
  ["schema/version.ts", "schema/common.ts", "schema/source-snapshot.ts", "schema/canonical-recipe.ts"],
]
  .flat()
  .map((rel) => `// ==== ${rel} ====\n${readFileSync(join(repoRoot, rel), "utf8")}`)
  .join("\n\n")

/** Wrap a transport so the run can report what it actually cost. */
function counting(inner: ReturnType<typeof createOpenAITransport>) {
  const tally = { calls: 0, inputTokens: 0, outputTokens: 0, retries: 0 }
  return {
    tally,
    transport: {
      async send(exchange: Parameters<typeof inner.send>[0]) {
        const reply = await inner.send(exchange)
        tally.calls += 1
        tally.inputTokens += reply.usage?.inputTokens ?? 0
        tally.outputTokens += reply.usage?.outputTokens ?? 0
        return reply
      },
    },
  }
}

async function main(): Promise<void> {
  const { transport, tally } = counting(
    createOpenAITransport({ apiKey: API_KEY as string, model: MODEL as string }),
  )
  // A retried call is billed like any other and nothing in the persisted record
  // mentions it, so the run counts them itself and prints them beside the cost.
  const onAttempt = (info: { attempt: number; stage: string; repairing?: string }) => {
    if (info.attempt === 1) return
    tally.retries += 1
    console.log(`       retry ${info.stage} (attempt ${info.attempt}): ${info.repairing ?? ""}`)
  }
  const capture = createModelCaptureProvider({
    transport,
    promptText: readFileSync(join(repoRoot, "prompts/capture/v1.md"), "utf8"),
    contractText,
    onAttempt,
  })
  const normalization = createModelNormalizationProvider({
    transport,
    promptText: readFileSync(join(repoRoot, "prompts/normalization/v1.md"), "utf8"),
    contractText,
    onAttempt,
  })
  const policy = createContentDerivedBlockIdPolicy()
  const repo = createProvisionalStore()

  const files = readdirSync(photosDir)
    .map((f) => join(photosDir, f))
    .filter((f) => {
      try {
        return sniff(readFileSync(f).subarray(0, 4), f) !== undefined
      } catch {
        return false
      }
    })
    .sort()
  const selected = limit > 0 ? files.slice(0, limit) : files

  mkdirSync(outDir, { recursive: true })
  console.log(`# CFV1-S1 real-photo run — model ${MODEL}, ${selected.length} photo(s)`)
  console.log(`# outputs -> ${outDir} (git-ignored)\n`)

  const summary: unknown[] = []

  for (const [index, file] of selected.entries()) {
    const bytes = new Uint8Array(readFileSync(file))
    const mediaType = sniff(bytes, file) as string
    const id = `photo-${String(index + 1).padStart(2, "0")}`
    const started = Date.now()
    try {
      const { snapshot, canonical: version } = await ingest(
        repo,
        capture,
        normalization,
        policy,
        bytes,
        {
          snapshotId: id,
          snapshotVersion: 0,
          sourceAdapter: "photo",
          adapterVersion: "1.0.0",
          runId: `${id}-capture`,
          captureModel: MODEL,
          capturePromptVersions: ["capture/v1"],
          sourceMediaType: mediaType,
        },
        {
          runId: `${id}-normalize`,
          targetOntologyVersion: "1.0.0",
          normalizationModel: MODEL,
          normalizationPromptVersions: ["normalization/v1"],
        },
      )
      writeFileSync(
        join(outDir, `${id}.snapshot.json`),
        `${JSON.stringify(snapshot, null, 2)}\n`,
      )
      // `ingest` returns the appended CanonicalVersion; the recipe is inside it.
      const canonical = version.recipe
      writeFileSync(
        join(outDir, `${id}.canonical.json`),
        `${JSON.stringify(version, null, 2)}\n`,
      )
      const ms = Date.now() - started
      console.log(
        `  ok   ${id}  ${basename(file).slice(0, 12)}…  ${(ms / 1000).toFixed(1)}s  ` +
          `blocks=${snapshot.blocks.length}  ingredients=${canonical.ingredientGroups.reduce(
            (n, g) => n + g.ingredients.length,
            0,
          )}  steps=${canonical.instructionSections.reduce((n, s) => n + s.steps.length, 0)}  ` +
          `"${canonical.title.slice(0, 40)}"`,
      )
      summary.push({ id, file: basename(file), title: canonical.title, ms, ok: true })
    } catch (err) {
      console.error(`  FAIL ${id}  ${basename(file).slice(0, 12)}…  ${(err as Error).message}`)
      summary.push({ id, file: basename(file), ok: false, error: (err as Error).message })
    }
  }

  writeFileSync(join(outDir, "run-summary.json"), `${JSON.stringify({ model: MODEL, summary }, null, 2)}\n`)
  const library = await repo.listLibrary()
  console.log(`\nLibrary: ${library.length} recipe(s) persisted through the real spine.`)
  console.log(
    `Cost: ${tally.calls} calls (${tally.retries} of them retries), ${tally.inputTokens.toLocaleString()} input + ` +
      `${tally.outputTokens.toLocaleString()} output tokens` +
      (selected.length > 0
        ? ` (${Math.round(tally.inputTokens / selected.length).toLocaleString()} + ${Math.round(tally.outputTokens / selected.length).toLocaleString()} per photo)`
        : ""),
  )
  console.log(`Wrote snapshots + canonicals to evals/fixtures/private/s1-gate/ (git-ignored).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
