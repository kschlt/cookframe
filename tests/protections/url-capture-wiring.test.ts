/**
 * serve/a-url-import-runs-the-url-capture-path — the capability behind the door
 * is the one that was built.
 *
 * The rule and its limits are stated in `url-capture-wiring.ts`. This file is the
 * rule's BREADTH: each table row names the substitution it exists to stop, and
 * the load-bearing cases hold the exact two spellings that shipped as the defect
 * — the route reading `deps.capture`, and the composition root giving the URL
 * field the model provider directly.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { collaboratorsPassedTo, fieldsAssignedIn } from "./url-capture-wiring.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf8")

/** The route as it shipped broken, kept as a fixture so the rule is measured against it. */
const ROUTE_BEFORE = `
const app = new Hono()
app.post("/capture/url", async (c) => {
  const result = await importFromUrl(
    { byteSource: deps.byteSource, repo: deps.repo, capture: deps.capture },
    url,
    ctx,
  )
  return c.json(result, 201)
})
`

/** The same route, wired the way the composition root now supports. */
const ROUTE_AFTER = ROUTE_BEFORE.replace("capture: deps.capture", "capture: deps.urlCapture")

/** The photo route, which legitimately passes `deps.capture` — to a different call. */
const PHOTO_ROUTE = `
const result = await ingest(deps.repo, deps.capture, deps.normalization, deps.policy, bytes, a, b)
const other = await somethingElse({ capture: deps.capture })
`

describe("serve/a-url-import-runs-the-url-capture-path", () => {
  it("reads the seam the url import is handed, and reads it from that call only", () => {
    expect(
      collaboratorsPassedTo(ROUTE_BEFORE, "importFromUrl").find((f) => f.field === "capture")
        ?.value,
      "the spelling that shipped: the url route reading the photo path's provider",
    ).toBe("deps.capture")
    expect(
      collaboratorsPassedTo(ROUTE_AFTER, "importFromUrl").find((f) => f.field === "capture")?.value,
    ).toBe("deps.urlCapture")

    // A `capture:` elsewhere in the same file is not this rule's business. If it
    // were, the photo route below would make the rule unsatisfiable and the next
    // author would satisfy it by renaming rather than by wiring.
    expect(
      collaboratorsPassedTo(PHOTO_ROUTE, "importFromUrl"),
      "a rule that read the file rather than the call would flag the photo route",
    ).toEqual([])
  })

  it("sees a field built by a call, and what that call was built around", () => {
    const composed = `
      const instance = await startInstance({
        capture: modelCapture,
        urlCapture: createUrlCaptureProvider(createDeterministicUrlCaptureProvider(), modelCapture),
      })
    `
    const fields = fieldsAssignedIn(composed)
    const urlCapture = fields.find((f) => f.field === "urlCapture")
    expect(urlCapture?.callee).toBe("createUrlCaptureProvider")
    expect(urlCapture?.firstArgumentCallee).toBe("createDeterministicUrlCaptureProvider")

    // The photo field is NOT a call, and the detector says so rather than
    // inventing a callee — otherwise `callee === undefined` could not be told
    // from "a call I failed to read".
    expect(fields.find((f) => f.field === "capture")?.callee).toBeUndefined()
  })

  /**
   * The substitutions this rule has to catch, each with what it would cost.
   *
   * Every row is a change someone could plausibly make while believing it is
   * equivalent — which is how the original defect happened, and why a row's
   * `why` is the part that has to survive review rather than the assertion.
   */
  const SUBSTITUTIONS = [
    {
      name: "the url field is given the model provider directly",
      source: `startInstance({ capture: modelCapture, urlCapture: modelCapture })`,
      why: "the shipped defect exactly: reachable route, unreachable capability",
      expect: (f: ReturnType<typeof fieldsAssignedIn>) =>
        expect(f.find((x) => x.field === "urlCapture")?.callee).toBeUndefined(),
    },
    {
      name: "the composite is built around something other than the deterministic reader",
      source: `startInstance({ urlCapture: createUrlCaptureProvider(modelCapture, modelCapture) })`,
      why: "a composite whose first half is the model reads no structured data at all",
      expect: (f: ReturnType<typeof fieldsAssignedIn>) =>
        expect(f.find((x) => x.field === "urlCapture")?.firstArgumentCallee).toBeUndefined(),
    },
    {
      name: "the field is built by a look-alike factory",
      source: `startInstance({ urlCapture: createUrlCaptureProviderish(createDeterministicUrlCaptureProvider()) })`,
      why: "the callee is read by name, so a near-name must not pass for the name",
      expect: (f: ReturnType<typeof fieldsAssignedIn>) =>
        expect(f.find((x) => x.field === "urlCapture")?.callee).not.toBe(
          "createUrlCaptureProvider",
        ),
    },
  ] as const

  it.each(SUBSTITUTIONS)("catches: $name", ({ source, expect: assert }) => {
    assert(fieldsAssignedIn(source))
  })

  it("keeps the table from shrinking to the one case that shipped", () => {
    expect(SUBSTITUTIONS.length).toBeGreaterThan(2)
    expect(new Set(SUBSTITUTIONS.map((s) => s.why)).size).toBe(SUBSTITUTIONS.length)
  })

  /**
   * The real subject: the tree as it is now.
   *
   * The floor comes first and is not decoration. A scan that found NO
   * `importFromUrl` call, or no `urlCapture` field, would satisfy every rule
   * below vacuously — the third recurring shape, a no-op passing because there
   * was nothing to fail on.
   */
  it("hands the url route the url capture path, composed around the deterministic reader", () => {
    const route = collaboratorsPassedTo(
      read("src", "http", "ingest-app.ts"),
      "importFromUrl",
      "src/http/ingest-app.ts",
    )
    expect(
      route.map((f) => f.field),
      "a scan that finds no collaborators satisfies the rule below without reading a thing",
    ).toContain("capture")
    expect(
      route.find((f) => f.field === "capture")?.value,
      "the url route reading the photo path's provider is the defect this unit was blocked for",
    ).toBe("deps.urlCapture")

    const composed = fieldsAssignedIn(read("src", "server", "main.ts"), "src/server/main.ts")
    const urlCapture = composed.find((f) => f.field === "urlCapture")
    expect(urlCapture, "the composition root names no url capture path at all").toBeDefined()
    expect(
      urlCapture?.callee,
      "a field built by anything but the composite leaves the deterministic reader off the path",
    ).toBe("createUrlCaptureProvider")
    expect(
      urlCapture?.firstArgumentCallee,
      "the composite's first half is what reads a page's own structured data",
    ).toBe("createDeterministicUrlCaptureProvider")

    // The two entries are separate seams, not one value under two names. Giving
    // both the same expression is how the capability was lost, and it would
    // satisfy every assertion above if `urlCapture` were merely required to
    // exist.
    expect(composed.find((f) => f.field === "capture")?.value).not.toBe(urlCapture?.value)
  })
})
