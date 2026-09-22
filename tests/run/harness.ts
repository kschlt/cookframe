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
import { createServer } from "node:net"
import { CanonicalRecipe, SCHEMA_VERSION } from "../../schema/index.js"
import { createInstanceCredential } from "../../src/http/instance-credential.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import {
  createFakeCaptureProvider,
  createFakeNormalizationProvider,
} from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider } from "../../src/pipeline/providers.js"
import type { UrlByteSource } from "../../src/security/url-byte-source.js"
import {
  type InstanceDeps,
  type RunningInstance,
  startInstance,
} from "../../src/server/instance.js"
import {
  type CapabilityStore,
  createInMemoryCapabilityStore,
} from "../../src/shopping/capability-token.js"
import type { ByteStore } from "../../src/storage/index.js"
import { unsuppliedByteSource, unsuppliedUrlCapture } from "../security/unsupplied-byte-source.js"
import { scratchByteStore } from "../support/scratch-byte-store.js"

/**
 * Two DIFFERENT secrets, because PDR-0003 says the phone's does not open the
 * library — ASSEMBLED rather than written down.
 *
 * The literals they replace failed `secret-scan` on this branch: gitleaks
 * matched them as `generic-api-key` at entropy 4.39, and it was right to. A
 * credential-shaped literal in a public repository is one a scanner cannot tell
 * from a real secret, which is the same reason the SL5 spike mints its
 * throwaway credential instead of committing one, and the reason the CI step
 * that starts the runtime image mints its two. Suppressing the finding would
 * have taught the scanner to ignore the shape it exists to catch.
 *
 * Long enough for `createInstanceCredential` (32), and obviously not secrets.
 */
const testCredential = (purpose: string): string => `${purpose}-${"not-a-secret-".repeat(3)}`
export const INGEST_CREDENTIAL = testCredential("ingest")
export const LIBRARY_CREDENTIAL = testCredential("library")

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
  /**
   * Replaces the in-memory store — a counting one, for the handoff proof that
   * has to show a refused request minted NOTHING. The store offers no
   * enumeration (ADR-0016), so from outside a token nobody was told about is
   * invisible; only the call itself can be seen.
   */
  readonly capabilityStore?: CapabilityStore
  /**
   * Configure `PUBLIC_BASE_URL` as the instance's REAL address, so a capability
   * URL it mints is one a proof can fetch.
   *
   * Opt-in, and the reason is the port. The address is configuration — the
   * operator tells the instance where it answers, because nothing in the process
   * can work that out — and it is composed into the app before the socket is
   * bound. Every other proof here binds port `0` and learns its port afterwards,
   * which is too late for this value. So a proof that needs it pays for a port
   * found by binding one and letting go (`freePort`), with the small race that
   * carries, and no other proof does.
   */
  readonly servesItsOwnAddress?: boolean
  /** Used by {@link testInstanceDeps} directly; `startTestInstance` sets it itself. */
  readonly publicBaseUrl?: string
  /**
   * The egress seam the URL route fetches through. A proof that imports a link
   * passes the REAL safe-fetch-backed source with `allowLoopback`, so it goes
   * through the same code a production instance runs; the default below is for
   * the proofs that never touch the URL address.
   */
  readonly byteSource?: UrlByteSource
  /**
   * The capture path the URL route runs through. A proof about the URL route
   * passes what `main.ts` composes — the deterministic reader with a model
   * fallback — rather than the deterministic reader alone, because the
   * composite is what a running instance has and the difference between the two
   * is exactly what the review's BLOCK was about.
   */
  readonly urlCapture?: CaptureProvider
  /**
   * Where the photo route keeps what it is sent. The default is the shipped
   * filesystem store on a directory of its own (`tests/support/scratch-byte-store.ts`);
   * a proof about keeping photographs passes a store on a directory it reads.
   */
  readonly scanStore?: ByteStore
}

/**
 * Start a real instance on an OS-assigned port, with deterministic providers and
 * no API key. Port `0` rather than a number: several suites run at once and a
 * chosen port is a flake waiting for a busy machine.
 */
export async function startTestInstance(options: TestInstanceOptions = {}): Promise<TestInstance> {
  const port = options.servesItsOwnAddress === true ? await freePort() : 0
  const built = testInstanceDeps({
    ...options,
    ...(port === 0 ? {} : { publicBaseUrl: `http://127.0.0.1:${port}` }),
  })
  const running = await startInstance(built.deps, port)
  return {
    ...running,
    repo: built.repo,
    capabilityStore: built.capabilityStore,
    closed: built.closed,
    origin: `http://127.0.0.1:${running.port}`,
  }
}

/** What {@link testInstanceDeps} hands back: the deps, and the pieces to look into. */
export interface TestInstanceParts {
  readonly deps: InstanceDeps
  readonly repo: ReturnType<typeof createProvisionalStore>
  readonly capabilityStore: CapabilityStore
  readonly closed: { count: number }
}

/**
 * The public address an instance is configured with when a proof does not ask
 * for its real one.
 *
 * Deliberately a name that resolves nowhere (`.invalid` is reserved for exactly
 * that): a proof that minted a capability URL and then fetched it without asking
 * for {@link TestInstanceOptions.servesItsOwnAddress} fails loudly with a lookup
 * error, rather than quietly reaching something else.
 */
export const UNBOUND_PUBLIC_BASE_URL = "https://unbound.invalid"

/**
 * The same collaborators {@link startTestInstance} runs on, without binding a
 * port — so a proof about the COMPOSITION rather than about the socket can call
 * `composeInstance` directly and still be looking at what the process serves.
 */
export function testInstanceDeps(options: TestInstanceOptions = {}): TestInstanceParts {
  const repo = createProvisionalStore()
  const capabilityStore = options.capabilityStore ?? createInMemoryCapabilityStore()
  const closed = { count: 0 }
  let n = 0

  const deps: InstanceDeps = {
    repo,
    capabilityStore,
    publicBaseUrl: options.publicBaseUrl ?? UNBOUND_PUBLIC_BASE_URL,
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
    scanStore: options.scanStore ?? scratchByteStore().store,
    byteSource: options.byteSource ?? unsuppliedByteSource(),
    urlCapture: options.urlCapture ?? unsuppliedUrlCapture(),
    urlSourceAdapter: "url-import",
    urlAdapterVersion: "1.0.0",
    closeStore: async () => {
      closed.count += 1
    },
    // The source the proof supplied is the one released. A default source holds
    // no pool — it refuses rather than fetching — so there is nothing to close.
    closeByteSource: async () => {
      await options.byteSource?.close()
    },
  }

  return { deps, repo, capabilityStore, closed }
}

/**
 * A port nobody is on, found by binding one and letting go.
 *
 * `PORT=0` would be simpler and is deliberately refused by the configuration: an
 * operator who sets it gets an instance on a port they cannot predict, which is
 * indistinguishable from one that did not start. The proof carries the cost of
 * that strictness rather than loosening the rule to suit itself.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      if (address === null || typeof address === "string") {
        probe.close()
        reject(new Error("could not obtain a free port"))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
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
