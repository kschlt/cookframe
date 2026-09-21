/**
 * Does the retry actually repair a real contract violation? (CFV1-SL1)
 *
 * `tests/slice1/model-providers.test.ts` proves the mechanism: a rejected reply
 * is re-sent with the validator's own message, a conforming second reply is
 * used, and the attempt still fails closed when it is spent. What those proofs
 * cannot show — they script the replies — is whether a real model, shown a real
 * `.strict()` message, actually produces a conforming reply. That is the whole
 * premise of the retry, and it was unmeasured.
 *
 * This probe measures it on the cheapest input that reliably produces the
 * failure. CFV1-S6 measured gpt-5.4-mini at 24/27 contract-valid, every failure
 * a `.strict()` violation, so the cheap tier on the `sparse` fixture reproduces
 * the class the real-photograph run hit on the full tier (one page in eleven,
 * an undefined key inside `ingredientUses`). Text in, text out: about 5.5k
 * tokens a call on the cheap tier, so the whole probe costs a few cents rather
 * than the ~75 cents a photograph re-run would.
 *
 *   OPENAI_API_KEY=… OPENAI_MODEL=gpt-5.4-mini npx tsx spikes/s6-fidelity/retry-probe.ts --runs 12
 *
 * It writes nothing. The numbers go in FINDINGS.md.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SourceSnapshot } from "../../schema/index.js"
import { createModelNormalizationProvider } from "../../src/pipeline/model-providers.js"
import { createOpenAITransport } from "../../src/pipeline/openai-transport.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_MODEL
if (!API_KEY) throw new Error("OPENAI_API_KEY is not set.")
if (!MODEL) throw new Error('OPENAI_MODEL is not set, e.g. OPENAI_MODEL="gpt-5.4-mini".')

const runs = Number(arg("--runs") ?? "12")
const fixture = arg("--fixture") ?? "sparse"

const contractText = [
  "schema/version.ts",
  "schema/common.ts",
  "schema/source-snapshot.ts",
  "schema/canonical-recipe.ts",
]
  .map((rel) => `// ==== ${rel} ====\n${readFileSync(join(repoRoot, rel), "utf8")}`)
  .join("\n\n")

const snapshot = JSON.parse(
  readFileSync(join(here, "fixtures", `${fixture}.snapshot.json`), "utf8"),
) as SourceSnapshot

async function main(): Promise<void> {
  let calls = 0
  let inputTokens = 0
  let outputTokens = 0
  const inner = createOpenAITransport({ apiKey: API_KEY as string, model: MODEL as string })
  const transport = {
    async send(exchange: Parameters<typeof inner.send>[0]) {
      const reply = await inner.send(exchange)
      calls += 1
      inputTokens += reply.usage?.inputTokens ?? 0
      outputTokens += reply.usage?.outputTokens ?? 0
      return reply
    },
  }

  const attemptsSeen: { attempt: number; repairing?: string }[] = []
  const provider = createModelNormalizationProvider({
    transport,
    promptText: readFileSync(join(repoRoot, "prompts/normalization/v1.md"), "utf8"),
    contractText,
    onAttempt: (info) => attemptsSeen.push({ attempt: info.attempt, ...(info.repairing !== undefined ? { repairing: info.repairing } : {}) }),
  })

  console.log(`# retry probe — ${MODEL}, fixture ${fixture}, ${runs} conversion(s)\n`)
  let firstTryOk = 0
  let repaired = 0
  let stillFailed = 0

  for (let i = 1; i <= runs; i++) {
    const before = attemptsSeen.length
    try {
      await provider.normalize(snapshot, {
        runId: `retry-probe-${i}`,
        targetOntologyVersion: "1.0.0",
        normalizationModel: MODEL as string,
        normalizationPromptVersions: ["normalization/v1"],
      })
      const spent = attemptsSeen.length - before
      if (spent === 1) {
        firstTryOk++
        console.log(`  ${String(i).padStart(2)}  ok on the first attempt`)
      } else {
        repaired++
        console.log(`  ${String(i).padStart(2)}  REPAIRED after ${spent} attempts`)
        console.log(`      first failure: ${attemptsSeen[before + 1]?.repairing ?? "?"}`)
      }
    } catch (err) {
      stillFailed++
      console.log(`  ${String(i).padStart(2)}  STILL FAILED: ${(err as Error).message.slice(0, 160)}`)
    }
  }

  console.log(`\nConversions: ${runs}`)
  console.log(`  conformed on the first attempt: ${firstTryOk}`)
  console.log(`  repaired by the retry:          ${repaired}`)
  console.log(`  still failed after the retry:   ${stillFailed}`)
  console.log(
    `Cost: ${calls} calls, ${inputTokens.toLocaleString()} input + ${outputTokens.toLocaleString()} output tokens`,
  )
  const withoutRetry = firstTryOk
  console.log(
    `Without the retry this run would have delivered ${withoutRetry}/${runs} recipes; with it, ${firstTryOk + repaired}/${runs}.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
