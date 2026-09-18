/**
 * Minimal eval harness (CFV1-SL0). It validates every committed public fixture
 * against the one contract in `schema/`, and exits non-zero on any failure so
 * CI and `npm run eval` fail loudly. Private fixtures (real photos, personal
 * recipes) live under evals/fixtures/private/ and are never read here — that
 * directory is git-ignored and absent in CI.
 *
 * Later slices grow this into the real capture/normalization eval; today its
 * job is to prove the harness runs and the contract is enforceable.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ZodType } from "zod"
import { CanonicalRecipe, SourceSnapshot } from "../schema/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, "fixtures", "public")

interface Case {
  readonly dir: string
  readonly schema: ZodType
}

const cases: readonly Case[] = [
  { dir: join(publicDir, "canonical"), schema: CanonicalRecipe },
  { dir: join(publicDir, "source-snapshot"), schema: SourceSnapshot },
]

function jsonFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((n) => n.endsWith(".json"))
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile())
}

export interface EvalResult {
  readonly total: number
  readonly failures: readonly { readonly file: string; readonly message: string }[]
}

export function runEvals(): EvalResult {
  const failures: { file: string; message: string }[] = []
  let total = 0
  for (const c of cases) {
    for (const file of jsonFiles(c.dir)) {
      total++
      const data: unknown = JSON.parse(readFileSync(file, "utf8"))
      const result = c.schema.safeParse(data)
      if (!result.success) {
        failures.push({
          file,
          message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        })
      }
    }
  }
  return { total, failures }
}

// Run when invoked directly (npm run eval), not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { total, failures } = runEvals()
  for (const f of failures) console.error(`FAIL ${f.file}\n  ${f.message}`)
  console.log(`${total - failures.length}/${total} public fixtures valid against the schema`)
  process.exit(failures.length === 0 ? 0 : 1)
}
