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
import {
  createPostgresStore,
  resolveDatabaseUrl,
  StoreNotMigratedError,
} from "../persistence/index.js"
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
  // `run/one-store-per-process`). CFV1-PG made this the durable store: what an
  // instance keeps now survives the process that wrote it, which is what makes
  // `SIGTERM` a stop rather than a loss.
  //
  // `DATABASE_URL` is deliberately NOT in `REQUIRED_CONFIGURATION`. The store's
  // own seam reads it and refuses by name (`resolveDatabaseUrl`, which also
  // rejects a URL no PostgreSQL driver can connect with — something a list of
  // required names cannot check), and one variable refused in two places is two
  // places to keep in step. The cost is that this refusal arrives a few lines
  // after the configuration one instead of with it; both exit non-zero naming
  // the variable, which is what an operator needs.
  const store = createPostgresStore(resolveDatabaseUrl())
  const repo = store.repository

  // The store is USED once before the port is bound, and that is a decision
  // rather than a warm-up (ADR-0027).
  //
  // `pg` connects lazily, so a store pointed at a database with no tables in it
  // constructs perfectly and fails on the first request that needs one. An
  // instance that binds, answers its miss, and returns 500 from every page is
  // the failure shape this project refuses everywhere else it can: configured
  // wrongly, running anyway, discovered by a user. `StoreNotMigratedError` says
  // "before starting the instance", which is a promise only this line can keep —
  // CFV1-PG could raise it, but nothing was reading it at a start.
  //
  // The probe is a real operation, not `select 1`: a query invented here could
  // pass against a database where every operation the instance actually performs
  // fails. It is the cheapest read the repository has.
  //
  // ONE read per migration-backed area, because `migrations/` holds more than
  // one file and a database can be half-migrated. `listLibrary` reaches the
  // recipe store (`0001`) and `loadCookingPlan` the plan store (`0002`); an
  // instance that came up on `0001` alone would serve its library and answer
  // every cooking route with a 500, which is the same failure one migration
  // further along. Absence is a return value for both, so neither needs a
  // fixture and neither costs more than a round trip.
  //
  // The cost, stated: the process now needs its database reachable to come up at
  // all, so a restart during an outage leaves the instance down rather than up
  // and failing. For a single-user instance an operator restarts themselves
  // (PDR-0002), down-and-saying-why is the better of the two, and it is the same
  // trade `resolveDatabaseUrl` already made by refusing an absent URL.
  try {
    await repo.listLibrary()
    // An id nothing can hold: the answer is always `undefined`, so what this
    // measures is only whether the table it reads can be read at all.
    await repo.loadCookingPlan("startup-probe", 1)
  } catch (error) {
    await store.close().catch(() => {})
    if (error instanceof StoreNotMigratedError) throw error
    throw new Error(
      `the database at DATABASE_URL could not be read, so the instance has nowhere to keep its ` +
        `library: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

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
      // Released after the server has stopped accepting and drained, never
      // before: a pool closed while a request is still in flight turns a clean
      // stop into a half-written one. `run/a-stop-leaves-nothing-half-written`
      // proves that ORDER, but against the harness's own counter rather than
      // this pool — the stop handler below calls `process.exit(0)`, which makes
      // a drained pool and a leaked one indistinguishable from outside. What
      // guards THIS line is a text assertion in `run/only-the-entry-point-binds`,
      // and it says as much rather than reading like a behavioural one.
      closeStore: () => store.close(),
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
