/**
 * serve/a-photograph-is-kept-before-it-is-read — the store that keeps a
 * photograph is on the path a photograph takes, ahead of the model.
 *
 * The rule and its limits are stated in `scan-retention-wiring.ts`. This file is
 * the rule's breadth: the fixtures plant each way the wiring can be lost while
 * the tree still compiles, and the last case reads the real tree.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { fieldPassedTo, initializerCallee, readPhotoRoute } from "./scan-retention-wiring.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf8")

/**
 * The two routes as the ingest app holds them, with the photograph kept first.
 *
 * The URL route comes FIRST here although it comes second in the real file,
 * and that is load-bearing: a detector that read the whole file instead of the
 * photo route would find a `put` moved into the URL route ahead of the photo
 * route's `ingest(`, and only this order lets the row below that plants exactly
 * that tell the two readings apart.
 */
const URL_ROUTE = (inside = "") => `
app.post("/capture/url", async (c) => {
${inside}  const result = await importFromUrl({ capture: deps.urlCapture }, url, ctx)
  return c.json(result, 201)
})
`
const PHOTO_ROUTE = (before: string, after = "") => `
app.post("/capture", bodyLimit({}), async (c) => {
  const body = new Uint8Array(await c.req.arrayBuffer())
${before}  const result = await ingest(deps.repo, deps.capture, deps.normalization, deps.policy, body, a, b)
${after}  return c.json(result, 201)
})
`
const KEEP = (receiver: string, argument: string) => `  try {
    await ${receiver}.put(${argument})
  } catch {
    return c.json({ error: "capture_failed" }, 500)
  }
`
const KEPT = URL_ROUTE() + PHOTO_ROUTE(KEEP("deps.scanStore", "body"))

/** What the real tree must read as, stated once so every plant is measured against it. */
function keptBeforeRead(source: string): boolean {
  const route = readPhotoRoute(source)
  const first = Math.min(...route.ingests)
  return (
    route.routeFound &&
    route.ingests.length > 0 &&
    route.puts.length === 1 &&
    route.puts[0]?.receiver === "deps.scanStore" &&
    route.puts[0]?.argument === "body" &&
    (route.puts[0]?.at ?? Number.POSITIVE_INFINITY) < first
  )
}

describe("serve/a-photograph-is-kept-before-it-is-read", () => {
  it("reads the photo route as keeping the photograph, then reading it", () => {
    expect(keptBeforeRead(KEPT)).toBe(true)
  })

  /**
   * Each row is an edit someone could make believing it harmless. Every one of
   * them compiles, and every one of them leaves a running instance answering
   * 201 to a photograph it did not keep, or kept only when the model agreed.
   */
  const LOSSES = [
    {
      name: "the put removed",
      source: URL_ROUTE() + PHOTO_ROUTE(""),
      why: "the shape the instance had before this unit: the store built and never called",
    },
    {
      name: "the put moved after the read",
      source: URL_ROUTE() + PHOTO_ROUTE("", KEEP("deps.scanStore", "body")),
      why: "keeping then depends on the model: a refused or failed capture loses its photograph",
    },
    {
      name: "the put moved to the url route",
      source: URL_ROUTE(KEEP("deps.scanStore", "body")) + PHOTO_ROUTE(""),
      why: "a fetched page is not a scan, and the photo route would keep nothing",
    },
    {
      name: "a different collaborator's put",
      source: URL_ROUTE() + PHOTO_ROUTE(KEEP("deps.repo", "body")),
      why: "the name is read, so a put on another seam must not pass for this one",
    },
    {
      name: "something other than the photograph kept",
      source: URL_ROUTE() + PHOTO_ROUTE(KEEP("deps.scanStore", "new Uint8Array(0)")),
      why: "the start-up probe's argument in the route keeps an empty file per capture and no photograph",
    },
    {
      name: "kept twice, once after the read",
      source:
        URL_ROUTE() + PHOTO_ROUTE(KEEP("deps.scanStore", "body"), KEEP("deps.scanStore", "body")),
      why: "exactly one put is what makes 'before' mean the only put rather than the first of several",
    },
  ] as const

  it.each(LOSSES)("catches: $name", ({ source }) => {
    expect(source, "the plant did not change the fixture").not.toBe(KEPT)
    expect(keptBeforeRead(source)).toBe(false)
  })

  it("keeps the table from shrinking to the one case that shipped", () => {
    expect(LOSSES.length).toBeGreaterThan(3)
    expect(new Set(LOSSES.map((l) => l.why)).size).toBe(LOSSES.length)
  })

  it("reads a store built once and passed on by name the same as one built inline", () => {
    // The composition root builds the store, probes it, and only then passes it
    // on — so the field is a shorthand for a binding, and a rule that read only
    // inline calls would report the real tree as unwired.
    const hoisted = `
      const scanStore = createFilesystemByteStore(config.storageRoot)
      await scanStore.put(new Uint8Array(0))
      await startInstance({ repo, scanStore }, config.port)
    `
    expect(fieldPassedTo(hoisted, "startInstance", "scanStore")).toEqual(["scanStore"])
    expect(initializerCallee(hoisted, "scanStore")).toBe("createFilesystemByteStore")

    // And a binding to something else is not mistaken for the store.
    const elsewhere = hoisted.replace("createFilesystemByteStore(", "createProvisionalStore(")
    expect(initializerCallee(elsewhere, "scanStore")).toBe("createProvisionalStore")
  })

  /**
   * The real subject: the tree as it is now.
   *
   * The floor comes first: a scan that found no photo route, or no `ingest(`
   * inside it, would satisfy an ordering rule vacuously.
   */
  it("keeps the photograph on the store main.ts builds, before the model reads it", () => {
    const route = readPhotoRoute(
      read("src", "http", "ingest-app.ts"),
      "/capture",
      "src/http/ingest-app.ts",
    )
    expect(route.routeFound, 'no app.post("/capture", …) in src/http/ingest-app.ts').toBe(true)
    expect(
      route.ingests.length,
      "the photo route reaches no ingest( call, so no order can be read",
    ).toBeGreaterThan(0)
    expect(
      route.puts.map((p) => `${p.receiver}.put(${p.argument})`),
      "the photo route must call deps.scanStore.put(body) exactly once",
    ).toEqual(["deps.scanStore.put(body)"])
    expect(
      (route.puts[0]?.at ?? Number.POSITIVE_INFINITY) < Math.min(...route.ingests),
      "deps.scanStore.put(body) must come before ingest( in the photo route: kept, then read",
    ).toBe(true)

    expect(
      fieldPassedTo(read("src", "server", "instance.ts"), "createIngestApp", "scanStore"),
      "the instance must hand the ingest app scanStore: deps.scanStore",
    ).toEqual(["deps.scanStore"])

    const main = read("src", "server", "main.ts")
    const passed = fieldPassedTo(main, "startInstance", "scanStore")
    expect(
      passed,
      "main.ts must pass startInstance a scanStore — inline, or as a const built by createFilesystemByteStore",
    ).toHaveLength(1)
    const expression = passed[0] as string
    const builtBy = /^[A-Za-z_$][\w$]*$/.test(expression)
      ? initializerCallee(main, expression)
      : /^([A-Za-z_$][\w$]*)\(/.exec(expression)?.[1]
    expect(
      builtBy,
      `main.ts passes scanStore: ${expression}, which is not built by createFilesystemByteStore`,
    ).toBe("createFilesystemByteStore")
  })
})
