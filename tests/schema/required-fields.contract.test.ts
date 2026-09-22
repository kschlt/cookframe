/**
 * The measurement behind PDR-0005, kept as a check: which fields does the
 * Canonical Recipe REQUIRE, and which of those can hold a value with nothing to
 * trace it to?
 *
 * The defect in `spikes/s1-photo-gate/VERDICT.md` was not really about titles.
 * It was about a contract demanding a value a source need not have, in a place
 * where no check could see it: `title` was required and was the one content
 * field on the whole contract carrying neither `sourceText` (the source's own
 * wording, which claim verification compares against the page) nor `sourceRefs`
 * (the evidence, which ref resolution proves exists). A field with neither is
 * unfalsifiable by construction — whatever is in it, nothing can disagree.
 *
 * That property is a fact about the schema, so it can be read off the schema
 * instead of being remembered. This walks the contract and pins the answer. The
 * allowlist below is not a suppression list: every entry names a field that
 * carries no source content, and adding one is a deliberate act with a reason
 * written next to it. A required CONTENT field with no grounding fails here,
 * which is what makes the class visible instead of waiting for the next
 * photograph to find it.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { CanonicalRecipe, SourceRef } from "../../schema/index.js"

// --- a walker over the contract's own definitions ---------------------------

/**
 * The Zod v4 internals this reads, named once.
 *
 * Reaching into `_def` is deliberate: the alternative is a second, hand-written
 * list of the contract's fields, and a second list is exactly what goes stale
 * without anyone noticing — the thing ADR-0020 had to add a drift check for.
 *
 * What v4 changed, measured rather than looked up, because the shape of this
 * interface IS the port: `_def` survives as an alias of `_zod.def`, so the
 * access path still reads; `typeName` and its `"ZodUnion"` constants are gone,
 * replaced by a lowercase `type`; `shape` is a plain object where it used to be
 * a function; an array's element moved from `type` to `element`; a literal
 * carries `values` rather than `value`; and a discriminated union is a plain
 * `"union"` that happens to carry a `discriminator`, so the two constants this
 * walk used to distinguish collapse into one test.
 *
 * "It breaks loudly on an upgrade" was the old comment's claim here, and it was
 * half right: this walk did break loudly, with a `TypeError`. Two files away it
 * broke SILENTLY, recognising nothing and reporting success. A loud break is an
 * accident of which key disappeared first, never a property, which is why every
 * walk in this repository now carries a bound that fails on an empty result —
 * here the exact list below, and the positive control above it.
 */
interface ZodInternals {
  readonly _def: {
    readonly type: string
    readonly shape?: Record<string, ZodInternals>
    readonly element?: ZodInternals
    readonly innerType?: ZodInternals
    readonly in?: ZodInternals
    readonly options?: readonly ZodInternals[]
    readonly discriminator?: string
    readonly values?: readonly unknown[]
  }
}

const asInternals = (schema: z.ZodTypeAny): ZodInternals => schema as unknown as ZodInternals

/** One required field, with the grounding its enclosing object provides. */
interface RequiredField {
  readonly path: string
  readonly field: string
}

const isOptional = (node: ZodInternals): boolean =>
  node._def.type === "optional" || node._def.type === "nullable"

/** Strip the wrappers that do not change which object a value ultimately is. */
const WRAPS_ONE_TYPE = new Set(["optional", "nullable", "default", "readonly", "nonoptional"])

function unwrap(node: ZodInternals): ZodInternals {
  let current = node
  for (;;) {
    const { type, innerType, element, in: input } = current._def
    if (WRAPS_ONE_TYPE.has(type) && innerType !== undefined) current = innerType
    else if (type === "array" && element !== undefined) current = element
    // v4 has no `ZodEffects`: `.refine` leaves the node's own type alone and
    // only adds checks, so nothing needs unwrapping for it. `.transform` does
    // wrap, as a `pipe` whose `in` is the schema that was transformed. The
    // contract uses only `refine` today; this arm is here so that adding a
    // transform later cannot make the walk quietly shallower.
    else if (type === "pipe" && input !== undefined) current = input
    else return current
  }
}

/**
 * Whether a node holds a VALUE rather than more structure.
 *
 * Only leaves are reported. A field whose type is an object — or a union of
 * them — is structure the walk descends into, and its own grounding is decided
 * where its fields are declared. This is what makes `title` disappear from the
 * report by becoming a union instead of a string: it stopped being a place a
 * value sits and became a place a declaration sits.
 */
const isLeaf = (node: ZodInternals): boolean =>
  node._def.shape === undefined && node._def.type !== "union"

/**
 * Every required LEAF field of every object reachable from `root`, paired with
 * the path of the object that declares it, skipping objects that carry their
 * own `sourceText` or `sourceRefs` — those are the grounded ones, and their
 * fields are traceable whatever else is true of them.
 */
