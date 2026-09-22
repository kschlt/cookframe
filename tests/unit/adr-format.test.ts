/**
 * CFV1-ADRF — the record format is declared once and checked against use.
 *
 * ADR-0006 declared the front-matter key list in prose, and the README repeated
 * it; `constrained_by` drifted into use across the tree while neither declaration
 * named it. ADR-0020 supersedes ADR-0006, holds the single machine-readable key
 * list, and this suite is the drift check that keeps the declaration and the
 * records from parting again — in both directions.
 *
 * The check itself ({@link collectDrift} and the loaders) is directory-agnostic;
 * these proofs point it at `docs/adr/`. The undeclared-key and stale-key proofs
 * feed the pure function synthetic inputs so they are discriminating — they show
 * the check failing on a drift it must catch, not merely passing on today's tree.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  collectDrift,
  type DeclaredKeys,
  FORMAT_KEYS_MARKER,
  loadRecordKeys,
  parseDeclaredKeys,
  readFrontMatter,
} from "./adr-format-drift.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const adrDir = join(repoRoot, "docs", "adr")
const ADR_ID = /^ADR-\d+/

/** Read a record file's raw text by its id prefix (e.g. "ADR-0020"). */
function readRecord(idPrefix: string): string {
  const file = readdirSync(adrDir).find((f) => f.startsWith(`${idPrefix}-`) && f.endsWith(".md"))
  if (file === undefined) throw new Error(`no record file for ${idPrefix}`)
  return readFileSync(join(adrDir, file), "utf8")
}

/** Parse a record's front matter as an object, via the drift check's own reader —
 * so the test parses front matter exactly as the loader does, not by a private copy. */
function frontMatter(idPrefix: string): Record<string, unknown> {
  return readFrontMatter(readRecord(idPrefix))
}

const declared: DeclaredKeys = parseDeclaredKeys(readRecord("ADR-0020"))
const records = loadRecordKeys(adrDir, ADR_ID)

describe("adr-format/supersession-is-declared-on-both-sides", () => {
  it("ADR-0020 supersedes the format record", () => {
    const fm = frontMatter("ADR-0020")
    expect(fm.id).toBe("ADR-0020")
    expect(fm.status).toBe("accepted")
    expect((fm.supersedes as string[] | undefined) ?? []).toContain("ADR-0006")
  })

  it("ADR-0006 declares the supersession on its side and its decision body is untouched", () => {
    const fm = frontMatter("ADR-0006")
    expect(fm.status).toBe("superseded")
    expect((fm.superseded_by as string[] | undefined) ?? []).toContain("ADR-0020")
    // The decision body must not have been quietly edited to absorb the change:
    // its own words still stand (only the front-matter supersession links moved).
    const body = readRecord("ADR-0006")
    expect(body).toMatch(/An accepted record is never rewritten/)
    expect(body).toMatch(/One file per decision/)
  })
})

describe("adr-format/one-definition-of-the-format", () => {
  it("exactly one record carries the machine-readable key list, and it is ADR-0020", () => {
    const carriers = readdirSync(adrDir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => readFileSync(join(adrDir, f), "utf8").includes(FORMAT_KEYS_MARKER))
    expect(carriers).toHaveLength(1)
    expect(carriers[0]).toMatch(/^ADR-0020-/)
  })

  it("the README references that record and does not repeat the key list", () => {
    const readme = readFileSync(join(adrDir, "README.md"), "utf8")
    expect(readme).toMatch(/ADR-0020/)
    // The README is not a second definition: it holds neither the machine-readable
    // block nor a re-enumeration of the declared keys. The old guard pinned three
    // key spellings in one order — a re-enumeration in any other spelling or order
    // slipped past it. Instead, count how many declared keys appear as whole words
    // anywhere in the README: prose that references the record names a key or two in
    // passing (e.g. `status`, `supersedes`), but repeating the list would name most
    // of them. Assert fewer than half — spelling- and order-independent.
    expect(readme).not.toContain(FORMAT_KEYS_MARKER)
    const allDeclared = [...declared.required, ...declared.optional, ...declared.reserved]
    const named = allDeclared.filter((key) => new RegExp(`\\b${key}\\b`).test(readme))
    expect(named.length, `README names too many declared keys: ${named.join(", ")}`).toBeLessThan(
      allDeclared.length / 2,
    )
  })
})

