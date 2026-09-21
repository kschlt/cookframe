/**
 * CFV1-DBQ — produce the SECOND normalization run the deciding queries need.
 *
 * `ADR-0003` is explicit about the data that closes OQ-03/OQ-04: "one real
 * Canonical Recipe, with real `sourceRefs`, and two normalization runs to
 * compare". The S1 photo gate produced the first run for eleven real
 * photographs. This produces the second, by doing exactly what the product
 * would do — `reprocess` over the ALREADY STORED snapshot, appending a new
 * version and leaving the first intact.
 *
 * Nothing here is a fixture. The two runs differ because two real normalization
 * calls differ, which is the only way a comparison query can be honest about
 * what it will have to surface in production.
 *
 * PRIVACY: reads and writes only under `evals/fixtures/private/`, which
 * `.gitignore` excludes. Nothing it writes may be committed.
 *
 * USAGE:
 *   OPENAI_MODEL=gpt-5.4 npx tsx spikes/dbq/reprocess-run.ts --in <dir> [--ids photo-01,photo-03]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SourceSnapshot } from "../../schema/index.js"
import { createProvisionalStore } from "../../src/persistence/provisional-store.js"
import { createModelNormalizationProvider } from "../../src/pipeline/model-providers.js"
import { createOpenAITransport } from "../../src/pipeline/openai-transport.js"
import { reprocess } from "../../src/pipeline/reprocess.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_MODEL
const inDir = arg("--in") ?? join(repoRoot, "evals", "fixtures", "private", "s1-gate")
const only = arg("--ids")?.split(",").map((s) => s.trim())

if (!API_KEY) throw new Error("OPENAI_API_KEY is not set.")
if (!MODEL) throw new Error('OPENAI_MODEL is not set, e.g. OPENAI_MODEL="gpt-5.4".')

const contractText = ["schema/version.ts", "schema/common.ts", "schema/source-snapshot.ts", "schema/canonical-recipe.ts"]
  .map((rel) => `// ==== ${rel} ====\n${readFileSync(join(repoRoot, rel), "utf8")}`)
  .join("\n\n")

async function main(): Promise<void> {
  const tally = { calls: 0, inputTokens: 0, outputTokens: 0, retries: 0 }
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
  const normalization = createModelNormalizationProvider({
    transport,
    promptText: readFileSync(join(repoRoot, "prompts/normalization/v1.md"), "utf8"),
    contractText,
    onAttempt: (info) => {
      if (info.attempt === 1) return
      tally.retries += 1
      console.log(`       retry (attempt ${info.attempt}): ${info.repairing ?? ""}`)
    },
  })

  const files = readdirSync(inDir)
    .filter((f) => f.endsWith(".snapshot.json"))
    .sort()
    .filter((f) => only === undefined || only.includes(f.replace(".snapshot.json", "")))

  console.log(`# CFV1-DBQ second normalization run — model ${MODEL}, ${files.length} snapshot(s)\n`)

  for (const file of files) {
    const snapshot = JSON.parse(readFileSync(join(inDir, file), "utf8")) as SourceSnapshot
    // A fresh store per snapshot: the first run is on disk, not in memory, so
    // the appended version here is numbered 1 and is relabelled to 2 on write.
    const repo = createProvisionalStore()
    await repo.storeSnapshot(snapshot)
    const started = Date.now()
    try {
      const version = await reprocess(repo, normalization, snapshot.id, {
        runId: `${snapshot.id}-normalize-run2`,
        targetOntologyVersion: "1.0.0",
        normalizationModel: MODEL as string,
        normalizationPromptVersions: ["normalization/v1"],
      })
      const record = { recipeId: version.recipeId, version: 2, recipe: version.recipe }
      writeFileSync(
        join(inDir, `${snapshot.id}.canonical.v2.json`),
        `${JSON.stringify(record, null, 2)}\n`,
      )
      console.log(
        `  ok   ${snapshot.id}  ${((Date.now() - started) / 1000).toFixed(1)}s  ` +
          `ingredients=${version.recipe.ingredientGroups.reduce((n, g) => n + g.ingredients.length, 0)}  ` +
          `steps=${version.recipe.instructionSections.reduce((n, s) => n + s.steps.length, 0)}`,
      )
    } catch (err) {
      console.error(`  FAIL ${snapshot.id}  ${(err as Error).message}`)
    }
  }

  console.log(
    `\nCost: ${tally.calls} calls (${tally.retries} retries), ` +
      `${tally.inputTokens.toLocaleString()} input + ${tally.outputTokens.toLocaleString()} output tokens`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
