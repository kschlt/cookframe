/**
 * Normalization-invariant tests (CFV1-SL0, proof: contributes to
 * slice0/ci-job-coverage — the normalization-invariant job).
 *
 * No normalizer exists yet (SL0 holds no product logic), so this job's future
 * subject — a Canonical Recipe produced from a Source Snapshot — is represented
 * today by the committed fixture pair. The invariants below are the semantic
 * half of the "do not invent" rule (recipe-ontology §4–§5): traceability must
 * resolve, and a value's `kind` must match what the value actually carries.
 *
 * These are deliberately loud rather than vacuous: they walk every
 * ValueExpression and every sourceRef in the fixture and would fail the build
 * the moment a normalizer emits a fact that cannot be traced or a `kind` that
 * lies about its value. When the real normalizer lands, its outputs are added
 * here as further subjects; the invariants themselves do not change.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CanonicalRecipe, SourceSnapshot } from "../../schema/index.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function readFixture(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(repoRoot, "evals", "fixtures", "public", ...parts), "utf8"))
}

const recipe = CanonicalRecipe.parse(readFixture("canonical", "two-yields-nutrition.json"))
const snapshot = SourceSnapshot.parse(readFixture("source-snapshot", "basic.json"))

/** Every block id the snapshot actually contains. */
const knownBlockIds = new Set(snapshot.blocks.map((b) => b.id))

/** Walk the whole recipe and collect every value it holds, keyed by a path. */
type ValueLike = { sourceText: string; kind: string; value?: number }
type RefLike = { blockId?: string; payloadPointer?: string }

function collect(
  node: unknown,
  path: string,
  values: Array<[string, ValueLike]>,
  refs: Array<[string, RefLike]>,
): void {
  if (Array.isArray(node)) {
    node.forEach((child: unknown, i: number) => {
      collect(child, `${path}[${i}]`, values, refs)
    })
    return
  }
  if (node === null || typeof node !== "object") return
  const obj = node as Record<string, unknown>
  if (typeof obj.sourceText === "string" && typeof obj.kind === "string") {
    values.push([path, obj as ValueLike])
  }
  if (
    path.endsWith("sourceRefs") === false &&
    ("blockId" in obj || "payloadPointer" in obj) &&
    !("kind" in obj)
  ) {
    refs.push([path, obj as RefLike])
  }
  for (const [key, child] of Object.entries(obj)) {
    collect(child, path ? `${path}.${key}` : key, values, refs)
  }
}

const values: Array<[string, ValueLike]> = []
const refs: Array<[string, RefLike]> = []
collect(recipe, "recipe", values, refs)

describe("normalization invariants (fixture as representative subject)", () => {
  it("finds values and refs to check (the job is not silently empty)", () => {
    expect(values.length).toBeGreaterThan(0)
    expect(refs.length).toBeGreaterThan(0)
  })

  it("every sourceRef resolves to a block that exists in the snapshot", () => {
    for (const [path, ref] of refs) {
      if (ref.blockId !== undefined) {
        expect(knownBlockIds.has(ref.blockId), `${path} -> ${ref.blockId}`).toBe(true)
      }
    }
  })

  it("a value's kind never lies about the scalar it carries", () => {
    for (const [path, v] of values) {
      if (v.kind === "exact") {
        expect(typeof v.value, `${path} kind=exact`).toBe("number")
      }
      if (v.kind === "none") {
        expect(v.value, `${path} kind=none`).toBeUndefined()
      }
      // Source wording is retained for every value, whatever the kind.
      expect(v.sourceText.length, `${path} sourceText`).toBeGreaterThan(0)
    }
  })
})
