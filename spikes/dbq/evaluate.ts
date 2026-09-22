/**
 * CFV1-DBQ — run the three deciding queries against both shapes and report.
 *
 * `ADR-0003` asked for a comparison, not a verdict, so this prints results per
 * query and per shape and leaves the reading to the record. Two guards keep it
 * honest:
 *
 * * Both shapes answer from the SAME data in the SAME engine, so nothing in the
 *   numbers is an engine difference.
 * * Every query's result is compared across shapes. A cost difference only means
 *   something once the two shapes are known to be answering the same question,
 *   and a disagreement is reported as a finding rather than averaged away.
 *
 * PRIVACY: the real corpus is third-party recipe text under
 * `evals/fixtures/private/`. The detailed report is written back there, where
 * `.gitignore` keeps it. What this prints — and what may be quoted in the record
 * — is counts, rates and timings. No ingredient name, title or step text.
 *
 * USAGE:
 *   npx tsx spikes/dbq/evaluate.ts [--in <dir>] [--repeat 7]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Client } from "pg"
import type { SourceSnapshot } from "../../schema/index.js"
import type { CanonicalVersion } from "../../src/persistence/repository.js"
import { connect, resetShape, type Shape, SHAPES, useShape } from "./db.js"
import { QUERY_LABELS, renderPerQueryPerShape, runOutcome, type ShapeReading } from "./report.js"
import { loadDocument } from "./document-shape.js"
import { loadHybrid } from "./hybrid-shape.js"
import { compareRuns, SHOPPING_SQL, shoppingRequirements } from "./queries.js"
import { loadRelational } from "./relational-shape.js"
import {
  createDocumentStore,
  createHybridStore,
  createRelationalStore,
  LIBRARY_SQL,
  listLibrary,
} from "./stores.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..")

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const inDir = arg("--in") ?? join(repoRoot, "evals", "fixtures", "private", "s1-gate")
const repeat = Number(arg("--repeat") ?? "7")

/** Every shape answered the same question iff every result is the same value. */
function agree(byShape: Record<string, unknown>): boolean {
  const seen = new Set(Object.values(byShape).map((v) => JSON.stringify(v)))
  return seen.size === 1
}