function ungroundedRequiredFields(root: z.ZodTypeAny, rootPath: string): RequiredField[] {
  const found: RequiredField[] = []
  const seen = new Set<string>()

  const visit = (node: ZodInternals, path: string): void => {
    if (seen.has(path)) return
    seen.add(path)
    const current = unwrap(node)
    if (current._def.type === "union") {
      // A discriminated union is a union that carries a discriminator, so one
      // test covers both kinds and the branch names each option by the literal
      // its discriminant holds — `[not_in_source]` rather than `[1]`.
      const discriminator = current._def.discriminator
      for (const [index, option] of (current._def.options ?? []).entries()) {
        const shape = unwrap(option)._def.shape
        const discriminant = discriminator === undefined ? undefined : shape?.[discriminator]
        const literal =
          discriminant === undefined ? undefined : unwrap(discriminant)._def.values?.[0]
        visit(option, `${path}[${String(literal ?? index)}]`)
      }
      return
    }
    const shape = current._def.shape
    if (shape === undefined) return
    const keys = Object.keys(shape)
    const grounded = keys.includes("sourceText") || keys.includes("sourceRefs")
    for (const [key, field] of Object.entries(shape)) {
      if (!grounded && !isOptional(field) && isLeaf(unwrap(field))) {
        found.push({ path, field: key })
      }
      visit(field, `${path}.${key}`)
    }
  }

  visit(asInternals(root), rootPath)
  return found
}

const formatted = (fields: readonly RequiredField[]): string[] =>
  fields.map((f) => `${f.path}.${f.field}`).sort()

// --- the walker can fail ---------------------------------------------------

describe("schema/the-required-field-walk-can-fail", () => {
  it("reports a required content field that carries no source grounding", () => {
    // The contract as it stood before PDR-0005, in miniature: a required
    // `title` string on an object that carries no `sourceText` and no
    // `sourceRefs`. If the walker cannot see this, the check below proves
    // nothing about the real contract either.
    const before = z
      .object({
        id: z.string(),
        title: z.string(),
        steps: z.array(z.object({ sourceText: z.string(), sourceRefs: z.array(SourceRef) })),
      })
      .strict()
    expect(formatted(ungroundedRequiredFields(before, "Before"))).toEqual([
      "Before.id",
      "Before.title",
    ])
  })

  it("stops reporting the field once it is grounded the way the contract grounds one", () => {
    const after = z
      .object({
        id: z.string(),
        title: z.object({ sourceText: z.string(), sourceRefs: z.array(SourceRef) }).strict(),
      })
      .strict()
    expect(formatted(ungroundedRequiredFields(after, "After"))).toEqual(["After.id"])
  })
})

// --- the contract as it stands ---------------------------------------------

/**
 * Every required field on the contract that carries no source grounding, with
 * why that is correct. None of them holds content the source supplies:
 * they are the pipeline's own identity and provenance, the declaration of a
 * state, or a container whose emptiness already expresses absence.
 */
const NOT_SOURCE_CONTENT: readonly string[] = [
  // Identity and versioning: assigned by the pipeline, never by the source.
  // `model-providers` overwrites whatever a model puts here.
  "CanonicalRecipe.id",
  "CanonicalRecipe.schemaVersion",
  // The declared gap itself. `state` is the declaration, not a value read off
  // the page — it is what makes the absence sayable (PDR-0005).
  "CanonicalRecipe.title[not_in_source].state",
  // The normalization run's own record: which snapshot, which run, which
  // ontology version. Pipeline facts about the conversion, not recipe facts.
  "CanonicalRecipe.provenance.sourceSnapshotId",
  "CanonicalRecipe.provenance.sourceSnapshotVersion",
  "CanonicalRecipe.provenance.targetOntologyVersion",
  "CanonicalRecipe.provenance.runId",
  // A hero image the user added or the pipeline stored: `media` as a whole is
  // optional, and these describe stored BYTES, not something the source said.
  "CanonicalRecipe.media.heroImage.storageIdentity",
  "CanonicalRecipe.media.heroImage.origin",
]

describe("schema/no-required-content-field-is-ungrounded", () => {
  it("the contract requires exactly the ungrounded fields that carry no source content", () => {
    // A new entry here is a deliberate act. If this fails because a required
    // field was added, the question to answer first is whether a source can
    // fail to supply it — and if it can, the answer is a declared state, not a
    // line in the list above.
    expect(formatted(ungroundedRequiredFields(CanonicalRecipe, "CanonicalRecipe"))).toEqual(
      [...NOT_SOURCE_CONTENT].sort(),
    )
  })

  it("`title` is no longer among them, and cites its source when it claims one", () => {
    const fields = formatted(ungroundedRequiredFields(CanonicalRecipe, "CanonicalRecipe"))
    expect(fields).not.toContain("CanonicalRecipe.title")
    // The `from_source` branch is absent from the list for the right reason:
    // it declares `sourceText` and `sourceRefs`, so the walker treats it as
    // grounded exactly as it treats an ingredient.
    expect(fields.filter((f) => f.startsWith("CanonicalRecipe.title[from_source]"))).toEqual([])
  })
})
