/**
 * CFV1-IDS — the proofs that a record number is defined once.
 *
 * Three things have to be true at once, and each is proved by PLANTING the
 * violation and requiring the check to go red at its own assertion: reading a
 * guard and believing it is how this repository has twice shipped a proof that
 * guarded something next to what its name claimed.
 *
 * The plant is made in a COPY of the shipped tree rather than in `docs/` itself.
 * That is not squeamishness: test files run in parallel, `adr-format.test.ts`
 * reads the same directory, and a duplicate record dropped into `docs/adr/` for
 * a moment would turn THAT suite red — a planted violation failing somewhere
 * other than at its own assertion, which proves nothing about the check under
 * test. The copy holds the real records, and the real directory loader walks it,
 * so what goes red is the shipped rule over the shipped documents plus one
 * deliberate fault.
 *
 * The check pointing at the real tree is covered separately: the green proofs
 * below run against `docs/` and assert the load is non-trivial, so a rule aimed
 * at an empty or wrong directory cannot pass them by finding nothing.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import {
  collectDuplicateDefinitions,
  collectUnresolvedCitations,
  type Definition,
  type IdViolation,
  linesOf,
  loadOpenQuestionDefinitions,
  loadRecordDefinitions,
  type RecordSource,
} from "./record-ids.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** The two record directories and the register — the whole definition surface. */
const ADR: RecordSource = { dir: join(repoRoot, "docs", "adr"), label: "docs/adr", prefix: "ADR" }
const PDR: RecordSource = {
  dir: join(repoRoot, "docs", "product-decisions"),
  label: "docs/product-decisions",
  prefix: "PDR",
}
const REGISTER_LABEL = "docs/open-questions.md"
const registerText = readFileSync(join(repoRoot, REGISTER_LABEL), "utf8")

const shippedRecords = [loadRecordDefinitions(ADR), loadRecordDefinitions(PDR)]
const shippedRegister = loadOpenQuestionDefinitions(registerText, REGISTER_LABEL)
const shipped = [...shippedRecords, shippedRegister]
const shippedDefinitions: Definition[] = shipped.flatMap((l) => [...l.definitions])
const shippedLines = shipped.flatMap((l) => [...l.lines])
const shippedIds = new Set(shippedDefinitions.map((d) => d.id))

/** Temporary copies of the shipped tree, removed when the file is done. */
const copies: string[] = []
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true })
})

/** A throwaway copy of a real record directory, for planting into. */
function copyOf(source: RecordSource): RecordSource {
  const dir = mkdtempSync(join(tmpdir(), "cookframe-records-"))
  copies.push(dir)
  cpSync(source.dir, dir, { recursive: true })
  return { ...source, dir }
}

/** Write one extra file into a copied directory. */
function plantFile(source: RecordSource, name: string, text: string): void {
  writeFileSync(join(source.dir, name), text)
}

/** A minimal but well-formed record body, so only the planted fault is at fault. */
const recordText = (id: string): string =>
  `---
id: "${id}"
title: "A planted record"
status: accepted
date: 2026-09-22
tags: ["planted"]
---

## Context

Planted by a proof.
`