/** Median, not mean: one cold first run should not move the number. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number)
}

async function timed<T>(n: number, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  let result = await fn() // warm: the first call pays for parsing and planning
  const runs: number[] = []
  for (let i = 0; i < n; i++) {
    const t = process.hrtime.bigint()
    result = await fn()
    runs.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  return { result, ms: median(runs) }
}

/** Count the statements a shape issues, which is where a read shape's cost is. */
function counting(client: Client): { client: Client; reset(): void; count(): number } {
  let n = 0
  const original = client.query.bind(client)
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (...args: unknown[]) => {
          n += 1
          return (original as (...a: unknown[]) => unknown)(...args)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  return { client: proxy, reset: () => { n = 0 }, count: () => n }
}

interface Corpus {
  readonly versions: readonly CanonicalVersion[]
  readonly snapshots: readonly SourceSnapshot[]
  readonly withTwoRuns: readonly string[]
}

function readCorpus(dir: string): Corpus {
  const files = readdirSync(dir)
  const versions = files
    .filter((f) => f.endsWith(".canonical.json") || f.endsWith(".canonical.v2.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CanonicalVersion)
  const snapshots = files
    .filter((f) => f.endsWith(".snapshot.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as SourceSnapshot)
  const byId = new Map<string, number>()
  for (const v of versions) byId.set(v.recipeId, (byId.get(v.recipeId) ?? 0) + 1)
  const withTwoRuns = [...byId.entries()].filter(([, n]) => n >= 2).map(([id]) => id).sort()
  return { versions, snapshots, withTwoRuns }
}

async function main(): Promise<void> {
  const client = await connect()
  if (client === undefined) {
    console.error("no PostgreSQL server answered — set DATABASE_URL, or start one locally.")
    process.exit(2)
  }
  const corpus = readCorpus(inDir)
  const counter = counting(client)
  const report: string[] = []
  const say = (line = ""): void => {
    console.log(line)
    report.push(line)
  }

  say(`# CFV1-DBQ — the three deciding queries, both shapes, real Slice 1 data`)
  say()
  say(`Corpus: ${corpus.versions.length} Canonical Recipe versions over ` +
      `${new Set(corpus.versions.map((v) => v.recipeId)).size} recipes, ` +
      `${corpus.withTwoRuns.length} of them with two normalization runs; ` +
      `${corpus.snapshots.length} Source Snapshots. ` +
      `Engine: one PostgreSQL server, one schema per shape. Timings are medians of ${repeat}.`)
  say()

  // --- loading ------------------------------------------------------------
  const load: Record<string, { inserts: number; ms: number }> = {}
  for (const shape of SHAPES) {
    await resetShape(client, shape)
    const loader =
      shape === "document" ? loadDocument : shape === "hybrid" ? loadHybrid : loadRelational
    load[shape] = await loader(client, corpus.versions, corpus.snapshots)
  }
  say(`## Writing`)
  say()
  say(`| shape | INSERT statements | ms |`)
  say(`|---|---|---|`)
  for (const shape of SHAPES) {
    say(`| ${shape} | ${load[shape]?.inserts} | ${load[shape]?.ms} |`)
  }
  say()

  // --- query 1 ------------------------------------------------------------
  const library: Record<string, unknown> = {}
  const q1: Record<string, { rows: number; ms: number; statements: number }> = {}
  for (const shape of SHAPES) {
    // No `useShape` first: `listLibrary` applies the schema itself now, so a
    // second one here would be a redundant round-trip INSIDE the timed region.
    // The statement count is measured, not assumed — it is 2 (the `set
    // search_path` and the select), and the column used to state 1.
    counter.reset()
    const { result, ms } = await timed(repeat, () => listLibrary(counter.client, shape))
    library[shape] = result
    q1[shape] = { rows: result.length, ms, statements: Math.round(counter.count() / (repeat + 1)) }
  }
  const q1Agrees = agree(library)

  // --- query 2 ------------------------------------------------------------
  const shopping: Record<string, unknown> = {}
  const q2: Record<string, { rows: number; ms: number; statements: number }> = {}
  for (const shape of SHAPES) {
    counter.reset()
    const { result, ms } = await timed(repeat, () => shoppingRequirements(counter.client, shape))
    shopping[shape] = result
    q2[shape] = { rows: result.length, ms, statements: Math.round(counter.count() / (repeat + 1)) }
  }
  const q2Agrees = agree(shopping)

  // --- query 3 ------------------------------------------------------------
  const comparisons: Record<string, unknown> = {}
  const q3: Record<string, { ms: number; statements: number; differences: number; same: number }> = {}
  for (const shape of SHAPES) {
    const repo =
      shape === "document"
        ? createDocumentStore(counter.client, shape)
        : shape === "hybrid"
          ? createHybridStore(counter.client, shape)
          : createRelationalStore(counter.client, shape)
    counter.reset()
    const { result, ms } = await timed(repeat, async () => {
      // Sequential: one connection, and overlapping queries on it would measure
      // pg's own queueing rather than the shape's read path.
      const out = []
      for (const id of corpus.withTwoRuns) out.push(await compareRuns(repo, id, 1, 2))
      return out
    })
    const statements = Math.round(counter.count() / (repeat + 1) / Math.max(1, corpus.withTwoRuns.length))
    comparisons[shape] = result
    q3[shape] = {
      ms,
      statements,
      differences: result.reduce((n, c) => n + c.differences.length, 0),
      same: result.reduce((n, c) => n + c.same, 0),
    }
  }
  const q3Agrees = agree(comparisons)

  // Rendered by `report.ts` rather than here, so that the criterion this table
  // IS can be exercised by a test without a database. See that module.
  const readings: Partial<Record<Shape, ShapeReading>> = {}
  for (const shape of SHAPES) {
    readings[shape] = {
      libraryRows: q1[shape]?.rows ?? 0,
      libraryStatements: q1[shape]?.statements ?? 0,
      libraryMs: q1[shape]?.ms ?? 0,
      librarySqlChars: LIBRARY_SQL[shape]?.trim().length ?? 0,
      shoppingLines: q2[shape]?.rows ?? 0,
      shoppingStatements: q2[shape]?.statements ?? 0,
      shoppingMs: q2[shape]?.ms ?? 0,
      shoppingSqlChars: SHOPPING_SQL[shape]?.trim().length ?? 0,
      comparisonDifferences: q3[shape]?.differences ?? 0,
      comparisonStatements: q3[shape]?.statements ?? 0,
      comparisonMs: q3[shape]?.ms ?? 0,
    }
  }
  for (const line of renderPerQueryPerShape(SHAPES, readings)) say(line)
  say(`Agreement between the shapes — same data, same question, same answer:`)
  say()
  say(`| query | shapes agree |`)
  say(`|---|---|`)
  say(`| 1 library list | ${q1Agrees ? "yes" : "**NO**"} |`)
  say(`| 2 shopping | ${q2Agrees ? "yes" : "**NO**"} |`)
  say(`| 3 run comparison | ${q3Agrees ? "yes" : "**NO**"} |`)
  say()

  // --- what the comparison query actually surfaced ------------------------
  const docComparisons = comparisons.document as Array<{ recipeId: string; same: number; differences: Array<{ path: string }> }>
  const branch = (p: string): string => `/${p.split("/")[1] ?? ""}`
  const byBranch = new Map<string, number>()
  for (const c of docComparisons) {
    for (const d of c.differences) byBranch.set(branch(d.path), (byBranch.get(branch(d.path)) ?? 0) + 1)
  }
  const totalLeaves = docComparisons.reduce((n, c) => n + c.same + c.differences.length, 0)
  say(`## What the comparison query has to surface`)
  say()
  say(`Two real normalization runs of the same ${docComparisons.length} snapshots, compared leaf by leaf ` +
      `(a leaf is one scalar at one JSON Pointer).`)
  say()
  say(`| | count |`)
  say(`|---|---|`)
  say(`| leaves compared | ${totalLeaves} |`)
  say(`| leaves equal | ${docComparisons.reduce((n, c) => n + c.same, 0)} |`)
  say(`| leaves differing | ${docComparisons.reduce((n, c) => n + c.differences.length, 0)} |`)
  say()
  say(`Where the two runs disagree, by top-level branch of the contract:`)
  say()
  say(`| branch | differing leaves |`)
  say(`|---|---|`)
  for (const [b, n] of [...byBranch.entries()].sort((a, z) => z[1] - a[1])) say(`| \`${b}\` | ${n} |`)
  say()

  // --- structural cost ----------------------------------------------------
  const ddl = (shape: Shape): string => readFileSync(join(here, `schema-${shape}.sql`), "utf8")
  const tables = (shape: Shape): number => (ddl(shape).match(/^create table /gm) ?? []).length
  const loc = (file: string): number =>
    readFileSync(join(here, file), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*")).length
  say(`## Structural cost`)
  say()
  const ddlLines = (shape: Shape): number =>
    ddl(shape).split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("--")).length
  say(`| | document | hybrid | relational |`)
  say(`|---|---|---|---|`)
  say(`| tables | ${tables("document")} | ${tables("hybrid")} | ${tables("relational")} |`)
  say(`| DDL lines | ${ddlLines("document")} | ${ddlLines("hybrid")} | ${ddlLines("relational")} |`)
  say(`| shape module lines (write + read) | ${loc("document-shape.ts")} | ${loc("document-shape.ts") + loc("hybrid-shape.ts")} | ${loc("relational-shape.ts")} |`)
  say(`| INSERT statements for the corpus | ${load.document?.inserts} | ${load.hybrid?.inserts} | ${load.relational?.inserts} |`)
  say()

  writeFileSync(join(inDir, "dbq-report.md"), `${report.join("\n")}\n`)
  writeFileSync(
    join(inDir, "dbq-results.json"),
    `${JSON.stringify({ load, q1, q2, q3, q1Agrees, q2Agrees, q3Agrees }, null, 2)}\n`,
  )
  console.log(`\nWrote the report to ${inDir}/dbq-report.md (git-ignored).`)
  await client.end()

  // A cost difference means nothing until the shapes are known to answer the
  // same question — this script says so itself, and then exited 0 anyway when
  // they did not. The report is still written, because a disagreement is the
  // thing you most need to read; what must not happen is the run LOOKING
  // successful, because that is how timings from an invalid run get quoted
  // into a decision record.
  const outcome = runOutcome({
    [QUERY_LABELS[0]]: q1Agrees,
    [QUERY_LABELS[1]]: q2Agrees,
    [QUERY_LABELS[2]]: q3Agrees,
  })
  if (outcome.exitCode !== 0) {
    console.error(
      `\nSHAPES DISAGREE on: ${outcome.disagreeing.join(", ")}. ` +
        `The timings above compare answers that are not the same answer, so they ` +
        `do not measure the shapes and must not be quoted. Report written for diagnosis.`,
    )
    process.exit(outcome.exitCode)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
