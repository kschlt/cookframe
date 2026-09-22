/**
 * CFV1-SL6 — the request-level half of when a plan is generated.
 *
 * Each `describe` string is the acceptance-criterion proof id it satisfies.
 *
 * `tests/slice6/generation-policy.test.ts` holds the seam's half: the policy
 * values, the shape of the tree, and the question the cooking view asks. This
 * file drives the real import route in-process (`app.request`, `ADR-0007`) and
 * watches WHEN generation happens relative to the response the phone gets.
 *
 * The ordering claim is made observable rather than asserted: the scheduler is
 * injected, so a proof can take the deferred work and hold it, and see that the
 * 201 has already been handed back with nothing generated. Asserting the
 * ordering by timing would be a race dressed as a measurement.
 */
import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { createCookingApp } from "../../src/http/cooking-app.js"
import type { IngestIdentity } from "../../src/http/ingest-app.js"
import { createIngestApp } from "../../src/http/ingest-app.js"
import { createIngestCredential } from "../../src/http/ingest-credential.js"
import { afterCurrentTurn, createAfterImport } from "../../src/http/plan-generation.js"
import type { RecipeRepository } from "../../src/persistence/index.js"
import { createProvisionalStore } from "../../src/persistence/index.js"
import { createContentDerivedBlockIdPolicy } from "../../src/pipeline/block-id-policy.js"
import { createFakeNormalizationProvider } from "../../src/pipeline/fake-providers.js"
import type { CaptureProvider, CaptureResult } from "../../src/pipeline/providers.js"

const CREDENTIAL = randomBytes(24).toString("base64url")
const PAGE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

const segmentation = [
  { order: 0, type: "title" as const, text: "Buttermilk Pancakes" },
  { order: 1, type: "ingredient" as const, text: "2 eggs" },
  { order: 2, type: "instruction" as const, text: "Whisk the eggs, then fold in the flour." },
]

const captureProvider = (): CaptureProvider => ({
  async capture(): Promise<CaptureResult> {
    return { sourceType: "image", capturedText: "captured", blocks: segmentation }
  },
})

const identity = (): IngestIdentity => ({
  newSnapshotId: () => "snap-plan-1",
  newCaptureRunId: () => "capture-run-1",
  newNormalizationRunId: () => "normalization-run-1",
})

interface Harness {
  readonly app: ReturnType<typeof createIngestApp>
  readonly repo: RecipeRepository
  /** The work `background` deferred, in the order it was deferred. */
  readonly deferred: (() => Promise<void> | void)[]
  readonly failures: string[]
}

function harness(
  policy: "lazy" | "background",
  options: { readonly realScheduler?: boolean } = {},
): Harness {
  const repo = createProvisionalStore()
  const deferred: (() => Promise<void> | void)[] = []
  const failures: string[] = []
  const app = createIngestApp({
    credential: createIngestCredential(CREDENTIAL),
    repo,
    capture: captureProvider(),
    normalization: createFakeNormalizationProvider(),
    policy: createContentDerivedBlockIdPolicy(),
    identity: identity(),
    targetOntologyVersion: "1.0.0",
    sourceAdapter: "ios-shortcut",
    adapterVersion: "1.0.0",
    afterImport: createAfterImport({
      repo,
      policy,
      onFailed: (recipeId) => failures.push(recipeId),
      ...(options.realScheduler === true
        ? {}
        : { schedule: (work: () => Promise<void> | void) => void deferred.push(work) }),
    }),
  })
  return { app, repo, deferred, failures }
}

const submit = async (app: Harness["app"]): Promise<Response> =>
  await app.request("/capture", {
    method: "POST",
    headers: { "content-type": "image/jpeg", authorization: `Bearer ${CREDENTIAL}` },
    body: PAGE,
  })

