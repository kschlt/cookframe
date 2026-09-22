/**
 * CFV1-IDS — a record number is DEFINED once, and every citation resolves.
 *
 * Every open pull request reads `main`, takes the next free number, and cannot
 * see the others. On 2026-09-22 that produced three ADR collisions inside ninety
 * minutes and one open-question collision, where two branches each registered a
 * different `OQ-42` and a different `OQ-43`. Every one of them was caught by a
 * person reading two branches side by side. Nothing in the repository would have
 * caught any of them: two files with the same id parse fine, two table rows with
 * the same id render fine, and the whole suite stays green.
 *
 * Central allocation by one thread is the stopgap in force since that morning,
 * and it holds only while every thread remembers to ask. This check is the part
 * that does not depend on remembering — with "up to date before merging"
 * required, the second pull request must pull `main` before it can merge, and
 * that is the moment this turns red.
 *
 * **A definition is judged structurally, never by a regex over the document.**
 * A record is defined by its FILENAME together with its front-matter `id`; an
 * open question is defined by the FIRST COLUMN of a table row. Records cite each
 * other constantly — `ADR-0025` names `ADR-0018` four times — so a check that
 * counted mentions would report a false duplicate for every cross-reference, and
 * a guard that cries wolf on correct work is a guard somebody switches off.
 *
 * The rule runs in the other direction too. A renumber that misses a citation
 * leaves a record pointing at an id nothing defines, which is the same failure
 * seen from the other side, so {@link collectUnresolvedCitations} reports it.
 *
 * **Fail closed.** A file that matches a record's filename shape but carries no
 * readable front matter, and a table row in the register whose first cell is not
 * an id, are violations rather than exemptions. That is deliberate and it has a
 * cost: a second kind of table in the register has to be taught to this rule
 * before it can be added. An id-uniqueness check that quietly skips what it
 * cannot read is a check that reports zero duplicates on a tree it never looked
 * at.
 *
 * Nothing here allocates a number, suggests the next free one, or edits a
 * record. It reads the tree and reports — it is the opposite of an index, which
 * `CLAUDE.md` forbids for the reason that an index has to be kept true by hand.
 *
 * The loaders take a directory and a label rather than finding the repository
 * themselves, so a proof can run the real loader over a copy of the real tree
 * with one violation planted in it, and the collectors are pure functions over
 * already-loaded data.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { readFrontMatter } from "../unit/adr-format-drift.js"

/** One id and the place that defines it, as a reader would look the place up. */
export interface Definition {
  readonly id: string
  /** Repository-relative, e.g. `docs/adr/ADR-0025-….md` or `docs/open-questions.md:37`. */
  readonly where: string
}

/** One line of a document, with where it came from — what the citation scan reads. */
export interface SourceLine {
  readonly where: string
  readonly text: string
}

/**
 * A single failure. `duplicate-definition` and `unresolved-citation` name every
 * place involved, because the useful half of "0025 is claimed twice" is which
 * two files claim it.
 */
export type IdViolation =
  | {
      readonly kind: "duplicate-definition"
      readonly id: string
      readonly where: readonly string[]
    }
  | {
      readonly kind: "id-disagrees"
      readonly where: string
      readonly filenameId: string
      readonly frontMatterId: string
    }
  | { readonly kind: "unreadable-definition"; readonly where: string; readonly reason: string }
  | {
      readonly kind: "unresolved-citation"
      readonly id: string
      readonly where: readonly string[]
    }

/** What a loader returns: what it defined, what it could not read, and the lines
 * the citation scan still has to walk. */
export interface Loaded {
  readonly definitions: readonly Definition[]
  readonly violations: readonly IdViolation[]
  readonly lines: readonly SourceLine[]
}

/** A directory of decision records sharing one id prefix. */
export interface RecordSource {
  /** Absolute path to read. */
  readonly dir: string
  /** Repository-relative name of that directory, for the messages. */
  readonly label: string
  /** `ADR` or `PDR` — records live in different directories per kind. */
  readonly prefix: string
}

/**
 * Every id shape this repository uses, as it appears in prose or front matter.
 *
 * The optional letter is not decoration: `OQ-25a` is a real id, lettered because
 * `OQ-25` onwards were already taken when it was registered, and the register
 * says an id is never reused or renumbered. An id is therefore a string, not a
 * number, and `OQ-25` and `OQ-25a` are two different questions.
 */
const CITED_ID = /\b(?:ADR|PDR|OQ)-\d+[a-z]?\b/g

/** Split a document into located lines, ready for {@link collectUnresolvedCitations}. */
export function linesOf(text: string, label: string): SourceLine[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, i) => ({
      where: `${label}:${i + 1}`,
      text: line,
    }))
}