describe("adr-format/undeclared-key-fails", () => {
  it("a record using a key the format does not declare is a drift", () => {
    const drift = collectDrift(
      [{ id: "ADR-9999", keys: [...declared.required, "invented_key"] }],
      declared,
    )
    expect(drift).toContainEqual({
      kind: "undeclared-key",
      key: "invented_key",
      record: "ADR-9999",
    })
  })
})

describe("adr-format/missing-required-key-fails", () => {
  it("a record that omits a required key is a drift", () => {
    // `required` is a real constraint, not a label: a record missing one of them
    // drifts. Without this, `required` and `optional` would be interchangeable and
    // the declaration could not say a key must always be present.
    const withoutDate = declared.required.filter((k) => k !== "date")
    const drift = collectDrift(
      [{ id: "ADR-9999", keys: [...withoutDate, ...declared.optional] }],
      declared,
    )
    expect(drift).toContainEqual({
      kind: "missing-required-key",
      key: "date",
      record: "ADR-9999",
    })
  })
})

describe("adr-format/unused-declared-key-fails", () => {
  it("a declared key no record uses is a stale-declaration drift", () => {
    const withGhost: DeclaredKeys = {
      required: declared.required,
      optional: [...declared.optional, "ghost_key"],
      reserved: declared.reserved,
    }
    const drift = collectDrift(records, withGhost)
    expect(drift).toContainEqual({ kind: "stale-declared-key", key: "ghost_key" })
  })

  it("a key declared reserved is exempt from the stale check", () => {
    const reservedGhost: DeclaredKeys = {
      required: declared.required,
      optional: declared.optional,
      reserved: [...declared.reserved, "ghost_key"],
    }
    const drift = collectDrift(records, reservedGhost)
    expect(drift.some((v) => v.key === "ghost_key")).toBe(false)
  })
})

describe("adr-format/the-loader-recovers-each-record-id", () => {
  it("loadRecordKeys captures the full id from the filename, not a truncated prefix", () => {
    // The synthetic drift proofs feed collectDrift hand-built RecordKeys, so they
    // never exercise the loader that turns a filename into an id. This does: it runs
    // the real loader over the tree. The id must be the full `ADR-NNNN`, never cut at
    // the first hyphen — the title that follows carries hyphens too, and cutting there
    // collapses every record's id to the bare "ADR", which reads as one id repeated.
    const ids = loadRecordKeys(adrDir, ADR_ID).map((r) => r.id)
    expect(ids).toContain("ADR-0006")
    expect(ids).toContain("ADR-0020")
    expect(ids).not.toContain("ADR")
    for (const id of ids) expect(id).toMatch(/^ADR-\d+$/)
    // No two records share an id — the collapse-to-"ADR" bug produced N identical ids.
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("adr-format/existing-records-unchanged", () => {
  it("every record now in the tree conforms to the declaration with no drift", () => {
    const drift = collectDrift(records, declared)
    expect(drift, JSON.stringify(drift)).toEqual([])
  })

  it("the record set is non-trivial (the check is not passing vacuously)", () => {
    expect(records.length).toBeGreaterThan(1)
    // `constrained_by` — the key whose drift prompted this item — is really in use,
    // so the declaration naming it is confirmed against the tree, not just asserted.
    expect(records.some((r) => r.keys.includes("constrained_by"))).toBe(true)
    expect(declared.optional).toContain("constrained_by")
  })
})