/** The register with one extra line spliced in after the line that matches. */
function plantLine(after: RegExp, line: string): string {
  const lines = registerText.split("\n")
  const at = lines.findIndex((l) => after.test(l))
  expect(at, `no line matched ${after}`).toBeGreaterThan(-1)
  return [...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join("\n")
}

/** Narrow to one kind, so an assertion cannot be satisfied by a different failure. */
const ofKind = (violations: readonly IdViolation[], kind: IdViolation["kind"]): IdViolation[] =>
  violations.filter((v) => v.kind === kind)

/** The ids a report names. A violation that carries no id is rendered as its kind
 * rather than dropped, so an assertion on this list cannot be satisfied by the
 * wrong kind of failure arriving in the right shape. */
const idsOf = (violations: readonly IdViolation[]): string[] =>
  violations.map((v) => ("id" in v ? v.id : `<${v.kind}>`))

describe("records/every-record-number-is-defined-once", () => {
  it("no ADR or PDR number in the tree is claimed twice, and the load is not empty", () => {
    const records = shippedRecords.flatMap((l) => [...l.definitions])
    expect(collectDuplicateDefinitions(records)).toEqual([])
    // Non-vacuity: a rule pointed at nothing reports no duplicates either. These
    // are the two directories and two ids that must be in the load for the
    // emptiness above to mean the tree is clean.
    expect(records.length).toBeGreaterThan(25)
    expect(records.map((r) => r.id)).toContain("ADR-0025")
    expect(records.map((r) => r.id)).toContain("PDR-0004")
    // And the records were readable: the front matter agreed with every filename.
    expect(shippedRecords.flatMap((l) => [...l.violations])).toEqual([])
  })

  it("a second file claiming an existing number fails, naming both files", () => {
    const planted = copyOf(ADR)
    plantFile(planted, "ADR-0025-a-second-claim-on-the-same-number.md", recordText("ADR-0025"))

    const duplicates = collectDuplicateDefinitions(loadRecordDefinitions(planted).definitions)
    expect(duplicates).toHaveLength(1)
    const [violation] = duplicates as [Extract<IdViolation, { kind: "duplicate-definition" }>]
    expect(violation.id).toBe("ADR-0025")
    // Both sites, not just "a duplicate exists": the useful half of the report is
    // which two files claim the number, because one of them has to be renumbered.
    expect(violation.where).toHaveLength(2)
    expect(violation.where).toContain("docs/adr/ADR-0025-a-second-claim-on-the-same-number.md")
    expect(violation.where).toContain(
      "docs/adr/ADR-0025-repository-interface-gains-the-cooking-plan-operations.md",
    )
  })

  it("a PDR number is held to the same rule as an ADR number", () => {
    // Product decisions live in their own directory, so a rule that walked only
    // `docs/adr/` would pass every proof above while leaving half the records
    // unguarded. (The item's own spec says both kinds live under `docs/adr/`;
    // they do not, and this is the proof that the check follows the tree.)
    const planted = copyOf(PDR)
    plantFile(planted, "PDR-0004-a-second-claim-on-the-same-number.md", recordText("PDR-0004"))

    const duplicates = collectDuplicateDefinitions(loadRecordDefinitions(planted).definitions)
    expect(idsOf(duplicates)).toEqual(["PDR-0004"])
  })

  it("a filename and a front-matter id that disagree fail, naming both ids", () => {
    // The other half of "defined once": a file named for one number whose front
    // matter claims another is two claims wearing one coat, and a citation that
    // follows the filename and a reader who trusts the front matter end up in
    // different records.
    const planted = copyOf(ADR)
    plantFile(planted, "ADR-0099-the-filename-says-one-thing.md", recordText("ADR-0100"))

    const violations = ofKind(loadRecordDefinitions(planted).violations, "id-disagrees")
    expect(violations).toHaveLength(1)
    const [violation] = violations as [Extract<IdViolation, { kind: "id-disagrees" }>]
    expect(violation.where).toBe("docs/adr/ADR-0099-the-filename-says-one-thing.md")
    expect(violation.filenameId).toBe("ADR-0099")
    expect(violation.frontMatterId).toBe("ADR-0100")
  })

  it("a record file the rule cannot read is a failure, not an exemption", () => {
    // Fail closed. A record with no front matter would otherwise be skipped by
    // the uniqueness rule and could carry any id it liked in its prose.
    const planted = copyOf(ADR)
    plantFile(planted, "ADR-0098-no-front-matter.md", "## Context\n\nNothing declared.\n")

    const violations = ofKind(loadRecordDefinitions(planted).violations, "unreadable-definition")
    expect(violations.map((v) => (v as { where: string }).where)).toEqual([
      "docs/adr/ADR-0098-no-front-matter.md",
    ])
  })

  it("a file that is not a record is not read as one", () => {
    // `docs/adr/README.md` has no front matter and must not be a violation, or
    // the check is red on a clean tree and gets switched off in a week.
    expect(loadRecordDefinitions(ADR).definitions.map((d) => d.where)).not.toContain(
      "docs/adr/README.md",
    )
    expect(loadRecordDefinitions(ADR).violations).toEqual([])
  })
})

describe("records/every-open-question-id-is-defined-once", () => {
  it("no open-question id is defined by two rows, and the register was really read", () => {
    expect(collectDuplicateDefinitions(shippedRegister.definitions)).toEqual([])
    expect(shippedRegister.violations).toEqual([])
    expect(shippedRegister.definitions.length).toBeGreaterThan(40)
    const ids = shippedRegister.definitions.map((d) => d.id)
    expect(ids).toContain("OQ-43")
    // Both tables in the file, not only the first: the release-readiness block
    // holds OQ-25 onwards, and OQ-25a is lettered precisely because of it.
    expect(ids).toContain("OQ-25")
    expect(ids).toContain("OQ-25a")
  })

  it("a second row defining an existing id fails, naming both rows", () => {
    const text = plantLine(/^\| OQ-42 \|/, "| OQ-42 | a different question entirely | open |")

    const loaded = loadOpenQuestionDefinitions(text, REGISTER_LABEL)
    const duplicates = collectDuplicateDefinitions(loaded.definitions)
    expect(duplicates).toHaveLength(1)
    const [violation] = duplicates as [Extract<IdViolation, { kind: "duplicate-definition" }>]
    expect(violation.id).toBe("OQ-42")
    // Two rows, each located: this is the collision that happened on 2026-09-22,
    // and a report that does not say WHERE leaves the reader grepping a file
    // whose every row mentions ids.
    expect(violation.where).toHaveLength(2)
    for (const where of violation.where) expect(where).toMatch(/^docs\/open-questions\.md:\d+$/)
  })

  it("the letter is part of the id: OQ-25 and OQ-25a are two questions", () => {
    // A rule that read the number and dropped the suffix would report today's
    // clean register as a duplicate — the false alarm that gets a guard removed.
    // The same rule must still catch a second OQ-25a.
    const text = plantLine(/^\| OQ-25a \|/, "| OQ-25a | a second claim on the lettered id | open |")
    const duplicates = collectDuplicateDefinitions(
      loadOpenQuestionDefinitions(text, REGISTER_LABEL).definitions,
    )
    expect(idsOf(duplicates)).toEqual(["OQ-25a"])
  })

  it("a mention in prose is not a definition", () => {
    // The decision that keeps this check alive. Records and rows cite ids
    // constantly, and a regex over the document would call every cross-reference
    // a duplicate. Three sentences naming ids that are all already defined must
    // add nothing at all.
    const text = plantLine(
      /^## Release readiness/,
      "\nOQ-42 is discussed in OQ-43, and OQ-01 closed by ADR-0007 the way OQ-01 always was.\n",
    )
    const loaded = loadOpenQuestionDefinitions(text, REGISTER_LABEL)
    expect(collectDuplicateDefinitions(loaded.definitions)).toEqual([])
    expect(loaded.definitions).toHaveLength(shippedRegister.definitions.length)
  })

  it("a table row that is not an id is a failure, not an exemption", () => {
    // Fail closed, the register's side of it: a row the rule cannot read is a
    // row whose id it cannot check, so it is reported rather than passed over.
    const text = plantLine(/^\| OQ-01 \|/, "| see above | a row with no id | open |")
    const violations = ofKind(
      loadOpenQuestionDefinitions(text, REGISTER_LABEL).violations,
      "unreadable-definition",
    )
    expect(violations).toHaveLength(1)
    expect((violations[0] as { reason: string }).reason).toContain("see above")
  })
})

describe("records/every-cited-id-resolves", () => {
  it("every id cited by a record or by the register is defined somewhere", () => {
    expect(collectUnresolvedCitations(shippedLines, shippedIds)).toEqual([])
    // Non-vacuity, both halves: lines were actually scanned, and the definitions
    // they resolve against are the real ones. An empty `shippedLines` and an
    // all-accepting `shippedIds` would each pass the line above in silence.
    expect(shippedLines.length).toBeGreaterThan(1000)
    expect(shippedIds.size).toBeGreaterThan(65)
  })

  it("a citation of an id nothing defines is reported, naming where", () => {
    const planted = linesOf("This follows ADR-0404, which was never written.", "docs/adr/x.md")
    const violations = collectUnresolvedCitations([...shippedLines, ...planted], shippedIds)
    expect(violations).toHaveLength(1)
    const [violation] = violations as [Extract<IdViolation, { kind: "unresolved-citation" }>]
    expect(violation.id).toBe("ADR-0404")
    expect(violation.where).toEqual(["docs/adr/x.md:1"])
  })

  // The real shape of the failure: a collision is resolved by renumbering one
  // side, and not every citation of the old number is found. Both kinds of id are
  // driven, because they are scanned by one regex and an alternative dropped from
  // it fails silently — with only the ADR case here, a rule that stopped looking
  // at open-question citations stayed green, and the collision of 2026-09-22 was
  // an OQ collision.
  it.each([
    {
      id: "ADR-0018",
      // ADR-0025 supersedes it, so at minimum that record's citations are found.
      citedBy: "docs/adr/ADR-0025-repository-interface-gains-the-cooking-plan-operations.md:",
    },
    {
      id: "OQ-13",
      // PDR-0004 closes it, and says so in its front matter.
      citedBy:
        "docs/product-decisions/PDR-0004-cooking-plan-generation-is-configurable-and-lazy-by-default.md:",
    },
    {
      id: "PDR-0002",
      // The single-user instance is the premise half the architecture cites.
      citedBy: "docs/adr/ADR-0011-reference-deployment-is-a-rented-single-tenant-cloud-server.md:",
    },
  ])("a renumber that leaves its citations behind is reported ($id)", ({ id, citedBy }) => {
    const renumbered = new Set([...shippedIds].filter((defined) => defined !== id))
    const violations = collectUnresolvedCitations(shippedLines, renumbered)
    expect(idsOf(violations)).toEqual([id])
    const [violation] = violations as [Extract<IdViolation, { kind: "unresolved-citation" }>]
    // The report is per line, so the renumberer gets the list of places to edit.
    expect(violation.where.some((w) => w.startsWith(citedBy))).toBe(true)
    expect(violation.where.length).toBeGreaterThan(1)
  })
})
