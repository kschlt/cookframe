/**
 * protections/a-fake-cannot-hide-a-missing-field — every optional seam input
 * that a shipped implementation reads and a fake ignores is named, together
 * with the proof that runs its callers over the shipped implementation instead.
 *
 * `seam-fields.ts` says why (ADR-0033, the defect behind #104) and how the tree
 * is read. The answer to such a field is one of two things. Either the field
 * becomes required, and the compiler refuses the caller that leaves it out, or
 * a proof drives the callers through the shipped implementation, where leaving
 * it out changes what comes back. The table below holds the second answer for
 * each field that has it. A new field that matches the three conditions, with
 * neither answer, is red here by name. An entry whose field no longer matches
 * is red too, so the table cannot keep claiming a guard that has gone.
 *
 * The scan itself is held to the standard ADR-0029 sets for structural guards.
 * The set it reports on the tree is named member by member, not claimed empty
 * or counted. And each of the three conditions is shown to decide on sources
 * built for it, so dropping any one of them turns a case red.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { programOverTree } from "../support/src-program.js"
import { repoRoot } from "./majors.js"
import { blindSpotsIn, fakeFilesIn, programFromSources } from "./seam-fields.js"

/**
 * Each blind spot in the tree, and the proof that answers it by running the
 * callers over the shipped implementation. Named by `describe` title and file,
 * so the entry points at a proof that exists rather than at a sentence.
 *
 * That an entry's proof answers its field is a human claim, and review is what
 * holds it. The only part a machine checks here is that the proof exists: an
 * entry naming a real proof that never touches the field stays green. To show
 * that the proof goes red when a caller leaves the field out, remove the field
 * at the caller with `mutation.ts`, as ADR-0033's evidence does.
 */
const CALLERS_PROVED_OVER_THE_SHIPPED_IMPLEMENTATION: Readonly<
  Record<string, { readonly proof: string; readonly file: string }>
> = {
  // The photo route states both, and the proof reads both back off the
  // exchange the shipped provider built: an image part at all (provenance),
  // and that part's media type as the phone sent it (a PNG, where the
  // provider's own default is JPEG).
  "CaptureProvider.capture(CaptureContext).sourceMediaType": {
    proof: "run/a-photograph-reaches-the-model-as-a-photograph",
    file: "tests/run/photograph-read-as-photograph.test.ts",
  },
  "CaptureProvider.capture(CaptureContext).sourceProvenance": {
    proof: "run/a-photograph-reaches-the-model-as-a-photograph",
    file: "tests/run/photograph-read-as-photograph.test.ts",
  },
}

const srcRoot = join(repoRoot, "src")
const tree = programOverTree()

describe("protections/a-fake-cannot-hide-a-missing-field", () => {
  it("counts the fakes the suite runs on", () => {
    // The scan's notion of a fake is a file name. Held by name, so a renamed
    // fake file is red here rather than a seam with no fake to compare against.
    expect(fakeFilesIn(tree, srcRoot)).toEqual(["pipeline/fake-providers.ts"])
  })

  it("names every field a fake ignores and a shipped implementation reads", () => {
    const spots = blindSpotsIn(tree, srcRoot)
    const unanswered = spots.filter(
      (s) => !(s.key in CALLERS_PROVED_OVER_THE_SHIPPED_IMPLEMENTATION),
    )
    expect(
      unanswered,
      "an optional seam field a shipped implementation reads and a fake ignores: a caller " +
        "that leaves it out passes every proof on the fake. Make the field required, or name " +
        "the proof that runs its callers over the shipped implementation in the table above",
    ).toEqual([])
    expect(
      spots.map((s) => s.key),
      "a table entry whose field no longer matches all three conditions",
    ).toEqual(Object.keys(CALLERS_PROVED_OVER_THE_SHIPPED_IMPLEMENTATION).sort())
  })

  it("points each entry at a proof that exists", () => {
    for (const { proof, file } of Object.values(CALLERS_PROVED_OVER_THE_SHIPPED_IMPLEMENTATION)) {
      const text = readFileSync(join(repoRoot, file), "utf8")
      expect(text.split(`describe("${proof}"`).length - 1, `${proof} in ${file}`).toBe(1)
    }
  })
})

