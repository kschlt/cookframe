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

/** A single drift: a key that should not be used, or a declaration gone stale. */
export interface DriftViolation {
  readonly kind: "undeclared-key" | "stale-declared-key"
  readonly key: string
  /** The record that used an undeclared key; absent for a stale declaration. */
  readonly record?: string
}

/**
 * Compare the keys records actually use against what the format declares, and
 * return every drift. Empty means the declaration and the records agree.
 *
 * - `undeclared-key`: a record carries a key the declaration does not list.
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
    for (const key of record.keys) {
      usedKeys.add(key)
      if (!declaredSet.has(key)) {
        violations.push({ kind: "undeclared-key", key, record: record.id })
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

/** The top-level front-matter keys of one record file, in file order. */
function frontMatterKeys(text: string): string[] {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/)
  if (match === null) throw new Error("record has no front matter")
  const parsed = parseYaml(match[1] as string) as Record<string, unknown> | null
  return parsed === null ? [] : Object.keys(parsed)
}

/** Load every `NNNN`-style record in a directory as its id and its keys. */
export function loadRecordKeys(dir: string, idPattern: RegExp): RecordKeys[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && idPattern.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8")
      const id = f.replace(/-.*$/, "").replace(/\.md$/, "")
      return { id, keys: frontMatterKeys(text) }
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