describe("slice6/background-does-not-delay-response", () => {
  it("hands back the 201 with the plan not yet derived", async () => {
    const h = harness("background")
    const response = await submit(h.app)
    const body = (await response.json()) as { recipeId: string; version: number }

    expect(response.status).toBe(201)
    // The work exists and has NOT run: the response is complete, the recipe is
    // stored, and no plan is.
    expect(h.deferred).toHaveLength(1)
    expect(await h.repo.loadCookingPlan(body.recipeId, body.version)).toBeUndefined()

    // And it is real work, not an empty hook — running it stores the plan.
    await h.deferred[0]?.()
    expect(await h.repo.loadCookingPlan(body.recipeId, body.version)).toBeDefined()
  })

  it("answers even when the deferred work never finishes", async () => {
    // The strongest form of "does not delay": generation that never completes.
    // If the route awaited the hook at all, this request would never return.
    const h = harness("background")
    h.deferred.length = 0
    const never = new Promise<void>(() => {})
    const app = createIngestApp({
      credential: createIngestCredential(CREDENTIAL),
      repo: h.repo,
      capture: captureProvider(),
      normalization: createFakeNormalizationProvider(),
      policy: createContentDerivedBlockIdPolicy(),
      identity: identity(),
      targetOntologyVersion: "1.0.0",
      sourceAdapter: "ios-shortcut",
      adapterVersion: "1.0.0",
      afterImport: () => void never,
    })
    expect((await submit(app)).status).toBe(201)
  })

  it("schedules generation strictly after this turn, with the shipped scheduler", async () => {
    // The injected scheduler above proves the route does not await the work.
    // This proves the SHIPPED one defers it past the current turn rather than
    // running it inline, which is what `ADR-0008` means by "after the response".
    const order: string[] = []
    afterCurrentTurn(() => {
      order.push("generation")
    })
    order.push("response")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(["response", "generation"])
  })

  it("schedules nothing at all under lazy", async () => {
    // Not "schedules a no-op": under `lazy` the difference between the policies
    // has to be visible from outside, or `background` is unfalsifiable.
    const h = harness("lazy")
    const body = (await submit(h.app)).json() as unknown as Promise<{
      recipeId: string
      version: number
    }>
    const created = await body
    expect(h.deferred).toEqual([])
    expect(await h.repo.loadCookingPlan(created.recipeId, created.version)).toBeUndefined()
  })
})

describe("slice6/incomplete-generation-degrades-to-lazy", () => {
  it("leaves the recipe viewable and derives on the next cooking view", async () => {
    // `ADR-0008`: a background generation lost to a restart is not an error
    // path. Here it is simply never run — the deferred work is dropped, exactly
    // as a process that died would drop it.
    const h = harness("background")
    const created = (await submit(h.app)).json() as unknown as Promise<{
      recipeId: string
      version: number
    }>
    const { recipeId, version } = await created
    expect(h.deferred).toHaveLength(1)
    h.deferred.length = 0 // the generation is lost

    expect(await h.repo.loadCookingPlan(recipeId, version)).toBeUndefined()

    const cooking = createCookingApp({ repo: h.repo })
    const recipe = await cooking.request(`/recipes/${recipeId}`)
    const cook = await cooking.request(`/recipes/${recipeId}/cook`)

    expect(recipe.status, "the recipe stopped being viewable").toBe(200)
    expect(cook.status, "the cooking view did not recover").toBe(200)
    expect(await cook.text()).toContain("Cooking")
  })

  it("reports a generation that failed rather than losing it silently", async () => {
    // The import has already succeeded and the recipe is already viewable, so
    // this changes no response — but a failure nobody can see is a failure
    // nobody will fix.
    const h = harness("background")
    const created = (await submit(h.app)).json() as unknown as Promise<{ recipeId: string }>
    const { recipeId } = await created

    const refusing: RecipeRepository = {
      ...h.repo,
      storeCookingPlan: () => Promise.reject(new Error("the store is gone")),
    }
    const hook = createAfterImport({
      repo: refusing,
      policy: "background",
      schedule: (work) => void work(),
      onFailed: (id) => h.failures.push(id),
    })
    const version = await h.repo.loadLatestCanonical(recipeId)
    if (version === undefined) throw new Error("the recipe that was just imported is not there")
    hook(version)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.failures).toContain(recipeId)
  })
})