/** A seam, a shipped implementation and a fake, each replaceable per case. */
const seam = (sources: Partial<Record<string, string>>): Record<string, string> => ({
  "src/port.ts": `
    export interface Ctx { readonly id: string; readonly mode?: string }
    export interface Port { run(input: string, ctx: Ctx): string }`,
  "src/shipped.ts": `
    import type { Port } from "./port"
    export const shipped: Port = { run(input, ctx) { return ctx.mode === "a" ? input : "" } }`,
  "src/fake-port.ts": `
    import type { Port } from "./port"
    export const fake: Port = { run(input) { return input } }`,
  ...(sources as Record<string, string>),
})
const spotsIn = (sources: Record<string, string>): string[] =>
  blindSpotsIn(programFromSources(sources), "/virtual/src").map((s) => s.key)

describe("protections/the-seam-field-scan-decides-on-each-condition", () => {
  it("finds the field when the fake does not declare the parameter", () => {
    expect(spotsIn(seam({}))).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the fake declares the parameter and reads another field", () => {
    expect(
      spotsIn(
        seam({
          "src/fake-port.ts": `
          import type { Port } from "./port"
          export const fake: Port = { run(input, ctx) { return ctx.id + input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the shipped implementation reads it through a helper", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Ctx, Port } from "./port"
          function pick(c: Ctx): string { return c.mode ?? "" }
          export const shipped: Port = { run(input, ctx) { return pick(ctx) + input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the shipped implementation destructures the parameter", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Port } from "./port"
          export const shipped: Port = { run(input, { mode }) { return mode ?? input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the shipped implementation destructures it in its body", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Port } from "./port"
          export const shipped: Port = { run(input, ctx) { const { mode } = ctx; return mode ?? input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the shipped implementation is an arrow function property", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Port } from "./port"
          export const shipped: Port = { run: (input, ctx) => ctx.mode ?? input }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the shipped implementation is a class", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Ctx, Port } from "./port"
          export class Shipped implements Port { run(input: string, ctx: Ctx): string { return ctx.mode ?? input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("finds it when the input is not the last parameter", () => {
    // Both seams in the tree take their context second and last, so nothing
    // there holds the scan to every parameter. This does.
    expect(
      spotsIn(
        seam({
          "src/port.ts": `
          export interface Ctx { readonly id: string; readonly mode?: string }
          export interface Port { run(ctx: Ctx, input: string, extra: string): string }`,
          "src/shipped.ts": `
          import type { Port } from "./port"
          export const shipped: Port = { run(ctx, input) { return ctx.mode ?? input } }`,
          "src/fake-port.ts": `
          import type { Port } from "./port"
          export const fake: Port = { run(ctx, input) { return input } }`,
        }),
      ),
    ).toEqual(["Port.run(Ctx).mode"])
  })

  it("does not report it when the fake reads it", () => {
    expect(
      spotsIn(
        seam({
          "src/fake-port.ts": `
          import type { Port } from "./port"
          export const fake: Port = { run(input, ctx) { return ctx.mode ?? input } }`,
        }),
      ),
    ).toEqual([])
  })

  it("does not report it when the field is required", () => {
    expect(
      spotsIn(
        seam({
          "src/port.ts": `
          export interface Ctx { readonly id: string; readonly mode: string; readonly note?: string }
          export interface Port { run(input: string, ctx: Ctx): string }`,
        }),
      ),
    ).toEqual([])
  })

  it("does not report it when no shipped implementation reads it", () => {
    expect(
      spotsIn(
        seam({
          "src/shipped.ts": `
          import type { Port } from "./port"
          export const shipped: Port = { run(input, ctx) { return ctx.id + input } }`,
        }),
      ),
    ).toEqual([])
  })

  it("does not count an implementation outside a fake file as a fake", () => {
    expect(
      spotsIn(
        seam({
          "src/fake-port.ts": "export {}",
          "src/other-port.ts": `
          import type { Port } from "./port"
          export const other: Port = { run(input) { return input } }`,
        }),
      ),
    ).toEqual([])
  })
})
