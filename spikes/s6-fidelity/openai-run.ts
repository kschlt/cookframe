/**
 * CFV1-S6 — OpenAI confirming run (spike, OQ-24).
 *
 * The Claude-side prototyping loop (subagents as "the model") already answered
 * OQ-24 on Claude models cost-free. This script runs the SAME prompts and inputs
 * against the production provider (OpenAI) so the finding can be confirmed on the
 * model that will actually run in production — model behaviour does not transfer
 * 1:1, so a prompt tuned on Claude gets a confirming run on OpenAI before we
 * trust it (see prompts/README.md "Prototyping vs. production").
 *
 * It writes run files into runs/ using the SAME naming the scorer consumes, so
 * after this runs you just do:  npx tsx spikes/s6-fidelity/score.ts
 *
 * PREREQUISITES (why this is "startklar" but not yet run):
 *   - OPENAI_API_KEY must be set in the environment (Kornelius adds it in the
 *     next run; deliberately absent now to avoid unnecessary key exposure).
 *   - OPENAI_MODEL selects the model id (e.g. "gpt-4o-2024-11-20"); set it to
 *     whatever the OpenAI project "Cookframe" should be measured on.
 *   - No SDK dependency: uses global fetch against the REST API, so nothing is
 *     added to package.json for a spike.
 *
 * USAGE (next session, key present):
 *   OPENAI_MODEL=<model-id> npx tsx spikes/s6-fidelity/openai-run.ts
 *   OPENAI_MODEL=<model-id> npx tsx spikes/s6-fidelity/openai-run.ts --runs 3
 *   # then: npx tsx spikes/s6-fidelity/score.ts
 *
 * It measures, per successful call, wall-clock latency and token usage (printed
 * and written into each run file's sibling .meta.json), which is the cost/latency
 * half of OQ-24 that the Claude-side pass could not produce.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")
const fixturesDir = join(here, "fixtures")
const runsDir = join(here, "runs")

const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OPENAI_MODEL
const RUNS = (() => {
  const i = process.argv.indexOf("--runs")
  return i >= 0 && process.argv[i + 1] ? Math.max(1, Number(process.argv[i + 1])) : 1
})()

if (!API_KEY) {
  console.error("OPENAI_API_KEY is not set. Add it to the environment, then re-run. (See file header.)")
  process.exit(2)
}
if (!MODEL) {
  console.error('OPENAI_MODEL is not set. Example: OPENAI_MODEL="gpt-4o-2024-11-20" npx tsx spikes/s6-fidelity/openai-run.ts')
  process.exit(2)
}
// A short, filename-safe model label for the run-file naming (<shape>__<fixture>__<model>__runNN).
const MODEL_LABEL = `openai-${MODEL.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 24)}`

function read(p: string): string {
  return readFileSync(p, "utf8")
}

const schemaBundle = [
  ["schema/version.ts", read(join(repoRoot, "schema/version.ts"))],
  ["schema/common.ts", read(join(repoRoot, "schema/common.ts"))],
  ["schema/source-snapshot.ts", read(join(repoRoot, "schema/source-snapshot.ts"))],
  ["schema/canonical-recipe.ts", read(join(repoRoot, "schema/canonical-recipe.ts"))],
]
  .map(([name, body]) => `// ==== ${name} ====\n${body}`)
  .join("\n\n")

type Shape = "capture" | "normalization" | "combined"

interface Job {
  readonly shape: Shape
  readonly fixture: string
  readonly promptFile: string
  readonly inputLabel: string
  readonly input: string
  /** which schemas are in force, described for the system prompt */
  readonly contract: string
}

const FIXTURES = ["freetext-heavy", "sparse", "multi-component"] as const

