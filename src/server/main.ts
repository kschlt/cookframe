/**
 * The process an operator runs (CFV1-RUN).
 *
 * This is the composition root and nothing else: it reads the environment
 * exactly once, constructs the real store, the real providers and the two
 * credentials, hands them to {@link startInstance}, and arranges for a signal to
 * stop it. It binds no socket itself — {@link startInstance} is the one place
 * that does — and it contains no routing, no policy and no rule that a proof
 * would want to check without starting a process.
 *
 * **Why it fails rather than defaults.** `readConfiguration` refuses an absent
 * value by name (see `config.ts`), and this file does not catch that. An
 * instance that starts with a missing credential is an instance whose operator
 * finds out from the wrong 401, or from a library anyone can read; one that
 * refuses to start says which variable to set and costs a restart.
 *
 * Run it with `npm start`.
 */
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInstanceCredential } from "../http/instance-credential.js"
import { createProvisionalStore } from "../persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../pipeline/block-id-policy.js"
import {
  createModelCaptureProvider,
  createModelNormalizationProvider,
} from "../pipeline/model-providers.js"
import { createOpenAITransport } from "../pipeline/openai-transport.js"
import { createInMemoryCapabilityStore } from "../shopping/capability-token.js"
import { readConfiguration } from "./config.js"
import { startInstance } from "./instance.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * The contract handed to the model verbatim — the `schema/` source itself, never
 * a prompt's restatement of it (`prompts/README.md`, recipe-ontology §5).
 */
const CONTRACT_FILES = [
  "schema/version.ts",
  "schema/common.ts",
  "schema/source-snapshot.ts",
  "schema/canonical-recipe.ts",
]

/** The ontology version a normalization run targets. */
const TARGET_ONTOLOGY_VERSION = "1.0.0"

async function main(): Promise<void> {
  const config = readConfiguration(process.env)

  // One provider is supported today and an unrecognised name is refused rather
  // than falling through to a default: an instance configured for a provider it
  // does not have should not start and quietly use another one's key.
  if (config.modelProvider !== "openai") {
    throw new Error(
      `MODEL_PROVIDER is ${JSON.stringify(config.modelProvider)}, and this build can only ` +
        "construct openai. Set MODEL_PROVIDER=openai or add the provider.",
    )
  }

  const contractText = CONTRACT_FILES.map(
    (rel) => `// ==== ${rel} ====\n${readFileSync(join(repoRoot, rel), "utf8")}`,
  ).join("\n\n")
  const transport = createOpenAITransport({ apiKey: config.modelApiKey, model: config.model })

  // ONE repository, constructed here and shared by every path (ADR-0018, and
  // `run/one-store-per-process`). The provisional in-memory store is what the
  // tree carries today; CFV1-PG replaces this single expression with its own
  // factory and hands back a handle whose `close` becomes `closeStore` below.
  const repo = createProvisionalStore()

  const instance = await startInstance(
    {
      repo,
      capabilityStore: createInMemoryCapabilityStore(),
      ingestCredential: createInstanceCredential(config.ingestCredential, "ingest credential"),
      libraryCredential: createInstanceCredential(config.libraryCredential, "library credential"),
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
      policy: createContentDerivedBlockIdPolicy(),
      identity: {
        newSnapshotId: () => randomUUID(),
        newCaptureRunId: () => randomUUID(),
        newNormalizationRunId: () => randomUUID(),
      },
      targetOntologyVersion: TARGET_ONTOLOGY_VERSION,
      sourceAdapter: "ios-shortcut",
      adapterVersion: "1.0.0",
    },
    config.port,
  )

  // Printed on one line, in a shape a proof can wait for. A process that has
  // bound its port and a process that is still starting look identical from
  // outside, and polling a port until it answers is how a flaky test is written.
  console.log(`cookframe listening on port ${instance.port}`)

  let stopping = false
  const stop = (signal: string): void => {
    if (stopping) return
    stopping = true
    console.log(`cookframe stopping on ${signal}`)
    instance
      .stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error)
        process.exit(1)
      })
  }
  // SIGTERM is what a container runtime sends; SIGINT is Ctrl-C. Both mean the
  // same thing here, and the operating model this has to tolerate — started on a
  // request, stopped when idle — makes the second one the common case.
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}

main().catch((error: unknown) => {
  // The refusal is the message. A stack trace above a "PORT is not set" line is
  // noise to the one person who reads this, so the message goes out alone.
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
