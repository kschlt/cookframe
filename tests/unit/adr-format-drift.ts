/**
 * CFV1-ADRF — the drift check: the durable half of the item.
 *
 * A decision record's front matter may carry only the keys the format declares.
 * The format used to be declared in prose in two places (the format record and
 * the directory README), and prose drifts silently: `constrained_by` came into
 * use across the tree without either declaration naming it. This check makes that
 * drift fail the build, in both directions — a record using an undeclared key,
 * and a declared key no record uses (a stale declaration) — so neither the error
 * that happened nor its mirror can recur unseen.
 *
 * It is deliberately directory-agnostic: {@link collectDrift} is a pure function
 * over already-loaded data, and the loaders take a path, so the same check points
 * at `docs/adr/` today and at `docs/product-decisions/` later without a rewrite.
 * There is no schema language here — a list of key names and set arithmetic is the
 * smallest thing that fails on drift.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

/**
 * The front-matter keys a record may carry, as declared by the authoritative
 * record. `required` and `optional` must each be used by at least one record;
 * `reserved` keys are exempt from that — they are declared ahead of a use that
 * does not exist yet (e.g. held for a coming supersession). The distinction is
 * the item's central decision: a declared-but-unused key is treated as STALE and
 * fails the build, so a key kept for the future must say so by being reserved.
 */
export interface DeclaredKeys {
  readonly required: readonly string[]
  readonly optional: readonly string[]
  readonly reserved: readonly string[]
}

/** One record's identity and the set of front-matter keys it actually carries. */
export interface RecordKeys {
  readonly id: string
  readonly keys: readonly string[]
}

/** A single drift: a key that should not be used, a missing required key, or a
 * declaration gone stale. */
export interface DriftViolation {
  readonly kind: "undeclared-key" | "missing-required-key" | "stale-declared-key"
  readonly key: string
  /** The offending record; absent for a stale declaration (which names no record). */
  readonly record?: string
}

/**
 * Compare the keys records actually use against what the format declares, and
 * return every drift. Empty means the declaration and the records agree.
 *
 * - `undeclared-key`: a record carries a key the declaration does not list.
 * - `missing-required-key`: a record is missing a `required` key. This is what
 *   makes `required` a real constraint rather than a label — the declaration says
 *   every record carries these, so a record that does not is drift.
 * - `stale-declared-key`: a `required`/`optional` key no record uses. `reserved`
 *   keys are exempt (that is what reserving one means).
 */
export function collectDrift(
  records: readonly RecordKeys[],
  declared: DeclaredKeys,
): DriftViolation[] {
  const declaredSet = new Set<string>([
    ...declared.required,
    ...declared.optional,
    ...declared.reserved,
  ])
  const reservedSet = new Set<string>(declared.reserved)
  const usedKeys = new Set<string>()
  const violations: DriftViolation[] = []

  for (const record of records) {
    const present = new Set<string>(record.keys)
    for (const key of record.keys) {
      usedKeys.add(key)
      if (!declaredSet.has(key)) {
        violations.push({ kind: "undeclared-key", key, record: record.id })
      }
    }
    for (const key of declared.required) {
      if (!present.has(key)) {
        violations.push({ kind: "missing-required-key", key, record: record.id })
      }
    }
  }

  for (const key of [...declared.required, ...declared.optional]) {
    if (!reservedSet.has(key) && !usedKeys.has(key)) {
      violations.push({ kind: "stale-declared-key", key })
    }
  }

  return violations
}

/**
 * Parse a record's YAML front matter to an object. Tolerant of CRLF endings, and
 * the one front-matter reader the drift check and its tests share, rather than the
 * `^---\n…\n---\n` regex being written out per call site.
 */
export function readFrontMatter(text: string): Record<string, unknown> {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/)
  if (match === null) throw new Error("record has no front matter")
  return (parseYaml(match[1] as string) as Record<string, unknown> | null) ?? {}
}

/** Load every record in a directory whose filename matches `idPattern`, as its
 * id (captured from the filename by that pattern) and its front-matter keys. */
export function loadRecordKeys(dir: string, idPattern: RegExp): RecordKeys[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && idPattern.test(f))
    .sort()
    .map((f) => {
      const keys = Object.keys(readFrontMatter(readFileSync(join(dir, f), "utf8")))
      // Capture the id (e.g. "ADR-0006"), never cut at the first hyphen — the
      // title that follows also contains hyphens.
      const id = f.match(idPattern)?.[0] ?? f.replace(/\.md$/, "")
      return { id, keys }
    })
}

/**
 * Extract the single machine-readable key declaration a record carries between
 * `<!-- format-keys:start -->` and `<!-- format-keys:end -->` (a fenced YAML
 * block). This is the one definition of the format; the README references the
 * record rather than repeating it.
 */
export function parseDeclaredKeys(recordText: string): DeclaredKeys {
  const region = recordText.match(
    /<!--\s*format-keys:start\s*-->([\s\S]*?)<!--\s*format-keys:end\s*-->/,
  )
  if (region === null) throw new Error("no format-keys block found in the authoritative record")
  const fenced = (region[1] as string).match(/```ya?ml\n([\s\S]*?)\n```/)
  if (fenced === null) throw new Error("format-keys block has no fenced yaml")
  const parsed = parseYaml(fenced[1] as string) as Partial<DeclaredKeys> | null
  return {
    required: parsed?.required ?? [],
    optional: parsed?.optional ?? [],
    reserved: parsed?.reserved ?? [],
  }
}

/** The marker that identifies the file holding the one key definition. */
export const FORMAT_KEYS_MARKER = "<!-- format-keys:start -->"