/**
 * Load the records of one directory: the id from the filename, checked against
 * the front-matter `id`.
 *
 * Files that do not begin with the prefix are not records and are skipped — the
 * directory README is the standing example. A file that DOES begin with it and
 * then fails to parse is a violation, not a skip: that is where a malformed
 * record would otherwise hide from the uniqueness rule.
 *
 * When the two disagree the FILENAME wins as the definition, because the
 * filename is what a reader follows from a citation. The disagreement is
 * reported either way, so the build is red regardless of which one was wrong.
 */
export function loadRecordDefinitions(source: RecordSource): Loaded {
  const named = new RegExp(`^(${source.prefix}-\\d+)-.+\\.md$`)
  const definitions: Definition[] = []
  const violations: IdViolation[] = []
  const lines: SourceLine[] = []

  for (const file of readdirSync(source.dir).sort()) {
    if (!file.endsWith(".md") || !file.startsWith(`${source.prefix}-`)) continue
    const where = `${source.label}/${file}`
    const match = file.match(named)
    if (match === null) {
      violations.push({
        kind: "unreadable-definition",
        where,
        reason: `filename is not ${source.prefix}-NNNN-<title>.md`,
      })
      continue
    }
    const filenameId = match[1] as string
    const text = readFileSync(join(source.dir, file), "utf8")
    lines.push(...linesOf(text, where))

    let frontMatterId: unknown
    try {
      frontMatterId = readFrontMatter(text).id
    } catch (error) {
      violations.push({
        kind: "unreadable-definition",
        where,
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (typeof frontMatterId !== "string") {
      violations.push({ kind: "unreadable-definition", where, reason: "front matter has no id" })
    } else if (frontMatterId !== filenameId) {
      violations.push({ kind: "id-disagrees", where, filenameId, frontMatterId })
    }
    definitions.push({ id: filenameId, where })
  }

  return { definitions, violations, lines }
}

/** `|---|---|---|` and the like: a table's rule line, which defines nothing. */
const TABLE_RULE = /^\|[\s:|-]+\|$/
/** The register's column header. */
const HEADER_CELL = "Id"
/** The first cell of a row that defines an open question. */
const OQ_ID = /^OQ-\d+[a-z]?$/

/**
 * Load the open questions the register DEFINES: one per table row, judged by the
 * row's first column.
 *
 * Every line outside a table is prose and defines nothing, but it is still
 * returned in `lines` so its citations are checked. Inside a table, a row whose
 * first cell is neither the header nor an id is unreadable rather than ignored.
 */
export function loadOpenQuestionDefinitions(text: string, label: string): Loaded {
  const definitions: Definition[] = []
  const violations: IdViolation[] = []
  const lines = linesOf(text, label)

  for (const line of lines) {
    if (!line.text.startsWith("|")) continue
    if (TABLE_RULE.test(line.text.trim())) continue
    const first = (line.text.split("|")[1] ?? "").trim()
    if (first === HEADER_CELL) continue
    if (!OQ_ID.test(first)) {
      violations.push({
        kind: "unreadable-definition",
        where: line.where,
        reason: `table row does not begin with an open-question id: ${JSON.stringify(first)}`,
      })
      continue
    }
    definitions.push({ id: first, where: line.where })
  }

  return { definitions, violations, lines }
}

/** Every id defined more than once, with all of its definition sites. */
export function collectDuplicateDefinitions(definitions: readonly Definition[]): IdViolation[] {
  const byId = new Map<string, string[]>()
  for (const definition of definitions) {
    const seen = byId.get(definition.id)
    if (seen === undefined) byId.set(definition.id, [definition.where])
    else seen.push(definition.where)
  }
  return [...byId.entries()]
    .filter(([, where]) => where.length > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, where]) => ({ kind: "duplicate-definition" as const, id, where }))
}

/**
 * Every id cited somewhere that no definition matches — the renumber that missed
 * a citation, seen from the citing side.
 */
export function collectUnresolvedCitations(
  lines: readonly SourceLine[],
  defined: ReadonlySet<string>,
): IdViolation[] {
  const byId = new Map<string, string[]>()
  for (const line of lines) {
    for (const id of line.text.match(CITED_ID) ?? []) {
      if (defined.has(id)) continue
      const seen = byId.get(id)
      if (seen === undefined) byId.set(id, [line.where])
      else if (!seen.includes(line.where)) seen.push(line.where)
    }
  }
  return [...byId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, where]) => ({ kind: "unresolved-citation" as const, id, where }))
}
