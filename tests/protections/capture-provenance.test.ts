/**
 * protections/every-capture-context-states-its-provenance — a capture context
 * built in `src/` says where its bytes came from.
 *
 * The measured failure: the photo route built its context without
 * `sourceProvenance`, the model-backed provider failed closed to the text path,
 * and every photograph a running instance was sent answered 500 (#104). Every
 * proof of the route ran on a fake that ignores the field, so none of them could
 * see it. This file reads the source instead of running it.
 *
 * `capture-provenance.ts` states the rule and what it reads. Following
 * ADR-0029, the empty set asserted on the tree is held by names: the three
 * places the instance builds a context are listed with what each states, so a
 * reader that stops seeing one of them is red, and so is a new one, which
 * arrives as a decision instead of passing unseen. The reader and the checker
 * are held against a source written to contain every way a context can be
 * built, the wrong ones included.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { filesUnder, SOURCE_EXTENSIONS } from "../support/tree.js"
import { captureContextsIn, unstated } from "./capture-provenance.js"
import { repoRoot } from "./majors.js"

const sources = new Map(
  filesUnder(join(repoRoot, "src"), { match: SOURCE_EXTENSIONS }).map((path) => [
    path,
    readFileSync(path, "utf8"),
  ]),
)
const tree = captureContextsIn(sources, repoRoot)
const bySite = (cs: typeof tree) => cs.map(({ site, provenance }) => ({ site, provenance }))

describe("protections/every-capture-context-states-its-provenance", () => {
  it("finds, by name, every place the running instance builds a capture context", () => {
    // Named rather than counted, and with what each one states. A reader that
    // stops seeing a file, a position or a form loses a row here; a new place
    // that builds a context adds one. Either way this is red until someone
    // looks, which is the point: the photo route was a new place nobody looked
    // at.
    expect(bySite(tree)).toEqual([
      // A page the user held: the vision path and its verification exemption.
      { site: "src/http/ingest-app.ts > ingest", provenance: "photo" },
      // A fetched page: someone else's words, verified against them.
      { site: "src/http/ingest-app.ts > importFromUrl", provenance: "url" },
      // The URL path's model fallback, handed the page's extracted text.
      { site: "src/pipeline/url-capture.ts > modelFallback.capture", provenance: "url" },
    ])
  })

  it("no capture context leaves out where its bytes came from", () => {
    expect(
      unstated(tree).map((c) => `${c.at} (${c.site}): ${c.provenance ?? "not stated"}`),
      "a context without sourceProvenance fails closed to the text path, which is how every photograph answered 500",
    ).toEqual([])
  })
})

// --- the reader and the checker, held against a source written for them -----

const FIXTURE_ROOT = join(repoRoot, "capture-provenance-fixture")

const FIXTURE = new Map([
  [
    join(FIXTURE_ROOT, "providers.ts"),
    `
export interface CaptureContext {
  readonly snapshotId: string
  readonly runId: string
  readonly sourceProvenance?: "url" | "paste" | "photo"
}
export interface NormalizationContext {
  readonly runId: string
}
export declare function ingest(bytes: Uint8Array, ctx: CaptureContext): Promise<void>
export declare function later(ctx?: CaptureContext): void
export declare function nested(args: { readonly ctx: CaptureContext }): void
export declare function normalize(ctx: NormalizationContext): void
export declare function take(value: object): void
`,
  ],
  [
    join(FIXTURE_ROOT, "a.ts"),
    `
import { type CaptureContext, ingest, later, nested, normalize, take } from "./providers.js"
declare function pick(): "photo" | "url"
declare function make(): CaptureContext
declare const flag: boolean

const annotated: CaptureContext = { snapshotId: "s", runId: "r", sourceProvenance: "paste" }

export async function routes(ctx: CaptureContext): Promise<void> {
  await ingest(new Uint8Array(), { snapshotId: "s", runId: "r", sourceProvenance: "photo" })
  await ingest(new Uint8Array(), { snapshotId: "s", runId: "r" })
  await ingest(new Uint8Array(), { ...ctx, sourceProvenance: "url" })
  await ingest(new Uint8Array(), { ...ctx })
  await ingest(new Uint8Array(), { sourceProvenance: "paste", ...ctx })
  await ingest(new Uint8Array(), { snapshotId: "s", runId: "r", sourceProvenance: pick() })
  const sourceProvenance = pick()
  await ingest(new Uint8Array(), { snapshotId: "s", runId: "r", sourceProvenance })
  await ingest(new Uint8Array(), ({ snapshotId: "s", runId: "r", sourceProvenance: "photo" }))
  await ingest(new Uint8Array(), { snapshotId: "s", runId: "r" } as CaptureContext)
  await ingest(
    new Uint8Array(),
    flag ? { snapshotId: "s", runId: "r", sourceProvenance: "photo" } : { snapshotId: "s", runId: "r" },
  )
  const byName = { snapshotId: "s", runId: "r" }
  await ingest(new Uint8Array(), byName)
  await ingest(new Uint8Array(), annotated)
  await ingest(new Uint8Array(), make())
  const fromHelper = make()
  await ingest(new Uint8Array(), fromHelper)
  await ingest(new Uint8Array(), ctx)
  later({ snapshotId: "s", runId: "r", sourceProvenance: "url" })
  nested({ ctx: { snapshotId: "s", runId: "r", sourceProvenance: "paste" } })
  normalize({ runId: "r" })
  take({ snapshotId: "s", runId: "r" })
}

export function fresh(): CaptureContext {
  return { snapshotId: "s", runId: "r", sourceProvenance: "photo" }
}

export const build = (): CaptureContext => ({ snapshotId: "s", runId: "r", sourceProvenance: "paste" })

export const checked = { snapshotId: "s", runId: "r", sourceProvenance: "url" } satisfies CaptureContext
`,
  ],
])

describe("protections/every-capture-context-states-its-provenance", () => {
  const found = captureContextsIn(FIXTURE, FIXTURE_ROOT)

  it("reads a capture context through every way one can be built, and says what each states", () => {
    // Every row is a way to build a context, and each is here because a reader
    // without it would pass the tree today and miss the next author's form.
    // What is NOT here is held by the same equality: the forwarded `ctx`, the
    // second reach of `annotated` through its name, a literal of another context
    // type, and a literal handed to a parameter typed `object`.
    expect(bySite(found)).toEqual([
      { site: "a.ts > const annotated", provenance: "paste" },
      { site: "a.ts > ingest", provenance: "photo" },
      { site: "a.ts > ingest", provenance: undefined },
      { site: "a.ts > ingest", provenance: "url" },
      // A spread alone states nothing of its own.
      { site: "a.ts > ingest", provenance: undefined },
      // A spread AFTER the property can put the absence back.
      { site: "a.ts > ingest", provenance: undefined },
      { site: "a.ts > ingest", provenance: "<computed>" },
      // The shorthand form is an expression too.
      { site: "a.ts > ingest", provenance: "<computed>" },
      // Through parentheses, a cast, and both arms of a conditional.
      { site: "a.ts > ingest", provenance: "photo" },
      { site: "a.ts > ingest", provenance: undefined },
      { site: "a.ts > ingest", provenance: "photo" },
      { site: "a.ts > ingest", provenance: undefined },
      // Built without an annotation, and a context only where it is handed over.
      { site: "a.ts > ingest (via byName)", provenance: undefined },
      // A helper's result: not read into, and so reported rather than trusted.
      { site: "a.ts > ingest", provenance: "<unreadable>" },
      // And the same through a name bound to anything but a literal.
      { site: "a.ts > ingest", provenance: "<unreadable>" },
      // An optional parameter: the type there is `CaptureContext | undefined`.
      { site: "a.ts > later", provenance: "url" },
      { site: "a.ts > ctx:", provenance: "paste" },
      { site: "a.ts > return from fresh", provenance: "photo" },
      { site: "a.ts > return from build", provenance: "paste" },
      { site: "a.ts > const checked", provenance: "url" },
    ])
  })

  it("objects to each context that does not state a provenance it can read, and to no other", () => {
    expect(unstated(found).map((c) => c.provenance)).toEqual([
      undefined,
      undefined,
      undefined,
      "<computed>",
      "<computed>",
      undefined,
      undefined,
      undefined,
      "<unreadable>",
      "<unreadable>",
    ])
  })
})
