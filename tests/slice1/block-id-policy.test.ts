/**
 * CFV1-SL1 — deterministic block-id assignment (the CFV1-S6 cross-cutting
 * requirement: make capture ids deterministic rather than model-chosen).
 *
 * Each `describe`/`it` string is the acceptance-criterion proof id it satisfies.
 * These prove what the policy honestly delivers — deterministic, content-derived,
 * unique id ASSIGNMENT given a segmentation — not segmentation stability, which
 * is a capture-prompt property beyond this module (S6's residual risk).
 */
import { describe, expect, it } from "vitest"
import { SnapshotBlock } from "../../schema/index.js"
import {
  type BlockIdPolicy,
  createContentDerivedBlockIdPolicy,
  type RawBlock,
} from "../../src/pipeline/block-id-policy.js"

const policy: BlockIdPolicy = createContentDerivedBlockIdPolicy()

/** The first element, asserting the array is non-empty (satisfies noUncheckedIndexedAccess). */
function first<T>(arr: readonly T[]): T {
  const head = arr[0]
  if (head === undefined) throw new Error("expected a non-empty result")
  return head
}

function idOfText(blocks: readonly SnapshotBlock[], text: string): string {
  const found = blocks.find((b) => b.text === text)
  if (found === undefined) throw new Error(`no block with text ${JSON.stringify(text)}`)
  return found.id
}

describe("slice1/block-id-assignment-deterministic", () => {
  it("assigns identical ids to the same segmentation across independent runs", () => {
    const raw: RawBlock[] = [
      { order: 0, type: "title", text: "Buttermilk Pancakes" },
      { order: 1, type: "ingredient", text: "2 eggs" },
      { order: 2, type: "instruction", text: "Whisk the eggs." },
    ]
    const a = createContentDerivedBlockIdPolicy().assignIds(raw)
    const b = createContentDerivedBlockIdPolicy().assignIds(raw)
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
  })

  it("preserves order, type, heading and text, adding only an id", () => {
    const [out] = policy.assignIds([{ order: 3, type: "title", heading: "H", text: "Pancakes" }])
    if (out === undefined) throw new Error("expected one block")
    expect({ order: out.order, type: out.type, heading: out.heading, text: out.text }).toEqual({
      order: 3,
      type: "title",
      heading: "H",
      text: "Pancakes",
    })
    expect(out.id).toMatch(/^b-[0-9a-f]{12}$/)
  })
})

describe("slice1/block-ids-content-derived", () => {
  it("gives identical content the same id regardless of its position", () => {
    const target: RawBlock = { order: 0, type: "instruction", text: "Whisk the eggs." }
    const early = policy.assignIds([target, { order: 1, type: "note", text: "x" }])
    const late = policy.assignIds([
      { order: 0, type: "note", text: "x" },
      { ...target, order: 1 },
    ])
    expect(idOfText(early, "Whisk the eggs.")).toBe(idOfText(late, "Whisk the eggs."))
  })

  it("gives different content different ids", () => {
    const out = policy.assignIds([
      { order: 0, type: "instruction", text: "Whisk." },
      { order: 1, type: "instruction", text: "Fold." },
    ])
    expect(out[0]?.id).not.toBe(out[1]?.id)
  })

  it("distinguishes blocks that differ only by type", () => {
    const asNote = first(policy.assignIds([{ order: 0, type: "note", text: "Serve hot." }]))
    const asInstr = first(policy.assignIds([{ order: 0, type: "instruction", text: "Serve hot." }]))
    expect(asNote.id).not.toBe(asInstr.id)
  })

  it("treats whitespace-only differences as the same content (normalized)", () => {
    const spaced = first(
      policy.assignIds([{ order: 0, type: "instruction", text: "Whisk  the   eggs." }]),
    )
    const trimmed = first(
      policy.assignIds([{ order: 0, type: "instruction", text: " Whisk the eggs. " }]),
    )
    expect(spaced.id).toBe(trimmed.id)
  })
})

describe("slice1/block-ids-unique-within-snapshot", () => {
  it("assigns unique, deterministic ids to byte-identical duplicate blocks", () => {
    const raw: RawBlock[] = [
      { order: 0, type: "ingredient", text: "Salt" },
      { order: 1, type: "ingredient", text: "Salt" },
      { order: 2, type: "ingredient", text: "Salt" },
    ]
    const ids = policy.assignIds(raw).map((b) => b.id)
    expect(new Set(ids).size).toBe(3)
    expect(
      createContentDerivedBlockIdPolicy()
        .assignIds(raw)
        .map((b) => b.id),
    ).toEqual(ids)
    expect(ids[0]).toMatch(/^b-[0-9a-f]{12}$/)
    expect(ids[1]).toMatch(/^b-[0-9a-f]{12}-1$/)
    expect(ids[2]).toMatch(/^b-[0-9a-f]{12}-2$/)
  })

  it("produces blocks that validate against the contract SnapshotBlock", () => {
    const out = policy.assignIds([{ order: 0, type: "title", heading: "Title", text: "Pancakes" }])
    expect(() => SnapshotBlock.parse(first(out))).not.toThrow()
  })
})
