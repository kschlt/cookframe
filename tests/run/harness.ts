/**
 * Shared scaffolding for the CFV1-RUN proofs.
 *
 * Every suite here talks to a REAL socket. That is the whole point of the unit:
 * nineteen pull requests of `app.request(...)` could not have found the defect
 * this one found on its first smoke run, because the code that broke lives in
 * the adapter between a Hono response and a Node socket. So nothing in this
 * folder mounts an app in process — it starts one, fetches over TCP, and stops
 * it.
 *
 * The recipes are synthetic and self-authored, like every fixture in this
 * repository (the public-repo content rule), and validated with
 * `CanonicalRecipe.parse` so a contract change breaks them here rather than
 * somewhere subtler.
 */
import { CanonicalRecipe, SCHEMA_VERSION } from "../../schema/index.js"
import { createInstanceCredential } from "../../src/http/instance-credential.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import {
  createFakeCaptureProvider,
  createFakeNormalizationProvider,
} from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider } from "../../src/pipeline/providers.js"
import {
  type InstanceDeps,
  type RunningInstance,
  startInstance,
} from "../../src/server/instance.js"
import {
  type CapabilityStore,
  createInMemoryCapabilityStore,
} from "../../src/shopping/capability-token.js"

/** Two DIFFERENT secrets, because PDR-0003 says the phone's does not open the library. */
export const INGEST_CREDENTIAL = "ingest-0123456789abcdef0123456789abcdef"
export const LIBRARY_CREDENTIAL = "library-0123456789abcdef0123456789abcdef"

/** A complete, schema-valid synthetic Canonical Recipe; `id`/`title` vary per call. */
export const canonical = (id: string, title: string): CanonicalRecipe =>
  CanonicalRecipe.parse({
    id,
    schemaVersion: SCHEMA_VERSION,
    title: { state: "from_source", sourceText: title, sourceRefs: [{ blockId: "b-title" }] },
    authors: ["Fixture Author"],
    yields: [
      {
        id: "y-1",
        sourceText: "1 loaf",
        scalingEligibility: "unknown",
        unit: "loaf",
        valueExpression: { sourceText: "1 loaf", kind: "exact", value: 1 },
        sourceRefs: [{ blockId: "b-yield" }],
      },
    ],
    ingredientGroups: [
      {
        id: "ig-1",
        sourceRefs: [{ blockId: "b-ing" }],
        ingredients: [
          {
            id: "ing-1",
            sourceText: "200 g flour",
            name: "flour",
            qualifiers: [],
            scalingEligibility: "proportional",
            sourceRefs: [{ blockId: "b-ing" }],
          },
        ],
      },
    ],
    instructionSections: [
      {
        id: "is-1",
        sourceRefs: [{ blockId: "b-step" }],
        steps: [
          {
            id: "step-1",
            sourceText: "Mix and bake.",
            normalizedActionText: "Mix and bake.",
            sourceRefs: [{ blockId: "b-step" }],
            ingredientUses: [],
            componentUses: [],
            equipmentUses: [],
            producesComponents: [],
            durations: [],
            temperatures: [],
            donenessCues: [],
            prerequisiteCues: [],
            waitCues: [],
          },
        ],
      },
    ],
    provenance: {
      sourceSnapshotId: "snap-1",
      sourceSnapshotVersion: 0,
      targetOntologyVersion: "1.0.0",
      runId: "run-1",
    },
  })

/** What a started test instance hands back: the address, the pieces, the stop. */
export interface TestInstance extends RunningInstance {
  readonly repo: ReturnType<typeof createProvisionalStore>
  readonly capabilityStore: CapabilityStore
  /** `http://127.0.0.1:<port>` — the origin every fetch in these suites uses. */
  readonly origin: string
  /** Records each time the store handle was closed, for the stop proofs. */
  readonly closed: { count: number }
}

/** Options a single proof varies; everything else is the same instance every time. */
export interface TestInstanceOptions {
  /** Replaces the deterministic fake — a slow one, for the stop proof. */
  readonly capture?: CaptureProvider
}

/**
 * Start a real instance on an OS-assigned port, with deterministic providers and
 * no API key. Port `0` rather than a number: several suites run at once and a
 * chosen port is a flake waiting for a busy machine.
 */
export async function startTestInstance(options: TestInstanceOptions = {}): Promise<TestInstance> {
  const repo = createProvisionalStore()
  const capabilityStore = createInMemoryCapabilityStore()
  const closed = { count: 0 }
  let n = 0

  const deps: InstanceDeps = {
    repo,
    capabilityStore,
    ingestCredential: createInstanceCredential(INGEST_CREDENTIAL, "ingest credential"),
    libraryCredential: createInstanceCredential(LIBRARY_CREDENTIAL, "library credential"),
    capture: options.capture ?? createFakeCaptureProvider(),
    normalization: createFakeNormalizationProvider(),
    policy: createContentDerivedBlockIdPolicy(),
    identity: {
      newSnapshotId: () => `snap-${++n}`,
      newCaptureRunId: () => `capture-${n}`,
      newNormalizationRunId: () => `normalize-${n}`,
    },
    targetOntologyVersion: "1.0.0",
    sourceAdapter: "ios-shortcut",
    adapterVersion: "1.0.0",
    closeStore: async () => {
      closed.count += 1
    },
  }

  const running = await startInstance(deps, 0)
  return {
    ...running,
    repo,
    capabilityStore,
    closed,
    origin: `http://127.0.0.1:${running.port}`,
  }
}

/** The submission the ingest route accepts, as the fake capture provider reads it. */
export const captureBody = (title: string, step = "Mix and bake."): Uint8Array =>
  new TextEncoder().encode(`${title}\n\n${step}`)

/** The three fields that must match for two responses to be indistinguishable. */
export async function shapeOf(res: Response): Promise<{
  status: number
  contentType: string | null
  body: string
}> {
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  }
}