function buildJobs(): Job[] {
  const jobs: Job[] = []
  for (const fx of FIXTURES) {
    const source = read(join(fixturesDir, `${fx}.source.txt`))
    const snapshot = read(join(fixturesDir, `${fx}.snapshot.json`))
    jobs.push({
      shape: "capture",
      fixture: fx,
      promptFile: "prompts/capture/v1.md",
      inputLabel: "RAW SOURCE",
      input: source,
      contract:
        "Output a single SourceSnapshot JSON object (schema/source-snapshot.ts). sourceType is \"text\".",
    })
    jobs.push({
      shape: "normalization",
      fixture: fx,
      promptFile: "prompts/normalization/v1.md",
      inputLabel: "SOURCE SNAPSHOT (input)",
      input: snapshot,
      contract:
        "Output a single CanonicalRecipe JSON object (schema/canonical-recipe.ts). schemaVersion must equal SCHEMA_VERSION; every sourceRef.blockId must be an id present in the input snapshot's blocks.",
    })
    jobs.push({
      shape: "combined",
      fixture: fx,
      promptFile: "prompts/combined/v1.md",
      inputLabel: "RAW SOURCE",
      input: source,
      contract:
        'Output a single JSON object {"snapshot": <SourceSnapshot>, "canonical": <CanonicalRecipe>}. canonical.schemaVersion must equal SCHEMA_VERSION; every canonical sourceRef.blockId must be an id you put in the snapshot. snapshot.sourceType is "text".',
    })
  }
  return jobs
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string }
}

async function callOpenAI(system: string, user: string): Promise<{ content: string; usage: ChatResponse["usage"]; ms: number }> {
  const started = Date.now()
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 1,
    }),
  })
  const ms = Date.now() - started
  const json = (await res.json()) as ChatResponse
  if (!res.ok || json.error) {
    throw new Error(`OpenAI ${res.status}: ${json.error?.message ?? "unknown error"}`)
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error("OpenAI returned no message content")
  return { content, usage: json.usage, ms }
}

function systemPrompt(job: Job): string {
  const prompt = read(join(repoRoot, job.promptFile))
  return [
    "You are one stage of a recipe-processing pipeline. Follow the STAGE INSTRUCTIONS exactly and emit only the JSON output they require. No prose, no markdown fence.",
    "",
    "=== STAGE INSTRUCTIONS ===",
    prompt,
    "",
    "=== OUTPUT CONTRACT (authoritative Zod schema; every object is .strict() — unknown keys are a failure) ===",
    schemaBundle,
    "",
    "=== THIS CALL ===",
    job.contract,
  ].join("\n")
}

async function main(): Promise<void> {
  const jobs = buildJobs()
  console.log(`# CFV1-S6 OpenAI run — model ${MODEL} (label ${MODEL_LABEL}), ${RUNS} run(s) x ${jobs.length} cells`)
  for (const job of jobs) {
    for (let r = 1; r <= RUNS; r++) {
      const runNo = String(r).padStart(2, "0")
      const base = `${job.shape}__${job.fixture}__${MODEL_LABEL}__run${runNo}`
      const outPath = join(runsDir, `${base}.json`)
      const user = `${job.inputLabel}:\n${job.input}`
      try {
        const { content, usage, ms } = await callOpenAI(systemPrompt(job), user)
        // Persist the model's JSON verbatim (strip an accidental fence if present).
        const cleaned = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
        writeFileSync(outPath, `${cleaned}\n`)
        writeFileSync(
          join(runsDir, `${base}.meta.json`),
          `${JSON.stringify({ model: MODEL, shape: job.shape, fixture: job.fixture, run: runNo, latencyMs: ms, usage }, null, 2)}\n`,
        )
        console.log(`  ok   ${base}  ${ms}ms  tokens=${usage?.total_tokens ?? "?"}`)
      } catch (err) {
        console.error(`  FAIL ${base}  ${(err as Error).message}`)
      }
    }
  }
  console.log("\nDone. Score with: npx tsx spikes/s6-fidelity/score.ts")
  console.log("(.meta.json sidecars carry latency + token usage — the cost/latency half of OQ-24.)")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
